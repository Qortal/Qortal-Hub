import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

import { LauncherTabShownContext } from '../launcherTabs';
import { LauncherTileMenu, type LauncherMenuTarget } from './LauncherTileMenu';

const folder = { id: 'f1', name: 'Games', createdAt: 1, updatedAt: 1 };
const target: LauncherMenuTarget = {
  kind: 'folder',
  folder,
  left: 40,
  top: 40,
};

const inTab = (isShown: boolean, onClose = vi.fn()) => (
  <ThemeProvider theme={createTheme()}>
    <LauncherTabShownContext.Provider value={isShown}>
      <LauncherTileMenu
        folders={[folder]}
        onClose={onClose}
        onDeleteFolder={vi.fn()}
        onMoveToFolder={vi.fn()}
        onNewFolder={vi.fn()}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onRemoveFromFolder={vi.fn()}
        onRenameFolder={vi.fn()}
        target={target}
      />
    </LauncherTabShownContext.Provider>
  </ThemeProvider>
);

// A launcher tab stays mounted while another tab shows. The right-click menu
// is a portal, outside the hidden tab: it has to step aside by itself, or it
// and its backdrop would stay over the Q-App shown in its place.
describe('a tile menu in a hidden launcher tab', () => {
  it('is put away with the tab, and shows again with it', async () => {
    const onClose = vi.fn();
    const { rerender } = render(inTab(true, onClose));
    expect(await screen.findByRole('menu')).toBeVisible();

    rerender(inTab(false, onClose));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    rerender(inTab(true, onClose));
    expect(await screen.findByRole('menu')).toBeVisible();
    expect(
      screen.getByRole('menuitem', { name: 'core:bookmarks.rename' })
    ).toBeVisible();
    // Hiding the tab doesn't close the menu: it is still open when it shows.
    expect(onClose).not.toHaveBeenCalled();
  });
});
