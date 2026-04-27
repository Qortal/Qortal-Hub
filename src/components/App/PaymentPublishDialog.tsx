import {
  Box,
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
      PaperProps={{
        sx: {
          background: '#121821',
          backgroundImage: 'none',
          border: '1px solid rgba(169,188,216,0.18)',
          borderRadius: '18px',
          boxShadow: '0 26px 56px rgba(0,0,0,0.44)',
          color: theme.palette.text.primary,
          minWidth: 360,
          overflow: 'hidden',
        },
      }}
      sx={{ zIndex: 10001 }}
    >
      <DialogTitle
        id="alert-dialog-title"
        sx={{
          borderBottom: '1px solid rgba(169,188,216,0.1)',
          color: theme.palette.text.primary,
          fontSize: '1.1rem',
          fontWeight: 650,
          px: 3,
          py: 2.2,
          textAlign: 'center',
        }}
      >
        {message.paymentFee
          ? t('core:payment', { postProcess: 'capitalizeFirstChar' })
          : t('core:publish', { postProcess: 'capitalizeFirstChar' })}
      </DialogTitle>
      <DialogContent sx={{ px: 3, py: 2.5 }}>
        <DialogContentText
          id="alert-dialog-description"
          sx={{
            color: 'rgba(232,236,244,0.88)',
            fontSize: '1rem',
            lineHeight: 1.55,
            mb: 2,
            textAlign: 'left',
          }}
        >
          {message.message}
        </DialogContentText>
        {(message?.paymentFee || message?.publishFee) && (
          <Box
            sx={{
              backgroundColor: 'rgba(255,255,255,0.028)',
              border: '1px solid rgba(169,188,216,0.12)',
              borderRadius: '14px',
              display: 'grid',
              gap: 0.8,
              px: 1.6,
              py: 1.35,
            }}
          >
            {message?.paymentFee && (
              <DialogContentText
                id="alert-dialog-description2"
                sx={{
                  color: 'rgba(214,221,233,0.78)',
                  fontSize: '0.88rem',
                  lineHeight: 1.5,
                  m: 0,
                }}
              >
                {t('core:fee.payment', { postProcess: 'capitalizeFirstChar' })}:{' '}
                <Box
                  component="span"
                  sx={{ color: theme.palette.text.primary, fontWeight: 600 }}
                >
                  {message.paymentFee}
                </Box>
              </DialogContentText>
            )}
            {message?.publishFee && (
              <DialogContentText
                id="alert-dialog-description3"
                sx={{
                  color: 'rgba(214,221,233,0.78)',
                  fontSize: '0.88rem',
                  lineHeight: 1.5,
                  m: 0,
                }}
              >
                {t('core:fee.publish', { postProcess: 'capitalizeFirstChar' })}:{' '}
                <Box
                  component="span"
                  sx={{ color: theme.palette.text.primary, fontWeight: 600 }}
                >
                  {message.publishFee}
                </Box>
              </DialogContentText>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions
        sx={{
          borderTop: '1px solid rgba(169,188,216,0.1)',
          gap: 1.2,
          justifyContent: 'flex-end',
          px: 3,
          py: 2,
        }}
      >
        <Button
          sx={{
            backgroundColor: theme.palette.other.positive,
            borderRadius: '11px',
            color: '#10200f',
            fontSize: '0.9rem',
            fontWeight: 600,
            minHeight: 42,
            minWidth: 112,
            px: 2.2,
            '&:hover': {
              backgroundColor: theme.palette.other.positive,
              color: '#10200f',
              filter: 'brightness(1.04)',
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
            borderRadius: '11px',
            color: '#220f0f',
            fontSize: '0.9rem',
            fontWeight: 600,
            minHeight: 42,
            minWidth: 112,
            px: 2.2,
            '&:hover': {
              backgroundColor: theme.palette.other.danger,
              color: '#220f0f',
              filter: 'brightness(1.04)',
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
