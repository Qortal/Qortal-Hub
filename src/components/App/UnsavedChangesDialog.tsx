import {
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
  const isDark = theme.palette.mode === 'dark';
  const { t } = useTranslation(['core']);

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
      slotProps={{
        backdrop: {
          sx: {
            backdropFilter: 'blur(3px)',
            backgroundColor: alpha('#000', isDark ? 0.66 : 0.42),
          },
        },
      }}
      PaperProps={{
        sx: isDark
          ? {
              bgcolor: '#1A2530',
              backgroundImage: 'none',
              border: `1px solid ${alpha('#A9BCD8', 0.32)}`,
              borderRadius: '18px',
              boxShadow: `0 24px 64px ${alpha('#000', 0.6)}`,
              maxWidth: 360,
              width: 'calc(100% - 40px)',
            }
          : {
              bgcolor: theme.palette.background.paper,
              backgroundImage: 'none',
              border: `1px solid ${theme.palette.border.subtle}`,
              borderRadius: '18px',
              boxShadow: `0 22px 48px ${alpha('#000', 0.18)}, 0 0 0 1px ${alpha(theme.palette.divider, 0.6)}`,
              maxWidth: 360,
              width: 'calc(100% - 40px)',
              color: theme.palette.text.primary,
            },
      }}
    >
      <DialogTitle
        id="alert-dialog-title"
        sx={{
          color: theme.palette.text.primary,
          fontSize: '1.08rem',
          fontWeight: 650,
          pb: 0.8,
          pt: 2.3,
          textAlign: 'center',
        }}
      >
        {t('core:action.logout', { postProcess: 'capitalizeFirstChar' })}?
      </DialogTitle>
      <DialogContent>
        <DialogContentText
          id="alert-dialog-description"
          sx={{
            color: isDark
              ? alpha(theme.palette.text.secondary, 0.9)
              : theme.palette.text.secondary,
            fontSize: '0.88rem',
            lineHeight: 1.48,
            textAlign: 'center',
          }}
        >
          {message}
        </DialogContentText>
      </DialogContent>
      <DialogActions
        sx={{ gap: 1, justifyContent: 'center', px: 2.3, pb: 2.3 }}
      >
        <Button
          onClick={onCancel}
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
          {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
        </Button>
        <Button
          variant="contained"
          onClick={onConfirm}
          autoFocus
          sx={{
            bgcolor: theme.palette.primary.main,
            borderRadius: '10px',
            color: theme.palette.primary.contrastText,
            fontWeight: 600,
            minWidth: 140,
            textTransform: 'none',
            '&:hover': {
              bgcolor: theme.palette.primary.dark,
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
