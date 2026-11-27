import { act, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appLockedAtom } from '../../atoms/presence';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import type { HubZoomChange, HubZoomState } from './hubZoom';
import { HubZoomButton } from './HubZoomButton';
import { HUB_ZOOM_BUBBLE_MS, useHubZoom } from './useHubZoom';

const TAB1 = { tabId: 't1', name: 'Opened-App', service: 'APP' };
const TAB2 = { tabId: 't2', name: 'Other-App', service: 'WEBSITE' };

/** Main, as the magnifier sees it: Hub's level, and each tab's own. */
const fakeMain = () => {
  const zoom = { hub: 0, own: new Map<string, number>() };
  const listeners = new Set<(change: HubZoomChange) => void>();
  const known = new Set(['t1', 't2']);
  const stateFor = (tabId: string | null): HubZoomState => ({
    hub: { level: zoom.hub, canIn: zoom.hub < 8.5, canOut: zoom.hub > -7.5 },
    app:
      tabId && known.has(tabId)
        ? {
            level: zoom.own.get(tabId) ?? 0,
            canIn: zoom.hub + (zoom.own.get(tabId) ?? 0) < 8.5,
            canOut: true,
          }
        : null,
  });
  const emit = (change: HubZoomChange) =>
    act(() => {
      listeners.forEach((listener) => listener(change));
    });
  const api = {
    onScreen: vi.fn(),
    panelPointer: vi.fn(),
    get: vi.fn(async (tabId: string | null) => stateFor(tabId)),
    change: vi.fn(
      async (
        target: { tabId: string } | 'hub',
        action: 'in' | 'out' | 'reset'
      ) => {
        const step = action === 'in' ? 0.5 : action === 'out' ? -0.5 : 0;
        if (target === 'hub') {
          zoom.hub = action === 'reset' ? 0 : zoom.hub + step;
        } else {
          const own = zoom.own.get(target.tabId) ?? 0;
          zoom.own.set(target.tabId, action === 'reset' ? 0 : own + step);
        }
        return stateFor(target === 'hub' ? null : target.tabId);
      }
    ),
    onChanged: vi.fn((listener: (change: HubZoomChange) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };
  return { api, emit, known, zoom };
};

function Harness({
  mode = 'apps',
  tab = TAB1,
}: {
  mode?: string;
  tab?: typeof TAB1 | null;
}) {
  const zoom = useHubZoom(mode, tab);
  return <HubZoomButton zoom={zoom} hoverBackground="rgba(0, 0, 0, 0.08)" />;
}

let main: ReturnType<typeof fakeMain>;
const settle = () => act(async () => {});
const magnifier = () => screen.queryByRole('button', { name: /^Zoom: / });
const panel = () => screen.queryByRole('dialog');

beforeEach(() => {
  main = fakeMain();
  (window as any).hubZoom = main.api;
});
afterEach(() => {
  delete (window as any).hubZoom;
  getDefaultStore().set(appLockedAtom, false);
  vi.useRealTimers();
});

describe('HubZoomButton', () => {
  it('shows nothing while the app on screen is at its normal size', async () => {
    main.zoom.hub = 1;
    render(<Harness />);
    await settle();

    // At Hub's size, which is the app's normal one.
    expect(magnifier()).toBeNull();
  });

  it('shows the zoom of the app on screen, on top of Hub’s', async () => {
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    expect(magnifier()).toHaveAccessibleName('Zoom: 110%');
    expect(
      magnifier().querySelector('[data-testid="ZoomInRoundedIcon"]')
    ).not.toBeNull();
  });

  it('shows nothing for Hub’s own zoom', async () => {
    main.zoom.hub = -1;
    const { rerender } = render(<Harness mode="home" />);
    await settle();
    expect(magnifier()).toBeNull();

    // A launcher tab is one of Hub's pages.
    rerender(<Harness tab={{ tabId: 'l1', internal: 'launcher' } as any} />);
    await settle();
    expect(magnifier()).toBeNull();
  });

  it('shows an app made smaller than Hub with the zoom-out magnifier', async () => {
    main.zoom.hub = 1;
    main.zoom.own.set('t1', -0.5);
    render(<Harness />);
    await settle();

    expect(magnifier()).toHaveAccessibleName('Zoom: 91%');
    expect(
      magnifier().querySelector('[data-testid="ZoomOutRoundedIcon"]')
    ).not.toBeNull();
  });

  it('opens its panel on a click, and zooms the app from it', async () => {
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    fireEvent.click(magnifier());
    expect(panel()).toHaveAccessibleName('Opened-App');
    expect(panel()).toHaveTextContent('110%');
    expect(panel()).toHaveTextContent('Kept for Opened-App on this computer');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await settle();
    expect(main.api.change).toHaveBeenLastCalledWith({ tabId: 't1' }, 'in');
    expect(panel()).toHaveTextContent('120%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    await settle();
    expect(main.api.change).toHaveBeenLastCalledWith({ tabId: 't1' }, 'out');
    expect(panel()).toHaveTextContent('100%');
    // Back at Hub's size, the panel stays open until it is closed, and
    // nothing is kept for the app.
    expect(screen.getByRole('button', { name: 'Same as Hub' })).toBeDisabled();
    expect(panel()).not.toHaveTextContent('Kept for');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Same as Hub' }));
    await settle();
    expect(main.api.change).toHaveBeenLastCalledWith({ tabId: 't1' }, 'reset');
    fireEvent.click(magnifier());
    expect(panel()).toBeNull();
    expect(magnifier()).toBeNull();
  });

  it('greys out a step past the limits', async () => {
    main.zoom.hub = 8;
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    fireEvent.click(magnifier());
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
  });

  it('closes on Escape and gives the keyboard back to the magnifier', async () => {
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    fireEvent.click(magnifier());
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Zoom out' })
    );
    fireEvent.keyDown(panel(), { key: 'Escape' });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(magnifier());
  });

  it('shows a zoom made with the keys for a moment, without taking the keyboard', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    await settle();
    const before = document.activeElement;

    main.zoom.own.set('t1', 0.5);
    main.emit({ what: 'app', key: 'k', tabIds: ['t1'], source: 'keys' });
    await settle();
    expect(panel()).toHaveTextContent('110%');
    expect(document.activeElement).toBe(before);
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS - 10));
    expect(panel()).not.toBeNull();
    act(() => vi.advanceTimersByTime(20));
    expect(panel()).toBeNull();
    // The zoom stays off normal: the magnifier stays.
    expect(magnifier()).toHaveAccessibleName('Zoom: 110%');
  });

  it('keeps that panel open while the pointer is on it, and tells main', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    await settle();

    main.zoom.own.set('t1', 0.5);
    main.emit({ what: 'app', key: 'k', tabIds: ['t1'], source: 'wheel' });
    await settle();
    fireEvent.pointerEnter(panel());
    expect(main.api.panelPointer).toHaveBeenLastCalledWith('t1');
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS * 2));
    expect(panel()).not.toBeNull();
    fireEvent.pointerLeave(panel());
    expect(main.api.panelPointer).toHaveBeenLastCalledWith(undefined);
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS));
    expect(panel()).toBeNull();
  });

  it('pops up nothing when Hub is zoomed', async () => {
    render(<Harness />);
    await settle();

    // The app on screen follows Hub, at Hub's zoom: nothing to show.
    main.zoom.hub = 0.5;
    main.emit({ what: 'hub', source: 'keys' });
    await settle();
    expect(panel()).toBeNull();
    expect(magnifier()).toBeNull();

    // An app off Hub's zoom keeps its magnifier, without a panel.
    main.zoom.own.set('t1', 0.5);
    main.emit({ what: 'app', key: 'k', tabIds: ['t1'], source: 'panel' });
    main.emit({ what: 'hub', source: 'wheel' });
    await settle();
    expect(magnifier()).toHaveAccessibleName('Zoom: 110%');
    expect(panel()).toBeNull();
  });

  it('pops up for nothing else', async () => {
    render(<Harness />);
    await settle();

    main.zoom.own.set('t2', 1);
    main.emit({ what: 'app', key: 'k', tabIds: ['t2'], source: 'keys' });
    main.zoom.own.set('t1', 0.5);
    main.emit({ what: 'app', key: 'k', tabIds: ['t1'], source: 'panel' });
    // A page that loaded, or the saved levels read: only asked again.
    main.emit({ what: 'app', key: 'k', tabIds: ['t1'], source: 'load' });
    main.emit({ what: 'hub', source: 'load' });
    await settle();
    expect(panel()).toBeNull();
    expect(magnifier()).toHaveAccessibleName('Zoom: 110%');
  });

  it('tells main the tab on screen, the lock, and a Hub window with the keyboard', async () => {
    const { rerender } = render(<Harness />);
    await settle();
    expect(main.api.onScreen).toHaveBeenLastCalledWith({
      tabId: 't1',
      locked: false,
    });

    act(() => getDefaultStore().set(appLockedAtom, true));
    expect(main.api.onScreen).toHaveBeenLastCalledWith({
      tabId: 't1',
      locked: true,
    });
    act(() => getDefaultStore().set(appLockedAtom, false));

    const dialog = document.createElement('div');
    dialog.className = 'MuiModal-root';
    const field = document.createElement('input');
    dialog.appendChild(field);
    document.body.appendChild(dialog);
    act(() => field.focus());
    expect(main.api.onScreen).toHaveBeenLastCalledWith({
      tabId: null,
      locked: false,
    });
    await act(async () => {
      field.blur();
      await new Promise((done) => setTimeout(done, 5));
    });
    expect(main.api.onScreen).toHaveBeenLastCalledWith({
      tabId: 't1',
      locked: false,
    });
    dialog.remove();

    rerender(<Harness mode="home" />);
    expect(main.api.onScreen).toHaveBeenLastCalledWith({
      tabId: null,
      locked: false,
    });
    rerender(<Harness tab={{ tabId: 'l1', internal: 'launcher' } as any} />);
    expect(main.api.onScreen).toHaveBeenLastCalledWith({
      tabId: null,
      locked: false,
    });
  });

  it('shows the tab now on screen, not an answer about the last one', async () => {
    let answerT1: (state: HubZoomState) => void = () => undefined;
    main.zoom.own.set('t2', -0.5);
    main.api.get.mockImplementationOnce(
      () => new Promise<HubZoomState>((done) => (answerT1 = done))
    );
    const { rerender } = render(<Harness />);
    rerender(<Harness tab={TAB2} />);
    await settle();
    expect(magnifier()).toHaveAccessibleName('Zoom: 91%');
    await act(async () =>
      answerT1({
        hub: { level: 0, canIn: true, canOut: true },
        app: { level: 2, canIn: true, canOut: true },
      })
    );
    expect(magnifier()).toHaveAccessibleName('Zoom: 91%');
  });

  it('closes a panel opened for the last tab when another comes on screen', async () => {
    main.zoom.own.set('t1', 0.5);
    main.zoom.own.set('t2', 1);
    const { rerender } = render(<Harness />);
    await settle();

    fireEvent.click(magnifier());
    expect(panel()).toHaveAccessibleName('Opened-App');
    rerender(<Harness tab={TAB2} />);
    await settle();
    expect(panel()).toBeNull();
    expect(magnifier()).toHaveAccessibleName('Zoom: 120%');
  });

  it('leaves main nothing pointing at it once gone', async () => {
    main.zoom.own.set('t1', 0.5);
    const { unmount } = render(<Harness />);
    await settle();

    fireEvent.pointerEnter(magnifier());
    expect(main.api.panelPointer).toHaveBeenLastCalledWith('t1');
    unmount();
    expect(main.api.panelPointer).toHaveBeenLastCalledWith(undefined);
    expect(main.api.onScreen).toHaveBeenLastCalledWith({
      tabId: null,
      locked: false,
    });
  });

  it('shows nothing without the desktop app', async () => {
    delete (window as any).hubZoom;
    main.zoom.hub = 2;
    render(<Harness mode="home" />);
    await settle();

    expect(magnifier()).toBeNull();
  });
});

