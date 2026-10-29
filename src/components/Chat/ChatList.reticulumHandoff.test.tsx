import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings
// rather than returning raw keys.
import '../../i18n/i18n';
import { ChatList } from './ChatList';

const virtualizer = vi.hoisted(() => ({
  count: 0,
  getTotalSize: () => virtualizer.count * 80,
  getVirtualItems: () =>
    Array.from({ length: virtualizer.count }, (_, index) => ({
      index,
      key: index,
      size: 80,
      start: index * 80,
    })),
  isScrolling: false,
  useAnimationFrameWithResizeObserver: false,
  getOffsetForIndex: vi.fn(
    (index: number, align: 'start' | 'end') => [index * 80, align] as const
  ),
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
  scrollToOffset: vi.fn(),
  rangeExtractor: null as
    | null
    | ((range: {
        startIndex: number;
        endIndex: number;
        overscan: number;
        count: number;
      }) => number[]),
  shouldAdjustScrollPositionOnItemSizeChange: null as
    | null
    | ((
        item: { start: number },
        delta: number,
        instance: {
          getScrollOffset: () => number;
          scrollAdjustments: number;
        }
      ) => boolean),
}));

vi.mock('@tanstack/react-virtual', () => ({
  defaultRangeExtractor: (range: {
    startIndex: number;
    endIndex: number;
    overscan: number;
    count: number;
  }) => {
    const start = Math.max(0, range.startIndex - range.overscan);
    const end = Math.min(range.count - 1, range.endIndex + range.overscan);
    return Array.from(
      { length: Math.max(0, end - start + 1) },
      (_, offset) => start + offset
    );
  },
  useVirtualizer: (options: {
    count: number;
    useAnimationFrameWithResizeObserver?: boolean;
    rangeExtractor?: typeof virtualizer.rangeExtractor;
    shouldAdjustScrollPositionOnItemSizeChange?: typeof virtualizer.shouldAdjustScrollPositionOnItemSizeChange;
  }) => {
    const { count } = options;
    virtualizer.count = count;
    virtualizer.useAnimationFrameWithResizeObserver =
      options.useAnimationFrameWithResizeObserver ?? false;
    virtualizer.shouldAdjustScrollPositionOnItemSizeChange =
      options.shouldAdjustScrollPositionOnItemSizeChange ?? null;
    virtualizer.rangeExtractor = options.rangeExtractor ?? null;
    return virtualizer;
  },
}));

vi.mock('./MessageItem', () => ({
  MessageItem: ({ message }: { message: { signature?: string } }) => (
    <div data-testid={'message-' + message.signature} />
  ),
}));

vi.mock('./ChatOptions', () => ({
  ChatOptions: () => null,
}));

const message = (
  signature: string,
  sender = 'Qremote',
  overrides: Record<string, unknown> = {}
) => ({
  signature,
  id: signature,
  message: signature,
  messageText: signature,
  sender,
  timestamp: Number(signature.replace(/\D/g, '')) || 1,
  ...overrides,
});

const baseProps = {
  chatReferences: {},
  handleReaction: vi.fn(),
  initialMessages: [],
  myAddress: 'Qme',
  onDelete: vi.fn(),
  onEdit: vi.fn(),
  onReply: vi.fn(),
  reticulumChatEnabled: true,
  reticulumInitialHistoryReady: true,
  reticulumUnreadCount: 0,
  reticulumViewActive: true,
  tempChatReferences: [],
  tempMessages: [],
};

let nextAnimationFrameId = 1;
let animationFrames = new Map<number, FrameRequestCallback>();

const flushPositioning = async () => {
  for (let pass = 0; pass < 6 && animationFrames.size > 0; pass += 1) {
    const callbacks = [...animationFrames.values()];
    animationFrames.clear();
    await act(async () => {
      callbacks.forEach((callback) => callback(performance.now()));
    });
  }
};

