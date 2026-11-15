import { describe, expect, it } from 'vitest';
import {
  appPageIdentifier,
  appReviewKey,
  appShotsIdentifier,
  replyIdentifier,
  replyPrefixOf,
  reviewIdentifierKind,
} from './appPageIds';

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

  it('makes a different reply identifier each time', () => {
    const key = appReviewKey('APP', 'Q-Tube');
    expect(replyIdentifier(key)).not.toBe(replyIdentifier(key));
  });
});