/**
 * The user's steps, with the pointer events a browser sends on the way:
 * onto the magnifier, click it, onto the panel, "Same as Hub", back onto
 * the magnifier and click it to close. The magnifier then goes away (the
 * app is at its normal size) while the pointer is on it, and a removed
 * element gets no pointerleave.
 */
const resetAndCloseWithTheMagnifier = async () => {
  main.zoom.own.set('t1', 0.5);
  render(<Harness />);
  await settle();
  fireEvent.pointerEnter(magnifier());
  fireEvent.click(magnifier());
  fireEvent.pointerLeave(magnifier());
  fireEvent.pointerEnter(panel());
  fireEvent.click(screen.getByRole('button', { name: 'Same as Hub' }));
  await settle();
  fireEvent.pointerLeave(panel());
  fireEvent.pointerEnter(magnifier());
  fireEvent.click(magnifier());
  await settle();
  expect(panel()).toBeNull();
  expect(magnifier()).toBeNull();
};

describe('HubZoomButton gone from under the pointer', () => {
  it('tells main the pointer is no longer on a magnifier that went away', async () => {
    await resetAndCloseWithTheMagnifier();

    // Otherwise main would keep { over: 'panel', tabId: 't1' }: Hub page
    // mouse moves don't change that, so keys and Ctrl+wheel over Hub's own
    // bars would keep zooming the app.
    expect(main.api.panelPointer).toHaveBeenLastCalledWith(undefined);
  });

  it('tells main the same when Escape closes the panel under the pointer', async () => {
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();
    fireEvent.pointerEnter(magnifier());
    fireEvent.click(magnifier());
    fireEvent.pointerLeave(magnifier());
    fireEvent.pointerEnter(panel());
    // Back to 100 % with −, which keeps the keyboard, then Escape.
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    fireEvent.click(zoomOut);
    await settle();
    expect(document.activeElement).toBe(zoomOut);
    fireEvent.keyDown(zoomOut, { key: 'Escape' });
    await settle();
    expect(panel()).toBeNull();
    expect(magnifier()).toBeNull();

    expect(main.api.panelPointer).toHaveBeenLastCalledWith(undefined);
  });

  it('still closes a later zoom’s panel after its moment', async () => {
    await resetAndCloseWithTheMagnifier();
    vi.useFakeTimers();

    // Later, Ctrl+= with the pointer on the app.
    main.zoom.own.set('t1', 0.5);
    main.emit({ what: 'app', key: 'k', tabIds: ['t1'], source: 'keys' });
    await settle();
    expect(panel()).toHaveTextContent('110%');
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS + 10));

    // Not left open over the app until a click on Hub's own parts.
    expect(panel()).toBeNull();
  });
});

