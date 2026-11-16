import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
// Initialises the shared i18n instance so useTranslation resolves real strings.
import '../../i18n/i18n';
import { lightTheme } from '../../styles/theme-light';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import TabComponent from './TabComponent';
import { PINNED_TAB_WIDTH_PX } from './tabStripLayout';

const QTUBE = { name: 'Q-Tube', service: 'APP', tabId: 'tab-1' };

const renderTab = (props: Partial<Parameters<typeof TabComponent>[0]> = {}) => {
  const handlers = {
    onClose: vi.fn(),
    onCloseAll: vi.fn(),
    onDuplicate: vi.fn(),
    onSelect: vi.fn(),
    onTogglePin: vi.fn(),
  };
  const app = props.app ?? QTUBE;
  render(
    <ThemeProvider theme={lightTheme}>
      <DndContext>
        <SortableContext items={[app.tabId]}>
          <TabComponent app={app} isSelected={false} {...handlers} {...props} />
        </SortableContext>
      </DndContext>
    </ThemeProvider>
  );
  return handlers;
};

const theTab = () => screen.getByRole('button', { name: 'Q-Tube' });
// By its label rather than its role: a × out of sight has no accessible
// name, and the tests check that it is out of sight.
const closeButton = () =>
  document.querySelector<HTMLButtonElement>('button[aria-label="Close tab"]');
const middleClick = (element: Element) =>
  fireEvent(
    element,
    new MouseEvent('auxclick', { bubbles: true, button: 1, cancelable: true })
  );

describe('TabComponent', () => {
  it('shows the title and a × while the tab is wide', () => {
    const handlers = renderTab({ widthPx: 180 });

    expect(theTab()).toHaveTextContent('Q-Tube');
    expect(theTab()).toHaveStyle({ width: '180px' });
    fireEvent.click(closeButton()!);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows only the icon when narrow, and keeps the title as its name', async () => {
    const user = userEvent.setup();
    renderTab({ widthPx: 80 });

    expect(theTab()).not.toHaveTextContent('Q-Tube');
    expect(theTab()).toHaveAttribute('aria-label', 'Q-Tube');
    expect(theTab()).toHaveStyle({ width: '80px' });

    await user.hover(theTab());
    expect(
      await screen.findByRole('tooltip', {}, { timeout: 2000 })
    ).toHaveTextContent('Q-Tube');
  });

  it('keeps the × of a narrow tab for the selected one or a hover', () => {
    renderTab({ isSelected: false, widthPx: 80 });
    expect(closeButton()).not.toBeVisible();
  });

  it('shows the × of the selected narrow tab', () => {
    renderTab({ isSelected: true, widthPx: 80 });
    expect(closeButton()).toBeVisible();
  });

  it('closes a normal tab with a middle click', () => {
    const handlers = renderTab();
    middleClick(theTab());
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('draws a pinned tab as its icon only, without a ×', () => {
    renderTab({
      app: { ...QTUBE, pinned: true },
      isPinned: true,
      isSelected: true,
      widthPx: PINNED_TAB_WIDTH_PX,
    });

    expect(theTab()).not.toHaveTextContent('Q-Tube');
    expect(theTab()).toHaveAttribute('data-pinned', 'true');
    expect(closeButton()).toBeNull();
  });

  it('leaves a pinned tab open on a middle click', () => {
    const handlers = renderTab({
      app: { ...QTUBE, pinned: true },
      isPinned: true,
      widthPx: PINNED_TAB_WIDTH_PX,
    });
    middleClick(theTab());
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it('offers Pin tab in its menu', async () => {
    const user = userEvent.setup();
    const handlers = renderTab();

    fireEvent.contextMenu(theTab());
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Pin tab',
      'Duplicate tab',
      'Close all tabs',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'Pin tab' }));
    expect(handlers.onTogglePin).toHaveBeenCalledTimes(1);
  });

  it('offers Unpin tab in the menu of a pinned tab', async () => {
    const user = userEvent.setup();
    const handlers = renderTab({
      app: { ...QTUBE, pinned: true },
      isPinned: true,
      widthPx: PINNED_TAB_WIDTH_PX,
    });

    fireEvent.contextMenu(theTab());
    expect(
      screen.queryByRole('menuitem', { name: 'Pin tab' })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Unpin tab' }));
    expect(handlers.onTogglePin).toHaveBeenCalledTimes(1);
  });
});
