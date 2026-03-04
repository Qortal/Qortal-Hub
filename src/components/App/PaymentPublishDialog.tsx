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

type Message = {
  message: string;
  paymentFee?: string;
  publishFee?: string;
};

type PaymentPublishDialogProps = {
  open: boolean;
  message: Message;
  onAccept: () => void;
  onCancel: () => void;
};

export function PaymentPublishDialog({
  open,
  message,
  onAccept,
  onCancel,
}: PaymentPublishDialogProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  return (
    <Dialog
      open={open}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
      sx={{ zIndex: 10001 }}
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
        {message.paymentFee
          ? t('core:payment', { postProcess: 'capitalizeFirstChar' })
          : t('core:publish', { postProcess: 'capitalizeFirstChar' })}
      </DialogTitle>
      <DialogContent>
        <DialogContentText id="alert-dialog-description">
          {message.message}
        </DialogContentText>
        {message?.paymentFee && (
          <DialogContentText id="alert-dialog-description2">
            {t('core:fee.payment', { postProcess: 'capitalizeFirstChar' })}:{' '}
            {message.paymentFee}
          </DialogContentText>
        )}
        {message?.publishFee && (
          <DialogContentText id="alert-dialog-description2">
            {t('core:fee.publish', { postProcess: 'capitalizeFirstChar' })}:{' '}
            {message.publishFee}
          </DialogContentText>
        )}
      </DialogContent>
      <DialogActions>
        <Button
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
          variant="contained"
          onClick={onAccept}
          autoFocus
        >
          {t('core:action.accept', { postProcess: 'capitalizeFirstChar' })}
        </Button>
        <Button
          sx={{
            backgroundColor: theme.palette.other.danger,
            color: 'black',
            fontWeight: 'bold',
            opacity: 0.7,
            '&:hover': {
              backgroundColor: theme.palette.other.danger,
              color: 'black',
              opacity: 1,
            },
          }}
          variant="contained"
          onClick={onCancel}
        >
          {t('core:action.decline', { postProcess: 'capitalizeFirstChar' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
