import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  alpha,
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
          fontSize: '1.04rem',
          fontWeight: 650,
          px: 3,
          py: 2,
          textAlign: 'left',
        }}
      >
        {message.paymentFee
          ? t('core:payment', { postProcess: 'capitalizeFirstChar' })
          : t('core:publish', { postProcess: 'capitalizeFirstChar' })}
      </DialogTitle>
      <DialogContent
        sx={{
          px: 3,
          pb: 2.65,
          '&&': {
            pt: 2.75,
          },
        }}
      >
        <DialogContentText
          id="alert-dialog-description"
          sx={{
            color: 'rgba(232,236,244,0.92)',
            fontSize: '1rem',
            lineHeight: 1.6,
            mb: message?.paymentFee || message?.publishFee ? 1.65 : 0,
            textAlign: 'left',
          }}
        >
          {message.message}
        </DialogContentText>
        {(message?.paymentFee || message?.publishFee) && (
          <Box
            sx={{
              backgroundColor: alpha('#FFFFFF', 0.032),
              border: '1px solid rgba(169,188,216,0.13)',
              borderRadius: '12px',
              display: 'grid',
              gap: 0.55,
              px: 1.45,
              py: 1.2,
            }}
          >
            <DialogContentText
              sx={{
                color: 'rgba(214,221,233,0.72)',
                fontSize: '0.78rem',
                fontWeight: 650,
                letterSpacing: '0.02em',
                lineHeight: 1.35,
                m: 0,
                textTransform: 'uppercase',
              }}
            >
              {message?.paymentFee
                ? t('core:fee.payment', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('core:fee.publish', {
                    postProcess: 'capitalizeFirstChar',
                  })}
            </DialogContentText>
            <DialogContentText
              sx={{
                color: theme.palette.text.primary,
                fontSize: '0.96rem',
                fontWeight: 700,
                lineHeight: 1.45,
                m: 0,
              }}
            >
              {message?.paymentFee || message.publishFee}
            </DialogContentText>
          </Box>
        )}
      </DialogContent>
      <DialogActions
        sx={{
          borderTop: '1px solid rgba(169,188,216,0.1)',
          gap: 1.2,
          justifyContent: 'center',
          px: 3,
          py: 1.8,
        }}
      >
        <Button
          sx={{
            backgroundColor: alpha('#FFFFFF', 0.035),
            border: '1px solid rgba(169,188,216,0.16)',
            borderRadius: '11px',
            color: theme.palette.text.primary,
            fontSize: '0.9rem',
            fontWeight: 600,
            minHeight: 42,
            minWidth: 112,
            px: 2.2,
            '&:hover': {
              backgroundColor: alpha('#FFFFFF', 0.055),
              borderColor: 'rgba(169,188,216,0.24)',
            },
          }}
          variant="outlined"
          onClick={onCancel}
        >
          {t('core:action.decline', { postProcess: 'capitalizeFirstChar' })}
        </Button>
        <Button
          sx={{
            backgroundColor: theme.palette.primary.main,
            borderRadius: '11px',
            color: '#FFFFFF',
            fontSize: '0.9rem',
            fontWeight: 600,
            minHeight: 42,
            minWidth: 112,
            px: 2.2,
            textTransform: 'none',
            '&:hover': {
              backgroundColor: theme.palette.primary.main,
              filter: 'brightness(1.05)',
            },
          }}
          variant="contained"
          onClick={onAccept}
          autoFocus
        >
          {t('core:action.accept', { postProcess: 'capitalizeFirstChar' })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
