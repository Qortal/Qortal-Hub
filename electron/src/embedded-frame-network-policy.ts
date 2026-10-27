type HeaderRequestDetails = {
  resourceType?: string;
};

export type WebRtcDocumentScope = 'hub' | 'qapp-guest';

/**
 * Keep ordinary frame networking available while preventing embedded content
 * from establishing WebRTC peer connections or DataChannels. Q-App webviews
 * have their own mainFrame, so their trusted session configuration must opt in
 * to covering main documents too. The Hub's own main document stays unrestricted.
 */
export const EMBEDDED_FRAME_CONNECTION_ALLOWLIST =
  '("*://*:*/*");redirects=allow;webrtc=block';

export function withEmbeddedFrameWebRtcBlocked(
  responseHeaders: Record<string, string | string[]>,
  details?: HeaderRequestDetails,
  scope: WebRtcDocumentScope = 'hub'
): Record<string, string | string[]> {
  if (
    details?.resourceType !== 'subFrame' &&
    !(scope === 'qapp-guest' && details?.resourceType === 'mainFrame')
  ) {
    return { ...responseHeaders };
  }

  const next = Object.fromEntries(
    Object.entries(responseHeaders).filter(
      ([name]) => name.toLowerCase() !== 'connection-allowlist'
    )
  );
  next['Connection-Allowlist'] = [EMBEDDED_FRAME_CONNECTION_ALLOWLIST];
  return next;
}
