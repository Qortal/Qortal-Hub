import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) =>
      name === 'userData' ? '/tmp/qortal-userdata' : '/tmp/qortal-appdata',
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('electron-is-dev', () => ({
  default: false,
}));

import {
  DEFAULT_RETICULUM_HUBS,
  buildManagedReticulumConfig,
} from './reticulum-daemon';

describe('reticulum-daemon managed config', () => {
  it('keeps LAN discovery and includes the default public hubs', () => {
    const config = buildManagedReticulumConfig();

    expect(config).toContain('[[Default Interface]]');
    expect(config).toContain('type = AutoInterface');
    expect(config).toContain('enabled = yes');

    for (const hub of DEFAULT_RETICULUM_HUBS) {
      expect(config).toContain(`[[${hub.name}]]`);
      expect(config).toContain('type = TCPClientInterface');
      expect(config).toContain(`target_host = ${hub.host}`);
      expect(config).toContain(`target_port = ${hub.port}`);
    }
  });

  it('can render multiple hubs without changing the generator shape', () => {
    const config = buildManagedReticulumConfig([
      { name: 'Hub One', host: 'one.example', port: 1111 },
      { name: 'Hub Two', host: 'two.example', port: 2222 },
    ]);

    expect(config).toContain('[[Hub One]]');
    expect(config).toContain('target_host = one.example');
    expect(config).toContain('target_port = 1111');
    expect(config).toContain('[[Hub Two]]');
    expect(config).toContain('target_host = two.example');
    expect(config).toContain('target_port = 2222');
  });
});
