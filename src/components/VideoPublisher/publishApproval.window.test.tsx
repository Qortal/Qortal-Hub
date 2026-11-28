/**
 * The approval goes the way a Q-App's does: get.ts posts the request, App's
 * message handler opens its approval window, and the answer comes back.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppMessageHandler } from '../../hooks/useAppMessageHandler';
import { requestPublishApproval } from './publishApproval';

const resources = [
  { service: 'VIDEO', name: 'Tester', identifier: 'qtube_vid_a_b' },
];

/** App's approval window, answering Accept or Decline. */
function approvalWindow(accepted: boolean) {
  const shown = vi.fn();
  renderHook(() =>
    useAppMessageHandler(
      { current: true },
      {
        current: (message, event) => {
          shown(message.payload);
          (event.source as Window).postMessage(
            {
              action: 'QORTAL_REQUEST_PERMISSION_RESPONSE',
              requestId: message.requestId,
              result: { accepted },
            },
            event.origin
          );
        },
      }
    )
  );
  return shown;
}

describe("requestPublishApproval, through Hub's approval window", () => {
  beforeEach(() => {
    // A page posting to itself gets its own origin and window as the source
    // in a browser; jsdom leaves both out, and App's handler checks them.
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
  afterEach(() => vi.restoreAllMocks());

  it('opens the window with the resources and the fee, and takes Accept', async () => {
    const shown = approvalWindow(true);
    const answer = requestPublishApproval({ resources, fee: 0.01 });
    await vi.waitFor(() => expect(shown).toHaveBeenCalled());
    expect(shown).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { type: 'resources', resources },
        fee: 0.01,
        // Hub's own request: the window names no app, where a request
        // without a tab would be shown as an unknown Q-App's.
        fromHub: true,
        requestingApp: null,
      })
    );
    await expect(answer).resolves.toBe(true);
  });

  it('takes Decline', async () => {
    const shown = approvalWindow(false);
    const answer = requestPublishApproval({ resources, fee: 0.01 });
    await vi.waitFor(() => expect(shown).toHaveBeenCalled());
    await expect(answer).resolves.toBe(false);
  });
});
