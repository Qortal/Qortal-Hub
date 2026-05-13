import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Popover,
  Select,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded';
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined';
import BookmarkAddedIcon from '@mui/icons-material/BookmarkAdded';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ShortUniqueId from 'short-unique-id';
import { atomWithStorage } from 'jotai/utils';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { executeEvent } from '../../../utils/events';
import type {
  AppBookmark,
  AppBookmarkFolder,
  AppBookmarksForAddress,
  BookmarkableAppTab,
} from './bookmarkTypes';
import {
  buildBookmarkLink,
  findBookmarkForCandidate,
  getBookmarkCandidateFromTab,
  loadBookmarksForAddress,
  parseBookmarkLink,
  removeBookmark,
  removeFolder,
  saveBookmarksForAddress,
  upsertBookmark,
  upsertFolder,
} from './bookmarkStorage';

const uid = new ShortUniqueId({ length: 10 });
const BOOKMARK_VIEW_STORAGE_KEY = 'qortal_app_bookmark_view_by_address';
const bookmarkViewByAddressAtom = atomWithStorage<Record<string, string | null>>(
  BOOKMARK_VIEW_STORAGE_KEY,
  {}
);

type AppBookmarksButtonProps = {
  address?: string | null;
  buttonSx?: object;
  chromeBackground?: string;
  selectedTab: BookmarkableAppTab | null;
  tooltipSlotProps?: any;
  tooltipTitle?: (text: string) => React.ReactNode;
};

type BookmarkFormState = {
  id?: string;
  name: string;
  link: string;
  folderId: string | null;
  createdAt?: number;
};

const emptyData: AppBookmarksForAddress = {
  folders: [],
  bookmarks: [],
  updatedAt: Date.now(),
};

function increaseBackgroundOpacity(color: string): string {
  return color.replace(
    /rgba\(([^,]+),([^,]+),([^,]+),\s*([^)]+)\)/,
    (_match, red, green, blue) => `rgba(${red},${green},${blue}, 0.99)`
  );
}

