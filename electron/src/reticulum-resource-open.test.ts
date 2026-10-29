import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  materializeReticulumResourceForOpen,
  safeReticulumOpenFileName,
} from './reticulum-resource-open';
describe('reticulum resource OS opening', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    while (temporaryDirectories.length) {
      fs.rmSync(temporaryDirectories.pop()!, { force: true, recursive: true });
    }
  });

  it('keeps the extension while removing traversal and platform-reserved characters', () => {
    expect(
      safeReticulumOpenFileName(
        'a'.repeat(64),
        '../folder\\unsafe:attachment?.dmg'
      )
    ).toBe('unsafe_attachment_-aaaaaaaaaaaa.dmg');
    expect(safeReticulumOpenFileName('b'.repeat(64), 'CON.exe')).toBe(
      '_CON-bbbbbbbbbbbb.exe'
    );
  });

  it('creates a reusable read-only copy with the original extension', async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reticulum-resource-open-test-')
    );
    temporaryDirectories.push(root);
    const sourcePath = path.join(root, 'assembled');
    fs.writeFileSync(sourcePath, 'verified attachment');

    const request = {
      sourcePath,
      tempRoot: root,
      fileHash: 'c'.repeat(64),
      suggestedFileName: 'report.log.1',
    };
    const [openedPath, racedPath] = await Promise.all([
      materializeReticulumResourceForOpen(request),
      materializeReticulumResourceForOpen(request),
    ]);
    const reusedPath = await materializeReticulumResourceForOpen(request);

    expect(path.basename(openedPath)).toBe('report.log-cccccccccccc.1');
    expect(fs.readFileSync(openedPath, 'utf8')).toBe('verified attachment');
    expect(racedPath).toBe(openedPath);
    expect(reusedPath).toBe(openedPath);
  });
});