describe('Reticulum ChatList channel handoff', () => {
  beforeEach(() => {
    vi.useRealTimers();
    virtualizer.scrollToIndex.mockClear();
    virtualizer.scrollToOffset.mockClear();
    virtualizer.getOffsetForIndex.mockClear();
    nextAnimationFrameId = 1;
    animationFrames = new Map();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      animationFrames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      animationFrames.delete(id);
    });
  });

  it('keeps a reused list hidden until the new channel is positioned', async () => {
    const { container, rerender } = render(
      <ChatList
        {...baseProps}
        chatId="group-1:channel-a"
        initialMessages={[message('message-1'), message('message-2')]}
      />
    );
    await flushPositioning();

    const viewport = container.querySelector(
      '[data-reticulum-chat-scroll-viewport="true"]'
    ) as HTMLElement;
    expect(viewport).toHaveStyle({ visibility: 'visible' });
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled();

    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:channel-b"
        initialMessages={[]}
        reticulumInitialHistoryReady={false}
      />
    );
    expect(viewport).toHaveStyle({ visibility: 'hidden' });

    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:channel-b"
        initialMessages={[message('message-3')]}
      />
    );
    expect(viewport).toHaveStyle({ visibility: 'hidden' });
    await flushPositioning();

    expect(viewport).toHaveStyle({ visibility: 'visible' });
    expect(
      container.querySelector('[data-testid="message-message-1"]')
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="message-message-3"]')
    ).not.toBeNull();
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled();
  });

  it('remeasures only an existing Reticulum row whose reactions changed', () => {
    const initialMessages = [message('message-1'), message('message-2')];
    const { container, rerender } = render(
      <ChatList
        {...baseProps}
        chatId="group-1:reaction-channel"
        initialMessages={initialMessages}
      />
    );

    virtualizer.measureElement.mockClear();
    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:reaction-channel"
        initialMessages={initialMessages}
        chatReferences={{
          'message-1': {
            reactions: {
              '👍': [{ sender: 'Qremote' }],
            },
          },
        }}
      />
    );

    const changedRow = container.querySelector('[data-index="0"]');
    expect(changedRow).not.toBeNull();
    expect(virtualizer.measureElement).toHaveBeenCalledTimes(1);
    expect(virtualizer.measureElement).toHaveBeenCalledWith(changedRow);

    virtualizer.measureElement.mockClear();
    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:reaction-channel"
        initialMessages={initialMessages}
        chatReferences={{
          'message-1': {
            reactions: {
              '👍': [{ sender: 'Qremote' }],
            },
          },
        }}
      />
    );
    expect(virtualizer.measureElement).not.toHaveBeenCalled();
  });

  it('remeasures a welcome when membership validation changes, before an animation frame', () => {
    const initialMessages = [
      message('message-1'),
      message('message-2', 'Qnew', {
        groupId: 1,
        qchatSystem: {
          type: 'group-welcome',
          groupId: 1,
          joinedAddress: 'Qnew',
          joinedAt: 123,
        },
      }),
      message('message-3'),
    ];
    const props = {
      ...baseProps,
      initialMessages,
      chatId: 'group-1:welcome-channel',
      reticulumMemberJoinedByAddress: { Qnew: 123 },
    };
    const { container, rerender } = render(
      <ChatList {...props} reticulumMemberRolesReady={false} />
    );
    virtualizer.measureElement.mockClear();
    rerender(<ChatList {...props} reticulumMemberRolesReady />);
    const welcomeRow = container.querySelector('[data-index="1"]');
    expect(virtualizer.measureElement.mock.calls).toEqual([[welcomeRow]]);
    // A deferred ResizeObserver entry could restore the old hidden-row size
    // even after this synchronous measurement has corrected the next row.
    expect(virtualizer.useAnimationFrameWithResizeObserver).toBe(false);

    virtualizer.measureElement.mockClear();
    rerender(
      <ChatList
        {...props}
        reticulumMemberRolesReady
        reticulumMemberJoinedByAddress={{ Qnew: 123, Qunrelated: 456 }}
      />
    );
    expect(virtualizer.measureElement).not.toHaveBeenCalled();

    rerender(
      <ChatList
        {...props}
        reticulumMemberRolesReady
        reticulumMemberJoinedByAddress={{ Qnew: 456 }}
      />
    );
    expect(virtualizer.measureElement.mock.calls).toEqual([[welcomeRow]]);
  });

  it('remeasures an unread divider and the following newly ungrouped header', async () => {
    const initialMessages = [
      message('message-1'),
      message('message-2'),
      message('message-3'),
    ];
    const props = {
      ...baseProps,
      initialMessages,
      chatId: 'group-1:divider-channel',
    };
    const { container, rerender } = render(<ChatList {...props} />);
    virtualizer.measureElement.mockClear();
    rerender(
      <ChatList
        {...props}
        reticulumUnreadCount={2}
        reticulumReadEntryToken={1}
      />
    );
    // The unread boundary is selected on the positioning frame. Measuring the
    // resulting divider/header change must happen in that React commit.
    await flushPositioning();
    expect(virtualizer.measureElement.mock.calls).toEqual([
      [container.querySelector('[data-index="1"]')],
      [container.querySelector('[data-index="2"]')],
    ]);
  });

  it('does not remeasure reaction rows while replacing a channel window', () => {
    const { rerender } = render(
      <ChatList
        {...baseProps}
        chatId="group-1:reaction-channel-a"
        initialMessages={[message('message-1')]}
        chatReferences={{
          'message-1': {
            reactions: { '👍': [{ sender: 'Qremote' }] },
          },
        }}
      />
    );

    virtualizer.measureElement.mockClear();
    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:reaction-channel-b"
        initialMessages={[message('message-2')]}
        chatReferences={{
          'message-2': {
            reactions: { '❤️': [{ sender: 'Qremote' }] },
          },
        }}
      />
    );

    // React detaches the old keyed row and attaches the replacement, so the
    // virtualizer receives one normal element measurement. The reaction
    // baseline must not add a second targeted measurement during handoff.
    const elementMeasurements = virtualizer.measureElement.mock.calls.filter(
      ([element]) => element instanceof HTMLElement
    );
    expect(elementMeasurements).toHaveLength(1);
  });

  it('does not add reaction measurements while replacing a same-channel search window', () => {
    const { rerender } = render(
      <ChatList
        {...baseProps}
        chatId="group-1:reaction-search-channel"
        initialMessages={[message('message-1')]}
        chatReferences={{
          'message-1': {
            reactions: { '👍': [{ sender: 'Qremote' }] },
          },
        }}
      />
    );

    virtualizer.measureElement.mockClear();
    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:reaction-search-channel"
        initialMessages={[message('message-2')]}
        chatReferences={{
          'message-2': {
            reactions: { '❤️': [{ sender: 'Qremote' }] },
          },
        }}
      />
    );

    const elementMeasurements = virtualizer.measureElement.mock.calls.filter(
      ([element]) => element instanceof HTMLElement
    );
    expect(elementMeasurements).toHaveLength(1);
  });

  it('lands on the first message represented by the unread count', async () => {
    render(
      <ChatList
        {...baseProps}
        chatId="group-1:unread-channel"
        initialMessages={[
          message('message-1'),
          message('message-2', 'Qme'),
          message('message-3'),
          message('message-4', 'Qremote', {
            chatReference: 'message-1',
          }),
          message('message-5'),
          message('message-6'),
        ]}
        reticulumUnreadCount={2}
      />
    );
    await flushPositioning();

    expect(virtualizer.getOffsetForIndex).toHaveBeenCalledWith(4, 'start');
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled();
  });

  it('pins an all-read channel to the real bottom as rows settle', async () => {
    const { container, rerender } = render(
      <ChatList
        {...baseProps}
        chatId="group-1:all-read-channel"
        initialMessages={[message('message-1'), message('message-2')]}
      />
    );
    const viewport = container.querySelector(
      '[data-reticulum-chat-scroll-viewport="true"]'
    ) as HTMLDivElement;
    let scrollHeight = 1_000;
    let scrollTop = 0;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, get: () => 300 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });

    expect(viewport).toHaveStyle({ visibility: 'hidden' });
    await flushPositioning();
    expect(viewport).toHaveStyle({ visibility: 'visible' });
    expect(scrollTop).toBe(1_000);

    scrollHeight = 1_240;
    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:all-read-channel"
        initialMessages={[
          message('message-1'),
          message('message-2'),
          message('message-3'),
        ]}
      />
    );
    await flushPositioning();
    expect(scrollTop).toBe(1_240);

    // A state refresh can arrive while the browser is between virtual-row
    // corrections. That transient offset must not release bottom-following.
    scrollTop = 680;
    scrollHeight = 1_400;
    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:all-read-channel"
        initialMessages={[
          message('message-1'),
          message('message-2'),
          message('message-3'),
          message('message-4'),
        ]}
      />
    );
    await flushPositioning();
    expect(scrollTop).toBe(1_400);

    // A virtualizer/layout correction must not be mistaken for the reader
    // deliberately scrolling away from the bottom.
    scrollTop = 640;
    fireEvent.scroll(viewport);
    expect(scrollTop).toBe(1_400);

    // An actual reader gesture still releases bottom-following immediately.
    virtualizer.scrollToIndex.mockClear();
    virtualizer.scrollToOffset.mockClear();
    virtualizer.getOffsetForIndex.mockClear();
    fireEvent.wheel(viewport, { deltaY: -100 });
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled();
    expect(virtualizer.scrollToOffset).not.toHaveBeenCalled();
    expect(virtualizer.getOffsetForIndex).not.toHaveBeenCalled();
    expect(
      virtualizer.shouldAdjustScrollPositionOnItemSizeChange?.(
        { start: 1_600 },
        80,
        { getScrollOffset: () => 1_100, scrollAdjustments: 0 }
      )
    ).toBe(false);
    scrollTop = 520;
    fireEvent.scroll(viewport);
    expect(scrollTop).toBe(520);
  });

  it('does not reclaim a tiny upward reader scroll inside the bottom tolerance', async () => {
    const initialWindow = [message('message-1'), message('message-2')];
    const { container, rerender } = render(
      <ChatList
        {...baseProps}
        chatId="group-1:tiny-reader-scroll"
        initialMessages={initialWindow}
      />
    );
    const viewport = container.querySelector(
      '[data-reticulum-chat-scroll-viewport="true"]'
    ) as HTMLDivElement;
    let scrollHeight = 1_000;
    let scrollTop = 0;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, get: () => 300 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, Math.min(value, scrollHeight - 300));
        },
      },
    });

    await flushPositioning();
    expect(scrollTop).toBe(700);

    fireEvent.wheel(viewport, { deltaY: -8 });
    scrollTop = 692;
    fireEvent.scroll(viewport);
    expect(scrollTop).toBe(692);

    // Reaching the real end naturally restores following for subsequent
    // messages and row-height changes.
    fireEvent.wheel(viewport, { deltaY: 8 });
    scrollTop = 700;
    fireEvent.scroll(viewport);
    scrollHeight = 1_100;
    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:tiny-reader-scroll"
        initialMessages={[...initialWindow, message('message-3')]}
      />
    );
    await flushPositioning();
    expect(scrollTop).toBe(800);
  });

  it('reveals an all-read channel on the first positioning frame', async () => {
    const { container } = render(
      <ChatList
        {...baseProps}
        chatId="group-1:fast-channel"
        initialMessages={[message('message-1'), message('message-2')]}
      />
    );
    const viewport = container.querySelector(
      '[data-reticulum-chat-scroll-viewport="true"]'
    ) as HTMLDivElement;
    let scrollTop = 0;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, get: () => 300 },
      scrollHeight: { configurable: true, get: () => 1_000 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });

    // The first frame runs the post-commit positioning decision and schedules
    // the frame in which the committed virtual rows are pinned and revealed.
    const firstFrame = [...animationFrames.values()];
    animationFrames.clear();
    await act(async () => {
      firstFrame.forEach((callback) => callback(performance.now()));
    });
    expect(viewport).toHaveStyle({ visibility: 'hidden' });

    const positioningFrame = [...animationFrames.values()];
    animationFrames.clear();
    await act(async () => {
      positioningFrame.forEach((callback) => callback(performance.now()));
    });

    expect(scrollTop).toBe(1_000);
    expect(viewport).toHaveStyle({ visibility: 'visible' });
  });

  it('keeps the first search-result jump instead of following the larger result window to the bottom', async () => {
    const onLoadNewer = vi.fn().mockResolvedValue({ added: 1 });
    const { container, rerender } = render(
      <ChatList
        {...baseProps}
        chatId="group-1:search-channel"
        initialMessages={[message('message-3'), message('message-4')]}
      />
    );
    const viewport = container.querySelector(
      '[data-reticulum-chat-scroll-viewport="true"]'
    ) as HTMLDivElement;
    let scrollTop = 0;
    let scrollHeight = 1_000;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, get: () => 300 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });

    await flushPositioning();
    expect(scrollTop).toBe(1_000);

    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:search-channel"
        initialMessages={[
          message('message-1'),
          message('message-2'),
          message('message-3'),
          message('message-4'),
        ]}
        hasNewerMessages
        onLoadNewer={onLoadNewer}
        scrollToMessageId="message-2"
        scrollToMessageNonce={1}
      />
    );
    // The anchored window keeps its full layout footprint, but its dynamic
    // positioning corrections are not exposed to the reader.
    expect(viewport).toHaveStyle({ visibility: 'hidden' });
    await flushPositioning();

    expect(viewport).toHaveStyle({ visibility: 'visible' });
    expect(virtualizer.getOffsetForIndex).toHaveBeenCalledWith(1, 'start');
    expect(scrollTop).toBe(80);

    // A short anchored window can clamp the requested target to its temporary
    // bottom. That programmatic scroll must neither turn bottom-following back
    // on nor start fetching every newer page until the real latest message.
    scrollHeight = 380;
    fireEvent.scroll(viewport);
    expect(scrollTop).toBe(80);
    expect(onLoadNewer).not.toHaveBeenCalled();

    scrollHeight = 460;
    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:search-channel"
        initialMessages={[
          message('message-1'),
          message('message-2'),
          message('message-3'),
          message('message-4'),
          message('message-5'),
        ]}
        hasNewerMessages
        onLoadNewer={onLoadNewer}
        scrollToMessageId="message-2"
        scrollToMessageNonce={1}
      />
    );
    await flushPositioning();
    expect(scrollTop).toBe(80);

    // Once the reader deliberately scrolls to the lower edge, normal forward
    // pagination resumes.
    scrollTop = 160;
    fireEvent.wheel(viewport, { deltaY: 100 });
    fireEvent.scroll(viewport);
    await waitFor(() => expect(onLoadNewer).toHaveBeenCalledTimes(1));
  });

  it('completes a cross-channel search jump on the first request', async () => {
    const { container, rerender } = render(
      <ChatList
        {...baseProps}
        chatId="group-1:channel-a"
        initialMessages={[message('message-1')]}
      />
    );
    await flushPositioning();

    const viewport = container.querySelector(
      '[data-reticulum-chat-scroll-viewport="true"]'
    ) as HTMLDivElement;
    let scrollTop = 0;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, get: () => 300 },
      scrollHeight: { configurable: true, get: () => 1_000 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });

    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:channel-b"
        initialMessages={[]}
        reticulumInitialHistoryReady={false}
        scrollToMessageId="message-3"
        scrollToMessageNonce={1}
      />
    );
    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:channel-b"
        initialMessages={[
          message('message-2'),
          message('message-3'),
          message('message-4'),
        ]}
        scrollToMessageId="message-3"
        scrollToMessageNonce={1}
      />
    );

    expect(viewport).toHaveStyle({ visibility: 'hidden' });
    await flushPositioning();

    expect(viewport).toHaveStyle({ visibility: 'visible' });
    expect(virtualizer.getOffsetForIndex).toHaveBeenCalledWith(1, 'start');
    expect(scrollTop).toBe(80);
  });

  it('mounts a distant pending search target outside the visible virtual range', () => {
    const historyWindow = Array.from({ length: 121 }, (_, index) =>
      message(`message-${index}`)
    );
    render(
      <ChatList
        {...baseProps}
        chatId="group-1:search-channel"
        initialMessages={historyWindow}
        scrollToMessageId="message-80"
        scrollToMessageNonce={1}
      />
    );

    const extracted = virtualizer.rangeExtractor?.({
      startIndex: 0,
      endIndex: 5,
      overscan: 5,
      count: historyWindow.length,
    });
    expect(extracted).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 80]);
  });

  it('keeps a same-channel search request pending until its converted row arrives', async () => {
    const { container, rerender } = render(
      <ChatList
        {...baseProps}
        chatId="group-1:search-channel"
        initialMessages={[message('message-8'), message('message-9')]}
      />
    );
    await flushPositioning();

    const viewport = container.querySelector(
      '[data-reticulum-chat-scroll-viewport="true"]'
    ) as HTMLDivElement;
    let scrollTop = 0;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, get: () => 300 },
      scrollHeight: { configurable: true, get: () => 1_000 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });
    const querySelector = viewport.querySelector.bind(viewport);
    let targetMountChecks = 0;
    vi.spyOn(viewport, 'querySelector').mockImplementation((selector) => {
      if (selector === '[data-index="1"]') {
        targetMountChecks += 1;
        if (targetMountChecks <= 2) return null;
      }
      return querySelector(selector);
    });

    // The navigation request is created as soon as the DB window opens. The
    // converted ChatList rows arrive in a later render.
    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:search-channel"
        initialMessages={[message('message-8'), message('message-9')]}
        scrollToMessageId="message-3"
        scrollToMessageNonce={1}
      />
    );
    expect(viewport).toHaveStyle({ visibility: 'hidden' });

    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:search-channel"
        initialMessages={[
          message('message-2'),
          message('message-3'),
          message('message-4'),
        ]}
        scrollToMessageId="message-3"
        scrollToMessageNonce={1}
      />
    );
    await flushPositioning();

    expect(viewport).toHaveStyle({ visibility: 'visible' });
    expect(targetMountChecks).toBeGreaterThan(2);
    expect(virtualizer.getOffsetForIndex).toHaveBeenCalledWith(1, 'start');
    expect(scrollTop).toBe(80);
  });

  it('does not consume a search request against a stale copy of the same target', async () => {
    const oldWindow = [
      message('message-2'),
      message('message-3'),
      message('message-8'),
    ];
    const { container, rerender } = render(
      <ChatList
        {...baseProps}
        chatId="group-1:search-channel"
        initialMessages={oldWindow}
      />
    );
    await flushPositioning();

    const viewport = container.querySelector(
      '[data-reticulum-chat-scroll-viewport="true"]'
    ) as HTMLDivElement;
    let scrollTop = 0;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, get: () => 300 },
      scrollHeight: { configurable: true, get: () => 1_000 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });
    virtualizer.getOffsetForIndex.mockClear();

    // The one request exists from the click onward, but remains blocked while
    // the replacement history is loading. It must not use index 1 from the old
    // window.
    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:search-channel"
        initialMessages={oldWindow}
        reticulumNavigationPending
        scrollToMessageId="message-3"
        scrollToMessageNonce={1}
      />
    );
    await flushPositioning();
    expect(virtualizer.getOffsetForIndex).not.toHaveBeenCalled();

    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:search-channel"
        initialMessages={[
          message('message-0'),
          message('message-1'),
          message('message-2'),
          message('message-3'),
          message('message-4'),
        ]}
        reticulumNavigationPending
        scrollToMessageId="message-3"
        scrollToMessageNonce={1}
      />
    );
    await flushPositioning();
    expect(virtualizer.getOffsetForIndex).not.toHaveBeenCalled();

    // Releasing the same request after conversion must use index 3 without a
    // second click or nonce.
    rerender(
      <ChatList
        {...baseProps}
        chatId="group-1:search-channel"
        initialMessages={[
          message('message-0'),
          message('message-1'),
          message('message-2'),
          message('message-3'),
          message('message-4'),
        ]}
        scrollToMessageId="message-3"
        scrollToMessageNonce={1}
      />
    );
    await flushPositioning();

    expect(viewport).toHaveStyle({ visibility: 'visible' });
    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(3, {
      align: 'start',
    });
    expect(virtualizer.getOffsetForIndex).toHaveBeenCalledWith(3, 'start');
    expect(virtualizer.getOffsetForIndex).not.toHaveBeenCalledWith(1, 'start');
    expect(virtualizer.scrollToOffset).toHaveBeenCalledWith(240, {
      align: 'start',
    });
    expect(scrollTop).toBe(240);
  });

  it('loads forward at the anchored window edge and can jump directly to latest', async () => {
    const onLoadNewer = vi.fn().mockResolvedValue({ added: 2 });
    const onJumpToLatest = vi.fn().mockResolvedValue({ success: true });
    const { container } = render(
      <ChatList
        {...baseProps}
        chatId="group-1:anchored-channel"
        hasNewerMessages
        initialMessages={[message('message-1'), message('message-2')]}
        onJumpToLatest={onJumpToLatest}
        onLoadNewer={onLoadNewer}
      />
    );
    const viewport = container.querySelector(
      '[data-reticulum-chat-scroll-viewport="true"]'
    ) as HTMLDivElement;
    let scrollTop = 700;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, get: () => 300 },
      scrollHeight: { configurable: true, get: () => 1_000 },
      scrollTop: {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });
    await flushPositioning();

    scrollTop = 700;
    fireEvent.scroll(viewport);
    await waitFor(() => expect(onLoadNewer).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /jump to latest/i }));
    await waitFor(() => expect(onJumpToLatest).toHaveBeenCalledTimes(1));
    await flushPositioning();
    expect(scrollTop).toBe(1_000);
  });
});
