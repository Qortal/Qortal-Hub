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
        {t('tutorial:important_info', { postProcess: 'capitalizeAll' })}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="alert-dialog-description">
          {message}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose} autoFocus>
          {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
