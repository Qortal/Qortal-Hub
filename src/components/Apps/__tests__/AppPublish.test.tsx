import React, { createContext } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
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

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { core: {} } },
});

const theme = createTheme();

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
  performPowTask: vi
    .fn()
    .mockResolvedValue({ success: true, nonce: 0, hash: '00' }),
}));

import { AppPublish } from '../AppPublish';
import { executeEvent } from '../../../utils/events';

const mockCategories = [
  { id: 'games', name: 'Games' },
  { id: 'tools', name: 'Tools' },
];

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme={theme}>
    <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
  </ThemeProvider>
);

const defaultProps = {
  categories: mockCategories,
  myAddress: 'testAddress',
  myName: 'TestApp',
  initialName: 'TestApp',
  initialAppType: 'APP' as const,
};

function mockFetch(metadata: unknown) {
  global.fetch = vi.fn((url: string) => {
    if (url.includes('/names/address/')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ name: 'TestApp' }]),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([{ name: 'TestApp', metadata }]),
    });
  }) as unknown as typeof fetch;
}

describe('AppPublish – getQapp metadata loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('populates title and description from metadata', async () => {
    mockFetch({
      title: 'My App',
      description: 'A great app',
      category: 'games',
      tags: ['fun', 'fast'],
    });

    render(
      <TestWrapper>
        <AppPublish {...defaultProps} />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
        'My App'
      );
      expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
        'A great app'
      );
    });
  });

  it('populates tags from an array', async () => {
    mockFetch({
      title: 'My App',
      description: 'A great app',
      tags: ['alpha', 'beta', 'gamma'],
    });

    render(
      <TestWrapper>
        <AppPublish {...defaultProps} />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Tag 1' })).toHaveValue(
        'alpha'
      );
      expect(screen.getByRole('textbox', { name: 'Tag 2' })).toHaveValue(
        'beta'
      );
      expect(screen.getByRole('textbox', { name: 'Tag 3' })).toHaveValue(
        'gamma'
      );
      expect(screen.getByRole('textbox', { name: 'Tag 4' })).toHaveValue('');
      expect(screen.getByRole('textbox', { name: 'Tag 5' })).toHaveValue('');
    });
  });

  it('populates tags from a comma-separated string', async () => {
    mockFetch({
      title: 'My App',
      description: 'A great app',
      tags: 'alpha, beta, gamma',
    });

    render(
      <TestWrapper>
        <AppPublish {...defaultProps} />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Tag 1' })).toHaveValue(
        'alpha'
      );
      expect(screen.getByRole('textbox', { name: 'Tag 2' })).toHaveValue(
        'beta'
      );
      expect(screen.getByRole('textbox', { name: 'Tag 3' })).toHaveValue(
        'gamma'
      );
    });
  });

  it('does not crash and still loads title/description when tags is undefined', async () => {
    mockFetch({
      title: 'My App',
      description: 'A great app',
      category: 'games',
    });

    render(
      <TestWrapper>
        <AppPublish {...defaultProps} />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
        'My App'
      );
      expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
        'A great app'
      );
    });

    expect(screen.getByRole('textbox', { name: 'Tag 1' })).toHaveValue('');
  });

  it('does not crash and still loads title/description when tags is null', async () => {
    mockFetch({ title: 'My App', description: 'No tags here', tags: null });

    render(
      <TestWrapper>
        <AppPublish {...defaultProps} />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
        'My App'
      );
      expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
        'No tags here'
      );
    });

    expect(screen.getByRole('textbox', { name: 'Tag 1' })).toHaveValue('');
  });

  it('does not crash when metadata is entirely absent', async () => {
    mockFetch(undefined);

    render(
      <TestWrapper>
        <AppPublish {...defaultProps} />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('');
      expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
        ''
      );
      expect(screen.getByRole('textbox', { name: 'Tag 1' })).toHaveValue('');
    });
  });
});

// ── Prefill: the right app, never over what the user typed ────────────────

type Reply = { ok: boolean; json: () => Promise<unknown> };

/** A fetch whose app searches answer only when the test says so. */
function controllableFetch() {
  const pending: { url: string; resolve: (body: unknown) => void }[] = [];
  const fetchMock = vi.fn((url: string) => {
    if (url.includes('/names/address/')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([{ name: 'TestApp' }, { name: 'OtherApp' }]),
      });
    }
    return new Promise<Reply>((resolve) => {
      pending.push({
        url,
        resolve: (body) =>
          resolve({ ok: true, json: () => Promise.resolve(body) }),
      });
    });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, pending };
}

const renderForm = (props = {}) =>
  render(
    <TestWrapper>
      <AppPublish {...defaultProps} {...props} />
    </TestWrapper>
  );

describe('AppPublish – prefill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks Core for the name's own default app only", async () => {
    const { pending } = controllableFetch();
    renderForm();

    await waitFor(() => expect(pending).toHaveLength(1));
    const url = new URL(pending[0].url);
    expect(url.searchParams.get('name')).toBe('TestApp');
    expect(url.searchParams.get('exactmatchnames')).toBe('true');
    expect(url.searchParams.get('default')).toBe('true');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('fills in its own app, not one whose name contains it', async () => {
    const { pending } = controllableFetch();
    renderForm();

    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0].resolve([
        {
          name: 'TestAppcontrol',
          service: 'APP',
          metadata: { title: 'Wrong' },
        },
        { name: 'TestApp', service: 'APP', metadata: { title: 'Right' } },
      ]);
    });

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
        'Right'
      )
    );
  });

  it('keeps what the user typed and holds Publish until the details load', async () => {
    const { pending } = controllableFetch();
    renderForm();

    await waitFor(() => expect(pending).toHaveLength(1));
    const publish = screen.getByRole('button', { name: /action\.publish/ });
    expect(publish).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Typed by me' },
    });
    await act(async () => {
      pending[0].resolve([
        {
          name: 'TestApp',
          service: 'APP',
          metadata: { title: 'From node', description: 'Node text' },
        },
      ]);
    });

    await waitFor(() => expect(publish).not.toBeDisabled());
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
      'Typed by me'
    );
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
      'Node text'
    );
  });

  it('drops a late answer for the name picked before', async () => {
    const { pending } = controllableFetch();
    const { rerender } = renderForm();
    await waitFor(() => expect(pending).toHaveLength(1));

    rerender(
      <TestWrapper>
        <AppPublish {...defaultProps} initialName="OtherApp" />
      </TestWrapper>
    );
    await waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => {
      pending[1].resolve([
        { name: 'OtherApp', service: 'APP', metadata: { title: 'Other' } },
      ]);
    });
    await act(async () => {
      pending[0].resolve([
        { name: 'TestApp', service: 'APP', metadata: { title: 'Old' } },
      ]);
    });

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue(
        'Other'
      )
    );
  });

  it("clears the form and warns when the app's details can't be loaded", async () => {
    const { pending } = controllableFetch();
    renderForm();

    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0].resolve([{ name: 'TestApp', service: 'APP', metadata: null }]);
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].url).toContain('/arbitrary/metadata/APP/TestApp/default');
    await act(async () => {
      pending[1].resolve(null);
    });

    await waitFor(() =>
      expect(executeEvent).toHaveBeenCalledWith(
        'openGlobalSnackBar',
        expect.objectContaining({
          type: 'warning',
          message: expect.stringMatching(/app_details_unavailable/),
        })
      )
    );
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('');
  });
});
