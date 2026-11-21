import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('audio-surface sandbox preload', () => {
  it('does not emit runtime requires for local modules', () => {
    const sourcePath = resolve(
      process.cwd(),
      'electron/src/audio-surface-preload.ts'
    );
    const source = readFileSync(sourcePath, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: sourcePath,
    }).outputText;

    const runtimeRequires = [
      ...output.matchAll(/require\(["']([^"']+)["']\)/g),
    ].map((match) => match[1]);

    expect(runtimeRequires).toEqual(['electron']);
  });

  it('exposes both directions of authenticated group WebRTC signaling', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'electron/src/audio-surface-preload.ts'),
      'utf8'
    );

    expect(source).toContain('sendRtcSignal: async');
    expect(source).toContain(
      "ipcRenderer.invoke('gcall:sendRtcSignal', input)"
    );
    expect(source).toContain("'gcall:rtc-signal'");
    expect(source).toContain("'gcall:local-session-taken-over'");
    expect(source).toContain("ipcRenderer.invoke('hub:getIceServers')");
  });
});
