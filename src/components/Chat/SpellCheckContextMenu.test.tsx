import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpellCheckContextMenu } from './SpellCheckContextMenu';
import type { Editor } from '@tiptap/react';

const mockShowSnackbar = vi.fn();
vi.mock('../../utils/events', () => ({
  executeEvent: (event: string, data: unknown) => {
    if (event === 'showSnackbar') {
      mockShowSnackbar(data);
    }
  },
}));

vi.mock('../../i18n/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}));

const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
  readText: vi.fn().mockResolvedValue(''),
};

Object.assign(navigator, {
  clipboard: mockClipboard,
});

describe('SpellCheckContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('with TextField input', () => {
    it('shows menu on right-click in enabled input', async () => {
      const inputRef = { current: null };
      const { container } = render(
        <SpellCheckContextMenu inputRef={inputRef}>
          <input
            ref={(el) => {
              inputRef.current = el;
            }}
            type="text"
            data-testid="test-input"
          />
        </SpellCheckContextMenu>
      );

      const wrapper = container.querySelector('div');
      if (!wrapper) throw new Error('Wrapper not found');

      fireEvent.contextMenu(wrapper, {
        clientX: 100,
        clientY: 100,
      });

      await waitFor(() => {
        expect(
          screen.getByText('reticulum:context_menu.cut')
        ).toBeInTheDocument();
      });
    });

    it('does not show menu on right-click in disabled input', async () => {
      const inputRef = { current: null };
      const { container } = render(
        <SpellCheckContextMenu inputRef={inputRef} disabled>
          <input
            ref={(el) => {
              inputRef.current = el;
            }}
            type="text"
            data-testid="test-input"
          />
        </SpellCheckContextMenu>
      );

      const wrapper = container.querySelector('div');
      if (!wrapper) throw new Error('Wrapper not found');

      fireEvent.contextMenu(wrapper, {
        clientX: 100,
        clientY: 100,
      });

      await waitFor(() => {
        expect(
          screen.queryByText('reticulum:context_menu.cut')
        ).not.toBeInTheDocument();
      });
    });

    it('does not show menu on right-click in readonly input', async () => {
      const inputRef = { current: null };
      const { container } = render(
        <SpellCheckContextMenu inputRef={inputRef} readOnly>
          <input
            ref={(el) => {
              inputRef.current = el;
            }}
            type="text"
            data-testid="test-input"
          />
        </SpellCheckContextMenu>
      );

      const wrapper = container.querySelector('div');
      if (!wrapper) throw new Error('Wrapper not found');

      fireEvent.contextMenu(wrapper, {
        clientX: 100,
        clientY: 100,
      });

      await waitFor(() => {
        expect(
          screen.queryByText('reticulum:context_menu.cut')
        ).not.toBeInTheDocument();
      });
    });

    it('closes menu when clicking outside', async () => {
      const inputRef = { current: null };
      const { container } = render(
        <div>
          <SpellCheckContextMenu inputRef={inputRef}>
            <input
              ref={(el) => {
                inputRef.current = el;
              }}
              type="text"
              data-testid="test-input"
            />
          </SpellCheckContextMenu>
          <button data-testid="outside-button">Outside</button>
        </div>
      );

      const wrapper =
        container.querySelector('[style*="display: contents"]') ??
        container.querySelector('div');
      if (!wrapper) throw new Error('Wrapper not found');

      fireEvent.contextMenu(wrapper, {
        clientX: 100,
        clientY: 100,
      });

      await waitFor(() => {
        expect(
          screen.getByText('reticulum:context_menu.cut')
        ).toBeInTheDocument();
      });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      await waitFor(() => {
        expect(
          screen.queryByText('reticulum:context_menu.cut')
        ).not.toBeInTheDocument();
      });
    });

    it('shows clipboard actions (Cut, Copy, Paste)', async () => {
      const inputRef = { current: null };
      const { container } = render(
        <SpellCheckContextMenu inputRef={inputRef}>
          <input
            ref={(el) => {
              inputRef.current = el;
            }}
            type="text"
            data-testid="test-input"
          />
        </SpellCheckContextMenu>
      );

      const wrapper = container.querySelector('div');
      if (!wrapper) throw new Error('Wrapper not found');

      fireEvent.contextMenu(wrapper, {
        clientX: 100,
        clientY: 100,
      });

      await waitFor(() => {
        expect(
          screen.getByText('reticulum:context_menu.cut')
        ).toBeInTheDocument();
        expect(
          screen.getByText('reticulum:context_menu.copy')
        ).toBeInTheDocument();
        expect(
          screen.getByText('reticulum:context_menu.paste')
        ).toBeInTheDocument();
      });
    });
  });

  describe('with TipTap editor', () => {
    const createMockEditor = (text: string = 'hello world') => {
      // The menu resolves the click in *document* coordinates now, so the mock
      // has to look like a ProseMirror doc: `resolve` walks out to the
      // enclosing textblock and `nodesBetween` yields its text nodes.
      const paragraph = {
        isTextblock: true,
        isText: false,
        isLeaf: false,
        nodeSize: text.length + 2,
        content: { size: text.length },
      };
      const textNode = {
        isText: true,
        isLeaf: false,
        text,
        nodeSize: text.length,
      };
      return {
        isDestroyed: false,
        getText: () => text,
        view: {
          posAtCoords: () => ({ pos: 1 }),
        },
        state: {
          selection: { from: 1, to: 1 },
          doc: {
            resolve: vi.fn(() => ({
              depth: 1,
              node: vi.fn(() => paragraph),
              before: vi.fn(() => 0),
            })),
            nodesBetween: vi.fn(
              (
                _from: number,
                _to: number,
                fn: (n: any, at: number) => unknown
              ) => {
                fn(textNode, 1);
                return undefined;
              }
            ),
            textBetween: vi.fn((from: number, to: number) =>
              text.slice(Math.max(0, from - 1), to - 1)
            ),
          },
        },
        chain: () => ({
          focus: () => ({
            setTextSelection: () => ({
              deleteSelection: () => ({
                insertContent: () => ({
                  run: vi.fn(),
                }),
                run: vi.fn(),
              }),
            }),
            deleteSelection: () => ({
              run: vi.fn(),
            }),
            insertContent: () => ({
              run: vi.fn(),
            }),
          }),
        }),
      } as unknown as Editor;
    };

    it('shows menu on right-click in TipTap editor', async () => {
      const editorRef = { current: createMockEditor() };
      const { container } = render(
        <SpellCheckContextMenu editorRef={editorRef}>
          <div data-testid="editor-wrapper">Editor content</div>
        </SpellCheckContextMenu>
      );

      const wrapper = container.querySelector('div');
      if (!wrapper) throw new Error('Wrapper not found');

      fireEvent.contextMenu(wrapper, {
        clientX: 100,
        clientY: 100,
      });

      await waitFor(() => {
        expect(
          screen.getByText('reticulum:context_menu.cut')
        ).toBeInTheDocument();
      });
    });
  });

  describe('clipboard actions', () => {
    it('copies selected text when Copy is clicked', async () => {
      const inputRef = { current: null };
      const { container } = render(
        <SpellCheckContextMenu inputRef={inputRef}>
          <input
            ref={(el) => {
              inputRef.current = el;
            }}
            type="text"
            defaultValue="hello world"
            data-testid="test-input"
          />
        </SpellCheckContextMenu>
      );

      if (inputRef.current) {
        inputRef.current.setSelectionRange(0, 5);
      }

      const wrapper = container.querySelector('div');
      if (!wrapper) throw new Error('Wrapper not found');

      fireEvent.contextMenu(wrapper, {
        clientX: 100,
        clientY: 100,
      });

      await waitFor(() => {
        expect(
          screen.getByText('reticulum:context_menu.copy')
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('reticulum:context_menu.copy'));

      await waitFor(() => {
        expect(mockClipboard.writeText).toHaveBeenCalled();
      });
    });

    it('shows toast when clipboard permission is denied', async () => {
      mockClipboard.writeText.mockRejectedValueOnce(
        new Error('Permission denied')
      );

      const inputRef = { current: null };
      const { container } = render(
        <SpellCheckContextMenu inputRef={inputRef}>
          <input
            ref={(el) => {
              inputRef.current = el;
            }}
            type="text"
            defaultValue="hello world"
            data-testid="test-input"
          />
        </SpellCheckContextMenu>
      );

      if (inputRef.current) {
        inputRef.current.setSelectionRange(0, 5);
      }

      const wrapper = container.querySelector('div');
      if (!wrapper) throw new Error('Wrapper not found');

      fireEvent.contextMenu(wrapper, {
        clientX: 100,
        clientY: 100,
      });

      await waitFor(() => {
        expect(
          screen.getByText('reticulum:context_menu.copy')
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('reticulum:context_menu.copy'));

      await waitFor(() => {
        expect(mockShowSnackbar).toHaveBeenCalledWith({
          message: 'reticulum:context_menu.clipboard_permission_denied',
        });
      });
    });
  });
});
