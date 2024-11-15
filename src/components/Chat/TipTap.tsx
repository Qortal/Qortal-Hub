import React, { useEffect, useMemo, useRef, useState } from "react";
import { EditorProvider, useCurrentEditor, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Color } from "@tiptap/extension-color";
import ListItem from "@tiptap/extension-list-item";
import TextStyle from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import IconButton from "@mui/material/IconButton";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import StrikethroughSIcon from "@mui/icons-material/StrikethroughS";
import FormatClearIcon from "@mui/icons-material/FormatClear";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import CodeIcon from "@mui/icons-material/Code";
import ImageIcon from "@mui/icons-material/Image"; // Import Image icon
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";
import HorizontalRuleIcon from "@mui/icons-material/HorizontalRule";
import UndoIcon from "@mui/icons-material/Undo";
import RedoIcon from "@mui/icons-material/Redo";
import FormatHeadingIcon from "@mui/icons-material/FormatSize";
import DeveloperModeIcon from "@mui/icons-material/DeveloperMode";
import Compressor from "compressorjs";
import Mention from '@tiptap/extension-mention';
import ImageResize from "tiptap-extension-resize-image"; // Import the ResizeImage extension
import { isMobile } from "../../App";
import tippy from "tippy.js";
import "tippy.js/dist/tippy.css";
import Popover from '@mui/material/Popover';
import List from '@mui/material/List';
import ListItemMui from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { ReactRenderer } from '@tiptap/react'
import MentionList from './MentionList.jsx'

