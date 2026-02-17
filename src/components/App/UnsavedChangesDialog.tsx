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

type UnsavedChangesDialogProps = {
  open: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function UnsavedChangesDialog({
  open,
  message,
  onCancel,
  onConfirm,
}: UnsavedChangesDialogProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  return (
    <Dialog
      open={open}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
    >
      <DialogTitle
        id="alert-dialog-title"
        sx={{
          textAlign: 'center',
          color: theme.palette.text.primary,
          fontWeight: 'bold',
          opacity: 1,
        }}
      >
        {t('core:action.logout', { postProcess: 'capitalizeAll' })}
      </DialogTitle>
      <DialogContent>
        <DialogContentText
          id="alert-dialog-description"
          sx={{ textAlign: 'center' }}
        >
          {message}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button
          variant="contained"
          onClick={onCancel}
          sx={{
            backgroundColor: theme.palette.other.danger,
            color: theme.palette.text.primary,
            fontWeight: 'bold',
            opacity: 0.7,
            '&:hover': {
              backgroundColor: theme.palette.other.danger,
              color: 'black',
              opacity: 1,
            },
          }}
        >
          {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
        </Button>
        <Button
          variant="contained"
          onClick={onConfirm}
          autoFocus
          sx={{
            backgroundColor: theme.palette.other.positive,
            color: theme.palette.text.primary,
            fontWeight: 'bold',
            opacity: 0.7,
            '&:hover': {
              backgroundColor: theme.palette.other.positive,
              color: 'black',
              opacity: 1,
            },
          }}
        >
          {t('core:action.continue_logout', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
