import React, { createContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

i18n.init({ lng: 'en', fallbackLng: 'en', resources: { en: { core: {} } } });

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
}));
vi.mock('../../../background/background', () => ({
  createEndpoint: vi.fn(async (path: string) => `http://node${path}`),
}));
vi.mock('../AppViewerContainer', () => ({ default: () => null }));
vi.mock('./screenshotImage', () => ({
  MAX_IMAGE_FILE_BYTES: 15 * 1024 * 1024,
  encodeScreenshot: vi.fn(async () => ({
    blob: new Blob([new Uint8Array([7])], { type: 'image/webp' }),
    width: 1600,
    height: 1000,
  })),
}));

import { ExtrasSummary, PublishPageExtras } from './PublishPageExtras';

const nodeWith = (shots: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const json = (value: unknown) => new Response(JSON.stringify(value));
    if (url.includes('identifier=qhub_app_'))
      return json(
        shots
          ? [
              {
                name: 'MyApp',
                service: 'IMAGE',
                identifier: 'qhub_app_shots_v1_APP',
                latestSignature: 'S',
              },
            ]
          : []
      );
    if (url.includes('/resource/status/')) return json({ status: 'READY' });
    if (url.includes('filepath=shots.json')) return json(shots);
    return new Response('', { status: 404 });
  });

const renderExtras = () => {
  const onSummaryChange = vi.fn();
  render(
    <ThemeProvider theme={createTheme()}>
      <I18nextProvider i18n={i18n}>
        <PublishPageExtras
          bare
          file={null}
          name="MyApp"
          onSummaryChange={onSummaryChange}
          service="APP"
        />
      </I18nextProvider>
    </ThemeProvider>
  );
  return () =>
    onSummaryChange.mock.calls[
      onSummaryChange.mock.calls.length - 1
    ]?.[0] as ExtrasSummary;
};

beforeEach(() => {
  window.electronAPI = undefined as any;
  URL.createObjectURL = vi.fn(() => 'blob:picture');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the publish form's summary of the screenshots", () => {
  it('has none for a new app until the publisher adds some', async () => {
    nodeWith(null);
    const latest = renderExtras();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(latest()).toMatchObject({
      pageText: false,
      screenshots: 'none',
      shotCount: 0,
      shotUrls: [],
    });
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: {
          files: [
            new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }),
          ],
        },
      });
    });
    expect(latest()).toMatchObject({
      screenshots: 'chosen',
      shotCount: 1,
      shotUrls: ['blob:picture'],
    });
  });

  it('keeps, changes or takes off the published ones', async () => {
    nodeWith({
      v: 1,
      shots: [
        { file: '1.webp', caption: '' },
        { file: '2.webp', caption: '' },
      ],
      updated: 1,
    });
    const latest = renderExtras();
    await waitFor(() =>
      expect(latest()).toMatchObject({ screenshots: 'keep', shotCount: 2 })
    );
    expect(latest().shotUrls).toHaveLength(2);

    fireEvent.click(
      screen.getByRole('radio', { name: /app_page.publish.shots_none/ })
    );
    expect(latest()).toMatchObject({ screenshots: 'remove', shotCount: 0 });

    fireEvent.click(
      screen.getByRole('radio', { name: /app_page.publish.shots_change/ })
    );
    expect(latest()).toMatchObject({ screenshots: 'keep', shotCount: 2 });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'action.remove' })[0]
    );
    expect(latest()).toMatchObject({ screenshots: 'chosen', shotCount: 1 });
  });
});