function textMatcher(doc, from) {
  const textBeforeCursor = doc.textBetween(0, from, ' ', ' ');
  const match = textBeforeCursor.match(/@[\w]*$/); // Match '@' followed by valid characters
  if (!match) return null;

  const start = from - match[0].length;
  const query = match[0];
  return { start, query };
}
const MenuBar = ({ setEditorRef, isChat }) => {
  const { editor } = useCurrentEditor();
  const fileInputRef = useRef(null);

  if (!editor) {
    return null;
  }

  useEffect(() => {
    if (editor && setEditorRef) {
      setEditorRef(editor);
    }
  }, [editor, setEditorRef]);

  const handleImageUpload = async (file) => {
    let compressedFile;
    await new Promise<void>((resolve) => {
      new Compressor(file, {
        quality: 0.6,
        maxWidth: 1200,
        mimeType: "image/webp",
        success(result) {
          compressedFile = new File([result], "image.webp", {
            type: "image/webp",
          });
          resolve();
        },
        error(err) {
          console.error("Image compression error:", err);
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
          .setImage({ src: url, style: "width: auto" })
          .run();
        fileInputRef.current.value = "";
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
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault(); // Prevent the default paste behavior
          handleImageUpload(file); // Call the image upload function
        }
      }
    }
  };

  useEffect(() => {
    if (editor) {
      editor.view.dom.addEventListener("paste", handlePaste);
      return () => {
        editor.view.dom.removeEventListener("paste", handlePaste);
      };
    }
  }, [editor]);

  return (
    <div className="control-group">
      <div className="button-group">
        <IconButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editor.can().chain().focus().toggleBold().run()}
          sx={{
            color: editor.isActive("bold") ? "white" : "gray",
            padding: isMobile ? "5px" : "revert",
          }}
        >
          <FormatBoldIcon />
        </IconButton>
        <IconButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editor.can().chain().focus().toggleItalic().run()}
          sx={{
            color: editor.isActive("italic") ? "white" : "gray",
            padding: isMobile ? "5px" : "revert",
          }}
        >
          <FormatItalicIcon />
        </IconButton>
        <IconButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          disabled={!editor.can().chain().focus().toggleStrike().run()}
          sx={{
            color: editor.isActive("strike") ? "white" : "gray",
            padding: isMobile ? "5px" : "revert",
          }}
        >
          <StrikethroughSIcon />
        </IconButton>
        <IconButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          disabled={!editor.can().chain().focus().toggleCode().run()}
          sx={{
            color: editor.isActive("code") ? "white" : "gray",
            padding: isMobile ? "5px" : "revert",
          }}
        >
          <CodeIcon />
        </IconButton>
        <IconButton
          onClick={() => editor.chain().focus().unsetAllMarks().run()}
          sx={{
            color:
              editor.isActive("bold") ||
              editor.isActive("italic") ||
              editor.isActive("strike") ||
              editor.isActive("code")
                ? "white"
                : "gray",
            padding: isMobile ? "5px" : "revert",
          }}
        >
          <FormatClearIcon />
        </IconButton>
        <IconButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          sx={{
            color: editor.isActive("bulletList") ? "white" : "gray",
            padding: isMobile ? "5px" : "revert",
          }}
        >
          <FormatListBulletedIcon />
        </IconButton>
        <IconButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          sx={{
            color: editor.isActive("orderedList") ? "white" : "gray",
            padding: isMobile ? "5px" : "revert",
          }}
        >
          <FormatListNumberedIcon />
        </IconButton>
        <IconButton
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          sx={{
            color: editor.isActive("codeBlock") ? "white" : "gray",
            padding: isMobile ? "5px" : "revert",
          }}
        >
          <DeveloperModeIcon />
        </IconButton>
        <IconButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          sx={{
            color: editor.isActive("blockquote") ? "white" : "gray",
            padding: isMobile ? "5px" : "revert",
          }}
        >
          <FormatQuoteIcon />
        </IconButton>
        <IconButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          disabled={!editor.can().chain().focus().setHorizontalRule().run()}
          sx={{ color: "gray", padding: isMobile ? "5px" : "revert" }}
        >
          <HorizontalRuleIcon />
        </IconButton>
        <IconButton
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          sx={{
            color: editor.isActive("heading", { level: 1 }) ? "white" : "gray",
            padding: isMobile ? "5px" : "revert",
          }}
        >
          <FormatHeadingIcon fontSize="small" />
        </IconButton>
        <IconButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().chain().focus().undo().run()}
          sx={{ color: "gray", padding: isMobile ? "5px" : "revert" }}
        >
          <UndoIcon />
        </IconButton>
        <IconButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().chain().focus().redo().run()}
          sx={{ color: "gray" }}
        >
          <RedoIcon />
        </IconButton>
        {!isChat && (
          <>
            <IconButton
              onClick={triggerImageUpload}
              sx={{ color: "gray", padding: isMobile ? "5px" : "revert" }}
            >
              <ImageIcon />
            </IconButton>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: "none" }}
              onChange={(event) => handleImageUpload(event.target.files[0])}
              accept="image/*"
            />
          </>
        )}
      </div>
    </div>
  );
};

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
    placeholder: "Start typing here...",
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
  enableMentions
}) => {

  const extensionsFiltered = isChat
    ? extensions.filter((item) => item?.name !== "image")
    : extensions;
  const editorRef = useRef(null);
  const setEditorRefFunc = (editorInstance) => {
    editorRef.current = editorInstance;
    setEditorRef(editorInstance);
  };

  // const users = [
  //   { id: 1, label: 'Alice' },
  //   { id: 2, label: 'Bob' },
  //   { id: 3, label: 'Charlie' },
  // ];



  const users = useMemo(()=> {
    return (membersWithNames || [])?.map((item)=> {
      return {
        id: item,
        label: item
      }
    })
  }, [membersWithNames])





  const usersRef = useRef([]);
  useEffect(() => {
    usersRef.current = users; // Keep users up-to-date
  }, [users]);

  const handleFocus = () => {
    if (!isMobile) return;
    setIsFocusedParent(true);
  };

  const handleBlur = () => {
    const htmlContent = editorRef.current.getHTML();
    if (!htmlContent?.trim() || htmlContent?.trim() === "<p></p>") {
      // Set focus state based on content
    }
  };

  const additionalExtensions = useMemo(()=> {
    if(!enableMentions) return []
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
            onStart: props => {
              component = new ReactRenderer(MentionList, {
                props,
                editor: props.editor,
              })
      
              if (!props.clientRect) {
                return
              }
      
              popup = tippy('body', {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              })
            },
      
            onUpdate(props) {
              component.updateProps(props)
      
              if (!props.clientRect) {
                return
              }
      
              popup[0].setProps({
                getReferenceClientRect: props.clientRect,
              })
            },
      
            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                popup[0].hide()
      
                return true
              }
      
              return component.ref?.onKeyDown(props)
            },
      
            onExit() {
              popup[0].destroy()
              component.destroy()
            },
           }
          },
        },
      })
    ]
  }, [enableMentions])

  return (
    <div>
    <EditorProvider
      slotBefore={
        (isFocusedParent || !isMobile || overrideMobile) && (
          <MenuBar setEditorRef={setEditorRefFunc} isChat={isChat} />
        )
      }
      extensions={[...extensionsFiltered,   ...additionalExtensions
    ]}
      content={content}
      onCreate={({ editor }) => {
        editor.on("focus", handleFocus); // Listen for focus event
        editor.on("blur", handleBlur); // Listen for blur event
      }}
      onUpdate={({ editor }) => {
      editor.on('focus', handleFocus);   // Ensure focus is updated
      editor.on('blur', handleBlur);     // Ensure blur is updated
    }}
      editorProps={{
        attributes: {
          class: "tiptap-prosemirror",
          style:
            isMobile ?
            `overflow: auto; min-height: ${
              customEditorHeight ? "200px" : "0px"
            }; max-height:calc(100svh - ${customEditorHeight || "140px"})`: `overflow: auto; max-height: 250px`,
        },
        handleKeyDown(view, event) {
          if (!disableEnter && event.key === "Enter") {
            if (event.shiftKey) {
              view.dispatch(
                view.state.tr.replaceSelectionWith(
                  view.state.schema.nodes.hardBreak.create()
                )
              );
              return true;
            } else {
              if (typeof onEnter === "function") {
                onEnter();
              }
              return true;
            }
          }
          return false;
        },
      }}
    />
    </div>

  );
};
