import { createContext } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
import { balanceAtom, txListAtom, userInfoAtom } from '../../../atoms/global';
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

const renderSetUpCard = () => {
  localStorage.setItem('getting_started_status_QADDR', 'completed');
  const store = createStore();
  store.set(userInfoAtom, { address: 'QADDR', name: 'b-test' });
  store.set(balanceAtom, 10);
  store.set(txListAtom, []);
  // The account has an avatar: it's set up.
  global.fetch = vi.fn((url: string) =>
    Promise.resolve({
      json: () =>
        Promise.resolve(String(url).includes('qortal_avatar') ? [{}] : []),
    })
  ) as unknown as typeof fetch;
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
  return screen.getByTestId('qortino-mascot-stage');
};

const eyes = (stage: HTMLElement) => stage.getAttribute('data-qortino-eyes');

const press = (stage: HTMLElement, x = 50, y = 50) =>
  fireEvent.pointerDown(stage, { clientX: x, clientY: y, pointerId: 1 });

const lift = (stage: HTMLElement, x = 50, y = 50) =>
  fireEvent.pointerUp(stage, { clientX: x, clientY: y, pointerId: 1 });

const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** Lets the node's answers (the avatar lookup) come in. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

/** The Zzz rising from his head while he dozes. */
const zzz = (stage: HTMLElement) => within(stage).queryAllByText('z');

describe("Qortino's faces on Home", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // The afternoon: he's awake.
    vi.setSystemTime(new Date(2026, 10, 15, 14, 0));
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('winks at a tap, then opens his eyes again', () => {
    const stage = renderSetUpCard();
    expect(eyes(stage)).toBe('open');
    press(stage);
    wait(120);
    lift(stage, 51);
    expect(eyes(stage)).toBe('wink');
    wait(800);
    expect(eyes(stage)).toBe('open');
  });

  it('keeps his eyes open for a right click', () => {
    const stage = renderSetUpCard();
    for (const type of ['pointerDown', 'pointerUp'] as const) {
      fireEvent[type](stage, {
        button: 2,
        clientX: 50,
        clientY: 50,
        pointerId: 1,
        pointerType: 'mouse',
      });
    }
    expect(eyes(stage)).toBe('open');
  });

  it('does nothing when the pointer moves away first, or the press is cancelled', () => {
    const stage = renderSetUpCard();
    press(stage);
    fireEvent.pointerMove(stage, { clientX: 90, clientY: 52, pointerId: 1 });
    lift(stage, 140, 52);
    expect(eyes(stage)).toBe('open');

    press(stage);
    fireEvent.pointerCancel(stage, { pointerId: 1 });
    lift(stage);
    expect(eyes(stage)).toBe('open');
  });

  it('is ticklish while held, then happy when let go', () => {
    const stage = renderSetUpCard();
    press(stage);
    wait(500);
    expect(screen.getByText('ticklish')).toBeInTheDocument();
    // Held, the finger may roam over him.
    for (const x of [90, 20, 110]) {
      fireEvent.pointerMove(stage, { clientX: x, clientY: 70, pointerId: 1 });
    }
    expect(screen.getByText('ticklish')).toBeInTheDocument();

    lift(stage, 110, 70);
    expect(eyes(stage)).toBe('happy');
    expect(screen.getByText('happy')).toBeInTheDocument();
    wait(1_700);
    expect(eyes(stage)).toBe('open');
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('gets sleepy late at night, with nothing to do', async () => {
    vi.setSystemTime(new Date(2026, 10, 15, 23, 30));
    const stage = renderSetUpCard();
    // Once the node says the account has an avatar.
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(eyes(stage)).toBe('sleepy');
    expect(screen.getByText('sleepy')).toBeInTheDocument();

    // A tap wakes him for a wink.
    press(stage);
    lift(stage);
    expect(eyes(stage)).toBe('wink');
    wait(800);
    expect(eyes(stage)).toBe('sleepy');
  });

  describe('at night', () => {
    it('stops dozing while he is being tickled', async () => {
      vi.setSystemTime(new Date(2026, 10, 15, 23, 30));
      const stage = renderSetUpCard();
      await settle();
      expect(eyes(stage)).toBe('sleepy');
      expect(zzz(stage)).toHaveLength(3);

      press(stage);
      wait(500);
      expect(screen.getByText('ticklish')).toBeInTheDocument();
      // Tickled, he is wide awake: no Zzz over a laughing face.
      expect(eyes(stage)).toBe('open');
      expect(zzz(stage)).toHaveLength(0);
    });

    it('gets sleepy when the night begins, with Home left open', async () => {
      vi.setSystemTime(new Date(2026, 10, 15, 22, 59, 0));
      const stage = renderSetUpCard();
      await settle();
      expect(eyes(stage)).toBe('open');
      expect(screen.getByText('idle')).toBeInTheDocument();

      // Two minutes on it's 23:01: nothing else on Home has changed.
      wait(120_000);
      expect(eyes(stage)).toBe('sleepy');
      expect(screen.getByText('sleepy')).toBeInTheDocument();
    });

    it('wakes up when the night ends, with Home left open', async () => {
      vi.setSystemTime(new Date(2026, 10, 16, 4, 59, 0));
      const stage = renderSetUpCard();
      await settle();
      expect(eyes(stage)).toBe('sleepy');

      wait(120_000);
      expect(eyes(stage)).toBe('open');
      expect(screen.getByText('idle')).toBeInTheDocument();
    });
  });

  describe('status badge', () => {
    it('keeps his status on one line, however long its translation', async () => {
      renderSetUpCard();
      await settle();
      // The badge is as wide as its text: "à l'écoute" must not break in two.
      expect(getComputedStyle(screen.getByText('idle')).whiteSpace).toBe(
        'nowrap'
      );
    });
  });
});
