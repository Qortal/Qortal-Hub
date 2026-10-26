import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import { app, MockWebContents } from '../../src/test/mocks/electron';
import { mkdir, writeFile } from 'fs/promises';
import { warn } from './logger';
import { maybeStartRendererCpuProfile } from './renderer-cpu-profile';

vi.mock('fs/promises', () => {
  const fs = { mkdir: vi.fn(), writeFile: vi.fn() };
  return { ...fs, default: fs };
});
vi.mock('./logger', () => ({ log: vi.fn(), warn: vi.fn() }));
import { rendererCpuProfileDurationSeconds } from './renderer-cpu-profile';

describe('renderer CPU profile activation', () => {
  it('stays disabled without the explicit command-line flag', () => {
    expect(rendererCpuProfileDurationSeconds(['electron', '.'])).toBeNull();
  });

  it('ignores a duration environment variable without the flag', () => {
    const previousValue = process.env.QORTAL_RENDERER_PROFILE_SECONDS;
    process.env.QORTAL_RENDERER_PROFILE_SECONDS = '900';
    try {
      expect(rendererCpuProfileDurationSeconds(['electron', '.'])).toBeNull();
    } finally {
      if (previousValue === undefined) {
        delete process.env.QORTAL_RENDERER_PROFILE_SECONDS;
      } else {
        process.env.QORTAL_RENDERER_PROFILE_SECONDS = previousValue;
      }
    }
  });

  it('uses the default duration for the bare command-line flag', () => {
    expect(
      rendererCpuProfileDurationSeconds(['electron', '.', '--profile-renderer'])
    ).toBe(60);
  });

  it('uses and limits an explicit command-line duration', () => {
    expect(
      rendererCpuProfileDurationSeconds([
        'electron',
        '.',
        '--profile-renderer=900',
      ])
    ).toBe(900);
    expect(
      rendererCpuProfileDurationSeconds([
        'electron',
        '.',
        '--profile-renderer=99999',
      ])
    ).toBe(3600);
  });

  it('does not mistake the delay flag for the activation flag', () => {
    expect(
      rendererCpuProfileDurationSeconds([
        'electron',
        '.',
        '--profile-renderer-delay=10',
      ])
    ).toBeNull();
  });
});

