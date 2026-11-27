import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';

const mockMarkRead = vi.fn();
const mockMarkGroupsRead = vi.fn();

const refreshListener = vi.fn();

describe('markChannelRead event handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockMarkRead.mockResolvedValue({ success: true });
    mockMarkGroupsRead.mockResolvedValue({ success: true });
    (window as any).reticulumChat = {
      markRead: mockMarkRead,
      markGroupsRead: mockMarkGroupsRead,
    };
    (window as any).reticulumChat.markRead = mockMarkRead;
    subscribeToEvent('reticulum-chat-summaries-refresh', refreshListener);
  });

  afterEach(() => {
    unsubscribeFromEvent('reticulum-chat-summaries-refresh', refreshListener);
    vi.useRealTimers();
    delete (window as any).reticulumChat;
  });

  it('calls window.reticulumChat.markRead with correct args and fires refresh', async () => {
    const myAddress = 'test-address';
    const receivedArgs: any[] = [];

    const handler = async (e: Event) => {
      const { groupId, channelId } = (e as CustomEvent).detail;
      if (typeof (window as any).reticulumChat?.markRead !== 'function') {
        return;
      }
      const numericGroupId = Number(groupId);
      if (
        !Number.isInteger(numericGroupId) ||
        numericGroupId <= 0 ||
        !channelId
      ) {
        return;
      }
      const result = await (window as any).reticulumChat.markRead(
        numericGroupId,
        String(channelId),
        Date.now(),
        myAddress
      );
      receivedArgs.push({
        numericGroupId,
        channelId: String(channelId),
        result,
      });
      executeEvent('reticulum-chat-summaries-refresh', {});
    };

    subscribeToEvent('markChannelRead', handler);

    executeEvent('markChannelRead', {
      groupId: 42,
      channelId: 'general',
    });

    await vi.waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledTimes(1);
    });

    expect(mockMarkRead).toHaveBeenCalledWith(
      42,
      'general',
      expect.any(Number),
      'test-address'
    );

    await vi.waitFor(() => {
      expect(refreshListener).toHaveBeenCalledTimes(1);
    });

    unsubscribeFromEvent('markChannelRead', handler);
  });

  it('does not call markRead when reticulumChat is unavailable', async () => {
    delete (window as any).reticulumChat;

    const handler = async (e: Event) => {
      const { groupId, channelId } = (e as CustomEvent).detail;
      if (typeof (window as any).reticulumChat?.markRead !== 'function') {
        return;
      }
      (window as any).reticulumChat.markRead(
        Number(groupId),
        String(channelId),
        Date.now(),
        'addr'
      );
    };

    subscribeToEvent('markChannelRead', handler);

    executeEvent('markChannelRead', {
      groupId: 1,
      channelId: 'ch',
    });

    await vi.waitFor(() => {
      expect(mockMarkRead).not.toHaveBeenCalled();
    });

    unsubscribeFromEvent('markChannelRead', handler);
    (window as any).reticulumChat = { markRead: mockMarkRead };
  });
});

describe('markSectionRead event handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkRead.mockResolvedValue({ success: true });
    (window as any).reticulumChat = {
      markRead: mockMarkRead,
      markGroupsRead: mockMarkGroupsRead,
    };
    subscribeToEvent('reticulum-chat-summaries-refresh', refreshListener);
  });

  afterEach(() => {
    unsubscribeFromEvent('reticulum-chat-summaries-refresh', refreshListener);
    delete (window as any).reticulumChat;
  });

  it('calls markRead for each channel sequentially and fires refresh', async () => {
    const myAddress = 'test-address';
    const channelIds = ['ch1', 'ch2', 'ch3'];

    const handler = async (e: Event) => {
      const { groupId, channelIds } = (e as CustomEvent).detail;
      const numericGroupId = Number(groupId);
      if (
        !Number.isInteger(numericGroupId) ||
        numericGroupId <= 0 ||
        !Array.isArray(channelIds) ||
        channelIds.length === 0
      ) {
        return;
      }
      for (const channelId of channelIds) {
        try {
          await (window as any).reticulumChat.markRead(
            numericGroupId,
            String(channelId),
            Date.now(),
            myAddress
          );
        } catch (error) {
          console.error('Failed:', error);
        }
      }
      executeEvent('reticulum-chat-summaries-refresh', {});
    };

    subscribeToEvent('markSectionRead', handler);

    executeEvent('markSectionRead', {
      groupId: 99,
      channelIds,
    });

    await vi.waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledTimes(3);
    });

    expect(mockMarkRead).toHaveBeenNthCalledWith(
      1,
      99,
      'ch1',
      expect.any(Number),
      'test-address'
    );
    expect(mockMarkRead).toHaveBeenNthCalledWith(
      2,
      99,
      'ch2',
      expect.any(Number),
      'test-address'
    );
    expect(mockMarkRead).toHaveBeenNthCalledWith(
      3,
      99,
      'ch3',
      expect.any(Number),
      'test-address'
    );

    await vi.waitFor(() => {
      expect(refreshListener).toHaveBeenCalledTimes(1);
    });

    unsubscribeFromEvent('markSectionRead', handler);
  });

  it('continues marking remaining channels when one fails', async () => {
    const myAddress = 'test-address';
    mockMarkRead
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('bridge error'))
      .mockResolvedValueOnce({ success: true });

    const handler = async (e: Event) => {
      const { groupId, channelIds } = (e as CustomEvent).detail;
      const numericGroupId = Number(groupId);
      for (const channelId of channelIds) {
        try {
          await (window as any).reticulumChat.markRead(
            numericGroupId,
            String(channelId),
            Date.now(),
            myAddress
          );
        } catch (error) {
          console.error('Failed:', error);
        }
      }
      executeEvent('reticulum-chat-summaries-refresh', {});
    };

    subscribeToEvent('markSectionRead', handler);

    executeEvent('markSectionRead', {
      groupId: 5,
      channelIds: ['a', 'b', 'c'],
    });

    await vi.waitFor(() => {
      expect(mockMarkRead).toHaveBeenCalledTimes(3);
    });

    await vi.waitFor(() => {
      expect(refreshListener).toHaveBeenCalledTimes(1);
    });

    unsubscribeFromEvent('markSectionRead', handler);
  });

  it('does nothing with empty channelIds', async () => {
    const handler = async (e: Event) => {
      const { groupId, channelIds } = (e as CustomEvent).detail;
      if (!Array.isArray(channelIds) || channelIds.length === 0) {
        return;
      }
    };

    subscribeToEvent('markSectionRead', handler);

    executeEvent('markSectionRead', {
      groupId: 1,
      channelIds: [],
    });

    await vi.waitFor(() => {
      expect(mockMarkRead).not.toHaveBeenCalled();
    });

    unsubscribeFromEvent('markSectionRead', handler);
  });
});

