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
        'tabs.my_apps': 'my apps',
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
  it('renders all four tabs', () => {
    const mockOnTabChange = vi.fn();
    render(
      <TestWrapper>
        <AppsTabs currentTab="official" onTabChange={mockOnTabChange} />
      </TestWrapper>
    );

    expect(screen.getByText(/official apps/i)).toBeInTheDocument();
    expect(screen.getByText(/community apps/i)).toBeInTheDocument();
    expect(screen.getByText(/categories/i)).toBeInTheDocument();
    expect(screen.getByText(/my apps/i)).toBeInTheDocument();
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

    // Click my apps tab
    await user.click(screen.getByText(/my apps/i));
    expect(mockOnTabChange).toHaveBeenLastCalledWith('my-apps');

    // Click community tab (not clicking official since it's already selected and won't trigger onChange)
    await user.click(screen.getByText(/community apps/i));
    expect(mockOnTabChange).toHaveBeenLastCalledWith('community');

    // Verify total call count
    expect(mockOnTabChange).toHaveBeenCalledTimes(3);
  });

  it('supports all valid tab values', () => {
    const mockOnTabChange = vi.fn();
    const tabValues: AppsLibraryTabValue[] = [
      'official',
      'community',
      'categories',
      'my-apps',
    ];

    tabValues.forEach((tabValue) => {
      const { unmount } = render(
        <TestWrapper>
          <AppsTabs currentTab={tabValue} onTabChange={mockOnTabChange} />
        </TestWrapper>
      );
      // Should render without errors
      expect(screen.getAllByRole('tab').length).toBe(4);
      unmount();
    });
  });
});