describe('renderer CPU profile lifecycle', () => {
  let contents: MockWebContents;
  let originalArgv: string[];
  const start = () =>
    maybeStartRendererCpuProfile(
      contents as unknown as WebContents,
      'main/shell'
    );
  const attachSpy = () => vi.spyOn(contents.debugger, 'attach');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    originalArgv = process.argv;
    process.argv = ['electron', '.', '--profile-renderer=1'];
    vi.stubEnv('QORTAL_RENDERER_PROFILE_DELAY_SECONDS', '0');
    contents = new MockWebContents();
  });
  afterEach(() => {
    process.argv = originalArgv;
    app.isPackaged = false;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it.each(['0', '-1', 'NaN', 'Infinity', 'oops'])(
    'rejects invalid duration %s',
    (value) => {
      expect(
        rendererCpuProfileDurationSeconds([`--profile-renderer=${value}`])
      ).toBeNull();
    }
  );
  it('rounds a positive fraction to at least one second', () => {
    expect(rendererCpuProfileDurationSeconds(['--profile-renderer=0.1'])).toBe(
      1
    );
  });
  it.each(['disabled', 'packaged', 'destroyed'])(
    'does no work when %s',
    (mode) => {
      if (mode === 'disabled') process.argv = ['electron', '.'];
      if (mode === 'packaged') app.isPackaged = true;
      if (mode === 'destroyed') contents.destroyed = true;
      const attach = attachSpy();
      start();
      expect(vi.getTimerCount()).toBe(0);
      expect(contents.eventNames()).toEqual([]);
      expect(attach).not.toHaveBeenCalled();
    }
  );
  it('records once, saves the profile, and releases its debugger and listeners', async () => {
    const send = vi.spyOn(contents.debugger, 'sendCommand');
    const detach = vi.spyOn(contents.debugger, 'detach');
    start();
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.map(([method]) => method)).toEqual([
      'Profiler.enable',
      'Profiler.setSamplingInterval',
      'Profiler.start',
    ]);
    expect(send).toHaveBeenCalledWith('Profiler.setSamplingInterval', {
      interval: 1000,
    });
    expect(writeFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenLastCalledWith('Profiler.stop', undefined);
    expect(mkdir).toHaveBeenCalledWith(
      '/tmp/qortal-userdata/renderer-profiles',
      { recursive: true }
    );
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/renderer-profiles\/main-shell-42-.*\.cpuprofile$/),
      JSON.stringify({ nodes: [], startTime: 0, endTime: 1000, samples: [] }),
      'utf8'
    );
    expect(detach).toHaveBeenCalledTimes(1);
    expect(contents.eventNames()).toEqual([]);
    expect(contents.debugger.eventNames()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    start();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('honours the explicit delay over the environment', async () => {
    vi.stubEnv('QORTAL_RENDERER_PROFILE_DELAY_SECONDS', '10');
    process.argv.push('--profile-renderer-delay=2');
    const attach = attachSpy();
    start();
    await vi.advanceTimersByTimeAsync(1999);
    expect(attach).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(attach).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
  });
  it('cancels a delayed capture when its renderer closes', async () => {
    process.argv.push('--profile-renderer-delay=60');
    const attach = attachSpy();
    start();
    contents.destroy();
    await vi.advanceTimersByTimeAsync(0);
    expect(attach).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(contents.eventNames()).toEqual([]);
  });
  it.each(['destroyed', 'render-process-gone'])(
    'cancels an active capture on %s',
    async (event) => {
      start();
      await vi.advanceTimersByTimeAsync(0);
      if (event === 'destroyed') contents.destroy();
      else contents.emit(event, {}, { reason: 'crashed' });
      await vi.advanceTimersByTimeAsync(0);
      expect(writeFile).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(contents.eventNames()).toEqual([]);
      expect(contents.debugger.isAttached()).toBe(false);
    }
  );
  it('leaves an open DevTools session alone', async () => {
    contents.devToolsOpened = true;
    const attach = attachSpy();
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(attach).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
  it('never detaches a debugger that was already attached', async () => {
    contents.debugger.attach();
    const detach = vi.spyOn(contents.debugger, 'detach');
    const send = vi.spyOn(contents.debugger, 'sendCommand');
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(detach).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
  it('never detaches another client after losing its own session', async () => {
    start();
    await vi.advanceTimersByTimeAsync(0);
    contents.debugger.detach();
    contents.debugger.attach();
    const detach = vi.spyOn(contents.debugger, 'detach');
    await vi.advanceTimersByTimeAsync(0);
    expect(detach).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not detach if attaching failed', async () => {
    attachSpy().mockImplementation(() => {
      throw new Error('attach failed');
    });
    const detach = vi.spyOn(contents.debugger, 'detach');
    start();
    await vi.advanceTimersByTimeAsync(0);
    expect(detach).not.toHaveBeenCalled();
    expect(contents.eventNames()).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
  it('cleans up even if a debugger command never settles', async () => {
    vi.spyOn(contents.debugger, 'sendCommand').mockReturnValue(
      new Promise(() => {})
    );
    start();
    await vi.advanceTimersByTimeAsync(0);
    contents.destroy();
    await vi.advanceTimersByTimeAsync(0);
    expect(contents.eventNames()).toEqual([]);
    expect(contents.debugger.eventNames()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['command', 'missing profile', 'write'])(
    'releases the debugger on %s failure',
    async (failure) => {
      if (failure === 'command')
        vi.spyOn(contents.debugger, 'sendCommand').mockRejectedValue(
          new Error('CDP failed')
        );
      if (failure === 'missing profile')
        vi.spyOn(contents.debugger, 'sendCommand').mockResolvedValue({});
      if (failure === 'write')
        vi.mocked(writeFile).mockRejectedValueOnce(new Error('disk full'));
      start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(contents.debugger.isAttached()).toBe(false);
      expect(contents.eventNames()).toEqual([]);
      expect(contents.debugger.eventNames()).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        '[RendererProfile] capture failed',
        expect.any(Object)
      );
    }
  );
});
