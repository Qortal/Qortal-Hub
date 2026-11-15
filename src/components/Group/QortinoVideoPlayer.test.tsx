import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QortinoVideoPlayer } from './QortinoVideoPlayer';

const labels = {
  back: 'Back 10 seconds',
  exitFullScreen: 'Exit full screen',
  forward: 'Forward 10 seconds',
  fullScreen: 'Full screen',
  mute: 'Mute',
  pause: 'Pause',
  play: 'Play',
  unmute: 'Unmute',
};

const renderPlayer = () => {
  const view = render(
    <QortinoVideoPlayer
      autoPlay={false}
      labels={labels}
      src="http://localhost:12391/arbitrary/VIDEO/BigPicture/gold"
    />
  );
  const video = view.container.querySelector('video') as HTMLVideoElement;
  const frame = view.container.firstElementChild as HTMLElement;
  return { frame, video };
};

/** jsdom's media has no clock: the test sets where it is and how long. */
const placeVideo = (video: HTMLVideoElement, at: number, length: number) => {
  Object.defineProperty(video, 'duration', {
    configurable: true,
    value: length,
  });
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    value: at,
    writable: true,
  });
};

describe('QortinoVideoPlayer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('goes back and forward 10 seconds, not past either end', () => {
    const { video } = renderPlayer();
    placeVideo(video, 95, 100);

    fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
    expect(video.currentTime).toBe(85);
    fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
    expect(video.currentTime).toBe(95);
    fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
    expect(video.currentTime).toBe(100);

    placeVideo(video, 4, 100);
    fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
    expect(video.currentTime).toBe(0);
  });

  it('lets its controls rest while it plays, until the pointer moves', () => {
    const { frame, video } = renderPlayer();
    // Paused, they stay.
    expect(frame).not.toHaveAttribute('data-resting');

    fireEvent.play(video);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(frame).toHaveAttribute('data-resting', 'true');

    fireEvent.pointerMove(frame);
    expect(frame).not.toHaveAttribute('data-resting');
    act(() => {
      vi.advanceTimersByTime(2400);
    });
    expect(frame).not.toHaveAttribute('data-resting');
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(frame).toHaveAttribute('data-resting', 'true');

    fireEvent.pointerMove(frame);
    fireEvent.pause(video);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(frame).not.toHaveAttribute('data-resting');
  });

  it('keeps its controls while the keyboard is on them', () => {
    const { frame, video } = renderPlayer();
    fireEvent.play(video);
    expect(frame).toHaveAttribute('data-resting', 'true');

    const mute = screen.getByRole('button', { name: 'Mute' });
    fireEvent.keyDown(document.body, { key: 'Tab' });
    act(() => {
      mute.focus();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(frame).not.toHaveAttribute('data-resting');

    act(() => {
      mute.blur();
    });
    expect(frame).toHaveAttribute('data-resting', 'true');
  });
});
