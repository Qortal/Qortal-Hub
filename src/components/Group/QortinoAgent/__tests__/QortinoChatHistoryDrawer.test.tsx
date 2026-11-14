import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../../../../i18n/i18n';
import { createEmptySession } from '../../../../qortinoAgent/chatHistoryStore';
import { QortinoChatHistoryDrawer } from '../QortinoChatHistoryDrawer';

const SESSION = {
  ...createEmptySession('offline'),
  id: 's1',
  title: 'Purifying water',
  titleCustom: true,
};

describe("Qortino's chat list", () => {
  it('cancels a rename with Escape without closing anything around it', () => {
    const onClose = vi.fn();
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <QortinoChatHistoryDrawer
          open
          onClose={onClose}
          sessions={[SESSION]}
          activeId="s1"
          onNewChat={vi.fn()}
          onSelect={vi.fn()}
          onRename={vi.fn()}
          onTogglePin={vi.fn()}
          onDelete={vi.fn()}
        />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: /Rename/ }));
    const field = screen.getByDisplayValue('Purifying water');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(
      screen.queryByDisplayValue('Purifying water')
    ).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
  });
});
