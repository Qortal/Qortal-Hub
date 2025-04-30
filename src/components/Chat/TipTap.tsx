import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { EditorProvider, useCurrentEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Color } from '@tiptap/extension-color';
import ListItem from '@tiptap/extension-list-item';
import TextStyle from '@tiptap/extension-text-style';
import Placeholder from '@tiptap/extension-placeholder';
import IconButton from '@mui/material/IconButton';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS';
import FormatClearIcon from '@mui/icons-material/FormatClear';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import CodeIcon from '@mui/icons-material/Code';
import ImageIcon from '@mui/icons-material/Image'; // Import Image icon
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import FormatHeadingIcon from '@mui/icons-material/FormatSize';
import DeveloperModeIcon from '@mui/icons-material/DeveloperMode';
import Compressor from 'compressorjs';
import Mention from '@tiptap/extension-mention';
import ImageResize from 'tiptap-extension-resize-image'; // Import the ResizeImage extension
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import { ReactRenderer } from '@tiptap/react';
import MentionList from './MentionList.jsx';
import { isDisabledEditorEnterAtom } from '../../atoms/global.js';
import { Box, Checkbox, Typography, useTheme } from '@mui/material';
import { useAtom } from 'jotai';
import { fileToBase64 } from '../../utils/fileReading/index.js';

function textMatcher(doc, from) {
  const textBeforeCursor = doc.textBetween(0, from, ' ', ' ');
  const match = textBeforeCursor.match(/@[\w]*$/); // Match '@' followed by valid characters
  if (!match) return null;

  const start = from - match[0].length;
  const query = match[0];
  return { start, query };
}

