import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

// Initialize i18n for tests
i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      core: {
        'tabs.official_apps': 'official apps',
        'tabs.community_apps': 'community apps',
        'tabs.categories': 'categories',
        'tabs.widgets': 'widgets',
        'tabs.my_apps': 'my apps',
        'tabs.add_private': 'Private apps',
      },
    },
  },
  interpolation: {
    escapeValue: false,
  },
});

// Create a test theme
const theme = createTheme();

// Test wrapper component
const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme={theme}>
    <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
  </ThemeProvider>
);

import { AppsTabs, AppsLibraryTabValue } from '../AppsLibrary';

describe('AppsTabs', () => {
  it('renders all six tabs', () => {
    const mockOnTabChange = vi.fn();
    render(
      <TestWrapper>
        <AppsTabs currentTab="official" onTabChange={mockOnTabChange} />
      </TestWrapper>
    );

    expect(screen.getByText(/official apps/i)).toBeInTheDocument();
    expect(screen.getByText(/community apps/i)).toBeInTheDocument();
    expect(screen.getByText(/categories/i)).toBeInTheDocument();
    expect(screen.getByText(/widgets/i)).toBeInTheDocument();
    expect(screen.getByText(/my apps/i)).toBeInTheDocument();
    expect(screen.getByText(/private apps/i)).toBeInTheDocument();
    // Widgets sits with the tabs to browse, before the account's own.
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Official apps',
      'Community apps',
      'Categories',
      'Widgets',
      'My apps',
      'Private apps',
    ]);
  });

  it('highlights the current tab', () => {
    const mockOnTabChange = vi.fn();
    const { rerender } = render(
      <TestWrapper>
        <AppsTabs currentTab="official" onTabChange={mockOnTabChange} />
      </TestWrapper>
    );

    // The official tab should be selected
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');

    // Rerender with different tab
    rerender(
      <TestWrapper>
        <AppsTabs currentTab="community" onTabChange={mockOnTabChange} />
      </TestWrapper>
    );

    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onTabChange when clicking a tab', async () => {
    const user = userEvent.setup();
    const mockOnTabChange = vi.fn();
    render(
      <TestWrapper>
        <AppsTabs currentTab="official" onTabChange={mockOnTabChange} />
      </TestWrapper>
    );

    // Click on community tab
    const communityTab = screen.getByText(/community apps/i);
    await user.click(communityTab);

    expect(mockOnTabChange).toHaveBeenCalledWith('community');
  });

  it('calls onTabChange with correct tab value for each tab', async () => {
    const user = userEvent.setup();
    const mockOnTabChange = vi.fn();
    render(
      <TestWrapper>
        <AppsTabs currentTab="official" onTabChange={mockOnTabChange} />
      </TestWrapper>
    );

    // Click categories tab
    await user.click(screen.getByText(/categories/i));
    expect(mockOnTabChange).toHaveBeenLastCalledWith('categories');

    // Click widgets tab
    await user.click(screen.getByText(/widgets/i));
    expect(mockOnTabChange).toHaveBeenLastCalledWith('widgets');

    // Click my apps tab
    await user.click(screen.getByText(/my apps/i));
    expect(mockOnTabChange).toHaveBeenLastCalledWith('my-apps');

    // Click community tab (not clicking official since it's already selected and won't trigger onChange)
    await user.click(screen.getByText(/community apps/i));
    expect(mockOnTabChange).toHaveBeenLastCalledWith('community');

    // Verify total call count
    expect(mockOnTabChange).toHaveBeenCalledTimes(4);
  });

  it('supports all valid tab values', () => {
    const mockOnTabChange = vi.fn();
    const tabValues: AppsLibraryTabValue[] = [
      'official',
      'community',
      'categories',
      'widgets',
      'my-apps',
      'private',
    ];

    tabValues.forEach((tabValue) => {
      const { unmount } = render(
        <TestWrapper>
          <AppsTabs currentTab={tabValue} onTabChange={mockOnTabChange} />
        </TestWrapper>
      );
      // Should render without errors (6 tabs: official, community, categories, widgets, my-apps, private)
      expect(screen.getAllByRole('tab').length).toBe(6);
      unmount();
    });
  });

  it('links each tab to its panel when given an id prefix', () => {
    render(
      <TestWrapper>
        <AppsTabs currentTab="official" idPrefix="lib" onTabChange={vi.fn()} />
      </TestWrapper>
    );

    const community = screen.getAllByRole('tab')[1];
    expect(community).toHaveAttribute('id', 'lib-tab-community');
    expect(community).toHaveAttribute('aria-controls', 'lib-panel-community');
  });

  it('still works when the system asks for less motion', async () => {
    const user = userEvent.setup();
    const originalMatchMedia = window.matchMedia;
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
    const onTabChange = vi.fn();
    try {
      render(
        <TestWrapper>
          <AppsTabs currentTab="categories" onTabChange={onTabChange} />
        </TestWrapper>
      );
      expect(screen.getAllByRole('tab')[2]).toHaveAttribute(
        'aria-selected',
        'true'
      );
      await user.click(screen.getByRole('tab', { name: /my apps/i }));
      expect(onTabChange).toHaveBeenCalledWith('my-apps');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
