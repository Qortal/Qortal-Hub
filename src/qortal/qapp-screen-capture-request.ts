export async function dispatchQAppScreenCaptureRequest(
  message: Record<string, unknown>
) {
  if (
    message.action !== 'SCREEN_CAPTURE_SELECT' ||
    typeof message.requestId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(message.requestId) ||
    (message.sourceId !== undefined &&
      (typeof message.sourceId !== 'string' || message.sourceId.length > 256))
  ) {
    throw new Error('INVALID_SCREEN_CAPTURE_REQUEST');
  }
  if (!window.electronAPI?.selectDisplayMedia)
    throw new Error('SCREEN_CAPTURE_UNSUPPORTED');
  // An unguessable, short-lived capability is delivered directly to the requesting
  // native frame. Main revalidates that frame and the approved source list.
  window.electronAPI.selectDisplayMedia(
    message.requestId,
    message.sourceId as string | undefined
  );
  return { accepted: true };
}
