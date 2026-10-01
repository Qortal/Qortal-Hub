type HeaderRequestDetails = {
  resourceType?: string;
};

/**
 * Keep ordinary frame networking available while preventing embedded content
 * from establishing WebRTC peer connections or DataChannels. The Hub document
 * is a mainFrame and therefore does not receive this policy.
 */
export const EMBEDDED_FRAME_CONNECTION_ALLOWLIST =
  '("*://*:*/*");redirects=allow;webrtc=block';

export function withEmbeddedFrameWebRtcBlocked(
  responseHeaders: Record<string, string | string[]>,
  details?: HeaderRequestDetails
): Record<string, string | string[]> {
  if (details?.resourceType !== 'subFrame') {
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
