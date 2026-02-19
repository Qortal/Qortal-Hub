import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Editor, EditorProvider, useCurrentEditor } from '@tiptap/react';
import { Fragment, Slice } from '@tiptap/pm/model';
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
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';

const MenuBar = memo(
  ({
    setEditorRef,
    isChat,
    isDisabledEditorEnter,
    setIsDisabledEditorEnter,
    toolbarStyle = 'default',
  }) => {
    const { editor } = useCurrentEditor();
    const fileInputRef = useRef(null);
    const theme = useTheme();
    const { t } = useTranslation([
      'auth',
      'core',
      'group',
      'question',
      'tutorial',
    ]);

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
    }, [editor, isChat]);

    return (
      <Box
        sx={{
          backgroundColor: isChat
            ? 'transparent'
            : theme.palette.background.paper,
          border: isChat ? 'none' : '1px solid',
          borderBottom: isChat ? '1px solid' : undefined,
          borderColor: theme.palette.divider,
          borderRadius: isChat ? '8px 8px 0 0' : '10px 10px 0 0',
          padding: isChat ? '8px 10px 10px' : '6px 10px 8px',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '2px',
          }}
        >
          <IconButton
            size="small"
            onClick={() => editor.chain().focus().toggleBold().run()}
            disabled={!editor.can().chain().focus().toggleBold().run()}
            sx={{
              color: editor.isActive('bold')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: '4px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <FormatBoldIcon sx={{ fontSize: '20px' }} />
          </IconButton>

          <IconButton
            size="small"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            disabled={!editor.can().chain().focus().toggleItalic().run()}
            sx={{
              color: editor.isActive('italic')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: '4px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <FormatItalicIcon sx={{ fontSize: '20px' }} />
          </IconButton>

          <IconButton
            size="small"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            disabled={!editor.can().chain().focus().toggleStrike().run()}
            sx={{
              color: editor.isActive('strike')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: '4px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <StrikethroughSIcon sx={{ fontSize: '20px' }} />
          </IconButton>

          <IconButton
            size="small"
            onClick={() => editor.chain().focus().toggleCode().run()}
            disabled={!editor.can().chain().focus().toggleCode().run()}
            sx={{
              color: editor.isActive('code')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: '4px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <CodeIcon sx={{ fontSize: '20px' }} />
          </IconButton>

          <IconButton
            size="small"
            onClick={() => editor.chain().focus().unsetAllMarks().run()}
            sx={{
              color:
                editor.isActive('bold') ||
                editor.isActive('italic') ||
                editor.isActive('strike') ||
                editor.isActive('code')
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary,
              padding: '4px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <FormatClearIcon sx={{ fontSize: '20px' }} />
          </IconButton>

          <IconButton
            size="small"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            sx={{
              color: editor.isActive('bulletList')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: '4px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <FormatListBulletedIcon sx={{ fontSize: '20px' }} />
          </IconButton>

          <IconButton
            size="small"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            sx={{
              color: editor.isActive('orderedList')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: '4px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <FormatListNumberedIcon sx={{ fontSize: '20px' }} />
          </IconButton>

          <IconButton
            size="small"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            sx={{
              color: editor.isActive('codeBlock')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: '4px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <DeveloperModeIcon sx={{ fontSize: '20px' }} />
          </IconButton>

          <IconButton
            size="small"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            sx={{
              color: editor.isActive('blockquote')
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: '4px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <FormatQuoteIcon sx={{ fontSize: '20px' }} />
          </IconButton>

          <IconButton
            size="small"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            disabled={!editor.can().chain().focus().setHorizontalRule().run()}
            sx={{
              color: theme.palette.text.secondary,
              padding: '4px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <HorizontalRuleIcon sx={{ fontSize: '20px' }} />
          </IconButton>

          <IconButton
            size="small"
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            }
            sx={{
              color: editor.isActive('heading', { level: 1 })
                ? theme.palette.text.primary
                : theme.palette.text.secondary,
              padding: '4px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <FormatHeadingIcon sx={{ fontSize: '20px' }} />
          </IconButton>

          <IconButton
            size="small"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().chain().focus().undo().run()}
            sx={{
              color: theme.palette.text.secondary,
              padding: '4px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <UndoIcon sx={{ fontSize: '20px' }} />
          </IconButton>

          <IconButton
            size="small"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().chain().focus().redo().run()}
            sx={{
              color: theme.palette.text.secondary,
              padding: '4px',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
          >
            <RedoIcon sx={{ fontSize: '20px' }} />
          </IconButton>

          {isChat && (
            <Box
              sx={{
                alignItems: 'center',
                borderLeft: '1px solid',
                borderColor: theme.palette.divider,
                cursor: 'pointer',
                display: 'flex',
                marginLeft: '8px',
                paddingLeft: '8px',
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
                size="small"
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
                  fontSize: '13px',
                  color: theme.palette.text.secondary,
                }}
              >
                {t('core:action.disable_enter', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Box>
          )}

          {!isChat && (
            <>
              <IconButton
                size="small"
                onClick={triggerImageUpload}
                sx={{
                  color: theme.palette.text.secondary,
                  padding: '4px',
                  '&:hover': {
                    backgroundColor: theme.palette.action.hover,
                    color: theme.palette.text.primary,
                  },
                }}
              >
                <ImageIcon sx={{ fontSize: '20px' }} />
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
        </Box>
      </Box>
    );
  }
);

const extensions = [
  TextStyle,
  Color.configure({ types: [TextStyle.name, ListItem.name] }),
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
    placeholder: i18n.t('core:action.start_typing', {
      postProcess: 'capitalizeFirstChar',
    }),
  }),
  ImageResize,
];

const content = ``;

type TiptapProps = {
  setEditorRef: (editorInstance: Editor | null) => void;
  onEnter: () => void | Promise<void>;
  disableEnter?: boolean;
  isChat?: boolean;
  /** Use chat-style composer (single bar, minimal border) without chat-only behavior (e.g. announcements keep image) */
  composerStyle?: boolean;
  maxHeightOffset?: number;
  overrideMobile?: boolean;
  customEditorHeight?: number | null;
  setIsFocusedParent: React.Dispatch<React.SetStateAction<boolean>>;
  isFocusedParent: boolean;
  membersWithNames?: unknown[];
  enableMentions?: boolean;
  insertImage?: (image: any) => void;
};

const Tiptap = ({
  setEditorRef,
  onEnter,
  disableEnter = false,
  isChat = false,
  composerStyle = false,
  maxHeightOffset,
  setIsFocusedParent,
  isFocusedParent,
  overrideMobile,
  customEditorHeight,
  membersWithNames = [],
  enableMentions,
  insertImage,
}: TiptapProps) => {
  const theme = useTheme();
  const [isDisabledEditorEnter, setIsDisabledEditorEnter] = useAtom(
    isDisabledEditorEnterAtom
  );

  const handleImageUpload = useCallback(
    async (file) => {
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
                compressedFile = result;
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
        }
      } catch (error) {
        console.error(error);
      }
    },
    [insertImage]
  );

  const extensionsFiltered = isChat
    ? extensions.filter((item) => item?.name !== 'image')
    : extensions;
  const editorRef = useRef(null);
  const setEditorRefFunc = useCallback((editorInstance) => {
    editorRef.current = editorInstance;
    setEditorRef(editorInstance);
  }, []);

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

  const useComposerLook = isChat || composerStyle;
  return (
    <Box
      className={useComposerLook ? 'tiptap-chat-composer' : undefined}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        justifyContent: 'space-between',
        '--text-primary': theme.palette.text.primary,
        '--text-secondary': theme.palette.text.secondary,
        '--background-default': theme.palette.background.default,
        '--background-secondary': theme.palette.background.paper,
        ...(useComposerLook && {
          '--composer-bg': theme.palette.background.default,
          '--composer-border': theme.palette.divider,
        }),
      }}
    >
      <EditorProvider
        slotBefore={
          <MenuBar
            setEditorRef={setEditorRefFunc}
            isChat={isChat}
            isDisabledEditorEnter={isDisabledEditorEnter}
            setIsDisabledEditorEnter={handleSetIsDisabledEditorEnter}
            toolbarStyle={useComposerLook ? 'chat' : 'default'}
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
            if (!isChat) return false;
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

            // Preserve paragraph spacing when pasting plain text (double newline = new paragraph)
            const text = event.clipboardData?.getData('text/plain');
            if (text != null && text !== '') {
              event.preventDefault();
              const schema = view.state.schema;
              const paragraphs = text.split(/\n\n+/);
              const paragraphNodes = paragraphs.map((block) => {
                if (block === '') {
                  return schema.nodes.paragraph.create(null, Fragment.empty);
                }
                const parts = block.split('\n');
                const content = parts.flatMap((t, i) =>
                  i === 0
                    ? [schema.text(t)]
                    : [
                        schema.nodes.hardBreak.create(),
                        schema.text(t),
                      ]
                );
                return schema.nodes.paragraph.create(
                  null,
                  Fragment.from(content)
                );
              });
              const fragment = Fragment.from(paragraphNodes);
              const slice = new Slice(fragment, 0, 0);
              view.dispatch(view.state.tr.replaceSelection(slice));
              return true;
            }

            return false; // fallback to default behavior otherwise
          },
        }}
      />
    </Box>
  );
};

export default Tiptap;
