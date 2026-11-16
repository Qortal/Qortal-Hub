import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha256';
import {
  appPageIdentifier,
  appReviewKey,
  appShotsIdentifier,
  normalizeAppIdentifier,
  replyIdentifier,
  replyPrefixOf,
  reviewIdentifierKind,
} from './appPageIds';

const hex16 = (text: string) =>
  Array.from(sha256(new TextEncoder().encode(text)), (byte) =>
    byte.toString(16).padStart(2, '0')
  )
    .join('')
    .slice(0, 16);

describe('app page identifiers', () => {
  it('names the page and screenshot resources per service', () => {
    expect(appPageIdentifier('APP')).toBe('qhub_app_page_v1_APP');
    expect(appPageIdentifier('website')).toBe('qhub_app_page_v1_WEBSITE');
    expect(appShotsIdentifier('APP')).toBe('qhub_app_shots_v1_APP');
  });

  it('gives each app one review key, whatever the name casing', () => {
    const key = appReviewKey('APP', 'Q-Blog');
    expect(key).toMatch(/^qhub_review_v1_APP_[0-9a-f]{16}$/);
    expect(appReviewKey('app', ' q-blog ')).toBe(key);
    expect(appReviewKey('WEBSITE', 'Q-Blog')).not.toBe(
      key.replace('_APP_', '_WEBSITE_')
    );
    expect(appReviewKey('APP', 'Q-Blog2')).not.toBe(key);
  });

  it('keeps identifiers within QDN limits for long and unusual names', () => {
    const key = appReviewKey('WEBSITE', 'Ünïcödé name with spaces & symbols!!');
    expect(key.length).toBeLessThanOrEqual(64);
    expect(key).toMatch(/^[a-zA-Z0-9_]+$/);
    expect(replyIdentifier(key).length).toBeLessThanOrEqual(64);
  });

  it('tells reviews, replies and other identifiers apart', () => {
    const key = appReviewKey('APP', 'Q-Tube');
    const reply = replyIdentifier(key, 'abc123');
    expect(reply).toBe(
      `qhub_reply_v1_APP_${key.slice('qhub_review_v1_APP_'.length)}_abc123`
    );
    expect(reviewIdentifierKind(key, key)).toBe('review');
    expect(reviewIdentifierKind(reply, key)).toBe('reply');
    expect(reviewIdentifierKind(replyPrefixOf(key), key)).toBeNull();
    // Replies don't start with the review key, so a review search skips them.
    expect(reply.startsWith(key)).toBe(false);
    expect(reviewIdentifierKind(`${key}_r_abc123`, key)).toBeNull();
    expect(reviewIdentifierKind(appReviewKey('APP', 'Other'), key)).toBeNull();
    expect(reviewIdentifierKind(`${key}x`, key)).toBeNull();
  });

  it("gives a widget under its own identifier a key of its own, never an app's", () => {
    const app = appReviewKey('APP', 'Q-Weather');
    const widget = appReviewKey('APP', 'Q-Weather', 'go-widget-now');
    // As docs/app-pages.md says: the name in lower case, a line break, the
    // identifier as published.
    expect(app).toBe(`qhub_review_v1_APP_${hex16('APP:q-weather')}`);
    expect(widget).toBe(
      `qhub_review_v1_APP_${hex16('APP:q-weather\ngo-widget-now')}`
    );
    expect(widget).not.toBe(app);
    expect(appReviewKey('app', ' q-weather ', 'go-widget-now')).toBe(widget);
    expect(appReviewKey('APP', 'Q-Weather', 'go-widget-weather')).not.toBe(
      widget
    );
    // An app named like the widget's poll still has a key of its own.
    expect(appReviewKey('APP', 'Q-Weather-id-go-widget-now')).not.toBe(widget);
    expect(replyIdentifier(widget).length).toBeLessThanOrEqual(64);
  });

  it("keeps the app's key for a widget that is its name's default APP", () => {
    const app = appReviewKey('APP', 'GO Clock');
    expect(appReviewKey('APP', 'GO Clock', null)).toBe(app);
    expect(appReviewKey('APP', 'GO Clock', '')).toBe(app);
    expect(appReviewKey('APP', 'GO Clock', 'default')).toBe(app);
    expect(normalizeAppIdentifier('default')).toBeNull();
    expect(normalizeAppIdentifier('  ')).toBeNull();
    expect(normalizeAppIdentifier(7)).toBeNull();
    expect(normalizeAppIdentifier('go-widget-now')).toBe('go-widget-now');
  });

  it('makes a different reply identifier each time', () => {
    const key = appReviewKey('APP', 'Q-Tube');
    expect(replyIdentifier(key)).not.toBe(replyIdentifier(key));
  });
});
