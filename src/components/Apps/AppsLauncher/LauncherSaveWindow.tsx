import { useEffect, useId, useState } from 'react';
import { Box, Button, Paper, Slide, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  isUsingImportExportSettingsAtom,
  settingsQDNLastUpdatedAtom,
} from '../../../atoms/global';
import { useSaveSettingsToQdn } from '../../Save/useSaveSettingsToQdn';
import type { AppBookmarksForAddress } from '../AppBookmarks/bookmarkTypes';
import {
  launcherEditsAtom,
  savedLauncherAtom,
  useHasUnsavedLauncher,
} from './launcherQdnSync';

/** How long "saved" stays before the window goes. */
export const SAVED_NOTICE_MS = 2500;

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
  const titleId = useId();
  const textId = useId();
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
    <Box
      sx={{
        bottom: 20,
        display: 'flex',
        justifyContent: 'center',
        left: 0,
        paddingInline: '16px',
        pointerEvents: 'none',
        position: 'absolute',
        right: 0,
        zIndex: 5,
      }}
    >
      <Slide direction="up" in={isOpen} mountOnEnter unmountOnExit>
        <Paper
          aria-describedby={phase === 'saved' ? undefined : textId}
          aria-labelledby={titleId}
          aria-modal={phase === 'saved' ? undefined : false}
          elevation={8}
          role={phase === 'saved' ? 'status' : 'dialog'}
          sx={(theme) => ({
            alignItems: 'center',
            backgroundImage: 'none',
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '16px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px 14px',
            maxWidth: 600,
            padding: '14px 16px',
            pointerEvents: 'auto',
            width: '100%',
          })}
        >
          <Box
            aria-hidden
            sx={(theme) => {
              const tone =
                phase === 'saved'
                  ? theme.palette.success.main
                  : phase === 'failed'
                    ? theme.palette.error.main
                    : theme.palette.primary.main;
              return {
                alignItems: 'center',
                backgroundColor: alpha(tone, 0.14),
                borderRadius: '50%',
                color: tone,
                display: 'flex',
                flexShrink: 0,
                height: 40,
                justifyContent: 'center',
                width: 40,
              };
            }}
          >
            <Icon sx={{ fontSize: 22 }} />
          </Box>
          <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
            <Typography
              id={titleId}
              sx={{ fontSize: '14px', fontWeight: 600, lineHeight: 1.4 }}
            >
              {title}
            </Typography>
            {phase === 'saved' ? null : (
              <Typography
                id={textId}
                sx={(theme) => ({
                  color: theme.palette.text.secondary,
                  fontSize: '12.5px',
                  lineHeight: 1.45,
                  overflowWrap: 'anywhere',
                })}
              >
                {text}
              </Typography>
            )}
          </Box>
          {phase === 'saved' ? null : (
            <Box
              sx={{
                display: 'flex',
                flexShrink: 0,
                gap: '8px',
                justifyContent: 'flex-end',
                marginLeft: 'auto',
              }}
            >
              <Button
                color="inherit"
                disabled={phase === 'saving'}
                onClick={putOff}
                sx={{ textTransform: 'none' }}
              >
                {t('core:launcher.save_later', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Button>
              <Button
                disableElevation
                loading={phase === 'saving'}
                onClick={handleSave}
                sx={{ borderRadius: '10px', textTransform: 'none' }}
                variant="contained"
              >
                {phase === 'failed'
                  ? t('core:launcher.save_retry', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('core:message.generic.save_qdn', {
                      postProcess: 'capitalizeFirstChar',
                    })}
              </Button>
            </Box>
          )}
        </Paper>
      </Slide>
    </Box>
  );
};
