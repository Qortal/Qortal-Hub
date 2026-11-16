import { useEffect, useState } from 'react';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  isUsingImportExportSettingsAtom,
  settingsQDNLastUpdatedAtom,
} from '../../../atoms/global';
import {
  QDN_CARD_DONE_MS,
  QdnCardDock,
  QdnSettingsCard,
} from '../../Save/QdnSettingsCard';
import { useSaveSettingsToQdn } from '../../Save/useSaveSettingsToQdn';
import type { AppBookmarksForAddress } from '../AppBookmarks/bookmarkTypes';
import {
  launcherEditsAtom,
  savedLauncherAtom,
  useHasUnsavedLauncher,
} from './launcherQdnSync';

/** How long "saved" stays before the window goes. */
export const SAVED_NOTICE_MS = QDN_CARD_DONE_MS;

interface LauncherSaveWindowProps {
  /** The account's bookmarks as the launcher shows them, or null. */
  bookmarks: AppBookmarksForAddress | null;
  myAddress?: string | null;
  /** The account's name: saving to QDN needs one. */
  myName?: string | null;
}

type Phase = 'idle' | 'saving' | 'saved' | 'failed';

/**
 * Offers to save the launcher to QDN once it was rearranged: the pinned apps,
 * the bookmarks and folders, and their order, so every device the account
 * signs in on shows the same. It stays until it is saved or put off; the next
 * change brings it back.
 */
export const LauncherSaveWindow = ({
  bookmarks,
  myAddress,
  myName,
}: LauncherSaveWindowProps) => {
  const { t } = useTranslation(['core']);
  const edits = useAtomValue(launcherEditsAtom);
  const saved = useAtomValue(savedLauncherAtom);
  const isUsingImportExport = useAtomValue(isUsingImportExportSettingsAtom);
  const settingsQdnLastUpdated = useAtomValue(settingsQDNLastUpdatedAtom);
  const hasUnsaved = useHasUnsavedLauncher(myAddress, bookmarks);
  const save = useSaveSettingsToQdn(myAddress, myName);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  /** The changes counted when the window was put off. */
  const [putOffAt, setPutOffAt] = useState(0);

  const account = myAddress || null;
  const editCount = edits.address === account ? edits.count : 0;
  // What is on QDN is known, and this account can publish there.
  const canSave =
    !!myName &&
    !!account &&
    isUsingImportExport === false &&
    settingsQdnLastUpdated !== -100 &&
    saved.address === account &&
    saved.status !== 'unknown';
  const isAsked = editCount > putOffAt && hasUnsaved && canSave;
  const isOpen =
    phase === 'saving' ||
    phase === 'saved' ||
    (phase === 'failed' && editCount > putOffAt) ||
    isAsked;

  useEffect(() => {
    if (phase !== 'saved') return;
    const timer = window.setTimeout(() => setPhase('idle'), SAVED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const handleSave = async () => {
    setPhase('saving');
    setError('');
    try {
      const outcome = await save();
      setPhase(outcome === 'saved' ? 'saved' : 'idle');
    } catch (reason) {
      setError((reason as Error)?.message || '');
      setPhase('failed');
    }
  };

  const putOff = () => {
    setPutOffAt(editCount);
    setPhase('idle');
    setError('');
  };

  const title =
    phase === 'saved'
      ? t('core:message.success.published_qdn', {
          postProcess: 'capitalizeFirstChar',
        })
      : phase === 'failed'
        ? t('core:message.error.save_qdn', {
            postProcess: 'capitalizeFirstChar',
          })
        : t('core:launcher.save_title', {
            postProcess: 'capitalizeFirstChar',
          });
  const text =
    phase === 'failed' && error
      ? error
      : t('core:launcher.save_text', { postProcess: 'capitalizeFirstChar' });
  const Icon =
    phase === 'saved'
      ? CheckRoundedIcon
      : phase === 'failed'
        ? ErrorOutlineRoundedIcon
        : CloudUploadOutlinedIcon;

  return (
    <QdnCardDock>
      <QdnSettingsCard
        icon={Icon}
        open={isOpen}
        primary={
          phase === 'saved'
            ? undefined
            : {
                label:
                  phase === 'failed'
                    ? t('core:launcher.save_retry', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    : t('core:message.generic.save_qdn', {
                        postProcess: 'capitalizeFirstChar',
                      }),
                loading: phase === 'saving',
                onClick: handleSave,
              }
        }
        secondary={
          phase === 'saved'
            ? undefined
            : {
                disabled: phase === 'saving',
                label: t('core:launcher.save_later', {
                  postProcess: 'capitalizeFirstChar',
                }),
                onClick: putOff,
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
    </QdnCardDock>
  );
};
