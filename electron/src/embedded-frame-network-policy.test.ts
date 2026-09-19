import { describe, expect, it } from 'vitest';
import {
  EMBEDDED_FRAME_CONNECTION_ALLOWLIST,
  withEmbeddedFrameWebRtcBlocked,
} from './embedded-frame-network-policy';

describe('embedded frame network policy', () => {
  it('blocks WebRTC only on subframe document responses', () => {
    expect(
      withEmbeddedFrameWebRtcBlocked(
        { Existing: ['value'] },
        { resourceType: 'subFrame' }
      )
    ).toEqual({
      Existing: ['value'],
      'Connection-Allowlist': [EMBEDDED_FRAME_CONNECTION_ALLOWLIST],
    });
  });

  it('does not restrict the Hub main frame', () => {
    expect(
      withEmbeddedFrameWebRtcBlocked(
        { Existing: ['value'] },
        { resourceType: 'mainFrame' }
      )
    ).toEqual({ Existing: ['value'] });
  });

  it('replaces a frame-provided allowlist case-insensitively', () => {
    expect(
      withEmbeddedFrameWebRtcBlocked(
        { 'connection-allowlist': ['("https://example.com");webrtc=allow'] },
        { resourceType: 'subFrame' }
      )
    ).toEqual({
      'Connection-Allowlist': [EMBEDDED_FRAME_CONNECTION_ALLOWLIST],
    });
  });
});
