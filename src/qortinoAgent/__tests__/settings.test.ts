import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSystemPrompt } from '../persona';
import { QORTINO_REPLY_TOKENS } from '../promptHistory';
import {
  DEFAULT_QORTINO_SETTINGS,
  getQortinoSettings,
  normalizeQortinoSettings,
  resetQortinoSettingsForTests,
  subscribeQortinoSettings,
  updateQortinoSettings,
} from '../settings';

const STORAGE_KEY = 'qortino:settings:v1';

describe("Qortino's settings", () => {
  afterEach(() => {
    resetQortinoSettingsForTests();
  });

  it('starts from the defaults', () => {
    expect(getQortinoSettings()).toEqual(DEFAULT_QORTINO_SETTINGS);
    expect(DEFAULT_QORTINO_SETTINGS).toEqual({
      answerLength: 'normal',
      textSize: 'default',
      enterSends: true,
      keepReady: 'short',
      useGpu: true,
    });
  });

  it('keeps a change on this computer and tells who listens', () => {
    const listener = vi.fn();
    subscribeQortinoSettings(listener);
    updateQortinoSettings({ answerLength: 'short', enterSends: false });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')).toMatchObject(
      { answerLength: 'short', enterSends: false }
    );
  });

  it('reads what was saved last time', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ textSize: 'large', keepReady: 'open' })
    );
    expect(getQortinoSettings()).toEqual({
      ...DEFAULT_QORTINO_SETTINGS,
      textSize: 'large',
      keepReady: 'open',
    });
  });

  it('falls back to the default for anything unknown or broken', () => {
    expect(
      normalizeQortinoSettings({
        answerLength: 'essay',
        textSize: 3,
        enterSends: 'yes',
        keepReady: null,
      })
    ).toEqual(DEFAULT_QORTINO_SETTINGS);
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(getQortinoSettings()).toEqual(DEFAULT_QORTINO_SETTINGS);
  });
});

describe('Answer length', () => {
  it('leaves the prompt as it was for normal answers', () => {
    expect(buildSystemPrompt('normal')).toBe(buildSystemPrompt());
  });

  it('adds its line at the very end, so the model re-reads only that', () => {
    const normal = buildSystemPrompt('normal');
    for (const length of ['short', 'detailed'] as const) {
      const prompt = buildSystemPrompt(length);
      expect(prompt.startsWith(`${normal}\n\n`)).toBe(true);
      expect(prompt).toMatch(new RegExp(`chose ${length} answers`));
    }
  });

  it('allows longer replies for longer answers', () => {
    expect(QORTINO_REPLY_TOKENS.short).toBeLessThan(
      QORTINO_REPLY_TOKENS.normal
    );
    expect(QORTINO_REPLY_TOKENS.normal).toBe(1024);
    expect(QORTINO_REPLY_TOKENS.detailed).toBeGreaterThan(
      QORTINO_REPLY_TOKENS.normal
    );
  });
});