describe('HubZoomButton for an app just opened', () => {
  it('shows the zoom kept for an app once its page has loaded', async () => {
    // The new tab is on screen before its webview has loaded its first
    // page: main doesn't know its app yet.
    main.known.delete('t1');
    main.zoom.own.set('t1', 1);
    render(<Harness />);
    await settle();
    expect(magnifier()).toBeNull();

    // Its page loads: main puts it at the zoom kept for it and says so.
    main.known.add('t1');
    main.emit({ what: 'app', key: 'k', tabIds: ['t1'], source: 'load' });
    await settle();
    expect(magnifier()).toHaveAccessibleName('Zoom: 120%');
    // Nothing pops up for it.
    expect(panel()).toBeNull();
  });
});

describe('HubZoomButton back at normal size', () => {
  it('still closes on Escape once its greyed-out button dropped the keyboard', async () => {
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    fireEvent.click(magnifier());
    fireEvent.click(screen.getByRole('button', { name: 'Same as Hub' }));
    await settle();
    expect(panel()).toHaveTextContent('100%');
    // The button is greyed out now; the keyboard is on the page.
    act(() => (document.activeElement as HTMLElement)?.blur());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(panel()).toBeNull();
    expect(magnifier()).toBeNull();
  });
});

describe('HubZoomButton and the pointer', () => {
  it('tells main when its panel closes under the pointer', async () => {
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    fireEvent.click(magnifier());
    fireEvent.pointerEnter(panel());
    expect(main.api.panelPointer).toHaveBeenLastCalledWith('t1');
    fireEvent.keyDown(panel(), { key: 'Escape' });
    await settle();
    // The magnifier stays (the app is still at 110 %); the panel is gone.
    expect(magnifier()).not.toBeNull();
    expect(main.api.panelPointer).toHaveBeenLastCalledWith(undefined);
  });

  it('tells main nothing while the pointer was never on it', async () => {
    main.zoom.own.set('t1', 0.5);
    const { rerender } = render(<Harness />);
    await settle();

    main.zoom.own.set('t1', 0);
    main.emit({ what: 'app', key: 'k', tabIds: ['t1'], source: 'panel' });
    await settle();
    expect(magnifier()).toBeNull();
    rerender(<Harness mode="home" />);
    await settle();
    expect(main.api.panelPointer).not.toHaveBeenCalled();
  });
});

