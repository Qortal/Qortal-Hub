import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { createStore, Provider } from 'jotai';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('../../../App', () => ({
  getBaseApiReact: () => 'http://node',
}));

vi.mock('../AppCard', () => ({
  AppCardEnhanced: ({ app }: { app: any }) => <div>{app.name}</div>,
}));

import { LauncherSearchResults } from './LauncherSearchResults';

describe('LauncherSearchResults', () => {
  it('reads how many saved items and apps were found as part of each heading', () => {
    render(
      <Provider store={createStore()}>
        <ThemeProvider theme={createTheme()}>
          <LauncherSearchResults
            apps={[
              { name: 'Chess', service: 'APP' },
              { name: 'Notes', service: 'APP' },
            ]}
            enterOpens={null}
            isActive
            link={null}
            myName="me"
            onOpenLink={vi.fn()}
            query="c"
            savedTiles={[
              <div key="a">a</div>,
              <div key="b">b</div>,
              <div key="c">c</div>,
            ]}
            scrollElement={null}
          />
        </ThemeProvider>
      </Provider>
    );

    const [saved, apps] = screen.getAllByRole('heading', { level: 2 });
    expect(saved).toHaveTextContent('core:launcher.results_saved3');
    expect(saved.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(apps).toHaveTextContent('core:launcher.results_apps2');
    expect(apps.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});
