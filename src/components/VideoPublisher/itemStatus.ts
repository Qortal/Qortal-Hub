import type { TFunction } from 'i18next';
import { formatEta } from './format';
import type { QueueItem, VideoDestination } from './videoPublisherTypes';

/** Progress 0–100 for the card's bar, or null when there's none to show. */
export function itemProgress(item: QueueItem): number | null {
  if (item.phase === 'converting') return item.percent ?? 0;
  if (item.phase === 'publishing' && item.publish) {
    const { stepIndex, stepCount, done, total } = item.publish;
    const step = total > 0 ? Math.min(1, done / total) : 0;
    const { bytesBefore, stepBytes, bytesTotal } = item.publish;
    if (bytesTotal > 0 && stepBytes > 0) {
      return Math.min(
        100,
        (((bytesBefore ?? 0) + stepBytes * step) / bytesTotal) * 100
      );
    }
    return stepCount > 0 ? ((stepIndex + step) / stepCount) * 100 : 0;
  }
  return null;
}

/**
 * "42 % · 3 min left": a conversion's progress beside the card's bar (the
 * time once ffmpeg reports its speed).
 */
export function convertingProgressText(t: TFunction, item: QueueItem): string {
  const percent = t('core:video_publisher.status.percent', {
    percent: Math.floor(item.percent ?? 0),
  });
  const eta = formatEta(t, item.etaSec);
  return eta ? `${percent} · ${eta}` : percent;
}

/** The card's one-line status. */
export function itemStatusText(
  t: TFunction,
  item: QueueItem,
  destination: VideoDestination
): string {
  const save = destination === 'save';
  switch (item.phase) {
    case 'probing':
      return t('core:video_publisher.status.probing');
    case 'ready':
      return t('core:video_publisher.status.ready');
    case 'waiting':
      return t('core:video_publisher.status.waiting');
    case 'converting':
      // Its % and time left sit beside the card's bar.
      return item.paused
        ? t('core:video_publisher.status.paused')
        : t('core:video_publisher.status.converting_now');
    case 'converted':
      return item.saved === false
        ? t('core:video_publisher.status.converted_save')
        : t('core:video_publisher.status.converted');
    case 'review':
      return save
        ? t('core:video_publisher.status.review_save')
        : t('core:video_publisher.status.review');
    case 'publishing': {
      if (item.awaitingApproval) {
        return t('core:video_publisher.status.awaiting_approval');
      }
      if (item.waitingForSlot) {
        return t('core:video_publisher.status.waiting_slot', {
          count: item.waitingForSlot,
        });
      }
      const step = item.publish;
      if (!step) return t('core:video_publisher.status.preparing');
      // Read by a node on this PC itself, with nothing to upload.
      if (step.onNode && step.kind === 'video') {
        return t('core:video_publisher.status.node_preparing_video');
      }
      if (step.onNode && step.kind === 'file') {
        return t('core:video_publisher.status.node_preparing_file');
      }
      // Its % sits beside the card's bar, for the whole upload.
      switch (step.kind) {
        case 'video':
          return t('core:video_publisher.status.publishing_the_video');
        case 'file':
          return t('core:video_publisher.status.publishing_the_file');
        case 'subtitle':
          return t('core:video_publisher.status.publishing_subtitle');
        case 'thumbnail':
          return t('core:video_publisher.status.publishing_thumbnail');
        case 'post':
          return t('core:video_publisher.status.publishing_post');
        case 'playlist':
          return t('core:video_publisher.status.publishing_playlist');
        // Subscreen's people and credits, after the listing.
        case 'person':
        case 'credits':
          return t('core:video_publisher.credits.publishing');
        default:
          return t('core:video_publisher.status.publishing_metadata');
      }
    }
    case 'saving':
      return t('core:video_publisher.status.saving');
    case 'done':
      return save || item.saved
        ? t('core:video_publisher.status.saved')
        : t('core:video_publisher.status.done');
    case 'failed':
      // Declined (or not answered in time): nothing failed.
      return item.error?.code === 'approval-declined'
        ? t('core:video_publisher.status.not_published')
        : t('core:video_publisher.status.failed');
    case 'unusable':
      return t('core:video_publisher.status.failed');
    case 'cancelled':
      return t('core:video_publisher.status.cancelled');
    case 'discarded':
      return t('core:video_publisher.status.discarded');
    default:
      return '';
  }
}

/** Busy in a run: shows Cancel rather than "take off the list". */
export const isItemBusy = (item: QueueItem) =>
  item.phase === 'waiting' ||
  item.phase === 'converting' ||
  (item.phase === 'converted' && item.saved !== false) ||
  item.phase === 'review' ||
  item.phase === 'publishing' ||
  item.phase === 'saving';