describe('HubZoomButton not left open', () => {
  /** Ctrl+wheel with the pointer on the app: the panel shows that zoom. */
  const zoomWithTheWheel = async () => {
    main.zoom.own.set('t1', 0.5);
    main.emit({ what: 'app', key: 'k', tabIds: ['t1'], source: 'wheel' });
    await settle();
    expect(panel()).toHaveTextContent('110%');
  };

  it('closes a panel opened with a click once the user clicks into the app', async () => {
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    for (const detail of [1, 0]) {
      // With the pointer, then with Enter.
      fireEvent.click(magnifier(), { detail });
      expect(panel()).not.toBeNull();
      // The Hub page gets no mousedown from a click into a webview: its
      // window loses the keyboard.
      act(() => {
        window.dispatchEvent(new Event('blur'));
      });
      expect(panel()).toBeNull();
      expect(magnifier()).toHaveAccessibleName('Zoom: 110%');
    }
  });

  it('lets a panel opened with the pointer fade once the pointer has left it', async () => {
    vi.useFakeTimers();
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    fireEvent.pointerEnter(magnifier());
    fireEvent.click(magnifier(), { detail: 1 });
    fireEvent.pointerLeave(magnifier());
    fireEvent.pointerEnter(panel());
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS * 2));
    expect(panel()).not.toBeNull();
    fireEvent.pointerLeave(panel());
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS - 10));
    expect(panel()).not.toBeNull();
    act(() => vi.advanceTimersByTime(20));
    expect(panel()).toBeNull();
    expect(magnifier()).toHaveAccessibleName('Zoom: 110%');
    expect(main.api.panelPointer).toHaveBeenLastCalledWith(undefined);
  });

  it('keeps a panel opened with the keyboard, or used with it, until it is closed', async () => {
    vi.useFakeTimers();
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    // Enter on the magnifier: a click with no count.
    fireEvent.click(magnifier());
    fireEvent.pointerEnter(magnifier());
    fireEvent.pointerLeave(magnifier());
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS * 3));
    expect(panel()).not.toBeNull();
    fireEvent.keyDown(panel(), { key: 'Escape' });
    expect(panel()).toBeNull();

    // Opened with the pointer, then used with the keys.
    fireEvent.pointerEnter(magnifier());
    fireEvent.click(magnifier(), { detail: 1 });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Zoom out' }), {
      key: 'Tab',
    });
    fireEvent.pointerLeave(magnifier());
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS * 3));
    expect(panel()).not.toBeNull();
  });

  it('closes a zoom’s panel once main saw the pointer go from it onto the app', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    await settle();
    await zoomWithTheWheel();

    // The panel opened under the pointer, which then moved onto it.
    fireEvent.pointerEnter(panel());
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS * 2));
    expect(panel()).not.toBeNull();
    // Then straight onto the app's page: no pointerleave here; main says so.
    main.emit({ what: 'pointer' });
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS - 10));
    expect(panel()).not.toBeNull();
    act(() => vi.advanceTimersByTime(20));
    expect(panel()).toBeNull();
    // Main knows already: the page doesn't tell it the pointer left.
    expect(main.api.panelPointer).toHaveBeenLastCalledWith('t1');
  });

  it('counts the pointer on the magnifier it clicked', async () => {
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    // No pointerenter seen first (the magnifier came up under the pointer).
    fireEvent.click(magnifier(), { detail: 1 });
    expect(main.api.panelPointer).toHaveBeenLastCalledWith('t1');
  });

  it('fades a panel opened with the pointer once main saw the pointer leave it', async () => {
    vi.useFakeTimers();
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    fireEvent.pointerEnter(magnifier());
    fireEvent.click(magnifier(), { detail: 1 });
    main.emit({ what: 'pointer' });
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS + 10));
    expect(panel()).toBeNull();
  });

  it('counts the pointer back on the panel when it moves there again', async () => {
    vi.useFakeTimers();
    render(<Harness />);
    await settle();
    await zoomWithTheWheel();

    fireEvent.pointerEnter(panel());
    main.emit({ what: 'pointer' });
    // Back from the app's page: the page never saw it leave, so no
    // pointerenter, only moves.
    fireEvent.pointerMove(panel());
    expect(main.api.panelPointer).toHaveBeenLastCalledWith('t1');
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS * 2));
    expect(panel()).not.toBeNull();
    fireEvent.pointerLeave(panel());
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS + 10));
    expect(panel()).toBeNull();
  });

  // The panel's own Popper has role tooltip too.
  const tooltip = () => document.querySelector('.MuiTooltip-popper');

  it('keeps its tooltip off while the panel is open', async () => {
    vi.useFakeTimers();
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    fireEvent.mouseOver(magnifier());
    act(() => vi.advanceTimersByTime(300));
    expect(tooltip()).toHaveTextContent('Zoom: 110%');
    fireEvent.click(magnifier(), { detail: 1 });
    act(() => vi.advanceTimersByTime(300));
    expect(panel()).not.toBeNull();
    expect(tooltip()).toBeNull();
    // Nor over the open panel when the pointer comes back to the magnifier.
    fireEvent.mouseLeave(magnifier());
    fireEvent.mouseOver(magnifier());
    act(() => vi.advanceTimersByTime(300));
    expect(tooltip()).toBeNull();
  });

  it('closes its tooltip once main saw the pointer go from it onto the app', async () => {
    vi.useFakeTimers();
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    fireEvent.pointerEnter(magnifier());
    fireEvent.mouseOver(magnifier());
    act(() => vi.advanceTimersByTime(300));
    expect(tooltip()).toHaveTextContent('Zoom: 110%');
    // Straight onto the app's page: no mouseleave for the tooltip.
    main.emit({ what: 'pointer' });
    act(() => vi.advanceTimersByTime(300));
    expect(tooltip()).toBeNull();
  });

  it('brings no tooltip back once a panel opened with a click has faded', async () => {
    vi.useFakeTimers();
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    fireEvent.pointerEnter(magnifier());
    fireEvent.mouseOver(magnifier());
    act(() => vi.advanceTimersByTime(300));
    expect(tooltip()).toHaveTextContent('Zoom: 110%');
    fireEvent.click(magnifier(), { detail: 1 });
    act(() => vi.advanceTimersByTime(300));
    expect(tooltip()).toBeNull();
    // Down onto the panel, then away onto Hub's bar.
    fireEvent.pointerLeave(magnifier());
    fireEvent.mouseLeave(magnifier());
    fireEvent.pointerEnter(panel());
    fireEvent.pointerLeave(panel());
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS + 300));
    expect(panel()).toBeNull();
    // The pointer is far from the magnifier: nothing pops up there.
    expect(tooltip()).toBeNull();
  });

  it('brings no tooltip back once a zoom’s short panel ends', async () => {
    vi.useFakeTimers();
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    fireEvent.pointerEnter(magnifier());
    fireEvent.mouseOver(magnifier());
    act(() => vi.advanceTimersByTime(300));
    expect(tooltip()).toHaveTextContent('Zoom: 110%');
    // Ctrl+= with the pointer on the magnifier.
    main.zoom.own.set('t1', 1);
    main.emit({ what: 'app', key: 'k', tabIds: ['t1'], source: 'keys' });
    await settle();
    act(() => vi.advanceTimersByTime(300));
    expect(panel()).toHaveTextContent('120%');
    expect(tooltip()).toBeNull();
    // Away, onto Hub's bar.
    fireEvent.pointerLeave(magnifier());
    fireEvent.mouseLeave(magnifier());
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS + 300));
    expect(panel()).toBeNull();
    expect(magnifier()).toHaveAccessibleName('Zoom: 120%');
    expect(tooltip()).toBeNull();
  });

  it('still fades after Ctrl was held in it for a Ctrl+wheel zoom', async () => {
    vi.useFakeTimers();
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    fireEvent.pointerEnter(magnifier());
    fireEvent.click(magnifier(), { detail: 1 });
    fireEvent.pointerLeave(magnifier());
    fireEvent.pointerEnter(panel());
    // The panel has the keyboard. Ctrl+wheel on it: main takes the wheel,
    // the page only gets Ctrl.
    fireEvent.keyDown(document.activeElement as Element, {
      key: 'Control',
      code: 'ControlLeft',
      ctrlKey: true,
    });
    main.zoom.own.set('t1', 1);
    main.emit({ what: 'app', key: 'k', tabIds: ['t1'], source: 'wheel' });
    await settle();
    fireEvent.pointerLeave(panel());
    act(() => vi.advanceTimersByTime(HUB_ZOOM_BUBBLE_MS + 10));
    expect(panel()).toBeNull();
  });

  it('closes when one of Hub’s windows takes the keyboard', async () => {
    main.zoom.own.set('t1', 0.5);
    render(<Harness />);
    await settle();

    // Opened with Enter: it would stay until closed.
    fireEvent.click(magnifier());
    expect(panel()).not.toBeNull();
    const dialog = document.createElement('div');
    dialog.className = 'MuiModal-root';
    const field = document.createElement('input');
    dialog.appendChild(field);
    document.body.appendChild(dialog);
    act(() => field.focus());
    expect(panel()).toBeNull();
    dialog.remove();
  });

  it('shows the tab on screen after a change answered for the last one', async () => {
    main.zoom.own.set('t1', 0.5);
    main.zoom.own.set('t2', -0.5);
    const { rerender } = render(<Harness />);
    await settle();
    let answer: () => void = () => undefined;
    main.api.change.mockImplementationOnce(
      () => new Promise((done) => (answer = () => done(undefined as never)))
    );

    fireEvent.click(magnifier());
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    // Another tab comes on screen before main answers.
    rerender(<Harness tab={TAB2} />);
    await settle();
    expect(magnifier()).toHaveAccessibleName('Zoom: 91%');
    await act(async () => answer());
    expect(magnifier()).toHaveAccessibleName('Zoom: 91%');
  });
});
