import * as React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useAtom } from 'jotai';
import { isOpenUrlInvalidAtom } from '../atoms/global';

import { useTranslation } from 'react-i18next';

export function CoreUrlInvalid() {
  const { t } = useTranslation(['node', 'core']);
  const [open, setOpen] = useAtom(isOpenUrlInvalidAtom);

  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="sm"
      aria-labelledby="core-setup-title"
    >
      <DialogTitle id="core-setup-title">
        {t('node:url.title', {
          postProcess: 'capitalizeEachFirstChar',
        })}
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body1" gutterBottom>
          {t('node:url.description', {
            postProcess: 'capitalizeFirstWord',
          })}
        </Typography>
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button
          onClick={() => {
            setOpen(false);
          }}
          variant="text"
        >
          {t('core:action.close', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
