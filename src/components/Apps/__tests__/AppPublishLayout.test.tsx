import React, { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';
import { capitalizeFirstChar } from '../../../i18n/processors';

// Every string renders as its key.
i18n.use(capitalizeFirstChar as never).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { core: {} } },
});

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
}));

vi.mock('../../../utils/events', () => ({
  executeEvent: vi.fn(),
}));

vi.mock('react-dropzone', () => ({
  useDropzone: () => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
  }),
}));

vi.mock('../../../background/background.ts', () => ({
  getFee: vi.fn().mockResolvedValue({ fee: '0.01' }),
}));

import { AppPublish } from '../AppPublish';
import { installPublishBridges } from '../../../test/mocks/publishBridges';

/** The node answers the names list and the app's details. */
function mockNode() {
  global.fetch = vi.fn((url: string) => {
    const body = url.includes('/names/address/')
      ? [{ name: 'TestApp' }]
      : url.includes('/arbitrary/metadata/')
        ? null
        : [
            {
              name: 'TestApp',
              service: 'APP',
              metadata: {
                title: 'Node title',
                description: 'Node description',
                category: 'games',
                tags: ['node'],
              },
            },
          ];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  }) as unknown as typeof fetch;
}

const renderForm = () =>
  render(
    <ThemeProvider theme={createTheme()}>
      <I18nextProvider i18n={i18n}>
        <AppPublish
          categories={[{ id: 'games', name: 'Games' }]}
          myAddress="Qowner"
          myName="TestApp"
          initialName="TestApp"
          initialAppType="APP"
          isAppTypeLocked
          isUpdate
        />
      </I18nextProvider>
    </ThemeProvider>
  );

const publishButton = () =>
  screen.getByRole('button', { name: /action\.publish/i });
/** The column with the library preview and Publish. */
const sideColumn = () =>
  screen.getByText('publish_form.preview_title').closest('.MuiPaper-root')!
    .parentElement!;

describe('AppPublish – across form widths', () => {
  // jsdom lays nothing out: the form's width and its observer are faked.
  let width = 1200;
  const observers: (() => void)[] = [];
  const realResizeObserver = globalThis.ResizeObserver;
  let bridges: ReturnType<typeof installPublishBridges>;
  beforeEach(() => {
    vi.clearAllMocks();
    bridges = installPublishBridges();
    mockNode();
    width = 1200;
    observers.length = 0;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => width,
    });
    globalThis.ResizeObserver = class {
      constructor(private callback: () => void) {}
      observe() {
        observers.push(this.callback);
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    bridges.uninstall();
    delete (HTMLElement.prototype as any).clientWidth;
    globalThis.ResizeObserver = realResizeObserver;
  });
  const resize = (next: number) =>
    act(() => {
      width = next;
      observers.forEach((callback) => callback());
    });

  it('keeps the preview and Publish, and the focus on it, when the form gets narrower or wider', async () => {
    renderForm();
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
        'Node title'
      )
    );
    const publish = publishButton();
    act(() => publish.focus());

    // One column, then two again.
    resize(700);
    expect(getComputedStyle(sideColumn()).position).not.toBe('sticky');
    expect(publishButton()).toBe(publish);
    expect(publish).toHaveFocus();
    resize(1200);
    expect(getComputedStyle(sideColumn()).position).toBe('sticky');
    expect(publishButton()).toBe(publish);
    expect(publish).toHaveFocus();
  });

  it('keeps its two columns while it measures 0 wide (hidden or collapsed)', async () => {
    renderForm();
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
        'Node title'
      )
    );
    expect(getComputedStyle(sideColumn()).position).toBe('sticky');

    resize(0);
    expect(getComputedStyle(sideColumn()).position).toBe('sticky');
    resize(1200);
    expect(getComputedStyle(sideColumn()).position).toBe('sticky');
  });
});
