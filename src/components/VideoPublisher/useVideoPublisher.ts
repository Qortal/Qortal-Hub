import { useAtomValue } from 'jotai';
import { useEffect, useMemo } from 'react';
import { userInfoAtom } from '../../atoms/global';
import {
  videoEncoderAtom,
  videoNodeLimitAtom,
  videoPublishedAtom,
  videoPublisherSettingsAtom,
  videoQueueAtom,
  videoRunAtom,
} from './videoPublisherAtoms';
import {
  type PublishAccount,
  videoPublisherController,
} from './videoPublisherController';

/**
 * Whether this Hub can convert videos: Electron's bridge, which main gives
 * the page only when ffmpeg and ffprobe came with this Hub. Without it Home
 * neither shows the window nor offers it.
 */
export const isVideoPublisherAvailable = (): boolean =>
  typeof window !== 'undefined' && Boolean(window.videoTool);

/** The queue, settings and run, with the controller that drives them. */
export function useVideoPublisher() {
  const controller = videoPublisherController();
  const items = useAtomValue(videoQueueAtom);
  const settings = useAtomValue(videoPublisherSettingsAtom);
  const run = useAtomValue(videoRunAtom);
  const nodeLimit = useAtomValue(videoNodeLimitAtom);
  const userInfo = useAtomValue(userInfoAtom);
  const published = useAtomValue(videoPublishedAtom);
  const encoder = useAtomValue(videoEncoderAtom);

  useEffect(() => {
    // The node in use can change between visits: check its limit each time.
    void controller.loadNodeLimit();
  }, [controller, userInfo?.address]);

  const account = useMemo<PublishAccount & { address: string | null }>(
    () => ({
      name:
        typeof userInfo?.name === 'string' && userInfo.name.trim()
          ? userInfo.name.trim()
          : null,
      publicKey:
        typeof userInfo?.publicKey === 'string' ? userInfo.publicKey : null,
      address: typeof userInfo?.address === 'string' ? userInfo.address : null,
    }),
    [userInfo?.name, userInfo?.publicKey, userInfo?.address]
  );

  return {
    controller,
    items,
    settings,
    run,
    nodeLimit,
    account,
    published,
    encoder,
  };
}
