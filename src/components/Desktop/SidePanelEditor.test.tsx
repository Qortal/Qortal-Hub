import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { availableQappsAtom } from '../../atoms/appsAtoms';
import { darkTheme } from '../../styles/theme-dark';
import { SidePanelEditor } from './SidePanelEditor';
import {
  SIDE_PANEL_DEFAULT,
  type SidePanelSettings,
  withSidePanelQdnItem,
} from './sidePanel';

vi.mock('../../utils/globalApi', () => ({
  getBaseApiReactForAvatar: () => 'http://node',
}));

const Harness = ({
  initial,
  devMode = false,
  onSettings,
}: {
  initial: SidePanelSettings;
  devMode?: boolean;
  onSettings: (settings: SidePanelSettings) => void;
}) => {
  const [settings, setSettings] = useState(initial);
  return (
    <SidePanelEditor
      devMode={devMode}
      onChange={(change) =>
        setSettings((current) => {
          const next = change(current);
          onSettings(next);
          return next;
        })
      }
      onClose={vi.fn()}
      open
      settings={settings}
    />
  );
};

const renderEditor = (
  initial: SidePanelSettings = SIDE_PANEL_DEFAULT,
  devMode = false
) => {
  const store = createStore();
  store.set(availableQappsAtom, [
    { name: 'Q-Tube', service: 'APP', metadata: { title: 'Q-Tube' } },
    { name: 'Qortal Wiki', service: 'WEBSITE', metadata: null },
    { name: 'Q-Mail', service: 'APP', metadata: null },
  ]);
  const onSettings = vi.fn();
  render(
    <Provider store={store}>
      <ThemeProvider theme={darkTheme}>
        <Harness devMode={devMode} initial={initial} onSettings={onSettings} />
      </ThemeProvider>
    </Provider>
  );
  return onSettings;
};

const lastSettings = (onSettings: ReturnType<typeof vi.fn>) =>
  onSettings.mock.calls[onSettings.mock.calls.length - 1][0];

const rows = () =>
  [...document.querySelectorAll('[data-side-panel-item]')].map((row) =>
    row.getAttribute('data-side-panel-item')
  );

describe('SidePanelEditor', () => {
  it('lists the buttons in order, dev mode only while it is on', () => {
    renderEditor();
    expect(rows()).toEqual([
      'home',
      'apps',
      'qchat',
      'divider',
      'info',
      'language',
      'theme',
    ]);
    // The built-in buttons can't be removed.
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  });

  it('shows dev mode when it is on', () => {
    renderEditor(SIDE_PANEL_DEFAULT, true);
    expect(rows()).toContain('dev');
  });

  it('hides the language, the theme and the node information', () => {
    const onSettings = renderEditor();
    expect(screen.queryByRole('checkbox', { name: 'show Home' })).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'show Language' }));

    expect(
      lastSettings(onSettings).items.find(
        (item: { kind: string }) => item.kind === 'language'
      )
    ).toEqual({ hidden: true, kind: 'language' });
    expect(
      screen.getByRole('checkbox', { name: 'show Language' })
    ).not.toBeChecked();
  });

  it('makes the buttons a bit bigger', () => {
    const onSettings = renderEditor();

    fireEvent.change(screen.getByRole('slider', { name: /button size/i }), {
      target: { value: 110 },
    });

    expect(lastSettings(onSettings).buttonSize).toBe(1.1);
  });

  it("sets the edge handle's height, and its background down to the outline", () => {
    const onSettings = renderEditor();

    fireEvent.change(
      screen.getByRole('slider', { name: /edge handle height/i }),
      { target: { value: 160 } }
    );
    expect(lastSettings(onSettings).handleHeight).toBe(160);

    fireEvent.change(
      screen.getByRole('slider', { name: /edge handle background/i }),
      { target: { value: 0 } }
    );
    expect(lastSettings(onSettings).handleBackground).toBe(0);
  });

  it('switches the edge handle off, so the whole edge opens the panel', () => {
    const onSettings = renderEditor();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Show the handle' }));

    expect(lastSettings(onSettings).edgeHandle).toBe(false);
    expect(
      screen.getByText(/the panel opens when the pointer reaches the left edge/)
    ).toBeInTheDocument();
    // Without a handle there is nothing to size.
    expect(
      screen.queryByRole('slider', { name: /edge handle height/i })
    ).toBeNull();
  });

  it('has no edge handle to set while the panel stays open', () => {
    renderEditor({ ...SIDE_PANEL_DEFAULT, show: 'always' });
    expect(screen.queryByRole('slider', { name: /edge handle/i })).toBeNull();
    expect(
      screen.getByRole('slider', { name: /button size/i })
    ).toBeInTheDocument();
  });

  it('keeps the panel open, beside the content', () => {
    const onSettings = renderEditor();
    fireEvent.click(
      screen.getByRole('radio', { name: 'Always, next to the content' })
    );
    expect(lastSettings(onSettings).show).toBe('always');
  });

  it('adds a Q-App from the search, and removes it', () => {
    const onSettings = renderEditor();
    const search = screen.getByPlaceholderText('Search Q-Apps and websites');

    fireEvent.change(search, { target: { value: 'tube' } });
    fireEvent.click(screen.getByRole('option', { name: /Q-Tube/ }));

    // At the end of the first group, before the divider.
    const items = lastSettings(onSettings).items;
    const divider = items.findIndex(
      (item: { kind: string }) => item.kind === 'divider'
    );
    expect(items[divider - 1]).toEqual({
      kind: 'qdn',
      name: 'Q-Tube',
      service: 'APP',
    });
    expect(rows()).toContain('qdn:APP:q-tube');

    fireEvent.click(screen.getByRole('button', { name: 'remove Q-Tube' }));
    expect(rows()).not.toContain('qdn:APP:q-tube');
  });

  it('offers websites too, and not what is already there', () => {
    renderEditor(
      withSidePanelQdnItem(SIDE_PANEL_DEFAULT, {
        name: 'Q-Tube',
        service: 'APP',
      })
    );
    const search = screen.getByPlaceholderText('Search Q-Apps and websites');

    fireEvent.change(search, { target: { value: 'q' } });

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).queryByText('Q-Tube')).toBeNull();
    expect(within(listbox).getByText('Qortal Wiki')).toBeInTheDocument();
    expect(within(listbox).getByText(/Website/)).toBeInTheDocument();
  });

  it('resets to the default panel', () => {
    const onSettings = renderEditor({
      ...withSidePanelQdnItem(SIDE_PANEL_DEFAULT, {
        name: 'Q-Tube',
        service: 'APP',
      }),
      background: 0.2,
      show: 'always',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(lastSettings(onSettings)).toEqual(SIDE_PANEL_DEFAULT);
  });
});
