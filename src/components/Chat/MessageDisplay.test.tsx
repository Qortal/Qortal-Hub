// MessageDisplay.test.ts
import { describe, expect, it } from 'vitest';
import { extractComponents } from './MessageDisplay';

describe('extractComponents', () => {
  // sanity checks
  it('returns null for falsy or non-qortal URLs', () => {
    expect(extractComponents('')).toBeNull();
    expect(extractComponents(null as unknown as string)).toBeNull();
    expect(extractComponents('https://example.com')).toBeNull();
  });

  it('returns null for qortal://use-* links', () => {
    expect(extractComponents('qortal://use-tool')).toBeNull();
    expect(extractComponents('qortal://use-')).toBeNull();
  });

  it('parses service-based URLs with a slash', () => {
    const res = extractComponents('qortal://blog/alice/my-post');
    expect(res).toEqual({
      service: 'BLOG',
      name: 'alice',
      identifier: undefined,
      path: 'my-post',
    });
  });

  it('defaults qortal://<username> to WEBSITE service', () => {
    const res = extractComponents('qortal://alice');
    expect(res).toEqual({
      service: 'WEBSITE',
      name: 'alice',
      identifier: undefined,
      path: '',
    });
  });

  it('leaves explicit WEBSITE service intact', () => {
    const res = extractComponents('qortal://WEBSITE/bob');
    expect(res).toEqual({
      service: 'WEBSITE',
      name: 'bob',
      identifier: undefined,
      path: '',
    });
  });

  it('uppercases the service portion only', () => {
    const res = extractComponents('qortal://weBsiTe/CaseUser');
    expect(res).toEqual({
      service: 'WEBSITE',
      name: 'CaseUser',
      identifier: undefined,
      path: '',
    });
  });

  // a couple of edge cases
  it('handles just protocol (no content) as null', () => {
    expect(extractComponents('qortal://')).toBeNull();
  });

  it('handles single-segment non-empty after protocol with spaces', () => {
    const res = extractComponents(
      'qortal://  alice  '.replace('  ', '').replace('  ', '')
    ); // simulate trimmed input
    expect(res).toEqual({
      service: 'WEBSITE',
      name: 'alice',
      identifier: undefined,
      path: '',
    });
  });
});
