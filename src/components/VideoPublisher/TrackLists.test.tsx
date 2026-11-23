import { ThemeProvider } from '@mui/material/styles';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { lightTheme } from '../../styles/theme-light';
import { subtitleFromFile } from './queueHelpers';
import { SubtitleList } from './TrackLists';
import type { SubtitleChoice } from './videoPublisherTypes';

const file = (name: string): SubtitleChoice =>
  subtitleFromFile({ id: name, name, size: 1, kind: 'subtitle' });

const renderList = (subtitles: SubtitleChoice[]) =>
  render(
    <ThemeProvider theme={lightTheme}>
      <SubtitleList
        burnIndex={null}
        disabled={false}
        onAddFiles={vi.fn()}
        onBurn={vi.fn()}
        onChange={vi.fn()}
        subtitles={subtitles}
      />
    </ThemeProvider>
  );

/** The row of the subtitle from `name`: its checkbox's label. */
const rowText = (name: string) =>
  screen
    .getByRole('checkbox', { name: new RegExp(`From ${name}`) })
    .closest('label')?.textContent ?? '';

describe('SubtitleList', () => {
  afterEach(() => cleanup());

  it('marks the track that stays out, not a full one listed after it', () => {
    renderList([
      file('Forced.eng.srt'),
      file('SDH.eng.HI.srt'),
      file('English.srt'),
    ]);
    const stays = 'Another track with this language goes along instead.';
    expect(rowText('Forced\\.eng\\.srt')).toContain('forced');
    expect(rowText('Forced\\.eng\\.srt')).toContain(stays);
    expect(rowText('SDH\\.eng\\.HI\\.srt')).toContain('hearing impaired');
    expect(rowText('SDH\\.eng\\.HI\\.srt')).toContain(stays);
    expect(rowText('English\\.srt')).not.toContain(stays);
    // Its language is English, not Hindi.
    expect(
      screen.getByRole('combobox', { name: 'Language of SDH.eng.HI.srt' })
    ).toHaveTextContent('English');
  });
});
