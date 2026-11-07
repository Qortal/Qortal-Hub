import type { WebContents } from 'electron';

/**
 * Limit WebRTC IP exposure as defense in depth. This still permits TURN TCP;
 * the guest session must also block WebRTC on mainFrame/subFrame responses.
 */
export function restrictQAppGuestWebRtc(
  guest: Pick<WebContents, 'setWebRTCIPHandlingPolicy'>
): void {
  guest.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
}
