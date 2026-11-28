import { beforeEach, describe, expect, it, vi } from 'vitest';

const getUserPermission = vi.fn();
vi.mock('../../qortal/get', () => ({ getUserPermission }));

import { requestPublishApproval } from './publishApproval';

describe('requestPublishApproval', () => {
  beforeEach(() => getUserPermission.mockReset());

  it("asks with Hub's own Q-App approval: the resources and the fee", async () => {
    getUserPermission.mockResolvedValue({ accepted: true });
    const resources = [
      { service: 'VIDEO', name: 'Tester', identifier: 'qtube_vid_a_b' },
      {
        service: 'DOCUMENT',
        name: 'Tester',
        identifier: 'qtube_vid_a_b_metadata',
        filename: 'video_metadata.json',
      },
    ];
    expect(await requestPublishApproval({ resources, fee: 0.02 })).toBe(true);
    const [payload, isFromExtension, appInfo] = getUserPermission.mock.calls[0];
    expect(payload).toMatchObject({
      text1: 'Do you give this application permission to publish to QDN?',
      details: { type: 'resources', resources },
      fee: 0.02,
    });
    // Without it, App's handler leaves the request unanswered.
    expect(isFromExtension).toBe(true);
    // Hub's own request, so the window names no app.
    expect(appInfo).toEqual({ fromHub: true });
  });

  it('is declined when the answer is no, or none came in time', async () => {
    getUserPermission.mockResolvedValue({ accepted: false });
    expect(await requestPublishApproval({ resources: [], fee: 0 })).toBe(false);
    // Hub resolves with false after the minute it waits.
    getUserPermission.mockResolvedValue(false);
    expect(await requestPublishApproval({ resources: [], fee: 0 })).toBe(false);
  });
});
