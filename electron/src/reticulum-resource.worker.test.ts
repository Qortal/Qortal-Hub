import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as nodeCrypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import {
  deleteReticulumResourcePaths,
  finalizeReticulumResource,
  hashReticulumResourceFile,
  readAndHashReticulumResourceFile,
  writeReticulumResourceRange,
} from './reticulum-resource.worker';

describe('reticulum resource worker operations', () => {
  const directories: string[] = [];

  afterEach(() => {
    while (directories.length) {
      fs.rmSync(directories.pop()!, { recursive: true, force: true });
    }
  });

  it('hashes and finalizes a verified resource', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-worker-test-'));
    directories.push(dir);
    const sourcePath = path.join(dir, 'download.partial');
    const destinationPath = path.join(dir, 'assembled', 'file.bin');
    const contents = Buffer.from('verified worker resource');
    const expectedHash = nodeCrypto.createHash('sha256').update(contents).digest('hex');
    fs.writeFileSync(sourcePath, contents);

    expect(hashReticulumResourceFile(sourcePath)).toBe(expectedHash);
    expect(
      finalizeReticulumResource({
        id: 1,
        kind: 'finalize_resource',
        sourcePath,
        destinationPath,
        expectedHash,
        expectedSize: contents.length,
      })
    ).toBe(expectedHash);
    expect(fs.readFileSync(destinationPath)).toEqual(contents);
    expect(fs.readFileSync(sourcePath)).toEqual(contents);
  });

  it('copies file bytes into a transferable array buffer', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-worker-test-'));
    directories.push(dir);
    const sourcePath = path.join(dir, 'download.partial');
    const contents = Buffer.from('transferable worker resource');
    const expectedHash = nodeCrypto.createHash('sha256').update(contents).digest('hex');
    fs.writeFileSync(sourcePath, contents);

    const result = readAndHashReticulumResourceFile(sourcePath);

    expect(Buffer.isBuffer(result.bytes)).toBe(false);
    expect(Buffer.from(result.bytes)).toEqual(contents);
    expect(result.hash).toBe(expectedHash);
  });

  it('moves a completed download into place without a second full-size copy', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-worker-test-'));
    directories.push(dir);
    const sourcePath = path.join(dir, 'download.partial');
    const destinationPath = path.join(dir, 'assembled', 'file.bin');
    const contents = Buffer.from('move completed worker resource');
    const expectedHash = nodeCrypto.createHash('sha256').update(contents).digest('hex');
    fs.writeFileSync(sourcePath, contents);

    expect(
      finalizeReticulumResource({
        id: 1,
        kind: 'finalize_resource',
        sourcePath,
        destinationPath,
        expectedHash,
        expectedSize: contents.length,
        moveSource: true,
      })
    ).toBe(expectedHash);
    expect(fs.existsSync(sourcePath)).toBe(false);
    expect(fs.readFileSync(destinationPath)).toEqual(contents);
  });

  it('rejects a final resource with the wrong hash', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-worker-test-'));
    directories.push(dir);
    const sourcePath = path.join(dir, 'download.partial');
    fs.writeFileSync(sourcePath, Buffer.from('invalid resource'));

    expect(() =>
      finalizeReticulumResource({
        id: 1,
        kind: 'finalize_resource',
        sourcePath,
        destinationPath: path.join(dir, 'assembled.bin'),
        expectedHash: 'a'.repeat(64),
        expectedSize: fs.statSync(sourcePath).size,
      })
    ).toThrow(/hash mismatch/);
  });

  it('deletes cleanup paths idempotently', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-worker-test-'));
    directories.push(dir);
    const first = path.join(dir, 'first');
    const second = path.join(dir, 'second');
    fs.mkdirSync(first);
    fs.writeFileSync(second, 'resource');

    expect(deleteReticulumResourcePaths([first, second, second])).toBe(2);
    expect(deleteReticulumResourcePaths([first, second])).toBe(0);
  });

  it('writes and hashes only the requested source range', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reticulum-resource-worker-test-'));
    directories.push(dir);
    const sourcePath = path.join(dir, 'source.bin');
    const destinationPath = path.join(dir, 'ranges', 'range.bin');
    const contents = Buffer.from('0123456789abcdef');
    fs.writeFileSync(sourcePath, contents);

    const result = writeReticulumResourceRange({
      id: 1,
      kind: 'write_range_file',
      sourcePath,
      destinationPath,
      startByte: 3,
      endByteExclusive: 11,
    });

    const expected = contents.subarray(3, 11);
    expect(fs.readFileSync(destinationPath)).toEqual(expected);
    expect(result).toEqual({
      hash: nodeCrypto.createHash('sha256').update(expected).digest('hex'),
      sizeBytes: expected.length,
    });
  });
});
