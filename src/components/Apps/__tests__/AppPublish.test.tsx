import React, { createContext } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  performPowTask: vi.fn().mockResolvedValue({ success: true, nonce: 0, hash: '00' }),
}));

import { AppPublish } from '../AppPublish';

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
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('My App');
      expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('A great app');
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
      expect(screen.getByRole('textbox', { name: 'Tag 1' })).toHaveValue('alpha');
      expect(screen.getByRole('textbox', { name: 'Tag 2' })).toHaveValue('beta');
      expect(screen.getByRole('textbox', { name: 'Tag 3' })).toHaveValue('gamma');
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
      expect(screen.getByRole('textbox', { name: 'Tag 1' })).toHaveValue('alpha');
      expect(screen.getByRole('textbox', { name: 'Tag 2' })).toHaveValue('beta');
      expect(screen.getByRole('textbox', { name: 'Tag 3' })).toHaveValue('gamma');
    });
  });

  it('does not crash and still loads title/description when tags is undefined', async () => {
    mockFetch({ title: 'My App', description: 'A great app', category: 'games' });

    render(
      <TestWrapper>
        <AppPublish {...defaultProps} />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('My App');
      expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('A great app');
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
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('My App');
      expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('No tags here');
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
      expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('');
      expect(screen.getByRole('textbox', { name: 'Tag 1' })).toHaveValue('');
    });
  });
});