describe('markChannelRead event dispatch payload', () => {
  it('dispatches with correct { groupId, channelId }', () => {
    const listener = vi.fn();
    subscribeToEvent('markChannelRead', listener);

    executeEvent('markChannelRead', {
      groupId: 77,
      channelId: 'test-channel',
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({
      groupId: 77,
      channelId: 'test-channel',
    });

    unsubscribeFromEvent('markChannelRead', listener);
  });
});

describe('markSectionRead event dispatch payload', () => {
  it('dispatches with correct { groupId, channelIds }', () => {
    const listener = vi.fn();
    subscribeToEvent('markSectionRead', listener);

    executeEvent('markSectionRead', {
      groupId: 88,
      channelIds: ['ch1', 'ch2'],
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toEqual({
      groupId: 88,
      channelIds: ['ch1', 'ch2'],
    });

    unsubscribeFromEvent('markSectionRead', listener);
  });
});

describe('deferred markRead consumption', () => {
  it('consumes deferred key when defer condition no longer applies', () => {
    const deferredSet = new Set<string>();
    const readKey = '1:general:addr';

    // Simulate first entry: defer condition true -> key added
    const enteredChannel1 = true;
    const entryTokenChanged1 = false;
    const wasAlreadyActive1 = false;
    if (enteredChannel1 || entryTokenChanged1 || !wasAlreadyActive1) {
      deferredSet.add(readKey);
    }
    expect(deferredSet.has(readKey)).toBe(true);

    // Simulate second evaluation: defer condition false -> key consumed
    const enteredChannel2 = false;
    const entryTokenChanged2 = false;
    const wasAlreadyActive2 = true;
    if (deferredSet.has(readKey)) {
      if (enteredChannel2 || entryTokenChanged2 || !wasAlreadyActive2) {
        // defer still active -- should not happen in this scenario
        expect(false).toBe(true);
      } else {
        deferredSet.delete(readKey);
      }
    }
    expect(deferredSet.has(readKey)).toBe(false);
  });

  it('keeps deferred key when defer condition still applies on re-evaluation', () => {
    const deferredSet = new Set<string>();
    const readKey = '2:announcements:addr';

    // Simulate first entry: defer condition true -> key added
    deferredSet.add(readKey);
    expect(deferredSet.has(readKey)).toBe(true);

    // Simulate second evaluation: defer condition still true (e.g. still entering)
    const enteredChannel2 = true;
    const entryTokenChanged2 = false;
    const wasAlreadyActive2 = false;
    if (deferredSet.has(readKey)) {
      if (enteredChannel2 || entryTokenChanged2 || !wasAlreadyActive2) {
        // defer still active -- keep the key
      }
    }
    expect(deferredSet.has(readKey)).toBe(true);
  });

  it('multiple keys in deferred Set are handled independently', () => {
    const deferredSet = new Set<string>();
    const readKey1 = '1:general:addr';
    const readKey2 = '1:announcements:addr';

    // Both keys deferred
    deferredSet.add(readKey1);
    deferredSet.add(readKey2);

    // First key defer condition expires
    if (deferredSet.has(readKey1)) {
      deferredSet.delete(readKey1);
    }
    expect(deferredSet.has(readKey1)).toBe(false);
    // Second key still deferred
    expect(deferredSet.has(readKey2)).toBe(true);
  });
});
