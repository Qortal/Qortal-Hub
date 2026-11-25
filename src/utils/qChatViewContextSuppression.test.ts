import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  DEFAULT_NOT_VIEWING_GROUP_ID,
  computeQChatVisible,
  isViewContextActive,
  shouldSuppressForViewedChannel,
} from './qChatViewContextSuppression';

const context = (
  overrides: Partial<Parameters<typeof isViewContextActive>[0]> = {}
) => ({
  groupId: 7,
  channelId: 'general',
  visible: true,
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shouldSuppressForViewedChannel', () => {
  it('suppresses an exact match while visible', () => {
    expect(shouldSuppressForViewedChannel(context(), 7, 'general')).toBe(true);
  });

  it('does not suppress a different group', () => {
    expect(shouldSuppressForViewedChannel(context(), 8, 'general')).toBe(false);
  });

  it('does not suppress a different channel in the same group', () => {
    expect(shouldSuppressForViewedChannel(context(), 7, 'announcements')).toBe(
      false
    );
  });

  it('does not suppress when the window is not visible', () => {
    expect(
      shouldSuppressForViewedChannel(context({ visible: false }), 7, 'general')
    ).toBe(false);
  });

  it('does not suppress with the not-viewing sentinel group id', () => {
    expect(
      shouldSuppressForViewedChannel(
        context({ groupId: DEFAULT_NOT_VIEWING_GROUP_ID }),
        DEFAULT_NOT_VIEWING_GROUP_ID,
        'general'
      )
    ).toBe(false);
  });

  it('does not suppress when no context has been published', () => {
    expect(shouldSuppressForViewedChannel(null, 7, 'general')).toBe(false);
    expect(shouldSuppressForViewedChannel(undefined, 7, 'general')).toBe(false);
  });

  it('treats a non-finite group id as inactive', () => {
    expect(
      shouldSuppressForViewedChannel(context({ groupId: NaN }), NaN, 'general')
    ).toBe(false);
  });

  it('is independent of scroll position', () => {
    // Scroll state is not part of the context at all; extra properties must not
    // change the outcome. Being scrolled up in the open channel still counts.
    const cases = [
      { isAtBottom: true },
      { isAtBottom: false },
      { isAtBottom: undefined },
      { scrollTop: 0 },
      { scrollTop: 5000 },
    ];

    for (const extra of cases) {
      expect(
        shouldSuppressForViewedChannel(
          { ...context(), ...extra } as any,
          7,
          'general'
        )
      ).toBe(true);
    }
  });

  it('suppresses a DM-shaped negative group id never matching a real group', () => {
    const dmContext = context({ groupId: DEFAULT_NOT_VIEWING_GROUP_ID });
    expect(shouldSuppressForViewedChannel(dmContext, 7, 'general')).toBe(false);
  });
});

describe('isViewContextActive', () => {
  it('is active for a non-negative group id', () => {
    expect(isViewContextActive(context())).toBe(true);
    expect(isViewContextActive(context({ groupId: 0 }))).toBe(true);
  });

  it('is inactive for the sentinel and for missing context', () => {
    expect(
      isViewContextActive(context({ groupId: DEFAULT_NOT_VIEWING_GROUP_ID }))
    ).toBe(false);
    expect(isViewContextActive(null)).toBe(false);
  });
});

describe('computeQChatVisible', () => {
  it('is true when the document is visible and focused', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    expect(computeQChatVisible()).toBe(true);
  });

  it('is false when the document is visible but unfocused', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    expect(computeQChatVisible()).toBe(false);
  });

  it('is false when the document is hidden even if focused', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    expect(computeQChatVisible()).toBe(false);
  });
});