const MenuBar = React.memo(
  ({
    setEditorRef,
    isChat,
    isDisabledEditorEnter,
    setIsDisabledEditorEnter,
  }) => {
    const { editor } = useCurrentEditor();
    const fileInputRef = useRef(null);
    const theme = useTheme();

    useEffect(() => {
      if (editor && setEditorRef) {
        setEditorRef(editor);
      }
    }, [editor, setEditorRef]);

    if (!editor) {
      return null;
    }

    const handleImageUpload = async (file) => {
      let compressedFile;
      await new Promise<void>((resolve) => {
        new Compressor(file, {
          quality: 0.6,
          maxWidth: 1200,
          mimeType: 'image/webp',
          success(result) {
            compressedFile = new File([result], 'image.webp', {
              type: 'image/webp',
            });
            resolve();
          },
          error(err) {
            console.error('Image compression error:', err);
          },
        });
      });

      if (compressedFile) {
        const reader = new FileReader();
        reader.onload = () => {
          const url = reader.result;
          editor
            .chain()
            .focus()
            .setImage({ src: url, style: 'width: auto' })
            .run();
          fileInputRef.current.value = '';
        };
        reader.readAsDataURL(compressedFile);
      }
    };

    const triggerImageUpload = () => {
      fileInputRef.current.click(); // Trigger the file input click
    };

    const handlePaste = (event) => {
      const items = event.clipboardData.items;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault(); // Prevent the default paste behavior
            handleImageUpload(file); // Call the image upload function
          }
        }
      }
    };

    useEffect(() => {
      if (editor && !isChat) {
        editor.view.dom.addEventListener('paste', handlePaste);
        return () => {
          editor.view.dom.removeEventListener('paste', handlePaste);
        };
      }
    }, [editor]);

    return (
      <div className="control-group">
        <div
          className="button-group"
          style={{
            display: 'flex',
          }}
        >
          <IconButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            disabled={!editor.can().chain().focus().toggleBold().run()}
            sx={{
              color: editor.isActive('bold')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: 'revert',
            }}
          >
            <FormatBoldIcon />
          </IconButton>
          <IconButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            disabled={!editor.can().chain().focus().toggleItalic().run()}
            sx={{
              color: editor.isActive('italic')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: 'revert',
            }}
          >
            <FormatItalicIcon />
          </IconButton>
          <IconButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            disabled={!editor.can().chain().focus().toggleStrike().run()}
            sx={{
              color: editor.isActive('strike')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: 'revert',
            }}
          >
            <StrikethroughSIcon />
          </IconButton>
          <IconButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            disabled={!editor.can().chain().focus().toggleCode().run()}
            sx={{
              color: editor.isActive('code')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: 'revert',
            }}
          >
            <CodeIcon />
          </IconButton>
          <IconButton
            onClick={() => editor.chain().focus().unsetAllMarks().run()}
            sx={{
              color:
                editor.isActive('bold') ||
                editor.isActive('italic') ||
                editor.isActive('strike') ||
                editor.isActive('code')
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary,
              padding: 'revert',
            }}
          >
            <FormatClearIcon />
          </IconButton>
          <IconButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            sx={{
              color: editor.isActive('bulletList')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: 'revert',
            }}
          >
            <FormatListBulletedIcon />
          </IconButton>
          <IconButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            sx={{
              color: editor.isActive('orderedList')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: 'revert',
            }}
          >
            <FormatListNumberedIcon />
          </IconButton>
          <IconButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            sx={{
              color: editor.isActive('codeBlock')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: 'revert',
            }}
          >
            <DeveloperModeIcon />
          </IconButton>
          <IconButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            sx={{
              color: editor.isActive('blockquote')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: 'revert',
            }}
          >
            <FormatQuoteIcon />
          </IconButton>
          <IconButton
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            disabled={!editor.can().chain().focus().setHorizontalRule().run()}
            sx={{ color: 'gray', padding: 'revert' }}
          >
            <HorizontalRuleIcon />
          </IconButton>
          <IconButton
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            }
            sx={{
              color: editor.isActive('heading', { level: 1 })
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: 'revert',
            }}
          >
            <FormatHeadingIcon fontSize="small" />
          </IconButton>
          <IconButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().chain().focus().undo().run()}
            sx={{ color: 'gray', padding: 'revert' }}
          >
            <UndoIcon />
          </IconButton>
          <IconButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().chain().focus().redo().run()}
            sx={{ color: 'gray' }}
          >
            <RedoIcon />
          </IconButton>
          {isChat && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                marginLeft: '5px',
                cursor: 'pointer',
              }}
              onClick={() => {
                setIsDisabledEditorEnter(!isDisabledEditorEnter);
              }}
            >
              <Checkbox
                edge="start"
                tabIndex={-1}
                disableRipple
                checked={isDisabledEditorEnter}
                sx={{
                  '&.Mui-checked': {
                    color: theme.palette.text.secondary,
                  },
                  '& .MuiSvgIcon-root': {
                    color: theme.palette.text.secondary,
                  },
                }}
              />
              <Typography
                sx={{
                  fontSize: '14px',
                  color: theme.palette.text.primary,
                }}
              >
                disable enter
              </Typography>
            </Box>
          )}
          {!isChat && (
            <>
              <IconButton
                onClick={triggerImageUpload}
                sx={{
                  color: theme.palette.text.secondary,
                  padding: 'revert',
                }}
              >
                <ImageIcon />
              </IconButton>
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={(event) => handleImageUpload(event.target.files[0])}
                accept="image/*"
              />
            </>
          )}
        </div>
      </div>
    );
  }
);

const extensions = [
  Color.configure({ types: [TextStyle.name, ListItem.name] }),
  TextStyle.configure({ types: [ListItem.name] }),
  StarterKit.configure({
    bulletList: {
      keepMarks: true,
      keepAttributes: false,
    },
    orderedList: {
      keepMarks: true,
      keepAttributes: false,
    },
  }),
  Placeholder.configure({
    placeholder: 'Start typing here...',
  }),
  ImageResize,
];

const content = ``;

