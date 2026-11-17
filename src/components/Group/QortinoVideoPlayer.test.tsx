import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
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

describe('QortinoVideoPlayer, when the browser can’t play the video', () => {
  it('says why, and its controls are off', () => {
    const view = render(
      <QortinoVideoPlayer
        autoPlay={false}
        labels={{ ...labels, failed: 'This video can’t be played.' }}
        src="http://localhost:12391/arbitrary/VIDEO/BigPicture/gold"
      />
    );
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();

    fireEvent.error(view.container.querySelector('video') as HTMLVideoElement);

    expect(screen.getByText('This video can’t be played.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mute' })).toBeDisabled();

    // Another address is tried afresh.
    view.rerender(
      <QortinoVideoPlayer
        autoPlay={false}
        labels={{ ...labels, failed: 'This video can’t be played.' }}
        src="http://localhost:12391/arbitrary/VIDEO/BigPicture/silver"
      />
    );
    expect(
      screen.queryByText('This video can’t be played.')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
  });
});

/** Every style rule on the page, as the browser reads them. */
const pageRules = () =>
  Array.from(document.styleSheets).flatMap((sheet) =>
    Array.from(sheet.cssRules)
  ) as CSSStyleRule[];

describe('QortinoVideoPlayer, a picture from QDN', () => {
  afterEach(() => {
    cleanup();
    document.getElementById('made-by-the-picture')?.remove();
  });

  it('keeps the picture’s address inside its own style', () => {
    // Something else on the page, which the picture has no say over.
    const other = document.body.appendChild(document.createElement('div'));
    other.id = 'made-by-the-picture';
    // A video's details on QDN give the picture: anyone can publish one.
    const poster =
      'data:image/png;base64,AAAA");}#made-by-the-picture{position:fixed}.x{background:url("';

    render(
      <QortinoVideoPlayer
        autoPlay={false}
        labels={labels}
        poster={poster}
        src={null}
        status={{ error: false, message: 'Preparing' }}
      />
    );

    // The player's own styles are there.
    expect(pageRules().length).toBeGreaterThan(0);
    expect(
      pageRules().some((rule) =>
        (rule.selectorText ?? '').includes('#made-by-the-picture')
      )
    ).toBe(false);
    expect(getComputedStyle(other).position).not.toBe('fixed');
  });

  it('keeps the picture’s address out of the names of its styles', () => {
    const other = document.body.appendChild(document.createElement('div'));
    other.id = 'made-by-the-picture';
    // The style sheet names a style by any "label:" in its text, and that
    // name becomes part of the rule's selector.
    const poster =
      'https://pictures.example/label:x,#made-by-the-picture;/cover.png';

    const { container } = render(
      <QortinoVideoPlayer
        autoPlay={false}
        labels={labels}
        poster={poster}
        src={null}
        status={{ error: false, message: 'Preparing' }}
      />
    );

    expect(pageRules().length).toBeGreaterThan(0);
    expect(
      pageRules().some((rule) =>
        (rule.selectorText ?? '').includes('#made-by-the-picture')
      )
    ).toBe(false);
    // The player's own layout stays the player's.
    expect(getComputedStyle(other).display).not.toBe('flex');
    // The picture still shows, on the element itself.
    expect(
      Array.from(container.querySelectorAll('div')).some((node) =>
        node.style.backgroundImage.includes('pictures.example')
      )
    ).toBe(true);
  });
});
