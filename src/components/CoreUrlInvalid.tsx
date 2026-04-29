import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  useTheme,
} from '@mui/material';
import { useAtom } from 'jotai';
import { isOpenUrlInvalidAtom } from '../atoms/global';

import { useTranslation } from 'react-i18next';
import {
  dialogActionsSx,
  dialogContentSx,
  dialogContentTextSx,
  dialogTitleSx,
  getDialogPaperSx,
  getDialogSecondaryButtonSx,
} from './App/dialogSurface';

export function CoreUrlInvalid() {
  const { t } = useTranslation(['node', 'core']);
  const theme = useTheme();
  const [open, setOpen] = useAtom(isOpenUrlInvalidAtom);

  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="sm"
      aria-labelledby="core-setup-title"
      PaperProps={{
        sx: getDialogPaperSx(theme, { maxWidth: 460 }),
      }}
    >
      <DialogTitle id="core-setup-title" sx={dialogTitleSx}>
        {t('node:url.title', {
          postProcess: 'capitalizeEachFirstChar',
        })}
      </DialogTitle>
      <DialogContent sx={dialogContentSx}>
        <Typography sx={dialogContentTextSx}>
          {t('node:url.description', {
            postProcess: 'capitalizeFirstWord',
          })}
        </Typography>
      </DialogContent>

      <DialogActions sx={dialogActionsSx}>
        <Button
          onClick={() => {
            setOpen(false);
          }}
          variant="outlined"
          sx={getDialogSecondaryButtonSx(theme)}
        >
          {t('core:action.close', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