export default ({
  setEditorRef,
  onEnter,
  disableEnter,
  isChat,
  maxHeightOffset,
  setIsFocusedParent,
  isFocusedParent,
  overrideMobile,
  customEditorHeight,
  membersWithNames,
  enableMentions,
  insertImage,
}) => {
  const theme = useTheme();
  const [isDisabledEditorEnter, setIsDisabledEditorEnter] = useAtom(
    isDisabledEditorEnterAtom
  );

  const handleImageUpload = async (file) => {
    try {
      if (!file.type.includes('image')) return;
      let compressedFile = file;
      if (file.type !== 'image/gif') {
        await new Promise<void>((resolve) => {
          new Compressor(file, {
            quality: 0.6,
            maxWidth: 1200,
            mimeType: 'image/webp',
            success(result) {
              compressedFile = new File([result], 'image.webp', {
                type: 'image/webp',
              });
              resolve();
            },
            error(err) {
              console.error('Image compression error:', err);
            },
          });
        });
      }

      if (compressedFile) {
        const toBase64 = await fileToBase64(compressedFile);
        insertImage(toBase64);
        console.log('toBase64', toBase64);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const extensionsFiltered = isChat
    ? extensions.filter((item) => item?.name !== 'image')
    : extensions;
  const editorRef = useRef(null);
  const setEditorRefFunc = useCallback((editorInstance) => {
    editorRef.current = editorInstance;
    setEditorRef(editorInstance);
  }, []);

  // const users = [
  //   { id: 1, label: 'Alice' },
  //   { id: 2, label: 'Bob' },
  //   { id: 3, label: 'Charlie' },
  // ];

  const users = useMemo(() => {
    return (membersWithNames || [])?.map((item) => {
      return {
        id: item,
        label: item,
      };
    });
  }, [membersWithNames]);

  const usersRef = useRef([]);
  useEffect(() => {
    usersRef.current = users; // Keep users up-to-date
  }, [users]);

  const handleBlur = () => {
    const htmlContent = editorRef.current.getHTML();
    if (!htmlContent?.trim() || htmlContent?.trim() === '<p></p>') {
      // Set focus state based on content
    }
  };

  const additionalExtensions = useMemo(() => {
    if (!enableMentions) return [];
    return [
      Mention.configure({
        HTMLAttributes: {
          class: 'mention',
        },
        suggestion: {
          items: ({ query }) => {
            if (!query) return usersRef?.current;
            return usersRef?.current?.filter((user) =>
              user.label.toLowerCase().includes(query.toLowerCase())
            );
          },
          render: () => {
            let popup; // Reference to the Tippy.js instance
            let component;

            return {
              onStart: (props) => {
                component = new ReactRenderer(MentionList, {
                  props,
                  editor: props.editor,
                });

                if (!props.clientRect) {
                  return;
                }

                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                });
              },

              onUpdate(props) {
                component.updateProps(props);

                if (!props.clientRect) {
                  return;
                }

                popup[0].setProps({
                  getReferenceClientRect: props.clientRect,
                });
              },

              onKeyDown(props) {
                if (props.event.key === 'Escape') {
                  popup[0].hide();

                  return true;
                }

                return component.ref?.onKeyDown(props);
              },

              onExit() {
                popup[0].destroy();
                component.destroy();
              },
            };
          },
        },
      }),
    ];
  }, [enableMentions]);

  const handleSetIsDisabledEditorEnter = useCallback((val) => {
    setIsDisabledEditorEnter(val);
    localStorage.setItem('settings-disable-editor-enter', JSON.stringify(val));
  }, []);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        justifyContent: 'space-between',
        '--text-primary': theme.palette.text.primary,
        '--text-secondary': theme.palette.text.secondary,
        '--background-default': theme.palette.background.default,
        '--background-secondary': theme.palette.background.paper,
      }}
    >
      <EditorProvider
        slotBefore={
          <MenuBar
            setEditorRef={setEditorRefFunc}
            isChat={isChat}
            isDisabledEditorEnter={isDisabledEditorEnter}
            setIsDisabledEditorEnter={handleSetIsDisabledEditorEnter}
          />
        }
        extensions={[...extensionsFiltered, ...additionalExtensions]}
        content={content}
        onCreate={({ editor }) => {
          editor.on('blur', handleBlur); // Listen for blur event
        }}
        onUpdate={({ editor }) => {
          editor.on('blur', handleBlur); // Ensure blur is updated
        }}
        editorProps={{
          attributes: {
            class: 'tiptap-prosemirror',
            style: `overflow: auto; max-height: 250px`,
          },
          handleKeyDown(view, event) {
            if (
              !disableEnter &&
              !isDisabledEditorEnter &&
              event.key === 'Enter'
            ) {
              if (event.shiftKey) {
                view.dispatch(
                  view.state.tr.replaceSelectionWith(
                    view.state.schema.nodes.hardBreak.create()
                  )
                );
                return true;
              } else {
                if (typeof onEnter === 'function') {
                  onEnter();
                }
                return true;
              }
            }
            return false;
          },
          handlePaste(view, event) {
            if (!isChat) return;
            const items = event.clipboardData?.items;
            if (!items) return false;

            for (const item of items) {
              if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                  event.preventDefault(); // Block the default paste
                  handleImageUpload(file); // Custom handler
                  return true; // Let ProseMirror know we handled it
                }
              }
            }

            return false; // fallback to default behavior otherwise
          },
        }}
      />
    </Box>
  );
};
