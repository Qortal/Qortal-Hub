import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import { useAtomValue } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isUsingImportExportSettingsAtom,
  settingsQDNLastUpdatedAtom,
  userInfoAtom,
} from '../../atoms/global';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { QDN_CARD_DONE_MS, QdnSettingsCard } from './QdnSettingsCard';
import {
  localChangedAt,
  readLocalLayouts,
  SAVED_LAYOUT_PARTS,
  savedLayoutsAtom,
} from './savedLayouts';
import { useUnsavedLayoutParts } from './useSavedLayouts';
import { useSaveSettingsToQdn } from './useSaveSettingsToQdn';

/** Sent when Edit Home is done, or the side panel's settings close. */
export const LAYOUT_EDIT_DONE_EVENT = 'layoutEditDone';

type Phase = 'idle' | 'saving' | 'saved' | 'failed';

/** When Home's layout or the side panel last changed on this device. */
const lastLayoutChange = (address: string) => {
  const local = readLocalLayouts(address);
  return Math.max(
    ...SAVED_LAYOUT_PARTS.map((part) => localChangedAt(local, part))
  );
};

/**
 * Offers to save Home's layout and the side panel to QDN once they were
 * edited, so the account's other devices can restore them, on the same card
 * as the launcher's. Saving asks to confirm, with the fee, as the Save
 * button does.
 *
 * When the settings saved on QDN couldn't be downloaded (from a node that
 * doesn't have them), saving could write over them, so it's off. The card
 * then says so after an edit that changed something, instead of nothing.
 */
export const LayoutSavePrompt = () => {
  const { t } = useTranslation(['core']);
  const userInfo = useAtomValue(userInfoAtom);
  const address = userInfo?.address ?? null;
  const name = userInfo?.name ?? null;
  const layouts = useAtomValue(savedLayoutsAtom);
  const isUsingImportExport = useAtomValue(isUsingImportExportSettingsAtom);
  const settingsQdnLastUpdated = useAtomValue(settingsQDNLastUpdatedAtom);
  const unsaved = useUnsavedLayoutParts(address);
  const hasUnsaved = unsaved.length > 0;
  const save = useSaveSettingsToQdn(address, name);
  const [isAsked, setIsAsked] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');

  // What's on QDN is known, and this account can publish there.
  const canSave =
    !!name &&
    !!address &&
    isUsingImportExport === false &&
    settingsQdnLastUpdated !== -100 &&
    layouts.address === address &&
    layouts.status === 'read';
  const readyRef = useRef(false);
  readyRef.current = canSave && hasUnsaved;
  // What's on QDN couldn't be downloaded: the Save button offers to write
  // over it, this card only says why it can't save.
  const cannotRead =
    !!name &&
    !!address &&
    isUsingImportExport === false &&
    settingsQdnLastUpdated === -100;
  const [isNoted, setIsNoted] = useState(false);
  const noteRef = useRef({ address, cannotRead });
  noteRef.current = { address, cannotRead };
  // The last change the card has said this about, so an edit that changed
  // nothing doesn't bring it back.
  const notedChangeRef = useRef(0);

  useEffect(() => {
    const onDone = () => {
      if (readyRef.current) {
        setError('');
        setPhase('idle');
        setIsAsked(true);
        return;
      }
      const { address: current, cannotRead: unreadable } = noteRef.current;
      if (!unreadable || !current) return;
      const changedAt = lastLayoutChange(current);
      if (changedAt > notedChangeRef.current) {
        notedChangeRef.current = changedAt;
        setIsNoted(true);
      }
    };
    subscribeToEvent(LAYOUT_EDIT_DONE_EVENT, onDone);
    return () => unsubscribeFromEvent(LAYOUT_EDIT_DONE_EVENT, onDone);
  }, []);

  // Readable again (another node), or another account: no note.
  useEffect(() => {
    if (!cannotRead) setIsNoted(false);
  }, [cannotRead]);
  useEffect(() => {
    notedChangeRef.current = address ? lastLayoutChange(address) : 0;
    setIsNoted(false);
  }, [address]);

  // Saved elsewhere meanwhile, or another account: nothing to ask.
  useEffect(() => {
    if (!hasUnsaved && phase === 'idle') setIsAsked(false);
  }, [hasUnsaved, phase]);
  useEffect(() => {
    setIsAsked(false);
    setPhase('idle');
  }, [address]);

  // Saved: it says so for a moment, then goes.
  useEffect(() => {
    if (phase !== 'saved') return;
    const timer = window.setTimeout(() => {
      setPhase('idle');
      setIsAsked(false);
    }, QDN_CARD_DONE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const onSave = async () => {
    setPhase('saving');
    setError('');
    try {
      const outcome = await save();
      // Declined at the confirmation: it stays, asking.
      setPhase(outcome === 'saved' ? 'saved' : 'idle');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '');
      setPhase('failed');
    }
  };

  const capital = { postProcess: 'capitalizeFirstChar' };
  const title =
    phase === 'saved'
      ? t('core:message.success.published_qdn', capital)
      : phase === 'failed'
        ? t('core:message.error.save_qdn', capital)
        : t('core:saved_layouts.save_title', capital);
  const text =
    phase === 'failed' && error
      ? error
      : unsaved.length > 1
        ? t('core:saved_layouts.save_text_both', capital)
        : unsaved[0] === 'sidePanel'
          ? t('core:saved_layouts.save_text_side_panel', capital)
          : t('core:saved_layouts.save_text_home', capital);

  return (
    <>
      <QdnSettingsCard
        icon={CloudOffOutlinedIcon}
        open={isNoted && !isAsked}
        secondary={{
          label: t('core:action.close', capital),
          onClick: () => setIsNoted(false),
        }}
        text={t('core:saved_layouts.unreadable_text', capital)}
        title={t('core:saved_layouts.unreadable_title', capital)}
      />
      <QdnSettingsCard
        icon={
          phase === 'saved'
            ? CheckRoundedIcon
            : phase === 'failed'
              ? ErrorOutlineRoundedIcon
              : CloudUploadOutlinedIcon
        }
        open={isAsked}
        primary={
          phase === 'saved'
            ? undefined
            : {
                label:
                  phase === 'failed'
                    ? t('core:saved_layouts.try_again', capital)
                    : t('core:message.generic.save_qdn', capital),
                loading: phase === 'saving',
                onClick: () => void onSave(),
              }
        }
        secondary={
          phase === 'saved'
            ? undefined
            : {
                disabled: phase === 'saving',
                label: t('core:saved_layouts.not_now', capital),
                onClick: () => {
                  setIsAsked(false);
                  setPhase('idle');
                  setError('');
                },
              }
        }
        text={phase === 'saved' ? undefined : text}
        title={title}
        tone={
          phase === 'saved'
            ? 'success'
            : phase === 'failed'
              ? 'error'
              : 'primary'
        }
      />
    </>
  );
};
