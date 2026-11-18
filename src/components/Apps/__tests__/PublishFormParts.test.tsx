import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../../App', () => ({ getBaseApiReact: () => 'http://node' }));

import { PublishPreviewCard, PublishSummaryCard } from '../PublishFormParts';

const wrap = (node: React.ReactNode) =>
  render(<ThemeProvider theme={createTheme()}>{node}</ThemeProvider>);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the summary beside Publish', () => {
  it('says which points are done, not only with an icon', () => {
    wrap(
      <PublishSummaryCard
        busy={false}
        checklist={[
          { key: 'name', label: 'Choose a name', done: true },
          { key: 'files', label: 'Choose the files', done: false },
        ]}
        disabled={false}
        onPublish={vi.fn()}
        parts={[{ key: 'app', label: 'The app' }]}
        publishLabel="Publish"
        unitFee={0.01}
      />
    );
    const [name, files] = screen.getAllByRole('listitem');
    expect(
      within(name).getByRole('img', { name: 'core:publish_form.check_done' })
    ).toBeInTheDocument();
    expect(
      within(files).getByRole('img', { name: 'core:publish_form.check_open' })
    ).toBeInTheDocument();
  });
});

describe('the library preview', () => {
  it('shows the same tag twice without a key clash', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    wrap(
      <PublishPreviewCard
        categoryName="Games"
        description="Fun"
        isWebsite={false}
        name="MyApp"
        shotUrls={[]}
        tags={['game', 'game']}
        title="My App"
        version=""
      />
    );
    expect(screen.getAllByText('game')).toHaveLength(2);
    expect(
      error.mock.calls.some((call) => String(call[0]).includes('same key'))
    ).toBe(false);
  });
});
