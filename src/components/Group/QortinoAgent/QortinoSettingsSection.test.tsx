import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n/i18n';
import { QORTINO_MODEL } from '../../../qortinoAgent/manifest';
import {
  getQortinoSettings,
  resetQortinoSettingsForTests,
} from '../../../qortinoAgent/settings';
import { QortinoSettingsSection } from './QortinoSettingsSection';

const INSTALL = {
  installed: true,
  modelId: QORTINO_MODEL.id,
  llmPath: `/agent/models/${QORTINO_MODEL.parts[0].filename}`,
};

function renderSection(
  overrides: Partial<Parameters<typeof QortinoSettingsSection>[0]> = {}
) {
  const props = {
    install: INSTALL,
    hasChats: true,
    onDeleteAllChats: vi.fn(),
    onRemoveQortino: vi.fn(async () => undefined),
    ...overrides,
  };
  render(<QortinoSettingsSection {...props} />);
  return props;
}

describe("Qortino's settings", () => {
  afterEach(() => {
    resetQortinoSettingsForTests();
    localStorage.clear();
  });

  it('groups the settings under their headings', () => {
    renderSection();
    for (const heading of ['Answers', 'This computer', 'Chats and storage']) {
      expect(
        screen.getByRole('heading', { name: heading })
      ).toBeInTheDocument();
    }
  });

  it('changes answers, text size, keep-ready, the Enter key and the graphics card', () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Short' }));
    fireEvent.click(screen.getByRole('button', { name: 'Large' }));
    fireEvent.click(screen.getByRole('button', { name: 'While Hub is open' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Enter key sends/ }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Use the graphics card/ })
    );
    expect(getQortinoSettings()).toEqual({
      answerLength: 'short',
      textSize: 'large',
      enterSends: false,
      keepReady: 'open',
      useGpu: false,
    });
    expect(screen.getByRole('button', { name: 'Short' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('asks before deleting every chat', () => {
    const props = renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Delete all chats' }));
    expect(props.onDeleteAllChats).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(props.onDeleteAllChats).toHaveBeenCalledTimes(1);
  });

  it('offers no remove before Qortino is downloaded', () => {
    renderSection({ install: { installed: false } });
    expect(
      screen.queryByRole('button', {
        name: "Remove Qortino's model from this computer",
      })
    ).not.toBeInTheDocument();
  });

  it('has nothing to delete when no chat has messages', () => {
    renderSection({ hasChats: false });
    expect(
      screen.getByRole('button', { name: 'Delete all chats' })
    ).toBeDisabled();
  });

  it('shows the model on this computer and removes it after a confirm', async () => {
    const props = renderSection();
    expect(
      screen.getByText('Qwen3 4B Instruct 2507 · 2.3 GB on this computer')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: "Remove Qortino's model from this computer",
      })
    );
    expect(props.onRemoveQortino).not.toHaveBeenCalled();
    expect(
      screen.getByText(/This deletes Qortino's model \(2\.3 GB\)/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(props.onRemoveQortino).toHaveBeenCalledTimes(1));
  });

  it('says why when removing failed, and lets the user cancel', async () => {
    renderSection({
      onRemoveQortino: vi.fn(async () => {
        throw new Error('cleanupStorage failed: busy');
      }),
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: "Remove Qortino's model from this computer",
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(
      await screen.findByText(
        'Could not remove Qortino: cleanupStorage failed: busy'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getByRole('button', {
        name: "Remove Qortino's model from this computer",
      })
    ).toBeInTheDocument();
  });
});
