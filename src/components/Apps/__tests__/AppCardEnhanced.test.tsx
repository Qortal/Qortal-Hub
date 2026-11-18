import React, { createContext } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore, Provider } from 'jotai';
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
import { executeEvent } from '../../../utils/events';

describe('AppCardEnhanced', () => {
  const mockApp = {
    name: 'TestApp',
    service: 'APP',
    created: 1700000000000,
    metadata: {
      title: 'Test Application',
      description:
        'This is a test application with a long description that should be truncated when displayed in the card component.',
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

describe('AppCardEnhanced in the library', () => {
  const app = {
    name: 'TestApp',
    service: 'APP',
    metadata: {
      title: 'Test Application',
      description: 'A short description.',
      category: 'GAMING',
      categoryName: 'Games',
      tags: 'game,fun',
    },
    status: { status: 'READY' },
  };

  const renderCard = (
    props: Partial<React.ComponentProps<typeof AppCardEnhanced>> = {},
    mode: 'light' | 'dark' = 'light'
  ) =>
    render(
      <Provider store={createStore()}>
        <ThemeProvider theme={createTheme({ palette: { mode } })}>
          <I18nextProvider i18n={i18n}>
            <AppCardEnhanced app={app} myName="user1" {...props} />
          </I18nextProvider>
        </ThemeProvider>
      </Provider>
    );

  beforeEach(() => {
    vi.mocked(executeEvent).mockClear();
  });

  it('shows the category as a plain label, readable in the dark theme on hover', () => {
    renderCard({}, 'dark');
    const category = screen.getByText('Games');
    // A clickable MUI Chip took its hover colour from action.selected.
    expect(category.closest('button, [role="button"]')).toBeNull();
    expect(category.closest('.MuiChip-root')).toBeNull();
    expect(document.querySelector('.MuiChip-root')).toBeNull();
  });

  it('shows tags that are not buttons', () => {
    renderCard();
    expect(
      screen.getByText('fun').closest('button, [role="button"]')
    ).toBeNull();
  });

  it('opens the app page from its title, by click or with Enter', async () => {
    const user = userEvent.setup();
    renderCard();
    const title = screen.getByRole('button', { name: 'Test Application' });

    await user.click(title);
    expect(executeEvent).toHaveBeenCalledWith('selectedAppInfo', { data: app });

    vi.mocked(executeEvent).mockClear();
    title.focus();
    await user.keyboard('{Enter}');
    expect(executeEvent).toHaveBeenCalledWith('selectedAppInfo', { data: app });
  });

  it('opens the page within the category when it is shown there', async () => {
    const user = userEvent.setup();
    renderCard({ isFromCategory: true });
    await user.click(screen.getByRole('button', { name: 'Test Application' }));
    expect(executeEvent).toHaveBeenCalledWith('selectedAppInfoCategory', {
      data: app,
    });
  });

  it('starts the app from Open without opening its page', async () => {
    const user = userEvent.setup();
    renderCard();
    const open = screen.getByRole('button', { name: 'action.open' });
    expect(open).toHaveAccessibleDescription('Test Application');

    await user.click(open);
    expect(executeEvent).toHaveBeenCalledTimes(1);
    expect(executeEvent).toHaveBeenCalledWith('addTab', { data: app });
  });

  it('pins and unpins the app', async () => {
    const user = userEvent.setup();
    renderCard();
    const pin = screen.getByRole('button', { name: 'action.pin' });
    expect(pin).toHaveAttribute('aria-pressed', 'false');

    await user.click(pin);
    expect(pin).toHaveAttribute('aria-pressed', 'true');
    await user.click(pin);
    expect(pin).toHaveAttribute('aria-pressed', 'false');
    expect(executeEvent).not.toHaveBeenCalled();
  });

  it('offers Update on the account’s own app', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    renderCard({ onUpdate });

    await user.click(screen.getByRole('button', { name: 'developer.update' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(executeEvent).not.toHaveBeenCalled();
  });

  it('lets Update give way in a tight tile, keeping Open or Download whole', () => {
    renderCard({ onUpdate: vi.fn() });
    // German "Aktualisieren" + pin + "Herunterladen" is wider than a narrow
    // tile: Update's text is cut short instead of the row leaving the card.
    expect(
      getComputedStyle(screen.getByRole('button', { name: 'developer.update' }))
        .flexShrink
    ).toBe('1');
    const other = screen.getByRole('button', {
      name: /action\.(open|download)/,
    });
    expect(getComputedStyle(other).flexShrink).toBe('0');
  });

  it('has no Update on other apps', () => {
    renderCard();
    expect(
      screen.queryByRole('button', { name: 'developer.update' })
    ).not.toBeInTheDocument();
  });

  it('shows a row in the list view, without the tags', () => {
    renderCard({ view: 'list' });
    const row = screen.getByRole('article', { name: 'Test Application' });
    expect(within(row).getByText('by @TestApp')).toBeInTheDocument();
    expect(within(row).getByText('Games')).toBeInTheDocument();
    expect(within(row).queryByText('fun')).not.toBeInTheDocument();
    expect(row).toHaveAttribute('data-library-row');
  });

  it('keeps a row to two lines, the details right next to the name', () => {
    renderCard({ view: 'list' });
    const row = screen.getByRole('article', { name: 'Test Application' });
    /** The innermost element of the row holding both texts. */
    const lineOf = (first: HTMLElement, second: HTMLElement) => {
      let node: HTMLElement | null = first;
      while (node && !node.contains(second)) node = node.parentElement;
      return node as HTMLElement;
    };
    const name = within(row).getByRole('button', { name: 'Test Application' });
    const developer = within(row).getByText('by @TestApp');
    const description = within(row).getByText('A short description.');

    // The name, its rating and its category on the first line.
    const firstLine = lineOf(name, within(row).getByText('Games'));
    expect(firstLine).not.toBe(row);
    expect(firstLine.querySelector('.MuiSkeleton-root')).not.toBeNull();
    expect(firstLine).not.toContainElement(developer);
    // Who made it and what it does on the second.
    const secondLine = lineOf(developer, description);
    expect(secondLine).not.toContainElement(name);
    expect(secondLine).toHaveTextContent('by @TestApp·A short description.');
  });
});
