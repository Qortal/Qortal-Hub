import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import type { FileHandle } from 'fs/promises';
import { basename, dirname, isAbsolute, join } from 'path';

export const SAVE_CHUNK_LIMIT = 256 * 1024;
const MAX_SIZE = 8 * 1024 ** 3;
const IDLE_MS = 5 * 60_000;
type Save = {
  id: string;
  owner: string;
  size: number;
  offset: number;
  created: number;
  touched: number;
  cancelled: boolean;
  busy: boolean;
  file?: FileHandle;
  part?: string;
  destination?: string;
};
export class SaveError extends Error {}
function fail(code: string): never {
  throw new SaveError(code);
}

/** Paths never cross the renderer boundary. Only the native dialog chooses them. */
export class QAppFileSaves {
  private saves = new Map<string, Save>();
  private recovery?: Promise<void>;
  constructor(
    private journal: string,
    private now = Date.now
  ) {}
  initialize() {
    return (this.recovery ??= this.recover());
  }

  private async recover() {
    await fs.mkdir(this.journal, { recursive: true, mode: 0o700 });
    for (const name of await fs.readdir(this.journal)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const record = join(this.journal, name);
      try {
        const part = JSON.parse(await fs.readFile(record, 'utf8')).part;
        if (
          typeof part !== 'string' ||
          !isAbsolute(part) ||
          basename(part) !== `.qortal-save-${name.slice(0, -5)}.part`
        )
          continue;
        await fs.unlink(part).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
        });
        await fs.unlink(record);
      } catch {
        /* Keep failed records for a later recovery attempt. */
      }
    }
  }

  async open(
    owner: string,
    filename: unknown,
    size: unknown,
    choose: (
      filename: string,
      size: number,
      checkLive: () => void
    ) => Promise<string | undefined>
  ) {
    if (
      typeof filename !== 'string' ||
      !filename ||
      filename.length > 200 ||
      /[\\/\u202a-\u202e\u2066-\u2069]/.test(filename) ||
      [...filename].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
      ) ||
      filename === '.' ||
      filename === '..' ||
      !Number.isSafeInteger(size) ||
      (size as number) < 0 ||
      (size as number) > MAX_SIZE
    )
      fail('SAVE_INVALID_REQUEST');
    if (
      this.saves.size >= 8 ||
      [...this.saves.values()].some((s) => s.owner === owner)
    )
      fail('SAVE_BUSY');
    const save: Save = {
      id: randomUUID(),
      owner,
      size: size as number,
      offset: 0,
      created: this.now(),
      touched: this.now(),
      busy: true,
      cancelled: false,
    };
    this.saves.set(save.id, save);
    try {
      await this.initialize();
      this.live(save);
      const destination = await choose(filename, save.size, () =>
        this.live(save)
      );
      this.live(save);
      if (!destination) fail('SAVE_CANCELLED');
      if (!isAbsolute(destination)) fail('SAVE_INVALID_REQUEST');
      // Do not allow two saves to race replacement of the same destination.
      if (
        [...this.saves.values()].some(
          (s) => s !== save && s.destination === destination
        )
      )
        fail('SAVE_BUSY');
      save.destination = destination;
      save.part = join(dirname(destination), `.qortal-save-${save.id}.part`);
      const record = await fs.open(
        join(this.journal, `${save.id}.json`),
        'wx',
        0o600
      );
      try {
        await record.writeFile(JSON.stringify({ part: save.part }));
        await record.sync();
      } finally {
        await record.close();
      }
      save.file = await fs.open(save.part, 'wx', 0o600);
      this.live(save);
      save.touched = this.now();
      save.busy = false;
      return { saveId: save.id, maxChunkBytes: SAVE_CHUNK_LIMIT };
    } catch (error) {
      await this.dispose(save);
      throw error;
    }
  }

  private live(save: Save) {
    if (
      save.cancelled ||
      this.now() - save.touched > IDLE_MS ||
      this.now() - save.created > 24 * 60 * 60_000
    )
      fail('SAVE_CANCELLED');
  }
  private get(owner: string, id: unknown) {
    const save = typeof id === 'string' ? this.saves.get(id) : undefined;
    if (!save || save.owner !== owner) fail('SAVE_NOT_FOUND');
    this.live(save);
    if (save.busy) fail('SAVE_BUSY');
    return save;
  }
  async write(owner: string, id: unknown, offset: unknown, data: unknown) {
    const save = this.get(owner, id);
    if (
      !(data instanceof Uint8Array) ||
      data.byteLength < 1 ||
      data.byteLength > SAVE_CHUNK_LIMIT ||
      offset !== save.offset ||
      save.offset + data.byteLength > save.size
    )
      fail('SAVE_INVALID_CHUNK');
    save.busy = true;
    try {
      let written = 0;
      while (written < data.byteLength) {
        this.live(save);
        const result = await save.file.write(
          data,
          written,
          data.byteLength - written,
          save.offset + written
        );
        if (!result.bytesWritten) fail('SAVE_IO_ERROR');
        written += result.bytesWritten;
      }
      this.live(save);
      save.offset += written;
      save.touched = this.now();
      return { bytesWritten: save.offset };
    } catch (error) {
      await this.dispose(save);
      throw error;
    } finally {
      save.busy = false;
    }
  }
  async finish(owner: string, id: unknown) {
    const save = this.get(owner, id);
    if (save.offset !== save.size) fail('SAVE_INCOMPLETE');
    save.busy = true;
    try {
      await save.file.sync();
      await save.file.close();
      save.file = undefined;
      this.live(save);
      // Atomic replacement only after the app explicitly finishes verification.
      await fs.rename(save.part, save.destination);
      return { saved: true };
    } finally {
      await this.dispose(save);
    }
  }
  async abort(owner: string, id: unknown) {
    const save = typeof id === 'string' ? this.saves.get(id) : undefined;
    if (!save || save.owner !== owner) return { aborted: true };
    save.cancelled = true;
    // In-flight operations own cleanup; don't close a descriptor beneath a write.
    if (!save.busy) await this.dispose(save);
    return { aborted: true };
  }
  async cleanup(owner?: string) {
    await Promise.all(
      [...this.saves.values()]
        .filter((s) => !owner || s.owner === owner)
        .map((s) => this.abort(s.owner, s.id))
    );
  }
  async expire() {
    await Promise.all(
      [...this.saves.values()]
        .filter(
          (s) =>
            this.now() - s.touched > IDLE_MS ||
            this.now() - s.created > 24 * 60 * 60_000
        )
        .map((s) => this.abort(s.owner, s.id))
    );
  }
  private async dispose(save: Save) {
    save.cancelled = true;
    try {
      await save.file?.close();
      save.file = undefined;
      if (save.part)
        await fs.unlink(save.part).catch((e) => {
          if (e.code !== 'ENOENT') throw e;
        });
      await fs.unlink(join(this.journal, `${save.id}.json`)).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
      });
    } catch {
      /* Journal retains the exact partial path for next launch cleanup. */
    }
    this.saves.delete(save.id);
  }
}
