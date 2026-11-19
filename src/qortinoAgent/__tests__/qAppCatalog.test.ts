import { describe, expect, it } from 'vitest';
import { formatQAppAnswer, matchQAppCatalog } from '../qAppCatalog';

describe('matchQAppCatalog', () => {
  it('matches Q-Assets questions', () => {
    const m = matchQAppCatalog('What is Q-Assets?');
    expect(m).not.toBeNull();
    expect(m!.entry.name).toBe('Q-Assets');
    expect(formatQAppAnswer(m!.entry).toLowerCase()).toContain('native');
  });

  it('matches spaced / alias forms', () => {
    expect(matchQAppCatalog('what is q assets')?.entry.id).toBe('q-assets');
    expect(matchQAppCatalog('explain Ear-Bump')?.entry.name).toBe('Ear-Bump');
  });

  it('does not treat network/concept asks as apps', () => {
    expect(matchQAppCatalog('what is qortal')).toBeNull();
    expect(matchQAppCatalog('What is Qortal?')).toBeNull();
    expect(matchQAppCatalog('explain qortal')).toBeNull();
    expect(matchQAppCatalog('what is minting')).toBeNull();
    expect(matchQAppCatalog('what are qortal names')).toBeNull();
    expect(matchQAppCatalog('what is onboarding')).toBeNull();
  });

  it('still matches Welcome to Qortal when asked for by name', () => {
    expect(matchQAppCatalog('what is Welcome to Qortal')?.entry.id).toBe(
      'welcome'
    );
    expect(matchQAppCatalog('open Welcome to Qortal')?.entry.name).toBe(
      'Welcome to Qortal'
    );
  });
});