export function AppBookmarksButton({
  address,
  buttonSx,
  chromeBackground,
  selectedTab,
  tooltipSlotProps,
  tooltipTitle,
}: AppBookmarksButtonProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<AppBookmarksForAddress>(emptyData);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [form, setForm] = useState<BookmarkFormState | null>(null);
  const [folderName, setFolderName] = useState('');
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] =
    useState<AppBookmarkFolder | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] =
    useState<AppBookmarkFolder | null>(null);
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [menuAnchorPosition, setMenuAnchorPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [moveMenuAnchorEl, setMoveMenuAnchorEl] =
    useState<HTMLElement | null>(null);
  const [menuTarget, setMenuTarget] = useState<
    | { type: 'bookmark'; bookmark: AppBookmark }
    | { type: 'folder'; folder: AppBookmarkFolder }
    | null
  >(null);
  const [viewByAddress, setViewByAddress] = useAtom(bookmarkViewByAddressAtom);

  const currentFolderId = address ? viewByAddress[address] || null : null;

  const candidate = useMemo(
    () => getBookmarkCandidateFromTab(selectedTab),
    [selectedTab]
  );
  const existingBookmark = useMemo(
    () => findBookmarkForCandidate(data.bookmarks, candidate),
    [candidate, data.bookmarks]
  );
  const isBookmarked = !!existingBookmark;
  const isOpen = Boolean(anchorEl);
  const isDark = theme.palette.mode === 'dark';
  const currentFolder =
    data.folders.find((folder) => folder.id === currentFolderId) || null;
  const bookmarkChromeBackground =
    increaseBackgroundOpacity(
      chromeBackground || (isDark ? 'rgb(33, 36, 42)' : 'rgb(223, 228, 235)')
    );
  const bookmarkFieldBackground =
    isDark
      ? 'rgba(28, 31, 37, 0.98)'
      : 'rgba(232, 236, 241, 0.96)';
  const bookmarkHoverBackground =
    isDark
      ? 'rgba(255, 255, 255, 0.07)'
      : 'rgba(0, 0, 0, 0.06)';
  const bookmarkInsetBackground =
    isDark
      ? 'rgba(28, 31, 37, 0.82)'
      : 'rgba(232, 236, 241, 0.88)';
  const bookmarkMenuPaperSx = {
    backgroundColor: bookmarkChromeBackground,
    backgroundImage: 'none',
    border: `1px solid ${theme.palette.border.subtle}`,
    borderRadius: '8px',
    color: theme.palette.text.primary,
    boxShadow:
      theme.palette.mode === 'dark'
        ? '0 16px 34px rgba(0,0,0,0.44)'
        : '0 16px 34px rgba(28,38,52,0.16)',
    minWidth: 174,
    p: 0.5,
    '.MuiList-root': {
      p: 0,
    },
  } as const;
  const bookmarkMenuItemSx = {
    borderRadius: '7px',
    color: theme.palette.text.primary,
    fontSize: 13,
    fontWeight: 500,
    gap: 1,
    minHeight: 36,
    px: 1.15,
    py: 0.75,
    '& .MuiSvgIcon-root': {
      color: theme.palette.text.secondary,
      flexShrink: 0,
      fontSize: 18,
      mr: 0,
    },
    '&:hover, &.Mui-focusVisible, &.Mui-selected, &.Mui-selected:hover': {
      backgroundColor: bookmarkHoverBackground,
    },
  } as const;
  const bookmarkMenuDangerItemSx = {
    ...bookmarkMenuItemSx,
    color: isDark ? '#F2C1C1' : theme.palette.error.main,
    '& .MuiSvgIcon-root': {
      color: isDark ? '#F2C1C1' : theme.palette.error.main,
      flexShrink: 0,
      fontSize: 18,
      mr: 0,
    },
  } as const;
  const bookmarkTextFieldSx = {
    '.MuiInputBase-root': {
      backgroundColor: bookmarkFieldBackground,
      borderRadius: '8px',
      fontSize: 13,
    },
    '.MuiOutlinedInput-notchedOutline': {
      borderColor: theme.palette.border.subtle,
    },
    '&:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: theme.palette.border.main,
    },
    '& .Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor:
        theme.palette.mode === 'dark'
          ? 'rgba(130, 185, 255, 0.42)'
          : 'rgba(41, 121, 218, 0.32)',
    },
  } as const;
  const bookmarkFieldLabelSx = {
    color: theme.palette.text.secondary,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.04em',
    lineHeight: 1,
    textTransform: 'uppercase',
  } as const;

  useEffect(() => {
    if (!address || !currentFolderId || !hasLoaded) return;
    const stillExists = data.folders.some((folder) => folder.id === currentFolderId);
    if (!stillExists) {
      setViewByAddress((prev) => ({ ...prev, [address]: null }));
    }
  }, [address, currentFolderId, data.folders, hasLoaded, setViewByAddress]);

  const setCurrentFolderId = (folderId: string | null) => {
    if (!address) return;
    setViewByAddress((prev) => ({ ...prev, [address]: folderId }));
    setForm(null);
    setShowCreateFolder(false);
    setRenamingFolder(null);
  };

  const persist = async (nextData: AppBookmarksForAddress) => {
    if (!address) {
      setData(nextData);
      return;
    }
    const saved = await saveBookmarksForAddress(address, nextData);
    setData(saved);
  };

  const openPopover = async (event: MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
    if (!address) return;

    setIsLoading(true);
    try {
      const loaded = await loadBookmarksForAddress(address);
      setData(loaded);
      setHasLoaded(true);
      const nextExisting = findBookmarkForCandidate(
        loaded.bookmarks,
        candidate
      );
      if (candidate && !nextExisting) {
        setForm({
          name: '',
          link: candidate.link,
          folderId: null,
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const closePopover = () => {
    setAnchorEl(null);
    setForm(null);
    setFolderName('');
    setShowCreateFolder(false);
    setRenamingFolder(null);
    setMenuAnchorEl(null);
    setMenuAnchorPosition(null);
    setMoveMenuAnchorEl(null);
    setMenuTarget(null);
  };

  const openBookmark = (bookmark: AppBookmark) => {
    executeEvent('addTab', {
      data: {
        service: bookmark.service,
        name: bookmark.appName,
        identifier: bookmark.identifier,
        path: bookmark.path
      },
    });
    executeEvent('open-apps-mode', {});
    closePopover();
  };

  const startAddCurrent = () => {
    if (!candidate) return;
    setForm({
      name: '',
      link: candidate.link,
      folderId: currentFolderId,
    });
  };

  const startEdit = (bookmark: AppBookmark) => {
    setForm({
      id: bookmark.id,
      name: bookmark.name,
      link: bookmark.link || buildBookmarkLink(bookmark),
      folderId: bookmark.folderId,
      createdAt: bookmark.createdAt,
    });
  };

  const saveBookmark = async () => {
    if (!form) return;

    const parsed = parseBookmarkLink(form.link);
    if (!form.name.trim() || !parsed) return;

    const now = Date.now();
    const bookmark: AppBookmark = {
      id: form.id || uid.rnd(),
      name: form.name.trim(),
      service: parsed.service,
      appName: parsed.appName,
      identifier: parsed.identifier,
      path: parsed.path,
      link: buildBookmarkLink(parsed),
      folderId: form.folderId,
      createdAt: form.createdAt || now,
      updatedAt: now,
    };

    await persist(upsertBookmark(data, bookmark));
    setForm(null);
  };

  const removeBookmarkById = async (bookmarkId: string) => {
    await persist(removeBookmark(data, bookmarkId));
    if (form?.id === bookmarkId) setForm(null);
  };

  const saveFolder = async () => {
    const trimmed = folderName.trim();
    if (!trimmed) return;

    const now = Date.now();
    await persist(
      upsertFolder(data, {
        id: uid.rnd(),
        name: trimmed,
        createdAt: now,
        updatedAt: now,
      })
    );
    setFolderName('');
    setShowCreateFolder(false);
  };

  const saveFolderRename = async () => {
    if (!renamingFolder) return;
    const trimmed = renamingFolder.name.trim();
    if (!trimmed) return;

    await persist(
      upsertFolder(data, {
        ...renamingFolder,
        name: trimmed,
        updatedAt: Date.now(),
      })
    );
    setRenamingFolder(null);
  };

  const moveBookmark = async (bookmark: AppBookmark, folderId: string) => {
    await persist(
      upsertBookmark(data, {
        ...bookmark,
        folderId: folderId || null,
        updatedAt: Date.now(),
      })
    );
  };

  const confirmDeleteFolder = async () => {
    if (!deleteFolderTarget) return;
    await persist(removeFolder(data, deleteFolderTarget.id));
    if (currentFolderId === deleteFolderTarget.id) {
      setCurrentFolderId(null);
    }
    setDeleteFolderTarget(null);
  };

  const deleteFolder = async (folder: AppBookmarkFolder) => {
    const hasBookmarks = data.bookmarks.some(
      (bookmark) => bookmark.folderId === folder.id
    );
    if (hasBookmarks) {
      setDeleteFolderTarget(folder);
      return;
    }
    await persist(removeFolder(data, folder.id));
    if (currentFolderId === folder.id) {
      setCurrentFolderId(null);
    }
  };

  const openItemMenu = (
    event: MouseEvent<HTMLElement>,
    target:
      | { type: 'bookmark'; bookmark: AppBookmark }
      | { type: 'folder'; folder: AppBookmarkFolder }
  ) => {
    event.stopPropagation();
    setMenuAnchorPosition(null);
    setMenuAnchorEl(event.currentTarget);
    setMenuTarget(target);
  };

  const openItemContextMenu = (
    event: MouseEvent<HTMLElement>,
    target:
      | { type: 'bookmark'; bookmark: AppBookmark }
      | { type: 'folder'; folder: AppBookmarkFolder }
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setMoveMenuAnchorEl(null);
    setMenuAnchorEl(null);
    setMenuAnchorPosition({ left: event.clientX + 2, top: event.clientY - 6 });
    setMenuTarget(target);
  };

  const closeItemMenu = () => {
    setMenuAnchorEl(null);
    setMenuAnchorPosition(null);
    setMenuTarget(null);
  };

  const closeMoveMenu = () => {
    setMoveMenuAnchorEl(null);
    setMenuTarget(null);
  };

  const renderBookmarkRow = (bookmark: AppBookmark) => (
    <ButtonBase
      key={bookmark.id}
      onClick={() => openBookmark(bookmark)}
      onContextMenu={(event) =>
        openItemContextMenu(event, { type: 'bookmark', bookmark })
      }
      sx={{
        alignItems: 'center',
        borderRadius: '8px',
        display: 'flex',
        gap: 1,
        justifyContent: 'flex-start',
        minHeight: 42,
        px: 1,
        py: 0.5,
        textAlign: 'left',
        width: '100%',
        '&:hover': {
          backgroundColor: bookmarkHoverBackground,
        },
      }}
    >
      <BookmarkBorderIcon
        sx={{ color: theme.palette.text.secondary, fontSize: 18 }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: 13,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {bookmark.name}
        </Typography>
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: 11.5,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {bookmark.link}
        </Typography>
      </Box>
      <Tooltip title={t('core:bookmarks.more')}>
        <IconButton
          size="small"
          onClick={(event) =>
            openItemMenu(event, { type: 'bookmark', bookmark })
          }
        >
          <MoreVertRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
    </ButtonBase>
  );

  const visibleBookmarks = data.bookmarks.filter(
    (bookmark) => (bookmark.folderId || null) === currentFolderId
  );
  const moveOptions =
    menuTarget?.type === 'bookmark'
      ? [
          ...(menuTarget.bookmark.folderId
            ? [{ id: '', name: t('core:bookmarks.top_level') }]
            : []),
          ...data.folders
            .filter((folder) => folder.id !== menuTarget.bookmark.folderId)
            .map((folder) => ({ id: folder.id, name: folder.name })),
        ]
      : [];
  const buttonTitle = isBookmarked
    ? t('core:bookmarks.bookmarked')
    : t('core:bookmarks.title');

  return (
    <>
      <Tooltip
        arrow
        placement="bottom"
        slotProps={tooltipSlotProps}
        title={tooltipTitle ? tooltipTitle(buttonTitle) : buttonTitle}
      >
        <span>
          <ButtonBase
            disableRipple
            onClick={openPopover}
            disabled={!address}
            sx={{
              ...buttonSx,
              color: isBookmarked
                ? theme.palette.primary.main
                : theme.palette.text.primary,
              opacity: address ? 1 : 0.32,
            }}
          >
            {isBookmarked ? (
              <BookmarkAddedIcon sx={{ fontSize: 18 }} />
            ) : (
              <BookmarkAddOutlinedIcon sx={{ fontSize: 18 }} />
            )}
          </ButtonBase>
        </span>
      </Tooltip>

      <Popover
        open={isOpen}
        anchorEl={anchorEl}
        onClose={closePopover}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        slotProps={{
          paper: {
            sx: {
              backgroundColor: bookmarkChromeBackground,
              backgroundImage: 'none',
              border: `1px solid ${theme.palette.border.subtle}`,
              borderRadius: '8px',
              boxShadow:
                theme.palette.mode === 'dark'
                  ? '0 18px 42px rgba(0,0,0,0.42)'
                  : '0 18px 42px rgba(28,38,52,0.16)',
              mt: 1,
              overflow: 'hidden',
              width: 460,
            },
          },
        }}
      >
        <Box sx={{ p: 2 }}>
          <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
            {currentFolder && (
              <IconButton size="small" onClick={() => setCurrentFolderId(null)}>
                <ArrowBackIosNewRoundedIcon sx={{ fontSize: 15 }} />
              </IconButton>
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 16, fontWeight: 700 }}>
                {currentFolder?.name || t('core:bookmarks.title')}
              </Typography>
              {currentFolder && (
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: 11.5,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('core:bookmarks.folder')}
                </Typography>
              )}
            </Box>
            {!currentFolder && (
              <Tooltip title={t('core:bookmarks.create_folder')}>
                <IconButton
                  size="small"
                  onClick={() => {
                    setShowCreateFolder((prev) => !prev);
                    setForm(null);
                  }}
                >
                  <CreateNewFolderOutlinedIcon sx={{ fontSize: 19 }} />
                </IconButton>
              </Tooltip>
            )}
            {candidate && (
              <Button
                disabled={!!form}
                size="small"
                startIcon={
                  isBookmarked ? <BookmarkAddedIcon /> : <BookmarkAddOutlinedIcon />
                }
                onClick={() =>
                  existingBookmark ? startEdit(existingBookmark) : startAddCurrent()
                }
                sx={{ borderRadius: '8px', textTransform: 'none' }}
                variant={isBookmarked ? 'outlined' : 'contained'}
              >
                {isBookmarked
                  ? t('core:bookmarks.bookmarked')
                  : t('core:bookmarks.add_page')}
              </Button>
            )}
          </Box>

          {isLoading && (
            <Typography sx={{ color: theme.palette.text.secondary, mt: 2 }}>
              {t('core:bookmarks.loading')}
            </Typography>
          )}

          {!isLoading && showCreateFolder && !currentFolder && (
            <Box
              sx={{
                alignItems: 'flex-end',
                display: 'flex',
                gap: 1,
                mt: 2,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  flex: 1,
                  flexDirection: 'column',
                  gap: 0.75,
                  minWidth: 0,
                }}
              >
                <Typography sx={bookmarkFieldLabelSx}>
                  {t('core:bookmarks.folder_name')}
                </Typography>
                <TextField
                  autoFocus
                  fullWidth
                  placeholder={t('core:bookmarks.new_folder')}
                  size="small"
                  sx={bookmarkTextFieldSx}
                  value={folderName}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      saveFolder();
                    }
                  }}
                  onChange={(e) => setFolderName(e.target.value)}
                />
              </Box>
              <Tooltip
                title={t('core:action.cancel', {
                  postProcess: 'capitalizeFirstChar',
                })}
              >
                <IconButton
                  onClick={() => {
                    setShowCreateFolder(false);
                    setFolderName('');
                  }}
                  size="small"
                  sx={{
                    border: `1px solid ${theme.palette.border.subtle}`,
                    borderRadius: '8px',
                    height: 40,
                    width: 40,
                  }}
                >
                  <CloseRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
              <Button
                onClick={saveFolder}
                sx={{
                  borderRadius: '8px',
                  height: 40,
                  textTransform: 'none',
                }}
                variant="outlined"
              >
                {t('core:bookmarks.create')}
              </Button>
            </Box>
          )}

          {!isLoading && form && (
            <Box
              sx={{
                backgroundColor: bookmarkInsetBackground,
                border: `1px solid ${theme.palette.border.subtle}`,
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                mt: 2,
                p: 1.75,
              }}
            >
              <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
                <BookmarkBorderIcon
                  sx={{ color: theme.palette.text.secondary, fontSize: 18 }}
                />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>
                    {form.id
                      ? t('core:bookmarks.edit_bookmark')
                      : t('core:bookmarks.add_bookmark')}
                  </Typography>
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: 11.5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('core:bookmarks.save_location_without_query')}
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <Typography sx={bookmarkFieldLabelSx}>
                  {t('core:bookmarks.name')}
                </Typography>
                <TextField
                  fullWidth
                  placeholder={t('core:bookmarks.bookmark_name_placeholder')}
                  size="small"
                  sx={bookmarkTextFieldSx}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <Typography sx={bookmarkFieldLabelSx}>
                  {t('core:bookmarks.qortal_link')}
                </Typography>
                <TextField
                  fullWidth
                  placeholder={t('core:bookmarks.qortal_link_placeholder')}
                  size="small"
                  sx={bookmarkTextFieldSx}
                  value={form.link}
                  onChange={(e) => setForm({ ...form, link: e.target.value })}
                />
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <Typography sx={bookmarkFieldLabelSx}>
                  {t('core:bookmarks.folder')}
                </Typography>
                <Select
                  displayEmpty
                  fullWidth
                  size="small"
                  sx={{
                    backgroundColor: bookmarkFieldBackground,
                    borderRadius: '8px',
                    fontSize: 13,
                    '.MuiSelect-select': {
                      alignItems: 'center',
                      color: theme.palette.text.primary,
                      display: 'flex',
                      minHeight: '1.4375em',
                      py: '9px',
                    },
                    '.MuiOutlinedInput-notchedOutline': {
                      borderColor: theme.palette.border.subtle,
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: theme.palette.border.main,
                    },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                      borderColor:
                        theme.palette.mode === 'dark'
                          ? 'rgba(130, 185, 255, 0.42)'
                          : 'rgba(41, 121, 218, 0.32)',
                    },
                  }}
                  value={form.folderId || ''}
                  renderValue={() => {
                    const selectedFolder = form.folderId
                      ? data.folders.find((folder) => folder.id === form.folderId)
                      : null;
                    return (
                      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
                        <FolderOutlinedIcon
                          sx={{
                            color: theme.palette.text.secondary,
                            fontSize: 17,
                          }}
                        />
                        <Typography sx={{ fontSize: 13, fontWeight: 500 }}>
                          {selectedFolder?.name || t('core:bookmarks.top_level')}
                        </Typography>
                      </Box>
                    );
                  }}
                  onChange={(e) =>
                    setForm({ ...form, folderId: e.target.value || null })
                  }
                >
                  <MenuItem value="">{t('core:bookmarks.top_level')}</MenuItem>
                  {data.folders.map((folder) => (
                    <MenuItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </MenuItem>
                  ))}
                </Select>
              </Box>

              <Divider sx={{ borderColor: theme.palette.border.subtle }} />

              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                {form.id && (
                  <Button
                    color="error"
                    startIcon={<DeleteOutlineIcon />}
                    onClick={() => removeBookmarkById(form.id!)}
                    size="small"
                    sx={{
                      borderRadius: '8px',
                      mr: 'auto',
                      textTransform: 'none',
                    }}
                    variant="outlined"
                  >
                    {t('core:bookmarks.remove')}
                  </Button>
                )}
                <Button
                  onClick={() => setForm(null)}
                  size="small"
                  sx={{
                    borderRadius: '8px',
                    color: theme.palette.text.secondary,
                    textTransform: 'none',
                  }}
                >
                  {t('core:action.cancel', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
                <Button
                  onClick={saveBookmark}
                  size="small"
                  sx={{
                    borderRadius: '8px',
                    minWidth: 72,
                    textTransform: 'none',
                  }}
                  variant="contained"
                >
                  {t('core:action.save', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
              </Box>
            </Box>
          )}

          {!isLoading && hasLoaded && (
            <>
              <Divider sx={{ my: 1.5 }} />

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {!currentFolder &&
                  data.folders.map((folder) => {
                    const count = data.bookmarks.filter(
                      (bookmark) => bookmark.folderId === folder.id
                    ).length;
                    return (
                      <ButtonBase
                        key={folder.id}
                        onClick={() => setCurrentFolderId(folder.id)}
                        onContextMenu={(event) =>
                          openItemContextMenu(event, { type: 'folder', folder })
                        }
                        sx={{
                          alignItems: 'center',
                          borderRadius: '8px',
                          display: 'flex',
                          gap: 1,
                          justifyContent: 'flex-start',
                          minHeight: 42,
                          px: 1,
                          py: 0.5,
                          textAlign: 'left',
                          width: '100%',
                          '&:hover': {
                            backgroundColor: bookmarkHoverBackground,
                          },
                        }}
                      >
                        <FolderOutlinedIcon
                          sx={{
                            color: theme.palette.text.secondary,
                            fontSize: 19,
                          }}
                        />
                        {renamingFolder?.id === folder.id ? (
                          <TextField
                            autoFocus
                            fullWidth
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') saveFolderRename();
                            }}
                            size="small"
                            sx={bookmarkTextFieldSx}
                            value={renamingFolder.name}
                            onChange={(e) =>
                              setRenamingFolder({
                                ...renamingFolder,
                                name: e.target.value,
                              })
                            }
                          />
                        ) : (
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                              sx={{
                                fontSize: 13,
                                fontWeight: 700,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {folder.name}
                            </Typography>
                            <Typography
                              sx={{
                                color: theme.palette.text.secondary,
                                fontSize: 11.5,
                              }}
                            >
                              {t('core:bookmarks.bookmark_count', { count })}
                            </Typography>
                          </Box>
                        )}
                        {renamingFolder?.id === folder.id ? (
                          <Button
                            onClick={(event) => {
                              event.stopPropagation();
                              saveFolderRename();
                            }}
                            size="small"
                            sx={{ textTransform: 'none' }}
                          >
                            {t('core:action.save', {
                              postProcess: 'capitalizeFirstChar',
                            })}
                          </Button>
                        ) : (
                          <IconButton
                            size="small"
                            onClick={(event) =>
                              openItemMenu(event, { type: 'folder', folder })
                            }
                          >
                            <MoreVertRoundedIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                        )}
                      </ButtonBase>
                    );
                  })}

                {visibleBookmarks.map(renderBookmarkRow)}

                {visibleBookmarks.length === 0 &&
                  (currentFolder || data.folders.length === 0) && (
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: 13,
                      py: 3,
                      textAlign: 'center',
                    }}
                  >
                    {currentFolder
                      ? t('core:bookmarks.no_bookmarks_folder')
                      : t('core:bookmarks.no_bookmarks')}
                  </Typography>
                )}
              </Box>
            </>
          )}
        </Box>
      </Popover>

      <Menu
        anchorEl={menuAnchorEl}
        anchorPosition={menuAnchorPosition || undefined}
        anchorReference={menuAnchorPosition ? 'anchorPosition' : 'anchorEl'}
        open={Boolean(menuAnchorEl) || Boolean(menuAnchorPosition)}
        onClose={closeItemMenu}
        slotProps={{
          paper: {
            sx: bookmarkMenuPaperSx,
          },
        }}
      >
        {menuTarget?.type === 'bookmark' && [
          <MenuItem
            key="edit"
            sx={bookmarkMenuItemSx}
            onClick={() => {
              startEdit(menuTarget.bookmark);
              closeItemMenu();
            }}
          >
            <EditOutlinedIcon />
            {t('core:bookmarks.edit')}
          </MenuItem>,
          ...(moveOptions.length > 0
            ? [
                <MenuItem
                  key="move"
                  sx={bookmarkMenuItemSx}
                  onClick={(event) => {
                    setMoveMenuAnchorEl(event.currentTarget);
                    setMenuAnchorEl(null);
                  }}
                >
                  <DriveFileMoveOutlinedIcon />
                  {t('core:bookmarks.move')}
                </MenuItem>,
              ]
            : []),
          <MenuItem
            key="delete"
            sx={bookmarkMenuDangerItemSx}
            onClick={() => {
              removeBookmarkById(menuTarget.bookmark.id);
              closeItemMenu();
            }}
          >
            <DeleteOutlineIcon />
            {t('core:bookmarks.delete')}
          </MenuItem>,
        ]}
        {menuTarget?.type === 'folder' && [
          <MenuItem
            key="rename"
            sx={bookmarkMenuItemSx}
            onClick={() => {
              setRenamingFolder(menuTarget.folder);
              closeItemMenu();
            }}
          >
            <EditOutlinedIcon />
            {t('core:bookmarks.rename')}
          </MenuItem>,
          <MenuItem
            key="delete"
            sx={bookmarkMenuDangerItemSx}
            onClick={() => {
              deleteFolder(menuTarget.folder);
              closeItemMenu();
            }}
          >
            <DeleteOutlineIcon />
            {t('core:bookmarks.delete')}
          </MenuItem>,
        ]}
      </Menu>

      <Menu
        anchorEl={moveMenuAnchorEl}
        open={Boolean(moveMenuAnchorEl)}
        onClose={closeMoveMenu}
        slotProps={{
          paper: {
            sx: bookmarkMenuPaperSx,
          },
        }}
      >
        {menuTarget?.type === 'bookmark' &&
          moveOptions.map((option) => (
            <MenuItem
              key={option.id || 'root'}
              sx={bookmarkMenuItemSx}
              onClick={() => {
                moveBookmark(menuTarget.bookmark, option.id);
                closeMoveMenu();
              }}
            >
              {option.name}
            </MenuItem>
          ))}
      </Menu>

      <Dialog
        open={!!deleteFolderTarget}
        onClose={() => setDeleteFolderTarget(null)}
        aria-labelledby="delete-bookmark-folder-title"
        aria-describedby="delete-bookmark-folder-description"
        PaperProps={{
          sx: isDark
            ? {
                bgcolor: '#111820',
                backgroundImage: 'none',
                border: `1px solid ${alpha('#A9BCD8', 0.18)}`,
                borderRadius: '18px',
                boxShadow: `0 24px 58px ${alpha('#000', 0.42)}`,
                maxWidth: 360,
                width: 'calc(100% - 40px)',
              }
            : {
                bgcolor: theme.palette.background.paper,
                backgroundImage: 'none',
                border: `1px solid ${theme.palette.border.subtle}`,
                borderRadius: '18px',
                boxShadow: `0 22px 48px ${alpha('#000', 0.09)}, 0 0 0 1px ${alpha(theme.palette.divider, 0.45)}`,
                color: theme.palette.text.primary,
                maxWidth: 360,
                width: 'calc(100% - 40px)',
              },
        }}
      >
        <DialogTitle
          id="delete-bookmark-folder-title"
          sx={{
            color: theme.palette.text.primary,
            fontSize: '1.08rem',
            fontWeight: 650,
            pb: 0.8,
            pt: 2.3,
            textAlign: 'center',
          }}
        >
          {t('core:bookmarks.delete_folder_title')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText
            id="delete-bookmark-folder-description"
            sx={{
              color: isDark
                ? alpha(theme.palette.text.secondary, 0.9)
                : theme.palette.text.secondary,
              fontSize: '0.88rem',
              lineHeight: 1.48,
              textAlign: 'center',
            }}
          >
            {t('core:bookmarks.delete_folder_message')}
          </DialogContentText>
        </DialogContent>
        <DialogActions
          sx={{ gap: 1, justifyContent: 'center', px: 2.3, pb: 2.3 }}
        >
          <Button
            onClick={() => setDeleteFolderTarget(null)}
            sx={
              isDark
                ? {
                    border: `1px solid ${alpha('#A9BCD8', 0.16)}`,
                    borderRadius: '10px',
                    color: theme.palette.text.secondary,
                    fontWeight: 600,
                    minWidth: 116,
                    textTransform: 'none',
                    '&:hover': {
                      bgcolor: alpha('#FFFFFF', 0.045),
                    },
                  }
                : {
                    border: `1px solid ${theme.palette.border.main}`,
                    borderRadius: '10px',
                    color: theme.palette.text.primary,
                    fontWeight: 600,
                    minWidth: 116,
                    textTransform: 'none',
                    '&:hover': {
                      bgcolor: theme.palette.action.hover,
                      borderColor: theme.palette.border.main,
                    },
                  }
            }
          >
            {t('core:action.cancel', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
          <Button
            onClick={confirmDeleteFolder}
            variant="contained"
            sx={{
              bgcolor: theme.palette.error.main,
              borderRadius: '10px',
              color: theme.palette.error.contrastText,
              fontWeight: 600,
              minWidth: 116,
              textTransform: 'none',
              '&:hover': {
                bgcolor: theme.palette.error.dark,
              },
            }}
          >
            {t('core:bookmarks.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
