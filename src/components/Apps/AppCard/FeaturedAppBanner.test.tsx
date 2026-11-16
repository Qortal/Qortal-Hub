import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';

const executeEvent = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
}));

vi.mock('../../../utils/events', () => ({
  executeEvent: (...args: unknown[]) => executeEvent(...args),
}));

vi.mock('../../../hooks/useAppRatings', () => ({
  useAppRating: () => ({ rating: null, containerRef: { current: null } }),
}));

import { FeaturedAppBanner } from './FeaturedAppBanner';

const apps = ['Torq', 'Q-Tube', 'SubWire', 'Q-Share', 'Q-Assets', 'Q-Mail'].map(
  (name, index) => ({
    name,
    service: 'APP',
    metadata: { title: name, description: `about ${name}` },
    status: { status: index === 0 ? 'READY' : 'PUBLISHED' },
  })
);

const NEXT = 'core:launcher.library.featured_next';
const PREV = 'core:launcher.library.featured_previous';

const renderBanner = (featuredApps = apps) =>
  render(
    <ThemeProvider theme={createTheme()}>
      <FeaturedAppBanner featuredApps={featuredApps} />
    </ThemeProvider>
  );

/** Makes every element report a row wider than its box. */
const fakeOverflow = () => {
  const scrollWidth = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'scrollWidth'
  );
  const clientWidth = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'clientWidth'
  );
  Object.defineProperty(Element.prototype, 'scrollWidth', {
    configurable: true,
    get: () => 2000,
  });
  Object.defineProperty(Element.prototype, 'clientWidth', {
    configurable: true,
    get: () => 600,
  });
  return () => {
    if (scrollWidth)
      Object.defineProperty(Element.prototype, 'scrollWidth', scrollWidth);
    if (clientWidth)
      Object.defineProperty(Element.prototype, 'clientWidth', clientWidth);
  };
};

