import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';

vi.mock('node:child_process', () => {
  const childProcess = { spawn: vi.fn() };
  return { ...childProcess, default: childProcess };
});

describe('renderer profiling launcher', () => {
  let child: EventEmitter & { kill: ReturnType<typeof vi.fn> };
  let exitCode: typeof process.exitCode;
  let signalHandlers: Function[];
  const launch = () => import('../scripts/run-renderer-profile.mjs');

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    exitCode = process.exitCode;
    signalHandlers = process.listeners('SIGTERM');
    child = Object.assign(new EventEmitter(), { kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as any);
    vi.stubEnv('ELECTRON_RUN_AS_NODE', '1');
    vi.stubEnv('QORTAL_RENDERER_PROFILE_SECONDS', '');
    vi.stubEnv('QORTAL_RENDERER_PROFILE_DELAY_SECONDS', '');
  });
  afterEach(() => {
    child.emit('exit', 0, null);
    process.exitCode = exitCode;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('launches Electron with explicit profiling flags and the Electron working directory', async () => {
    await launch();
    const [executable, args, options] = vi.mocked(spawn).mock.calls[0];
    expect(executable).toBe('/mock/electron');
    expect(args).toEqual([
      '.',
      '--profile-renderer=900',
      '--profile-renderer-delay=60',
    ]);
    expect(String(options.cwd)).toMatch(/\/electron$/);
    expect(options.stdio).toBe('inherit');
    expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(process.env.ELECTRON_RUN_AS_NODE).toBe('1');
  });
  it('passes custom capture duration and delay', async () => {
    vi.stubEnv('QORTAL_RENDERER_PROFILE_SECONDS', '30');
    vi.stubEnv('QORTAL_RENDERER_PROFILE_DELAY_SECONDS', '0');
    await launch();
    expect(vi.mocked(spawn).mock.calls[0][1]).toEqual([
      '.',
      '--profile-renderer=30',
      '--profile-renderer-delay=0',
    ]);
  });
  it('forwards termination and removes its handlers before propagating the exit signal', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    await launch();
    const handler = process
      .listeners('SIGTERM')
      .find((fn) => !signalHandlers.includes(fn));
    expect(handler).toBeDefined();
    handler('SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('exit', null, 'SIGTERM');
    expect(process.listeners('SIGTERM')).toEqual(signalHandlers);
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });
  it('preserves a failed Electron exit code', async () => {
    await launch();
    child.emit('exit', 7, null);
    expect(process.exitCode).toBe(7);
    expect(process.listeners('SIGTERM')).toEqual(signalHandlers);
  });
  it('reports spawn failures and removes its signal handlers', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await launch();
    child.emit('error', new Error('missing electron'));
    expect(error).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(process.listeners('SIGTERM')).toEqual(signalHandlers);
  });
});
