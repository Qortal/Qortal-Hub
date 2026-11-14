import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

let baseUrl = 'http://node-one:12391';

vi.mock('../../../App', () => ({
  getBaseApiReact: () => baseUrl,
}));

import { selectedNodeInfoAtom } from '../../../atoms/global';
import { LauncherAppIcon } from './LauncherTile';

const LOGO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const thumbnailOf = (appName: string, retry = 0) =>
  `${baseUrl}/arbitrary/THUMBNAIL/${appName}/qortal_avatar?async=true${
    retry ? `&retry=${retry}` : ''
  }`;

/** The picture of the app or the logo that was handed in, not the stand-in. */
const pictureIn = (container: HTMLElement, src: string) =>
  container.querySelector<HTMLImageElement>(`img[src="${src}"]`);

/** The Qortal logo that stands in while there is no picture. */
const standIn = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLImageElement>('img')].find(
    (img) =>
      !img.src.includes('/arbitrary/THUMBNAIL/') &&
      img.getAttribute('src') !== LOGO
  );

/**
 * Fires a picture's `load` as soon as it is on the page, before the effects
 * of that render run. A picture the browser already holds in memory does
 * that: an open tab's icon, the account's avatar, a private app's logo.
 */
const LoadsFromMemory = ({
  src,
  watch,
  children,
}: {
  src: string;
  /** The picture is fired again when this changes. */
  watch?: unknown;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const picture = ref.current?.querySelector(`img[src="${src}"]`);
    picture?.dispatchEvent(new Event('load'));
  }, [src, watch]);
  return <div ref={ref}>{children}</div>;
};

const renderIcon = (
  ui: (store: ReturnType<typeof createStore>) => ReactNode
) => {
  const store = createStore();
  const wrap = () => (
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>{ui(store)}</ThemeProvider>
    </Provider>
  );
  const view = render(wrap());
  return { store, ...view, rerenderIcon: () => view.rerender(wrap()) };
};

