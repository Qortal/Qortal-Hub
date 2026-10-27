import { describe, expect, it } from 'vitest';
import {
  EMBEDDED_FRAME_CONNECTION_ALLOWLIST,
  withEmbeddedFrameWebRtcBlocked,
} from './embedded-frame-network-policy';

describe('embedded frame network policy', () => {
  it('blocks WebRTC on Hub subframe document responses', () => {
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

  it.each(['mainFrame', 'subFrame'])(
    'blocks WebRTC on Q-App guest %s documents, overriding server policy',
    (resourceType) => {
      const headers = {
        Existing: ['value'],
        'Content-Security-Policy': ["connect-src 'self'"],
        'connection-allowlist': ['("*");webrtc=allow'],
        'CONNECTION-ALLOWLIST': ['("*");webrtc=allow'],
      };
      expect(
        withEmbeddedFrameWebRtcBlocked(headers, { resourceType }, 'qapp-guest')
      ).toEqual({
        Existing: ['value'],
        'Content-Security-Policy': ["connect-src 'self'"],
        'Connection-Allowlist': [EMBEDDED_FRAME_CONNECTION_ALLOWLIST],
      });
      expect(headers['connection-allowlist']).toEqual(['("*");webrtc=allow']);
    }
  );

  it.each(['script', 'xhr', 'media', 'image', undefined])(
    'leaves guest %s resource responses unchanged',
    (resourceType) => {
      const headers = { Existing: ['value'] };
      expect(
        withEmbeddedFrameWebRtcBlocked(headers, { resourceType }, 'qapp-guest')
      ).toEqual(headers);
    }
  );

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
