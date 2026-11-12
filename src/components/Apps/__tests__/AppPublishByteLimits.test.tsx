import React, { createContext } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

i18n.init({
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

const bytes = (value: string) => new TextEncoder().encode(value).length;

const renderForm = () =>
  render(
    <ThemeProvider theme={createTheme()}>
      <I18nextProvider i18n={i18n}>
        <AppPublish
          categories={[]}
          myAddress="testAddress"
          myName="TestApp"
          initialName=""
          initialAppType="APP"
        />
      </I18nextProvider>
    </ThemeProvider>
  );

const type = (name: string, value: string) => {
  const field = screen.getByRole('textbox', { name });
  fireEvent.change(field, { target: { value } });
  return field;
};

describe('AppPublish – Core metadata limits', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    ) as unknown as typeof fetch;
  });

  it('keeps a Latin title of 80 characters whole', async () => {
    renderForm();
    const field = type('Title', 'a'.repeat(80));
    await waitFor(() => expect(field).toHaveValue('a'.repeat(80)));
  });

  it('cuts a Cyrillic title where Core would: 80 bytes, 40 letters', async () => {
    renderForm();
    const field = type('Title', 'Ж'.repeat(80));
    await waitFor(() => expect(field).toHaveValue('Ж'.repeat(40)));
    expect(bytes((field as HTMLInputElement).value)).toBe(80);
  });

  it('cuts a description at 240 bytes without breaking a character', async () => {
    renderForm();
    const field = type('Description', `${'a'.repeat(238)}😀 more`);
    await waitFor(() => expect(field).toHaveValue('a'.repeat(238)));
  });

  it('never leaves half an emoji in a tag', async () => {
    renderForm();
    const field = type('Tag 1', `${'x'.repeat(19)}😀`);
    await waitFor(() => expect(field).toHaveValue('x'.repeat(19)));
  });
});
