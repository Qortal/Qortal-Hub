import type { WebContents } from 'electron';

/** Keep a Q-App guest from gathering direct WebRTC network candidates. */
export function restrictQAppGuestWebRtc(
  guest: Pick<WebContents, 'setWebRTCIPHandlingPolicy'>
): void {
  guest.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
}
