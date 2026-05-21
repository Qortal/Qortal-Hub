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

type NewNodeReloadRequiredDialogProps = {
  open: boolean;
  onReload: () => void;
};

export function NewNodeReloadRequiredDialog({
  open,
  onReload,
}: NewNodeReloadRequiredDialogProps) {
  const theme = useTheme();
  const { t } = useTranslation(['auth']);

  return (
    <Dialog
      open={open}
      disableEscapeKeyDown
      onClose={() => {
        /* Must reload via primary action — same UX contract as blocking confirmations */
      }}
      aria-labelledby="new-node-reload-dialog-title"
      aria-describedby="new-node-reload-dialog-description"
      PaperProps={{
        sx: {
          bgcolor: '#111820',
          backgroundImage: 'none',
          border: `1px solid ${alpha('#A9BCD8', 0.18)}`,
          borderRadius: '18px',
          boxShadow: `0 24px 58px ${alpha('#000', 0.42)}`,
          maxWidth: 360,
          width: 'calc(100% - 40px)',
        },
      }}
    >
      <DialogTitle
        id="new-node-reload-dialog-title"
        sx={{
          color: theme.palette.text.primary,
          fontSize: '1.08rem',
          fontWeight: 650,
          pb: 0.8,
          pt: 2.3,
          textAlign: 'center',
        }}
      >
        {t('auth:connection_mode.reload_after_new_node_title', {
          postProcess: 'capitalizeFirstChar',
        })}
      </DialogTitle>
      <DialogContent>
        <DialogContentText
          id="new-node-reload-dialog-description"
          sx={{
            color: alpha(theme.palette.text.secondary, 0.9),
            fontSize: '0.88rem',
            lineHeight: 1.48,
            textAlign: 'center',
          }}
        >
          {t('auth:connection_mode.reload_after_new_node_message')}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'center', px: 2.3, pb: 2.3 }}>
        <Button
          variant="contained"
          onClick={onReload}
          autoFocus
          sx={{
            bgcolor: theme.palette.primary.main,
            borderRadius: '10px',
            color: theme.palette.primary.contrastText,
            fontWeight: 600,
            minWidth: 200,
            textTransform: 'none',
            '&:hover': {
              bgcolor: theme.palette.primary.dark,
            },
          }}
        >
          {t('auth:connection_mode.reload_after_new_node_button')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
