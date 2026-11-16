import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { SortDropdown } from './SortDropdown';
import { StatusFilter } from './StatusFilter';
import { CategoryFilter } from './CategoryFilter';

const wrap = (ui: React.ReactNode) =>
  render(
    <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
      {ui}
    </ThemeProvider>
  );

describe('SortDropdown', () => {
  it('is one button named by what it sets, showing the current sort', () => {
    wrap(<SortDropdown onChange={vi.fn()} value="highest_rated" />);

    const pill = screen.getByLabelText('core:filter.sort_by');
    expect(pill.tagName).toBe('BUTTON');
    expect(pill).toHaveAttribute('aria-haspopup', 'menu');
    expect(pill).toHaveAttribute('aria-expanded', 'false');
    expect(pill).toHaveAccessibleName(
      'core:filter.sort_by core:sort.highest_rated'
    );
  });

  it('uses the page font, not the browser’s button font', () => {
    wrap(<SortDropdown onChange={vi.fn()} value="highest_rated" />);
    expect(
      getComputedStyle(screen.getByLabelText('core:filter.sort_by')).fontFamily
    ).toBe('inherit');
  });

  it('lists the sorts in a fixed order, with the current one checked', async () => {
    const user = userEvent.setup();
    wrap(<SortDropdown onChange={vi.fn()} value="newest" />);

    await user.click(screen.getByLabelText('core:filter.sort_by'));

    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual([
      'core:sort.highest_rated',
      'core:sort.most_rated',
      'core:sort.recently_updated',
      'core:sort.newest',
      'core:sort.oldest',
      'core:sort.alphabetical',
    ]);
    expect(
      within(menu).getByRole('menuitemradio', { name: 'core:sort.newest' })
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      within(menu).getByRole('menuitemradio', { name: 'core:sort.oldest' })
    ).toHaveAttribute('aria-checked', 'false');
  });

  it('sets the chosen sort and closes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    wrap(<SortDropdown onChange={onChange} value="newest" />);

    await user.click(screen.getByLabelText('core:filter.sort_by'));
    await user.click(
      await screen.findByRole('menuitemradio', { name: 'core:sort.oldest' })
    );

    expect(onChange).toHaveBeenCalledWith('oldest');
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    );
  });

  it('gives focus back to the pill when Escape closes it', async () => {
    const user = userEvent.setup();
    wrap(<SortDropdown onChange={vi.fn()} value="newest" />);
    const pill = screen.getByLabelText('core:filter.sort_by');

    await user.click(pill);
    await screen.findByRole('menu');
    expect(pill).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    );
    expect(pill).toHaveFocus();
  });

  it('gives each menu its own id', async () => {
    const user = userEvent.setup();
    wrap(
      <>
        <SortDropdown onChange={vi.fn()} value="newest" />
        <SortDropdown onChange={vi.fn()} value="oldest" />
      </>
    );
    const [first, second] = screen.getAllByLabelText('core:filter.sort_by');

    await user.click(first);
    const firstId = first.getAttribute('aria-controls');
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    );
    await user.click(second);
    const secondId = second.getAttribute('aria-controls');

    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(firstId).not.toBe(secondId);
  });
});

describe('the popups under reduced motion', () => {
  const originalMatchMedia = window.matchMedia;
  const clientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientHeight'
  );

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    if (clientHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'clientHeight',
        clientHeight
      );
    }
  });

  const openPaper = async (ui: React.ReactNode, name: string) => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    // A real height, so MUI's "auto" timing would give the menu a duration.
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 300,
    });
    const user = userEvent.setup();
    wrap(ui);
    await user.click(screen.getByLabelText(name));
    await waitFor(() =>
      expect(document.querySelector('.MuiPopover-paper')).not.toBeNull()
    );
    return document.querySelector('.MuiPopover-paper') as HTMLElement;
  };

  it('opens Sort without growing in', async () => {
    const sort = await openPaper(
      <SortDropdown onChange={vi.fn()} value="newest" />,
      'core:filter.sort_by'
    );
    expect(sort.style.transition).toMatch(/opacity 0ms/);
  });

  it('opens Status without growing in', async () => {
    const status = await openPaper(
      <StatusFilter onChange={vi.fn()} value="all" />,
      'core:filter.status'
    );
    expect(status.style.transition).toMatch(/opacity 0ms/);
  });

  it('opens Category without growing in', async () => {
    const paper = await openPaper(
      <CategoryFilter categories={[]} onChange={vi.fn()} value="all" />,
      'core:filter.category'
    );
    expect(paper.style.transition).toMatch(/opacity 0ms/);
  });
});

describe('StatusFilter', () => {
  it('lists all, installed and not installed, and sets the choice', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    wrap(<StatusFilter onChange={onChange} value="all" />);
    const pill = screen.getByLabelText('core:filter.status');
    expect(pill).toHaveAccessibleName('core:filter.status core:filter.all');
    expect(getComputedStyle(pill).backgroundImage).toBe('none');

    await user.click(pill);
    const items = within(await screen.findByRole('menu')).getAllByRole(
      'menuitemradio'
    );
    expect(items.map((item) => item.textContent)).toEqual([
      'core:filter.all',
      'core:filter.installed',
      'core:filter.not_installed',
    ]);
    expect(items[0]).toHaveAttribute('aria-checked', 'true');

    await user.click(items[1]);
    expect(onChange).toHaveBeenCalledWith('installed');
  });

  it('lays the active tint over the pill’s own surface', () => {
    // Over the bar's background alone the accent text fell below 4.5:1.
    wrap(<StatusFilter onChange={vi.fn()} value="installed" />);
    const pill = screen.getByLabelText('core:filter.status');
    expect(getComputedStyle(pill).backgroundImage).toContain('linear-gradient');
    expect(getComputedStyle(pill).backgroundColor).not.toBe('');
  });

  it('gives focus back to the pill when Escape closes it', async () => {
    const user = userEvent.setup();
    wrap(<StatusFilter onChange={vi.fn()} value="installed" />);
    const pill = screen.getByLabelText('core:filter.status');

    await user.click(pill);
    await screen.findByRole('menu');
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    );
    expect(pill).toHaveFocus();
  });
});
