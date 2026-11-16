import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloudDownloadOutlinedIcon from '@mui/icons-material/CloudDownloadOutlined';
import { useAtom, useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { userInfoAtom } from '../../atoms/global';
import { QDN_CARD_DONE_MS, QdnSettingsCard } from './QdnSettingsCard';
import {
  keepLocalLayouts,
  restoreSavedLayouts,
  type SavedLayoutPart,
  savedLayoutsAtom,
} from './savedLayouts';

/**
 * After signing in: when Home's layout or the side panel changed both here
 * and on another device that saved it to QDN, this offers the saved one, on
 * the same card as the offer to save. Keeping this device's sets the saved
 * one aside until a newer is saved.
 */
export const LayoutRestoreOffer = () => {
  const { t } = useTranslation(['core']);
  const address = useAtomValue(userInfoAtom)?.address;
  const [state, setState] = useAtom(savedLayoutsAtom);
  const [isRestored, setIsRestored] = useState(false);
  const offer = address && state.address === address ? state.offer : [];
  // What was offered, so the card keeps its words while it goes.
  const [offered, setOffered] = useState<SavedLayoutPart[]>([]);
  useEffect(() => {
    if (offer.length) setOffered(offer);
    // The parts, not the array, which is new on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.join()]);

  // Restored: it says so for a moment, then goes.
  useEffect(() => {
    if (!isRestored) return;
    const timer = window.setTimeout(
      () => setIsRestored(false),
      QDN_CARD_DONE_MS
    );
    return () => window.clearTimeout(timer);
  }, [isRestored]);
  useEffect(() => {
    setIsRestored(false);
  }, [address]);

  if (!address) return null;

  const capital = { postProcess: 'capitalizeFirstChar' };
  const parts = offer.length ? offer : offered;
  const text =
    parts.length > 1
      ? t('core:saved_layouts.offer_both')
      : parts[0] === 'homeLayout'
        ? t('core:saved_layouts.offer_home')
        : t('core:saved_layouts.offer_side_panel');

  return (
    <QdnSettingsCard
      icon={isRestored ? CheckRoundedIcon : CloudDownloadOutlinedIcon}
      open={isRestored || offer.length > 0}
      primary={
        isRestored
          ? undefined
          : {
              label: t('core:saved_layouts.restore', capital),
              onClick: () => {
                setState((current) =>
                  restoreSavedLayouts(address, current, current.offer)
                );
                setIsRestored(true);
              },
            }
      }
      secondary={
        isRestored
          ? undefined
          : {
              label: t('core:saved_layouts.keep', capital),
              onClick: () =>
                setState((current) =>
                  keepLocalLayouts(address, current, current.offer)
                ),
            }
      }
      text={isRestored ? undefined : text}
      title={
        isRestored
          ? t('core:saved_layouts.restored')
          : t('core:saved_layouts.restore_title', capital)
      }
      tone={isRestored ? 'success' : 'primary'}
    />
  );
};
