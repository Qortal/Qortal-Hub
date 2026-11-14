import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AppBookmarkFolder } from '../AppBookmarks/bookmarkTypes';

interface LauncherDeleteFolderDialogProps {
  /** The folder that is about to be deleted, or null while nothing is asked. */
  folder: AppBookmarkFolder | null;
  onCancel: () => void;
  onConfirm: (folder: AppBookmarkFolder) => void;
}

/**
 * Asks before a folder that holds something is deleted, with the question
 * the bookmarks menu asks: it is the same folder.
 */
export const LauncherDeleteFolderDialog = ({
  folder,
  onCancel,
  onConfirm,
}: LauncherDeleteFolderDialogProps) => {
  const { t } = useTranslation(['core']);

  return (
    <Dialog
      aria-describedby="launcher-delete-folder-text"
      aria-labelledby="launcher-delete-folder-title"
      onClose={onCancel}
      open={!!folder}
      slotProps={{
        paper: { sx: { borderRadius: '16px', maxWidth: 360 } },
      }}
    >
      <DialogTitle id="launcher-delete-folder-title">
        {t('core:bookmarks.delete_folder_title')}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="launcher-delete-folder-text">
          {t('core:bookmarks.delete_folder_message')}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ padding: '8px 20px 16px' }}>
        <Button
          color="inherit"
          onClick={onCancel}
          sx={{ textTransform: 'none' }}
        >
          {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
        </Button>
        <Button
          color="error"
          onClick={() => folder && onConfirm(folder)}
          sx={{ textTransform: 'none' }}
          variant="contained"
        >
          {t('core:bookmarks.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
