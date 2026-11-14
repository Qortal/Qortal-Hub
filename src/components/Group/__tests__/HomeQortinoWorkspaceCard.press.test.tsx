import { createContext } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { createStore, Provider as JotaiProvider } from 'jotai';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  balanceAtom,
  qortinoAgentOpenAtom,
  txListAtom,
  userInfoAtom,
} from '../../../atoms/global';
import { HomeQortinoWorkspaceCard } from '../HomeQortinoWorkspaceCard';

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  getArbitraryEndpointReact: () => '/arbitrary/resources/search',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
  extStates: {},
}));

vi.mock('../../../utils/events', () => ({
  executeEvent: vi.fn(),
  subscribeToEvent: vi.fn(),
  unsubscribeFromEvent: vi.fn(),
}));

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { group: {} } },
  interpolation: { escapeValue: false },
});

// jsdom has no PointerEvent: React reads clientX/clientY from a MouseEvent.
beforeAll(() => {
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    // @ts-expect-error -- test polyfill
    window.PointerEvent = PointerEventPolyfill;
  }
});

const renderUnlockedCard = ({ desktopApp = true } = {}) => {
  // The desktop app's bridge to the model process (preload.ts).
  if (desktopApp) window.qortinoLlm = {} as typeof window.qortinoLlm;
  else delete window.qortinoLlm;
  localStorage.setItem('getting_started_status_QADDR', 'completed');
  const store = createStore();
  store.set(userInfoAtom, { address: 'QADDR', name: 'b-test' });
  store.set(balanceAtom, 10);
  store.set(txListAtom, []);
  global.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve([]),
  }) as typeof fetch;
  window.sendMessage = vi.fn(async () => null) as typeof window.sendMessage;
  render(
    <JotaiProvider store={store}>
      <ThemeProvider theme={createTheme()}>
        <I18nextProvider i18n={i18n}>
          <HomeQortinoWorkspaceCard />
        </I18nextProvider>
      </ThemeProvider>
    </JotaiProvider>
  );
  return store;
};

const press = (stage: HTMLElement, x: number, y: number) =>
  fireEvent.pointerDown(stage, { clientX: x, clientY: y, pointerId: 1 });

describe("Pressing Qortino's head on Home", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete window.qortinoLlm;
  });

  it('opens Qortino on a click', () => {
    const store = renderUnlockedCard();
    const stage = screen.getByTestId('qortino-mascot-stage');
    press(stage, 50, 50);
    act(() => {
      vi.advanceTimersByTime(120);
    });
    fireEvent.pointerUp(stage, { clientX: 51, clientY: 50, pointerId: 1 });
    expect(store.get(qortinoAgentOpenAtom)).toBe(true);
  });

  it('opens nothing on a right click', () => {
    const store = renderUnlockedCard();
    const stage = screen.getByTestId('qortino-mascot-stage');
    fireEvent.pointerDown(stage, {
      button: 2,
      clientX: 50,
      clientY: 50,
      pointerId: 1,
      pointerType: 'mouse',
    });
    fireEvent.pointerUp(stage, {
      button: 2,
      clientX: 50,
      clientY: 50,
      pointerId: 1,
      pointerType: 'mouse',
    });
    expect(store.get(qortinoAgentOpenAtom)).toBe(false);
  });

  it('opens nothing in the browser, where Qortino AI cannot run', () => {
    const store = renderUnlockedCard({ desktopApp: false });
    const stage = screen.getByTestId('qortino-mascot-stage');
    press(stage, 50, 50);
    fireEvent.pointerUp(stage, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(store.get(qortinoAgentOpenAtom)).toBe(false);
  });

  it('does not open when the pointer is dragged away first', () => {
    const store = renderUnlockedCard();
    const stage = screen.getByTestId('qortino-mascot-stage');
    press(stage, 50, 50);
    fireEvent.pointerMove(stage, { clientX: 90, clientY: 52, pointerId: 1 });
    fireEvent.pointerUp(stage, { clientX: 140, clientY: 52, pointerId: 1 });
    expect(store.get(qortinoAgentOpenAtom)).toBe(false);
  });

  it('does not open when the press is cancelled', () => {
    const store = renderUnlockedCard();
    const stage = screen.getByTestId('qortino-mascot-stage');
    press(stage, 50, 50);
    fireEvent.pointerCancel(stage, { pointerId: 1 });
    fireEvent.pointerUp(stage, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(store.get(qortinoAgentOpenAtom)).toBe(false);
  });

  it('giggles while being tickled, then answers instead of opening', () => {
    const store = renderUnlockedCard();
    const stage = screen.getByTestId('qortino-mascot-stage');
    press(stage, 50, 50);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(
      screen.getByRole('button', { name: /quips\.giggle\./ })
    ).toBeInTheDocument();
    expect(screen.getByText('ticklish')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(900);
    });
    fireEvent.pointerUp(stage, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(store.get(qortinoAgentOpenAtom)).toBe(false);
    expect(
      screen.getByRole('button', { name: /quips\.tickle\./ })
    ).toBeInTheDocument();
  });

  it('stays tickled while the pointer roams over him', () => {
    const store = renderUnlockedCard();
    const stage = screen.getByTestId('qortino-mascot-stage');
    press(stage, 50, 50);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const firstGiggle = screen
      .getByRole('button', { name: /quips\.giggle\./ })
      .getAttribute('aria-label');
    // Rubbing back and forth, far past the tap slop.
    for (const x of [90, 20, 110, 10, 80]) {
      fireEvent.pointerMove(stage, { clientX: x, clientY: 70, pointerId: 1 });
      act(() => {
        vi.advanceTimersByTime(250);
      });
    }
    expect(screen.getByText('ticklish')).toBeInTheDocument();
    // Rubbed, he giggles on: a new giggle has come.
    expect(
      screen
        .getByRole('button', { name: /quips\.giggle\./ })
        .getAttribute('aria-label')
    ).not.toBe(firstGiggle);

    fireEvent.pointerUp(stage, { clientX: 80, clientY: 70, pointerId: 1 });
    expect(store.get(qortinoAgentOpenAtom)).toBe(false);
    expect(
      screen.getByRole('button', { name: /quips\.tickle\./ })
    ).toBeInTheDocument();
  });
});
