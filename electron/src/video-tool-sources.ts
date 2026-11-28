import { randomUUID } from 'crypto';
import type { VideoProbe, VideoSource } from './video-tool-types';

const VIDEO_EXTENSIONS = new Set(
  `mp4 m4v mov qt 3gp 3g2 mkv webm avi wmv asf flv f4v ts m2ts mts mpg mpeg
  vob ogv mxf dv divx xvid`.split(/\s+/)
);
const SUBTITLE_EXTENSIONS = new Set(['srt', 'vtt', 'ass', 'ssa', 'sub', 'sup']);

/** What the open dialog lists: videos and their subtitle files. */
export const PICKABLE_EXTENSIONS = [
  ...VIDEO_EXTENSIONS,
  ...SUBTITLE_EXTENSIONS,
] as const;

export function sourceKind(name: string): VideoSource['kind'] {
  const dot = name.lastIndexOf('.');
  const extension = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (SUBTITLE_EXTENSIONS.has(extension)) return 'subtitle';
  return 'other';
}

/** A file main has checked: an absolute path to a regular file. */
export type SourceFile = {
  path: string;
  name: string;
  size: number;
  relativePath?: string;
};

export type SourceEntry = VideoSource & {
  path: string;
  /** ffprobe's summary, kept while the file is unchanged. */
  probe?: { mtimeMs: number; size: number; result: VideoProbe };
};

/**
 * The files each page added, by webContents id. A page only reaches its own
 * sources, and they are dropped when it navigates or dies.
 */
export class VideoSourceRegistry {
  private readonly owners = new Map<number, Map<string, SourceEntry>>();

  constructor(private readonly newId: () => string = randomUUID) {}

  add(ownerId: number, files: SourceFile[]): VideoSource[] {
    let sources = this.owners.get(ownerId);
    if (!sources) {
      sources = new Map();
      this.owners.set(ownerId, sources);
    }
    return files.map((file) => {
      const source: VideoSource = {
        id: this.newId(),
        name: file.name,
        size: file.size,
        kind: sourceKind(file.name),
        ...(file.relativePath ? { relativePath: file.relativePath } : {}),
      };
      sources.set(source.id, { ...source, path: file.path });
      return source;
    });
  }

  get(ownerId: number, sourceId: unknown): SourceEntry | undefined {
    if (typeof sourceId !== 'string') return undefined;
    return this.owners.get(ownerId)?.get(sourceId);
  }

  forget(ownerId: number, sourceId: string): void {
    const sources = this.owners.get(ownerId);
    sources?.delete(sourceId);
    if (sources?.size === 0) this.owners.delete(ownerId);
  }

  clearOwner(ownerId: number): void {
    this.owners.delete(ownerId);
  }
}
