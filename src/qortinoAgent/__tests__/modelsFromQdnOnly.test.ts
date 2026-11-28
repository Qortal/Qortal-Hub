import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  modelPartPath,
  PUBLISHED_QSHARE_FILES,
  QDN_OTHER_MODELS,
  QORTINO_MODEL_LAYOUTS,
  QORTINO_OTHER_MODELS_DIR,
} from '../manifest';

const ROOT = path.resolve(__dirname, '../../..');
const SOURCES = [
  'src/qortinoAgent',
  'src/components/Group/QortinoAgent',
  'electron/src',
];

function sourceFiles(): Array<{ file: string; text: string }> {
  const found: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(full);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name) &&
        (dir.includes('qortino') ||
          dir.includes('Qortino') ||
          entry.name.startsWith('qortino-'))
      ) {
        found.push({
          file: path.relative(ROOT, full),
          text: fs.readFileSync(full, 'utf8'),
        });
      }
    }
  };
  for (const dir of SOURCES) walk(path.join(ROOT, dir));
  return found;
}

describe('Qortino models come from QDN only', () => {
  it('has no web link to a model file anywhere in its code', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(10);
    const links = files.filter(({ text }) =>
      /huggingface\.co|https?:\/\/[^\s'"`]*\.gguf/i.test(text)
    );
    expect(links.map(({ file }) => file)).toEqual([]);
  });

  it('downloads model files only through the QDN download', () => {
    const callers = sourceFiles()
      .filter(({ text }) => /QortinoLlm\.downloadUrl\(/.test(text))
      .map(({ file }) => file);
    expect(callers).toEqual([path.join('src', 'qortinoAgent', 'download.ts')]);
  });

  it('offers other models that can be published on QDN and checked', () => {
    const ownFiles = new Set(
      QORTINO_MODEL_LAYOUTS.flatMap((layout) =>
        layout.parts.map((part) => part.filename)
      )
    );
    expect(QDN_OTHER_MODELS.length).toBeGreaterThan(0);
    for (const model of QDN_OTHER_MODELS) {
      for (const part of model.parts) {
        expect(part.sha256).toMatch(/^[0-9a-f]{64}$/);
        // QDN takes files up to 2 GiB.
        expect(part.sizeBytes).toBeGreaterThan(0);
        expect(part.sizeBytes).toBeLessThan(2 * 1024 ** 3);
        expect(ownFiles.has(part.filename)).toBe(false);
        // Found even when the node cannot read the share's file list.
        expect(PUBLISHED_QSHARE_FILES[part.filename.toLowerCase()]).toEqual({
          identifier: expect.stringMatching(/^qshare_file_/),
          service: 'FILE',
          sizeBytes: part.sizeBytes,
        });
        // Clean-ups of Qortino's own files leave this folder alone.
        expect(modelPartPath(model, part)).toMatch(
          new RegExp(`^${QORTINO_OTHER_MODELS_DIR}/[a-z0-9.-]+/[^/]+\\.gguf$`)
        );
      }
      // llama.cpp loads the parts together from the first one.
      expect(model.parts.map((part) => part.filename)).toEqual(
        model.parts.map((_, i) =>
          model.parts[0].filename.replace(
            /-00001-of-(\d{5})\.gguf$/,
            (_m, count: string) =>
              `-${String(i + 1).padStart(5, '0')}-of-${count}.gguf`
          )
        )
      );
    }
  });
});
