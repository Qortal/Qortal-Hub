/**
 * Tests for the shared view-channel store.
 *
 * Background: suppression used to rely solely on the synchronous
 * `qchat-view-channel` DOM event. A payload published before the subscriber
 * attached was lost, leaving the subscriber's ref at the not-viewing sentinel
 * and letting a notification fire for the channel the user was looking at.
 *
 * The store is written at the source (ChatGroup) and read at notification time,
 * so the ordering no longer matters.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_NOT_VIEWING_GROUP_ID,
  getPublishedViewContext,
  isViewingChannel,
  resetPublishedViewChannel,
  setPublishedViewChannel,
} from './qChatViewContextSuppression';

function setFocus(visible: boolean) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (visible ? 'visible' : 'hidden'),
  });
  Object.defineProperty(document, 'hasFocus', {
    configurable: true,
    value: () => visible,
  });
}

describe('published view channel store', () => {
  beforeEach(() => {
    resetPublishedViewChannel();
    setFocus(true);
  });

  afterEach(() => {
    resetPublishedViewChannel();
    vi.restoreAllMocks();
  });

  it('starts at the not-viewing sentinel', () => {
    expect(getPublishedViewContext().groupId).toBe(
      DEFAULT_NOT_VIEWING_GROUP_ID
    );
    expect(isViewingChannel(7, 'general')).toBe(false);
  });

  it('reports viewing after a publish, with no event subscriber involved', () => {
    // This is the regression: no listener is attached, only the store write.
    setPublishedViewChannel({ groupId: 7, channelId: 'general' });
    expect(isViewingChannel(7, 'general')).toBe(true);
  });

  it('does not report viewing a different channel of the same group', () => {
    setPublishedViewChannel({ groupId: 7, channelId: 'general' });
    expect(isViewingChannel(7, 'announcements')).toBe(false);
  });

  it('does not report viewing a channel of a different group', () => {
    setPublishedViewChannel({ groupId: 7, channelId: 'general' });
    expect(isViewingChannel(8, 'general')).toBe(false);
  });

  it('honours the not-viewing sentinel published by an inactive ChatGroup', () => {
    setPublishedViewChannel({ groupId: 7, channelId: 'general' });
    expect(isViewingChannel(7, 'general')).toBe(true);

    setPublishedViewChannel({
      groupId: DEFAULT_NOT_VIEWING_GROUP_ID,
      channelId: '',
    });
    expect(isViewingChannel(7, 'general')).toBe(false);
  });

  it('evaluates visibility live, not at publish time', () => {
    setPublishedViewChannel({ groupId: 7, channelId: 'general' });
    expect(isViewingChannel(7, 'general')).toBe(true);

    // Window loses focus after the publish: suppression must stop, because the
    // user genuinely is not looking at the channel any more.
    setFocus(false);
    expect(isViewingChannel(7, 'general')).toBe(false);
    expect(getPublishedViewContext().visible).toBe(false);
  });

  it('normalises a non-finite group id to the sentinel', () => {
    setPublishedViewChannel({ groupId: NaN, channelId: 'general' });
    expect(getPublishedViewContext().groupId).toBe(
      DEFAULT_NOT_VIEWING_GROUP_ID
    );
    expect(isViewingChannel(NaN, 'general')).toBe(false);
  });

  it('ignores a non-string channel id', () => {
    setPublishedViewChannel({ groupId: 7, channelId: undefined as any });
    expect(getPublishedViewContext().channelId).toBe('');
    expect(isViewingChannel(7, 'general')).toBe(false);
  });
});
