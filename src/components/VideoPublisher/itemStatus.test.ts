import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { itemProgress, itemStatusText } from './itemStatus';
import type { QueueItem } from './videoPublisherTypes';

const item = (changes: Partial<QueueItem>) =>
  ({ id: 'x', phase: 'waiting', ...changes }) as QueueItem;

describe('itemProgress', () => {
  it("shows a conversion's own percent", () => {
    expect(itemProgress(item({ phase: 'converting', percent: 57 }))).toBe(57);
    expect(itemProgress(item({ phase: 'waiting' }))).toBeNull();
  });

  it('weights an upload by bytes: the video, not the thumbnail, is the bar', () => {
    const publish = {
      stepIndex: 0,
      stepCount: 3,
      kind: 'video' as const,
      done: 50,
      total: 100,
      bytesBefore: 0,
      stepBytes: 1_000_000,
      bytesTotal: 1_010_000,
    };
    // Half the video up: half the bar (not a sixth, as three equal steps
    // would make it).
    expect(itemProgress(item({ phase: 'publishing', publish }))).toBeCloseTo(
      49.5,
      1
    );
    // The video up, the thumbnail starting: nearly all of it.
    expect(
      itemProgress(
        item({
          phase: 'publishing',
          publish: {
            ...publish,
            stepIndex: 1,
            kind: 'thumbnail',
            done: 0,
            total: 1,
            bytesBefore: 1_000_000,
            stepBytes: 9_000,
          },
        })
      )
    ).toBeCloseTo(99, 0);
  });

  it('falls back to equal steps without byte sizes', () => {
    expect(
      itemProgress(
        item({
          phase: 'publishing',
          publish: {
            stepIndex: 1,
            stepCount: 2,
            kind: 'metadata',
            done: 0,
            total: 1,
          },
        })
      )
    ).toBe(50);
  });
});

describe('itemStatusText', () => {
  const t = ((key: string) => key) as unknown as TFunction;
  const publishing = (kind: 'video' | 'file' | 'thumbnail', onNode?: boolean) =>
    item({
      phase: 'publishing',
      publish: { stepIndex: 0, stepCount: 2, kind, done: 0, total: 1, onNode },
    });

  it('says when it waits for the approval, and when it was declined', () => {
    expect(
      itemStatusText(
        t,
        item({
          phase: 'publishing',
          awaitingApproval: true,
          publish: {
            stepIndex: 0,
            stepCount: 2,
            kind: 'video',
            done: 0,
            total: 1,
          },
        }),
        'qtube'
      )
    ).toBe('core:video_publisher.status.awaiting_approval');
    expect(
      itemStatusText(
        t,
        item({
          phase: 'failed',
          error: { code: 'approval-declined', stage: 'publish' },
        }),
        'qtube'
      )
    ).toBe('core:video_publisher.status.not_published');
    expect(
      itemStatusText(
        t,
        item({ phase: 'failed', error: { code: 'refused', stage: 'publish' } }),
        'qtube'
      )
    ).toBe('core:video_publisher.status.failed');
  });

  it('says when a node on this PC prepares the file itself', () => {
    expect(itemStatusText(t, publishing('video', true), 'qtube')).toBe(
      'core:video_publisher.status.node_preparing_video'
    );
    expect(itemStatusText(t, publishing('file', true), 'qshare')).toBe(
      'core:video_publisher.status.node_preparing_file'
    );
    // An upload, or a step the node doesn't read itself.
    expect(itemStatusText(t, publishing('video'), 'qtube')).toBe(
      'core:video_publisher.status.publishing_the_video'
    );
    expect(itemStatusText(t, publishing('thumbnail', true), 'qtube')).toBe(
      'core:video_publisher.status.publishing_thumbnail'
    );
  });
});
