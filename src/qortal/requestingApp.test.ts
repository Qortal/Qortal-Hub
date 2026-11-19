import { describe, expect, it } from 'vitest';
import {
  HUB_REQUEST,
  isHubRequest,
  requestingAppFromAppInfo,
} from './requestingApp';

describe('requestingAppFromAppInfo', () => {
  it('takes the name and service from the request’s tab', () => {
    expect(
      requestingAppFromAppInfo({ name: 'Q-Wallets', service: 'APP', tabId: 1 })
    ).toEqual({ name: 'Q-Wallets', service: 'APP' });
  });

  it('has no app without a usable name', () => {
    expect(requestingAppFromAppInfo(null)).toBeNull();
    expect(requestingAppFromAppInfo(undefined)).toBeNull();
    expect(requestingAppFromAppInfo('Q-Wallets')).toBeNull();
    expect(requestingAppFromAppInfo({ service: 'APP' })).toBeNull();
    expect(requestingAppFromAppInfo({ name: 42 })).toBeNull();
    expect(requestingAppFromAppInfo({ name: '  \u200b ' })).toBeNull();
  });

  it('removes characters that hide or reorder part of the name', () => {
    const app = requestingAppFromAppInfo({
      // A right-to-left override would show this as "Q-Wallets…".
      name: 'Evil\u202e\u200bstellaW-Q\u0007\u2066',
      service: 'APP',
    });
    expect(app?.name).toBe('EvilstellaW-Q');
  });

  it('removes fillers, joiners, selectors and tags that draw nothing', () => {
    const hidden = [
      '\u034f', // combining grapheme joiner
      '\u115f', // Hangul choseong filler
      '\u3164', // Hangul filler
      '\uffa0', // halfwidth Hangul filler
      '\ufe0f', // variation selector
      '\u2800', // Braille blank
      '\u{e0041}', // tag character
      '\u{e007f}', // cancel tag
      '\u{1d173}', // musical symbol format character
    ];
    const app = requestingAppFromAppInfo({
      name: `${hidden.join('')}Q-${hidden.join('')}Wallets${hidden.join('')}`,
      service: 'APP',
    });
    expect(app?.name).toBe('Q-Wallets');
    // A name made only of them is no name.
    expect(requestingAppFromAppInfo({ name: hidden.join('') })).toBeNull();
    // Visible text outside the basic plane stays.
    expect(requestingAppFromAppInfo({ name: 'Q-\u{1f600}' })?.name).toBe(
      'Q-\u{1f600}'
    );
  });

  it('cuts a long name', () => {
    const app = requestingAppFromAppInfo({ name: 'A'.repeat(200) });
    expect(Array.from(app!.name)).toHaveLength(49);
    expect(app!.name.endsWith('…')).toBe(true);
  });

  it('keeps only a service that looks like one', () => {
    expect(requestingAppFromAppInfo({ name: 'x', service: 'website' })).toEqual(
      { name: 'x', service: 'WEBSITE' }
    );
    expect(
      requestingAppFromAppInfo({ name: 'x', service: 'APP<script>' })?.service
    ).toBeNull();
    expect(requestingAppFromAppInfo({ name: 'x' })?.service).toBeNull();
  });
});

describe('isHubRequest', () => {
  it('is true only for the appInfo Hub\u2019s own pages pass', () => {
    expect(isHubRequest(HUB_REQUEST)).toBe(true);
    // As it arrives after window.postMessage has copied it.
    expect(isHubRequest(structuredClone(HUB_REQUEST))).toBe(true);
    expect(isHubRequest(undefined)).toBe(false);
    expect(isHubRequest({ name: '', service: 'APP', tabId: 7 })).toBe(false);
    expect(isHubRequest({ name: 'Qortal Hub', service: 'APP' })).toBe(false);
    expect(isHubRequest({ fromHub: 'true' })).toBe(false);
  });
});
