import { describe, expect, it } from 'vitest';
import {
  buildQuitterPostIdentifier,
  quitterHashString,
} from './quitterIdentity';

// The prefix Home's feed searches for (quitterFeedApi.ts): Quitter's app,
// POST and ROOT hashes.
const POST_ID = /^MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-[0-9A-Za-z]{15}-v1$/;

describe('buildQuitterPostIdentifier', () => {
  it('builds public post ids the feed and Torq find', async () => {
    const first = await buildQuitterPostIdentifier();
    const second = await buildQuitterPostIdentifier();
    expect(first).toMatch(POST_ID);
    expect(second).toMatch(POST_ID);
    expect(second).not.toBe(first);
  });
});

describe('quitterHashString', () => {
  it('hashes a mentioned name the same way every time, URL-safe', async () => {
    const hash = await quitterHashString('Bob');
    expect(hash).toHaveLength(14);
    expect(hash).toMatch(/^[A-Za-z0-9.~!]+$/);
    await expect(quitterHashString('Bob')).resolves.toBe(hash);
    await expect(quitterHashString('Carol')).resolves.not.toBe(hash);
  });
});
