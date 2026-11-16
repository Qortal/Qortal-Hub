import { useEffect, useRef } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import { useTranslation } from 'react-i18next';
import type { TorqDocNode } from './torqRichText';

type TorqTextEditorProps = {
  /** Read once on mount; later changes flow out through onChange. */
  initialDoc: TorqDocNode;
  disabled?: boolean;
  onChange: (doc: TorqDocNode) => void;
};

/**
 * Torq body editor: Enter starts a paragraph (Torq shows a gap), Shift+Enter
 * breaks a line, and the toolbar covers what Torq publishes as rich text.
 */
export const TorqTextEditor = ({
  initialDoc,
  disabled = false,
  onChange,
}: TorqTextEditorProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const placeholder = t('core:torq_composer.placeholder');

  const editor = useEditor({
    // It mounts as the composer opens: start typing right away.
    autofocus: 'end',
    content: initialDoc,
    editable: !disabled,
    editorProps: {
      attributes: {
        'aria-label': placeholder,
        'aria-multiline': 'true',
        role: 'textbox',
      },
    },
    extensions: [
      StarterKit.configure({
        blockquote: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        strike: false,
      }),
      Underline,
      Placeholder.configure({ placeholder }),
    ],
    onUpdate: ({ editor: current }) => {
      onChangeRef.current(current.getJSON() as TorqDocNode);
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  const label = (key: string) =>
    t(`core:torq_composer.${key}`, { postProcess: 'capitalizeFirstChar' });

  const tools = [
    {
      key: 'bold',
      icon: <FormatBoldIcon fontSize="small" />,
      label: label('format_bold'),
      active: editor?.isActive('bold'),
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      key: 'italic',
      icon: <FormatItalicIcon fontSize="small" />,
      label: label('format_italic'),
      active: editor?.isActive('italic'),
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      key: 'underline',
      icon: <FormatUnderlinedIcon fontSize="small" />,
      label: label('format_underline'),
      active: editor?.isActive('underline'),
      run: () => editor?.chain().focus().toggleUnderline().run(),
    },
    {
      key: 'bullet',
      icon: <FormatListBulletedIcon fontSize="small" />,
      label: label('format_bullet_list'),
      active: editor?.isActive('bulletList'),
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      key: 'ordered',
      icon: <FormatListNumberedIcon fontSize="small" />,
      label: label('format_numbered_list'),
      active: editor?.isActive('orderedList'),
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
  ];

  const isDark = theme.palette.mode === 'dark';

  return (
    <Box
      sx={{
        backgroundColor: isDark
          ? alpha(theme.palette.common.white, 0.03)
          : alpha(theme.palette.common.black, 0.02),
        border: `1px solid ${alpha(theme.palette.text.primary, isDark ? 0.23 : 0.2)}`,
        borderRadius: '12px',
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
        overflow: 'hidden',
        '&:focus-within': {
          borderColor: theme.palette.primary.main,
          boxShadow: `inset 0 0 0 1px ${theme.palette.primary.main}`,
        },
      }}
    >
      <Box
        sx={{
          borderBottom: `1px solid ${theme.palette.divider}`,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.25,
          px: 0.75,
          py: 0.25,
        }}
      >
        {tools.map((tool) => (
          <Tooltip key={tool.key} title={tool.label}>
            <span>
              <IconButton
                size="small"
                aria-label={tool.label}
                aria-pressed={Boolean(tool.active)}
                disabled={disabled || !editor}
                // Keep the editor selection when the button takes the click.
                onMouseDown={(event) => event.preventDefault()}
                onClick={tool.run}
                sx={{
                  borderRadius: '8px',
                  color: tool.active
                    ? theme.palette.primary.main
                    : theme.palette.text.secondary,
                  backgroundColor: tool.active
                    ? alpha(theme.palette.primary.main, 0.12)
                    : 'transparent',
                }}
              >
                {tool.icon}
              </IconButton>
            </span>
          </Tooltip>
        ))}
      </Box>
      <Box
        sx={{
          cursor: 'text',
          fontSize: 14,
          lineHeight: 1.55,
          maxHeight: 240,
          minHeight: 88,
          overflowY: 'auto',
          px: 1.5,
          py: 1,
          '& .tiptap': {
            color: theme.palette.text.primary,
            minHeight: 68,
            outline: 'none',
            overflowWrap: 'anywhere',
          },
          // Mirror how Torq renders the published post.
          '& .tiptap p': { margin: 0 },
          '& .tiptap p + p': { marginTop: '0.75em' },
          '& .tiptap ul, & .tiptap ol': { margin: '0.35em 0', pl: '1.4em' },
          '& .tiptap li p': { margin: 0 },
          '& .tiptap p.is-editor-empty:first-of-type::before': {
            color: theme.palette.text.secondary,
            content: 'attr(data-placeholder)',
            float: 'left',
            height: 0,
            pointerEvents: 'none',
            whiteSpace: 'pre-line',
          },
        }}
        onClick={() => editor?.chain().focus().run()}
      >
        <EditorContent editor={editor} />
      </Box>
    </Box>
  );
};
