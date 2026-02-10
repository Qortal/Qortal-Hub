import React, { createContext } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
        'app_detail.by_developer': 'by @{{developer}}',
        none: 'none',
      },
    },
  },
});

// Create a test theme
const theme = createTheme();

// Create mock context for QORTAL_APP_CONTEXT
const MockQortalAppContext = createContext({
  show: vi.fn(),
});

// Test wrapper component
const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <MockQortalAppContext.Provider value={{ show: vi.fn() }}>
    <ThemeProvider theme={theme}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </ThemeProvider>
  </MockQortalAppContext.Provider>
);

// Mock the App module with all required exports
vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://localhost:12391',
  QORTAL_APP_CONTEXT: createContext({ show: vi.fn() }),
}));

// Mock the executeEvent function
vi.mock('../../../utils/events', () => ({
  executeEvent: vi.fn(),
}));

// Import after mocks
import { AppCardEnhanced } from '../AppCard/AppCardEnhanced';

describe('AppCardEnhanced', () => {
  const mockApp = {
    name: 'TestApp',
    service: 'APP',
    created: 1700000000000,
    metadata: {
      title: 'Test Application',
      description: 'This is a test application with a long description that should be truncated when displayed in the card component.',
      category: 'games',
      categoryName: 'Games',
      tags: 'game,fun,test',
    },
    status: { status: 'READY' },
  };

  const mockAppMinimal = {
    name: 'MinimalApp',
    service: 'APP',
  };

  it('renders app title from metadata', () => {
    render(
      <TestWrapper>
        <AppCardEnhanced app={mockApp} myName="user1" />
      </TestWrapper>
    );
    expect(screen.getByText('Test Application')).toBeInTheDocument();
  });

  it('falls back to name when title is missing', () => {
    render(
      <TestWrapper>
        <AppCardEnhanced app={mockAppMinimal} myName="user1" />
      </TestWrapper>
    );
    expect(screen.getByText('MinimalApp')).toBeInTheDocument();
  });

  it('displays developer name', () => {
    render(
      <TestWrapper>
        <AppCardEnhanced app={mockApp} myName="user1" />
      </TestWrapper>
    );
    // The full text is "by @TestApp" from i18n
    expect(screen.getByText('by @TestApp')).toBeInTheDocument();
  });

  it('displays category when available', () => {
    render(
      <TestWrapper>
        <AppCardEnhanced app={mockApp} myName="user1" />
      </TestWrapper>
    );
    expect(screen.getByText('Games')).toBeInTheDocument();
  });

  it('truncates long descriptions', () => {
    render(
      <TestWrapper>
        <AppCardEnhanced app={mockApp} myName="user1" />
      </TestWrapper>
    );
    // The description should be truncated (original is ~100 chars, truncated at 80)
    const description = screen.getByText(/This is a test application/);
    expect(description.textContent?.length).toBeLessThan(
      mockApp.metadata.description.length
    );
  });

  it('handles missing description gracefully', () => {
    render(
      <TestWrapper>
        <AppCardEnhanced app={mockAppMinimal} myName="user1" />
      </TestWrapper>
    );
    // Should not throw and should render
    expect(screen.getByText('MinimalApp')).toBeInTheDocument();
  });

  it('displays tags when available', () => {
    render(
      <TestWrapper>
        <AppCardEnhanced app={mockApp} myName="user1" />
      </TestWrapper>
    );
    expect(screen.getByText('game')).toBeInTheDocument();
    expect(screen.getByText('fun')).toBeInTheDocument();
    expect(screen.getByText('test')).toBeInTheDocument();
  });

  it('handles missing tags gracefully', () => {
    render(
      <TestWrapper>
        <AppCardEnhanced app={mockAppMinimal} myName="user1" />
      </TestWrapper>
    );
    // Should not throw
    expect(screen.getByText('MinimalApp')).toBeInTheDocument();
  });

  it('renders action buttons', () => {
    render(
      <TestWrapper>
        <AppCardEnhanced app={mockApp} myName="user1" />
      </TestWrapper>
    );
    // The card has pin and open action buttons
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });
});