const setReducedMotion = (reduce: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

describe('FeaturedAppBanner', () => {
  const originalMatchMedia = window.matchMedia;
  const originalPointerEvent = window.PointerEvent;
  let restoreOverflow: (() => void) | null = null;
  const scrollBy = vi.fn();

  beforeEach(() => {
    executeEvent.mockClear();
    scrollBy.mockClear();
    Element.prototype.scrollBy = scrollBy as never;
  });

  afterEach(() => {
    restoreOverflow?.();
    restoreOverflow = null;
    window.matchMedia = originalMatchMedia;
    window.PointerEvent = originalPointerEvent;
    vi.useRealTimers();
  });

  it('draws other items with their own card, told apart by their key', () => {
    const widgets = ['now', 'bars'].map((identifier) => ({
      name: 'Q-Weather',
      service: 'APP',
      identifier,
    }));
    render(
      <ThemeProvider theme={createTheme()}>
        <FeaturedAppBanner
          featuredApps={widgets}
          getKey={(item) => `${item.name}/${item.identifier}`}
          renderItem={(item) => <p>{`widget ${item.identifier}`}</p>}
          variant="top-rated"
        />
      </ThemeProvider>
    );
    const list = screen.getByRole('list');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual(['widget now', 'widget bars']);
    // No app card, so no Open.
    expect(screen.queryByText('core:action.open')).toBeNull();
  });

  it('shows each featured app once, in its order', () => {
    renderBanner();
    const list = screen.getByRole('list');
    const titles = within(list)
      .getAllByRole('article')
      .map((card) => within(card).getAllByRole('button')[0].textContent);
    expect(titles).toEqual(apps.map((app) => app.name));
  });

  it('has no arrows when every card fits', () => {
    renderBanner();
    expect(screen.queryByRole('button', { name: NEXT })).toBeNull();
    expect(screen.queryByRole('button', { name: PREV })).toBeNull();
  });

  it('pages smoothly with the arrows when the row is wider', async () => {
    const user = userEvent.setup();
    restoreOverflow = fakeOverflow();
    renderBanner();

    const prev = screen.getByRole('button', { name: PREV });
    expect(prev).toHaveAttribute('aria-disabled', 'true');
    await user.click(prev);
    expect(scrollBy).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: NEXT }));
    // Three 184 px cards and their gaps fit in 600 px.
    expect(scrollBy).toHaveBeenCalledWith({
      left: 3 * 196,
      behavior: 'smooth',
    });
  });

  it('jumps instead of gliding when the system asks for less motion', async () => {
    const user = userEvent.setup();
    setReducedMotion(true);
    restoreOverflow = fakeOverflow();
    renderBanner();

    await user.click(screen.getByRole('button', { name: NEXT }));
    expect(scrollBy).toHaveBeenCalledWith({ left: 3 * 196, behavior: 'auto' });
  });

  it('opens the app page from the title and the app from Open', async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByRole('button', { name: 'Q-Tube' }));
    expect(executeEvent).toHaveBeenCalledWith('selectedAppInfo', {
      data: apps[1],
    });

    executeEvent.mockClear();
    const torq = screen.getByRole('article', { name: 'Torq' });
    await user.click(
      within(torq).getByRole('button', { name: 'core:action.open' })
    );
    expect(executeEvent).toHaveBeenCalledTimes(1);
    expect(executeEvent).toHaveBeenCalledWith('addTab', { data: apps[0] });
  });

  it('moves to the next card with the arrow keys', () => {
    renderBanner();
    const first = screen.getByRole('button', { name: 'Torq' });
    act(() => first.focus());

    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Q-Tube' })).toHaveFocus();

    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' });
    expect(first).toHaveFocus();
  });

  // jsdom has no PointerEvent: a mouse event that carries the pointer's id
  // and type stands in for it.
  const fakePointerEvents = () => {
    class FakePointerEvent extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? '';
      }
    }
    window.PointerEvent = FakePointerEvent as never;
  };

  it('opens nothing at the end of a mouse drag, and the next click works', () => {
    fakePointerEvents();
    vi.useFakeTimers();
    renderBanner();
    const list = screen.getByRole('list');
    const title = screen.getByRole('button', { name: 'Q-Tube' });
    const pointer = { pointerId: 1, pointerType: 'mouse', button: 0 };
    const held = { ...pointer, buttons: 1 };

    fireEvent.pointerDown(title, { ...held, clientX: 300 });
    fireEvent.pointerMove(title, { ...held, clientX: 200 });
    expect(list).toHaveAttribute('data-dragging', 'true');
    fireEvent.pointerUp(title, { ...pointer, clientX: 200 });
    fireEvent.click(title);

    expect(list).not.toHaveAttribute('data-dragging');
    expect(executeEvent).not.toHaveBeenCalled();

    // A short move is still a click.
    act(() => {
      vi.runOnlyPendingTimers();
    });
    fireEvent.pointerDown(title, { ...held, clientX: 300 });
    fireEvent.pointerMove(title, { ...held, clientX: 297 });
    fireEvent.pointerUp(title, { ...pointer, clientX: 297 });
    fireEvent.click(title);
    expect(executeEvent).toHaveBeenCalledWith('selectedAppInfo', {
      data: apps[1],
    });
  });

  it('does not drag on a plain hover after a press that ended outside the row', () => {
    fakePointerEvents();
    renderBanner();
    const list = screen.getByRole('list');
    const title = screen.getByRole('button', { name: 'Q-Tube' });
    const pointer = { pointerId: 1, pointerType: 'mouse', button: 0 };
    list.scrollLeft = 50;

    // Pressed, moved down off the row, and let go out there.
    fireEvent.pointerDown(title, { ...pointer, buttons: 1, clientX: 300 });
    fireEvent.pointerMove(title, {
      ...pointer,
      buttons: 1,
      clientX: 302,
      clientY: 400,
    });
    fireEvent.pointerUp(document.body, { ...pointer, clientX: 302 });

    // Back over the row with no button held.
    fireEvent.pointerMove(title, { ...pointer, buttons: 0, clientX: 200 });
    expect(list).not.toHaveAttribute('data-dragging');
    expect(list.scrollLeft).toBe(50);

    // An ordinary click afterwards still opens the page.
    fireEvent.pointerDown(title, { ...pointer, buttons: 1, clientX: 200 });
    fireEvent.pointerUp(title, { ...pointer, clientX: 200 });
    fireEvent.click(title);
    expect(list).not.toHaveAttribute('data-dragging');
    expect(executeEvent).toHaveBeenCalledWith('selectedAppInfo', {
      data: apps[1],
    });
  });

  it('keeps every Featured card part at its full height', () => {
    renderBanner();
    const description = screen.getByText('about Torq');
    expect(getComputedStyle(description).flexShrink).toBe('0');
  });

  it('can start empty and fill in later', () => {
    const { rerender } = render(
      <ThemeProvider theme={createTheme()}>
        <FeaturedAppBanner featuredApps={[]} />
      </ThemeProvider>
    );
    expect(screen.queryByRole('list')).toBeNull();

    rerender(
      <ThemeProvider theme={createTheme()}>
        <FeaturedAppBanner featuredApps={apps} />
      </ThemeProvider>
    );
    expect(screen.getAllByRole('article')).toHaveLength(apps.length);
  });

  it("says the community's top rated are rated by the community, with a star", () => {
    const { container, rerender } = render(
      <ThemeProvider theme={createTheme()}>
        <FeaturedAppBanner featuredApps={apps} />
      </ThemeProvider>
    );
    expect(
      screen.getByText('core:launcher.library.featured_hint')
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-testid="AutoAwesomeRoundedIcon"]')
    ).not.toBeNull();

    rerender(
      <ThemeProvider theme={createTheme()}>
        <FeaturedAppBanner featuredApps={apps} variant="top-rated" />
      </ThemeProvider>
    );
    expect(
      screen.getByText('core:launcher.library.top_rated_hint')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('core:launcher.library.featured_hint')
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="StarRoundedIcon"]')
    ).not.toBeNull();
    expect(
      screen.getByRole('heading', { name: 'core:official_apps.featured' })
    ).toBeInTheDocument();
  });

  it("opens an app's page as one of a category's when on a category's page", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider theme={createTheme()}>
        <FeaturedAppBanner
          featuredApps={apps}
          isFromCategory
          variant="top-rated"
        />
      </ThemeProvider>
    );
    await user.click(screen.getByRole('button', { name: 'Q-Tube' }));
    expect(executeEvent).toHaveBeenCalledWith('selectedAppInfoCategory', {
      data: apps[1],
    });
  });
});
