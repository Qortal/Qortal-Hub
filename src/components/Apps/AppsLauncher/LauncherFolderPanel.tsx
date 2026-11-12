import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useRef,
  useState,
} from 'react';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import FolderDeleteOutlinedIcon from '@mui/icons-material/FolderDeleteOutlined';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import { Box, IconButton, InputBase, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AppBookmarkFolder } from '../AppBookmarks/bookmarkTypes';
import { FOLDER_NAME_MAX_LENGTH } from './launcherItems';

interface LauncherFolderPanelProps {
  folder: AppBookmarkFolder;
  /** How many tiles the folder shows. */
  count: number;
  isRenaming: boolean;
  onRenameStart: () => void;
  /** Called with the new name, or with null when renaming was given up. */
  onRenameEnd: (name: string | null) => void;
  onDelete: () => void;
  onClose: () => void;
  /** True while a dragged tile would land in the folder's free space. */
  isDropTarget?: boolean;
  /** Set on the area that takes drops. */
  bodyRef?: Ref<HTMLDivElement>;
  /** The folder's tiles. */
  children: ReactNode;
}

/**
 * A bookmark folder shown open under the row of tiles, so what is in it is
 * one click away. It stays open, also the next time, until it is closed. Its
 * header renames and deletes the folder; what was in it stays on the launcher.
 */
export const LauncherFolderPanel = ({
  folder,
  count,
  isRenaming,
  onRenameStart,
  onRenameEnd,
  onDelete,
  onClose,
  isDropTarget = false,
  bodyRef,
  children,
}: LauncherFolderPanelProps) => {
  const { t } = useTranslation(['core']);
  const [draftName, setDraftName] = useState(folder.name);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Escape gives up; the blur that follows must not save.
  const gaveUpRef = useRef(false);

  useEffect(() => {
    if (!isRenaming) return;
    gaveUpRef.current = false;
    setDraftName(folder.name);
    // Selected, so typing replaces the name.
    const input = inputRef.current;
    input?.focus();
    input?.select();
    // Only when renaming starts.
  }, [isRenaming]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      inputRef.current?.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      gaveUpRef.current = true;
      inputRef.current?.blur();
    }
  };

  const folderNameLabel = t('core:bookmarks.folder_name');
  const renameLabel = t('core:bookmarks.rename');
  const deleteLabel = t('core:launcher.folder_delete', {
    postProcess: 'capitalizeFirstChar',
  });
  const closeLabel = t('core:action.close', {
    postProcess: 'capitalizeFirstChar',
  });

  return (
    <Box
      aria-label={folder.name}
      role="group"
      sx={(theme) => ({
        backgroundColor: theme.palette.background.paper,
        border: `1px solid ${
          isDropTarget ? theme.palette.primary.main : theme.palette.divider
        }`,
        borderRadius: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: '8px 12px 8px',
        transition: 'border-color 120ms ease',
        width: '100%',
      })}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: '4px',
          minHeight: 34,
        }}
      >
        {isRenaming ? (
          <InputBase
            inputProps={{
              'aria-label': folderNameLabel,
              maxLength: FOLDER_NAME_MAX_LENGTH,
            }}
            inputRef={inputRef}
            onBlur={() => onRenameEnd(gaveUpRef.current ? null : draftName)}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={folderNameLabel}
            sx={(theme) => ({
              backgroundColor: theme.palette.background.default,
              border: `1px solid ${theme.palette.primary.main}`,
              borderRadius: '8px',
              flex: '0 1 280px',
              fontSize: '14px',
              fontWeight: 600,
              padding: '1px 8px',
            })}
            value={draftName}
          />
        ) : (
          <Typography
            component="h3"
            onDoubleClick={onRenameStart}
            sx={(theme) => ({
              color: theme.palette.text.primary,
              fontSize: '14px',
              fontWeight: 600,
              margin: 0,
              overflowWrap: 'anywhere',
            })}
          >
            {folder.name}
          </Typography>
        )}
        <Typography
          component="span"
          sx={(theme) => ({
            color: theme.palette.text.secondary,
            flex: 1,
            fontSize: '13px',
            paddingLeft: '4px',
          })}
        >
          {count}
        </Typography>
        <Tooltip title={renameLabel}>
          <IconButton
            aria-label={renameLabel}
            onClick={onRenameStart}
            size="small"
            sx={(theme) => ({ color: theme.palette.text.secondary })}
          >
            <DriveFileRenameOutlineIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={deleteLabel}>
          <IconButton
            aria-label={deleteLabel}
            onClick={onDelete}
            size="small"
            sx={(theme) => ({ color: theme.palette.text.secondary })}
          >
            <FolderDeleteOutlinedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={closeLabel}>
          <IconButton
            aria-label={closeLabel}
            onClick={onClose}
            size="small"
            sx={(theme) => ({ color: theme.palette.text.secondary })}
          >
            <KeyboardArrowUpRoundedIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box ref={bodyRef} sx={{ minHeight: 60, width: '100%' }}>
        {count === 0 ? (
          <Typography
            sx={(theme) => ({
              color: theme.palette.text.secondary,
              fontSize: '13px',
              padding: '8px 0',
            })}
          >
            {t('core:bookmarks.no_bookmarks_folder')}
          </Typography>
        ) : (
          children
        )}
      </Box>
    </Box>
  );
};
