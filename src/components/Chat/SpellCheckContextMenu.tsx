import { useState, useCallback, useRef, useEffect, forwardRef } from 'react';
import type { Editor } from '@tiptap/react';
import { Box, Divider, MenuItem, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import { useTranslation } from 'react-i18next';
import { CustomStyledMenu } from '../ContextMenu';
import { executeEvent } from '../../utils/events';
import {
  buildCharRunsInTextblock,
  findWordAtPosition,
} from './spellCheckWordRange';

interface SpellCheckContextMenuProps {
  children: React.ReactNode;
  inputRef?: React.RefObject<HTMLInputElement | HTMLTextAreaElement>;
  editorRef?: React.MutableRefObject<Editor | null>;
  onTextChange?: (text: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
}

interface MenuPosition {
  mouseX: number;
  mouseY: number;
}

const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const SpellCheckContextMenu = forwardRef<
  HTMLInputElement | HTMLTextAreaElement,
  SpellCheckContextMenuProps
>(
  (
    {
      children,
      inputRef: externalInputRef,
      editorRef,
      onTextChange,
      disabled = false,
      readOnly = false,
    },
    forwardedRef
  ) => {
    const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [misspelledWord, setMisspelledWord] = useState<string | null>(null);
    const [wordRange, setWordRange] = useState<{
      start: number;
      end: number;
    } | null>(null);
    const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(
      null
    );
    const internalInputRef = useRef<
      HTMLInputElement | HTMLTextAreaElement | null
    >(null);
    const menuInstanceIdRef = useRef(
      crypto.randomUUID?.() || `spell-menu-${Math.random()}`
    );
    const { t } = useTranslation(['reticulum', 'core']);

    const inputRef = externalInputRef || internalInputRef;

    const handleContextMenu = useCallback(
      async (event: React.MouseEvent<HTMLElement>) => {
        if (disabled || readOnly) return;

        event.preventDefault();
        event.stopPropagation();

        const target = event.currentTarget;
        const editor = editorRef?.current;
        const inputElement = inputRef?.current;

        if (!editor && !inputElement) {
          setMenuPosition({ mouseX: event.clientX, mouseY: event.clientY });
          setAnchorElement(target);
          setSuggestions([]);
          setMisspelledWord(null);
          setWordRange(null);
          return;
        }

        let wordSuggestions: string[] = [];
        let word: string | null = null;
        let wordStart = 0;
        let wordEnd = 0;

        if (editor && !editor.isDestroyed) {
          // Get position from right-click coordinates, not from selection
          const posAtCoords = editor.view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          const clickPosition = posAtCoords
            ? posAtCoords.pos
            : editor.state.selection.from;

          // Resolve the word in *document* coordinates. The old code took
          // offsets from editor.getText() and reused them as document
          // positions; the two disagree around every node boundary, which is how
          // replacing inside a bullet list produced "hehello" and how the word
          // next to a mention took the mention with it.
          // Walk out to the enclosing textblock, so a word never spans two
          // paragraphs. `getText()` could not distinguish them: it joins the
          // document into one string.
          const resolvedAt = editor.state.doc.resolve(clickPosition);
          let textblockDepth = resolvedAt.depth;
          while (
            textblockDepth > 0 &&
            !resolvedAt.node(textblockDepth).isTextblock
          ) {
            textblockDepth -= 1;
          }
          const textblock = resolvedAt.node(textblockDepth);
          const textblockStart = resolvedAt.before(textblockDepth) + 1;
          const runs = buildCharRunsInTextblock(
            editor.state.doc,
            textblockStart,
            textblockStart + textblock.content.size
          );
          const detected = findWordAtPosition(runs, clickPosition);

          if (detected) {
            wordStart = detected.from;
            wordEnd = detected.to;
            word = detected.word;
            console.log(
              `[SpellCheckContextMenu] Detected word: "${word}" at document positions ${wordStart}-${wordEnd}`
            );

            try {
              const electronAPI = (window as any).electronAPI;
              if (electronAPI?.spellCheck?.getSuggestions) {
                console.log(
                  '[SpellCheckContextMenu] Calling electronAPI.spellCheck.getSuggestions...'
                );
                wordSuggestions =
                  await electronAPI.spellCheck.getSuggestions(word);
                console.log(
                  `[SpellCheckContextMenu] Got ${wordSuggestions?.length ?? 0} suggestions:`,
                  wordSuggestions
                );
              } else if ('webFrame' in (window as any)) {
                const webFrame = (window as any).require?.(
                  'electron'
                )?.webFrame;
                if (webFrame?.getWordSuggestions) {
                  wordSuggestions = webFrame.getWordSuggestions(word) || [];
                }
              } else {
                console.log(
                  '[SpellCheckContextMenu] electronAPI.spellCheck.getSuggestions not available'
                );
              }
            } catch (error) {
              console.warn(
                '[SpellCheckContextMenu] Spell check API error:',
                error
              );
            }
          }
        } else if (inputElement) {
          // For regular input/textarea, use selection position (right-click doesn't change it)
          const selectionStart = inputElement.selectionStart ?? 0;
          const selectionEnd = inputElement.selectionEnd ?? 0;
          const hasSelection = selectionStart !== selectionEnd;

          if (!hasSelection && inputElement.value) {
            const textValue = inputElement.value;
            const caretPosition = selectionStart;

            wordStart = caretPosition;
            wordEnd = caretPosition;

            while (wordStart > 0 && /\w/.test(textValue[wordStart - 1])) {
              wordStart--;
            }
            while (
              wordEnd < textValue.length &&
              /\w/.test(textValue[wordEnd])
            ) {
              wordEnd++;
            }

            if (wordStart < wordEnd) {
              word = textValue.slice(wordStart, wordEnd);

              try {
                const electronAPI = (window as any).electronAPI;
                if (electronAPI?.spellCheck?.getSuggestions) {
                  wordSuggestions =
                    await electronAPI.spellCheck.getSuggestions(word);
                } else if ('webFrame' in (window as any)) {
                  const webFrame = (window as any).require?.(
                    'electron'
                  )?.webFrame;
                  if (webFrame?.getWordSuggestions) {
                    wordSuggestions = webFrame.getWordSuggestions(word) || [];
                  }
                }
              } catch (error) {
                console.warn('Spell check API error:', error);
              }
            }
          }
        }

        executeEvent('spellCheckContextMenuOpened', {
          instanceId: menuInstanceIdRef.current,
        });

        console.log('[SpellCheckContextMenu] Setting menu state:', {
          word,
          suggestions: wordSuggestions.slice(0, 5),
          hasEditor: !!editor,
          hasInput: !!inputElement,
        });

        setMenuPosition({ mouseX: event.clientX, mouseY: event.clientY });
        setAnchorElement(target);
        setSuggestions(wordSuggestions.slice(0, 5));
        setMisspelledWord(word);
        setWordRange(word ? { start: wordStart, end: wordEnd } : null);
      },
      [disabled, readOnly, inputRef, editorRef]
    );

    const handleClose = useCallback(() => {
      setMenuPosition(null);
      setAnchorElement(null);
      setSuggestions([]);
      setMisspelledWord(null);
      setWordRange(null);
    }, []);

    const replaceWord = useCallback(
      (newWord: string) => {
        const editor = editorRef?.current;
        const inputElement = inputRef?.current;

        if (editor && !editor.isDestroyed && wordRange) {
          // Use stored word range from context menu detection
          const { start: wordStart, end: wordEnd } = wordRange;

          editor
            .chain()
            .focus()
            .setTextSelection({ from: wordStart + 1, to: wordEnd + 1 })
            .deleteSelection()
            .insertContent(newWord)
            .run();
        } else if (inputElement) {
          // For input/textarea, recalculate from current selection
          const textValue = inputElement.value;
          const caretPosition = inputElement.selectionStart ?? 0;

          let wordStart = caretPosition;
          let wordEnd = caretPosition;

          while (wordStart > 0 && /\w/.test(textValue[wordStart - 1])) {
            wordStart--;
          }
          while (wordEnd < textValue.length && /\w/.test(textValue[wordEnd])) {
            wordEnd++;
          }

          const before = textValue.slice(0, wordStart);
          const after = textValue.slice(wordEnd);
          const newText = before + newWord + after;

          if (onTextChange) {
            onTextChange(newText);
          }

          inputElement.value = newText;

          const newCaretPosition = wordStart + newWord.length;
          inputElement.setSelectionRange(newCaretPosition, newCaretPosition);

          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        }

        handleClose();
      },
      [inputRef, editorRef, onTextChange, wordRange, handleClose]
    );

    const handleSuggestionClick = useCallback(
      (suggestion: string) => {
        replaceWord(suggestion);
      },
      [replaceWord]
    );

    const handleCut = useCallback(async () => {
      const editor = editorRef?.current;
      const inputElement = inputRef?.current;

      if (editor && !editor.isDestroyed) {
        const { from, to } = editor.state.selection;
        if (from === to) {
          handleClose();
          return;
        }

        const selectedText = editor.state.doc.textBetween(from, to);

        try {
          await navigator.clipboard.writeText(selectedText);
          editor.chain().focus().deleteSelection().run();
        } catch (error) {
          console.error('Cut failed:', error);
          executeEvent('showSnackbar', {
            message: t('reticulum:context_menu.clipboard_permission_denied', {
              postProcess: 'capitalizeFirstChar',
            }),
          });
        }
      } else if (inputElement) {
        const selectionStart = inputElement.selectionStart ?? 0;
        const selectionEnd = inputElement.selectionEnd ?? 0;

        if (selectionStart === selectionEnd) {
          handleClose();
          return;
        }

        const selectedText = inputElement.value.slice(
          selectionStart,
          selectionEnd
        );

        try {
          await navigator.clipboard.writeText(selectedText);
          const textValue = inputElement.value;
          const newText =
            textValue.slice(0, selectionStart) + textValue.slice(selectionEnd);

          if (onTextChange) {
            onTextChange(newText);
          }

          inputElement.value = newText;
          inputElement.setSelectionRange(selectionStart, selectionStart);
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (error) {
          console.error('Cut failed:', error);
          executeEvent('showSnackbar', {
            message: t('reticulum:context_menu.clipboard_permission_denied', {
              postProcess: 'capitalizeFirstChar',
            }),
          });
        }
      }

      handleClose();
    }, [inputRef, editorRef, onTextChange, handleClose, t]);

    const handleCopy = useCallback(async () => {
      const editor = editorRef?.current;
      const inputElement = inputRef?.current;

      if (editor && !editor.isDestroyed) {
        const { from, to } = editor.state.selection;
        if (from === to) {
          handleClose();
          return;
        }

        const selectedText = editor.state.doc.textBetween(from, to);

        try {
          await navigator.clipboard.writeText(selectedText);
        } catch (error) {
          console.error('Copy failed:', error);
          executeEvent('showSnackbar', {
            message: t('reticulum:context_menu.clipboard_permission_denied', {
              postProcess: 'capitalizeFirstChar',
            }),
          });
        }
      } else if (inputElement) {
        const selectionStart = inputElement.selectionStart ?? 0;
        const selectionEnd = inputElement.selectionEnd ?? 0;

        if (selectionStart === selectionEnd) {
          handleClose();
          return;
        }

        const selectedText = inputElement.value.slice(
          selectionStart,
          selectionEnd
        );

        try {
          await navigator.clipboard.writeText(selectedText);
        } catch (error) {
          console.error('Copy failed:', error);
          executeEvent('showSnackbar', {
            message: t('reticulum:context_menu.clipboard_permission_denied', {
              postProcess: 'capitalizeFirstChar',
            }),
          });
        }
      }

      handleClose();
    }, [inputRef, editorRef, handleClose, t]);

    const handlePaste = useCallback(async () => {
      const editor = editorRef?.current;
      const inputElement = inputRef?.current;

      try {
        const clipboardText = await navigator.clipboard.readText();

        if (editor && !editor.isDestroyed) {
          editor.chain().focus().insertContent(clipboardText).run();
        } else if (inputElement) {
          const selectionStart = inputElement.selectionStart ?? 0;
          const selectionEnd = inputElement.selectionEnd ?? 0;
          const textValue = inputElement.value;

          const newText =
            textValue.slice(0, selectionStart) +
            clipboardText +
            textValue.slice(selectionEnd);

          if (onTextChange) {
            onTextChange(newText);
          }

          inputElement.value = newText;
          const newCaretPosition = selectionStart + clipboardText.length;
          inputElement.setSelectionRange(newCaretPosition, newCaretPosition);
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch (error) {
        console.error('Paste failed:', error);
        executeEvent('showSnackbar', {
          message: t('reticulum:context_menu.clipboard_permission_denied', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
      }

      handleClose();
    }, [inputRef, editorRef, onTextChange, handleClose, t]);

    useEffect(() => {
      if (!menuPosition) return undefined;

      const closeOnEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          handleClose();
        }
      };

      const closeOnScroll = () => {
        handleClose();
      };

      document.addEventListener('keydown', closeOnEscape);
      document.addEventListener('scroll', closeOnScroll, true);

      return () => {
        document.removeEventListener('keydown', closeOnEscape);
        document.removeEventListener('scroll', closeOnScroll, true);
      };
    }, [menuPosition, handleClose]);

    const shortcutKey = isMac ? 'Cmd' : 'Ctrl';

    return (
      <>
        <div onContextMenu={handleContextMenu} style={{ display: 'contents' }}>
          {children}
        </div>

        <CustomStyledMenu
          open={Boolean(menuPosition)}
          onClose={handleClose}
          anchorReference="anchorPosition"
          anchorPosition={
            menuPosition
              ? { top: menuPosition.mouseY, left: menuPosition.mouseX }
              : undefined
          }
          reticulumMenu
        >
          {suggestions.length > 0 &&
            suggestions.map((suggestion) => (
              <MenuItem
                key={suggestion}
                onClick={() => handleSuggestionClick(suggestion)}
                sx={{
                  fontSize: '13px',
                  fontWeight: 600,
                  minHeight: 36,
                }}
              >
                <Typography variant="inherit">{suggestion}</Typography>
              </MenuItem>
            ))}

          {suggestions.length === 0 && misspelledWord && (
            <MenuItem disabled>
              <Typography variant="inherit">
                {t('reticulum:context_menu.no_suggestions')}
              </Typography>
            </MenuItem>
          )}

          {(suggestions.length > 0 || misspelledWord) && (
            <Divider sx={{ my: 0.5 }} />
          )}

          <MenuItem
            onClick={handleCut}
            sx={{ display: 'flex', justifyContent: 'space-between' }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <ContentCutIcon sx={{ mr: 1.5, fontSize: '18px' }} />
              <Typography variant="inherit">
                {t('reticulum:context_menu.cut')}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              {shortcutKey}+X
            </Typography>
          </MenuItem>

          <MenuItem
            onClick={handleCopy}
            sx={{ display: 'flex', justifyContent: 'space-between' }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <ContentCopyIcon sx={{ mr: 1.5, fontSize: '18px' }} />
              <Typography variant="inherit">
                {t('reticulum:context_menu.copy')}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              {shortcutKey}+C
            </Typography>
          </MenuItem>

          <MenuItem
            onClick={handlePaste}
            sx={{ display: 'flex', justifyContent: 'space-between' }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <ContentPasteIcon sx={{ mr: 1.5, fontSize: '18px' }} />
              <Typography variant="inherit">
                {t('reticulum:context_menu.paste')}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              {shortcutKey}+V
            </Typography>
          </MenuItem>
        </CustomStyledMenu>
      </>
    );
  }
);

SpellCheckContextMenu.displayName = 'SpellCheckContextMenu';