beforeEach(() => {
  baseUrl = 'http://node-one:12391';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LauncherAppIcon', () => {
  it('shows the picture once it has loaded', () => {
    const { container } = renderIcon(() => <LauncherAppIcon appName="Torq" />);
    const picture = pictureIn(container, thumbnailOf('Torq'))!;

    expect(picture).not.toBeVisible();

    fireEvent.load(picture);

    expect(picture).toBeVisible();
    expect(standIn(container)).toBeUndefined();
  });

  it('shows a picture that loads before the effects of its first render run', () => {
    const { container } = renderIcon(() => (
      <LoadsFromMemory src={thumbnailOf('Torq')}>
        <LauncherAppIcon appName="Torq" />
      </LoadsFromMemory>
    ));

    expect(pictureIn(container, thumbnailOf('Torq'))).toBeVisible();
  });

  it('shows a private app’s logo that loads before the effects run', () => {
    const { container } = renderIcon(() => (
      <LoadsFromMemory src={LOGO}>
        <LauncherAppIcon src={LOGO} />
      </LoadsFromMemory>
    ));

    expect(pictureIn(container, LOGO)).toBeVisible();
  });

  it('starts over for another app, also when its picture loads at once', () => {
    let appName = 'Torq';
    const { container, rerenderIcon } = renderIcon(() => (
      <LoadsFromMemory src={thumbnailOf(appName)}>
        <LauncherAppIcon appName={appName} />
      </LoadsFromMemory>
    ));
    expect(pictureIn(container, thumbnailOf('Torq'))).toBeVisible();

    appName = 'WIP';
    rerenderIcon();

    expect(pictureIn(container, thumbnailOf('Torq'))).toBeNull();
    expect(pictureIn(container, thumbnailOf('WIP'))).toBeVisible();
  });

  it('hides the picture of the app before while the next one loads', () => {
    let appName = 'Torq';
    const { container, rerenderIcon } = renderIcon(() => (
      <LauncherAppIcon appName={appName} />
    ));
    fireEvent.load(pictureIn(container, thumbnailOf('Torq'))!);

    appName = 'WIP';
    rerenderIcon();

    const next = pictureIn(container, thumbnailOf('WIP'))!;
    expect(next).not.toBeVisible();
    fireEvent.load(next);
    expect(next).toBeVisible();
  });

  it('keeps a picture that is showing when the same one is asked for again', () => {
    let appName: string | null | undefined = 'Minter Helper';
    const src = LOGO;
    const { container, rerenderIcon } = renderIcon(() => (
      <LauncherAppIcon appName={appName} src={src} />
    ));
    fireEvent.load(pictureIn(container, LOGO)!);

    // The logo is the same, so the picture on the page does not load again.
    appName = null;
    rerenderIcon();
    expect(pictureIn(container, LOGO)).toBeVisible();

    appName = undefined;
    rerenderIcon();
    expect(pictureIn(container, LOGO)).toBeVisible();
  });

  it('shows the Qortal logo for a picture that fails, and asks for it again', () => {
    vi.useFakeTimers();
    const { container } = renderIcon(() => <LauncherAppIcon appName="Torq" />);

    fireEvent.error(pictureIn(container, thumbnailOf('Torq'))!);

    expect(pictureIn(container, thumbnailOf('Torq'))).toBeNull();
    expect(standIn(container)).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    // The logo stays while the picture is asked for again.
    const again = pictureIn(container, thumbnailOf('Torq', 1))!;
    expect(again).not.toBeVisible();
    expect(standIn(container)).toBeVisible();

    fireEvent.load(again);

    expect(again).toBeVisible();
    expect(standIn(container)).toBeUndefined();
  });

  it('gives up after the last try and keeps the logo', () => {
    vi.useFakeTimers();
    const { container } = renderIcon(() => <LauncherAppIcon appName="Torq" />);

    fireEvent.error(pictureIn(container, thumbnailOf('Torq'))!);
    for (const [retry, delay] of [
      [1, 2_000],
      [2, 6_000],
      [3, 15_000],
    ]) {
      act(() => {
        vi.advanceTimersByTime(delay);
      });
      fireEvent.error(pictureIn(container, thumbnailOf('Torq', retry))!);
    }
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(container.querySelector('img[src*="/arbitrary/THUMBNAIL/"]')).toBe(
      null
    );
    expect(standIn(container)).toBeVisible();
  });

  it('asks another node for a picture the first one did not have', () => {
    const { container, store } = renderIcon(() => (
      <LauncherAppIcon appName="Torq" />
    ));
    fireEvent.error(pictureIn(container, thumbnailOf('Torq'))!);
    expect(standIn(container)).toBeVisible();

    baseUrl = 'http://node-two:12391';
    act(() => {
      store.set(selectedNodeInfoAtom, { url: baseUrl } as never);
    });

    // The logo stays until the other node's picture shows.
    const fromNodeTwo = pictureIn(container, thumbnailOf('Torq'))!;
    expect(fromNodeTwo).not.toBeVisible();
    expect(standIn(container)).toBeVisible();

    fireEvent.load(fromNodeTwo);

    expect(fromNodeTwo).toBeVisible();
    expect(standIn(container)).toBeUndefined();
  });

  it('keeps a picture that has loaded when the node changes', () => {
    const { container, store } = renderIcon(() => (
      <LauncherAppIcon appName="Torq" />
    ));
    fireEvent.load(pictureIn(container, thumbnailOf('Torq'))!);
    const fromNodeOne = thumbnailOf('Torq');

    baseUrl = 'http://node-two:12391';
    act(() => {
      store.set(selectedNodeInfoAtom, { url: baseUrl } as never);
    });

    // The picture that is showing stays; nothing is asked for again.
    expect(pictureIn(container, fromNodeOne)).toBeVisible();
    expect(pictureIn(container, thumbnailOf('Torq'))).toBeNull();
    expect(standIn(container)).toBeUndefined();
  });

  it('shows what it is given in place of a picture, such as a lock', () => {
    const { container, getByText } = renderIcon(() => (
      <LauncherAppIcon>
        <span>lock</span>
      </LauncherAppIcon>
    ));

    expect(getByText('lock')).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
  });
});
