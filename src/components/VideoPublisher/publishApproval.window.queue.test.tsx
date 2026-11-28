/**
 * The publisher's approval and a Q-App's request at the same time, through
 * Hub's real request route (get.ts, which shows one request at a time), App's
 * real message handler and the real useModal that holds App's approval
 * window. The permission handler below does what App's
 * qortalRequestPermissionFromExtension does with them.
 */
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppMessageHandler } from '../../hooks/useAppMessageHandler';
import { useModal } from '../../hooks/useModal';
import { getUserPermission } from '../../qortal/get';
import { requestPublishApproval } from './publishApproval';

const videoResources = [
  { service: 'VIDEO', name: 'Tester', identifier: 'qtube_vid_a_b' },
];
const qappPayload = {
  text1: 'Do you give this application permission to publish to QDN?',
  details: {
    type: 'resources',
    resources: [{ service: 'DOCUMENT', name: 'Tester', identifier: 'note' }],
  },
  fee: 0.01,
};

/** App's approval window: shows a request, answers with its buttons. */
function useApprovalWindow() {
  const modal = useModal();
  const handler = useRef(null);
  handler.current = async (message, event) => {
    try {
      await modal.show(message.payload);
      event.source.postMessage(
        {
          action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
          requestId: message.requestId,
          result: { accepted: true },
        },
        event.origin
      );
    } catch {
      event.source.postMessage(
        {
          action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
          requestId: message.requestId,
          result: { accepted: false },
        },
        event.origin
      );
    }
  };
  useAppMessageHandler({ current: true }, handler);
  return modal;
}

describe('the approval window with two requests at once', () => {
  beforeEach(() => {
    // jsdom leaves origin and source out of a page's message to itself;
    // App's handler checks both.
    vi.spyOn(window, 'postMessage').mockImplementation((data: unknown) => {
      setTimeout(() =>
        window.dispatchEvent(
          new MessageEvent('message', {
            data,
            origin: window.location.origin,
            source: window,
          })
        )
      );
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the video's request on screen when a Q-App asks meanwhile, then shows the Q-App's", async () => {
    const { result } = renderHook(() => useApprovalWindow());

    // A converted video asks right before it goes up.
    const video = requestPublishApproval({
      resources: videoResources,
      fee: 0.02,
    });
    await vi.waitFor(() =>
      expect(result.current.message).toMatchObject({ fee: 0.02 })
    );
    // A Q-App the user is working in asks too, while that window is open:
    // its request waits its turn, the video's stays on screen.
    const qapp = getUserPermission(qappPayload, true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.message).toMatchObject({
      details: { resources: videoResources },
    });

    act(() => result.current.onOk(undefined));
    await expect(video).resolves.toBe(true);

    // Then the Q-App's request shows, and gets its own answer.
    await vi.waitFor(() =>
      expect(result.current.message).toMatchObject({ fee: 0.01 })
    );
    act(() => result.current.onOk(undefined));
    await expect(qapp).resolves.toMatchObject({ accepted: true });
  });
});
