import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

const openApp = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
}));

vi.mock('../../../hooks/useHandlePrivateApps', () => ({
  useHandlePrivateApps: () => ({ openApp }),
}));

import { PublishedPrivateApps } from '../PublishedPrivateApps';
import { libraryViewAtom } from '../AppsLibrary/libraryView';

const privateResult = {
  name: 'alice',
  service: 'DOCUMENT',
  identifier: 'minter-helper',
  metadata: { description: 'qortal-hub-private-app;groupId=7' },
  created: 1700000000000,
};

type Answer = { ok?: boolean; body: unknown };

/** Answers the names lookup, then the search, in turn. */
const mockFetch = (...answers: Answer[]) => {
  const fetchMock = vi.fn();
  answers.forEach(({ ok = true, body }) =>
    fetchMock.mockResolvedValueOnce({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    })
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

const renderList = (view: 'grid' | 'list' = 'grid', refreshKey = 0) => {
  const store = createStore();
  store.set(libraryViewAtom, view);
  const ui = (key: number) => (
    <Provider store={store}>
      <ThemeProvider theme={createTheme()}>
        <PublishedPrivateApps myAddress="Qme" refreshKey={key} />
      </ThemeProvider>
    </Provider>
  );
  const result = render(ui(refreshKey));
  return { ...result, rerenderWith: (key: number) => result.rerender(ui(key)) };
};

describe('PublishedPrivateApps in the library', () => {
  beforeEach(() => {
    openApp.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows each app as a tile and opens it', async () => {
    const user = userEvent.setup();
    mockFetch({ body: [{ name: 'alice' }] }, { body: [privateResult] });
    renderList();

    const tile = await screen.findByRole('article', { name: 'minter-helper' });
    expect(tile).toHaveTextContent('core:private_apps.details');
    await user.click(
      within(tile).getByRole('button', { name: 'core:action.open' })
    );
    expect(openApp).toHaveBeenCalledWith(
      {
        name: 'alice',
        service: 'DOCUMENT',
        identifier: 'minter-helper',
        groupId: 7,
      },
      true,
      undefined
    );
  });

  it('shows rows in the list view', async () => {
    mockFetch({ body: [{ name: 'alice' }] }, { body: [privateResult] });
    renderList('list');

    const row = await screen.findByRole('article', { name: 'minter-helper' });
    const date = row.querySelector('.libraryPrivateDate');
    expect(date).not.toBeNull();
    // The details and the date share the line under the name.
    const line = date?.parentElement as HTMLElement;
    expect(line).toHaveTextContent('core:private_apps.details');
    expect(line).not.toContainElement(
      within(row).getByRole('heading', { name: 'minter-helper' })
    );
  });

  it('offers to try again after an error', async () => {
    const user = userEvent.setup();
    mockFetch(
      { body: [{ name: 'alice' }] },
      { ok: false, body: null },
      { body: [{ name: 'alice' }] },
      { body: [privateResult] }
    );
    renderList();

    expect(
      await screen.findByText('core:private_apps.load_error')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'core:retry' }));
    expect(
      await screen.findByRole('article', { name: 'minter-helper' })
    ).toBeInTheDocument();
    // Retry is gone: focus moved to the section's title, not to the page.
    expect(
      screen.getByRole('heading', { name: 'core:private_apps.published_title' })
    ).toHaveFocus();
  });

  it('keeps Retry in place, with focus, while it tries and when it fails again', async () => {
    const user = userEvent.setup();
    let answerSearch: (value: unknown) => void = () => {};
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ name: 'alice' }],
      })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => null })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ name: 'alice' }],
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answerSearch = resolve;
        })
      );
    global.fetch = fetchMock as unknown as typeof fetch;
    renderList();

    const retry = await screen.findByRole('button', { name: 'core:retry' });
    await user.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    // Still there while the node answers, marked as busy.
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-disabled', 'true');

    answerSearch({ ok: false, status: 500, json: async () => null });
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled'));
    expect(retry).toHaveFocus();
    expect(
      screen.getByText('core:private_apps.load_error')
    ).toBeInTheDocument();
  });

  it('says when there are none', async () => {
    mockFetch({ body: [{ name: 'alice' }] }, { body: [] });
    renderList();
    expect(
      await screen.findByText('core:private_apps.empty')
    ).toBeInTheDocument();
  });

  it('has no refresh button of its own, and reloads with the library', async () => {
    const fetchMock = mockFetch(
      { body: [{ name: 'alice' }] },
      { body: [privateResult] },
      { body: [{ name: 'alice' }] },
      { body: [privateResult] }
    );
    const { rerenderWith } = renderList();
    await screen.findByRole('article', { name: 'minter-helper' });
    expect(
      screen.queryByRole('button', { name: 'core:action.refresh' })
    ).not.toBeInTheDocument();

    rerenderWith(1);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    // The apps stay on screen while the list reloads.
    expect(
      screen.getByRole('article', { name: 'minter-helper' })
    ).toBeInTheDocument();
  });
});
