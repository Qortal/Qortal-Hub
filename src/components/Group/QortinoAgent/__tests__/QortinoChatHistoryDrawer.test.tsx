import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
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

const chat = (id: string, title: string) => ({
  ...createEmptySession('offline'),
  id,
  title,
  titleCustom: true,
});

/** The list as the chat keeps it: a deleted chat leaves, the rest move up. */
function Chats() {
  const [sessions, setSessions] = useState([
    chat('s1', 'First chat'),
    chat('s2', 'Second chat'),
    chat('s3', 'Third chat'),
  ]);
  return (
    <QortinoChatHistoryDrawer
      open
      onClose={vi.fn()}
      sessions={sessions}
      activeId="s3"
      onNewChat={vi.fn()}
      onSelect={vi.fn()}
      onRename={vi.fn()}
      onTogglePin={vi.fn()}
      onDelete={(id) =>
        setSessions((prev) => prev.filter((session) => session.id !== id))
      }
    />
  );
}

const titles = () =>
  screen
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
    .filter((text) => text.endsWith('chat'));

const clickFirstDelete = () =>
  fireEvent.click(screen.getAllByRole('button', { name: 'Delete chat' })[0]);

describe("Deleting from Qortino's chat list", () => {
  it('deletes one chat on a double click, not the next one too', () => {
    render(<Chats />);
    clickFirstDelete();
    // The second click lands on the chat that moved up under the pointer.
    clickFirstDelete();
    expect(titles()).toEqual(['Second chat', 'Third chat']);
  });

  it('deletes the next chat on a click of its own', async () => {
    render(<Chats />);
    clickFirstDelete();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    clickFirstDelete();
    expect(titles()).toEqual(['Third chat']);
  });

  it("deletes the next chat after the computer's clock was set back", async () => {
    render(<Chats />);
    clickFirstDelete();
    // The clock is set back an hour between the two deletes.
    const wallClock = Date.now;
    const setBack = vi
      .spyOn(Date, 'now')
      .mockImplementation(() => wallClock() - 3_600_000);
    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 450));
      });
      clickFirstDelete();
      expect(titles()).toEqual(['Third chat']);
    } finally {
      setBack.mockRestore();
    }
  });
});
