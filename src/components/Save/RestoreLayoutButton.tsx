import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { useAtomValue } from 'jotai';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { userInfoAtom } from '../../atoms/global';
import { executeEvent } from '../../utils/events';
import type { SavedLayoutPart } from './savedLayouts';
import { useSavedLayout } from './useSavedLayouts';

/**
 * Restore from QDN: shown while the layout saved on QDN differs from this
 * device's. It asks first, since this device's layout is replaced.
 */
export const RestoreLayoutButton = ({ part }: { part: SavedLayoutPart }) => {
  const { t, i18n } = useTranslation(['core']);
  const address = useAtomValue(userInfoAtom)?.address;
  const { saved, restore } = useSavedLayout(address, part);
  const [isConfirming, setIsConfirming] = useState(false);
  if (!saved) return null;

  const when =
    saved.changedAt > 1
      ? new Date(saved.changedAt).toLocaleString(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : null;
  const question =
    part === 'homeLayout'
      ? when
        ? t('core:saved_layouts.confirm_home_when', { when })
        : t('core:saved_layouts.confirm_home')
      : when
        ? t('core:saved_layouts.confirm_side_panel_when', { when })
        : t('core:saved_layouts.confirm_side_panel');
  const label = t('core:saved_layouts.restore_from_qdn', {
    postProcess: 'capitalizeFirstChar',
  });

  return (
    <>
      <Button
        onClick={() => setIsConfirming(true)}
        size="small"
        startIcon={<CloudDownloadRoundedIcon />}
        sx={{ borderRadius: 999, textTransform: 'none' }}
      >
        {label}
      </Button>
      <Dialog onClose={() => setIsConfirming(false)} open={isConfirming}>
        <DialogTitle>{label}</DialogTitle>
        <DialogContent>
          <DialogContentText>{question}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsConfirming(false)}>
            {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
          </Button>
          <Button
            onClick={() => {
              restore();
              setIsConfirming(false);
              executeEvent('openGlobalSnackBar', {
                message: t('core:saved_layouts.restored'),
                type: 'success',
              });
            }}
            variant="contained"
          >
            {t('core:saved_layouts.restore', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
