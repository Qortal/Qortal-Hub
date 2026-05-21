import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  dialogActionsSx,
  dialogContentSx,
  dialogContentTextSx,
  dialogTitleSx,
  getDialogPaperSx,
  getDialogPrimaryButtonSx,
} from './dialogSurface';

type InfoDialogProps = {
  open: boolean;
  message: string;
  onClose: () => void;
};

export function InfoDialog({ open, message, onClose }: InfoDialogProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'tutorial']);

  return (
    <Dialog
      open={open}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
      PaperProps={{
        sx: getDialogPaperSx(theme, { maxWidth: 420 }),
      }}
    >
      <DialogTitle
        id="alert-dialog-title"
        sx={dialogTitleSx}
      >
        {t('tutorial:important_info', { postProcess: 'capitalizeAll' })}
      </DialogTitle>
      <DialogContent sx={dialogContentSx}>
        <DialogContentText
          id="alert-dialog-description"
          sx={dialogContentTextSx}
        >
          {message}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={dialogActionsSx}>
        <Button
          variant="contained"
          onClick={onClose}
          autoFocus
          sx={getDialogPrimaryButtonSx(theme)}
        >
          {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
