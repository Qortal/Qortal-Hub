import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  alpha,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import { useTranslation } from 'react-i18next';
import { getFee } from '../../../background/background';
import {
  limitQdnDescription,
  limitQdnTitle,
} from '../../../utils/qdnMetadataLimits';
import { EMPTY_APP_PAGE } from './appPageData';
import { normalizeAppService } from './appPageIds';
import {
  publishAppPage,
  publishAppShots,
  publishHiddenState,
  publishRemovedApp,
} from './appPageQdn';
import { appPageErrorText } from './appPageErrors';
import { useLauncherTabDialog } from '../launcherTabs';
import { publishSignature } from '../publishProfiles';
import { buildRemovedAppPage, removedAppMessages } from './removedAppPage';
import {
  claimHiddenStateRun,
  hiddenStateChangeCount,
  rememberUnfinishedHide,
  UnfinishedHide,
  unfinishedHideOf,
  useHiddenStateChanges,
  useHiddenStateRun,
  useUnfinishedHide,
} from './useAppPage';

/** What hiding publishes, in this order: the hidden record comes last. */
type Part = 'app' | 'page' | 'screenshots' | 'record';
type PartState = 'waiting' | 'working' | 'done' | 'failed';

interface HideAppDialogProps {
  open: boolean;
  /** The app's listing: service, name and metadata. */
  app: any;
  /** Its page text and screenshots exist, so replacing covers them too. */
  hasPage: boolean;
  hasShots: boolean;
  /**
   * The node has said what the page has (its hidden record, page text and
   * screenshots): until then nothing is published.
   */
  ready?: boolean;
  /**
   * Hidden already, as the page says now: from another page or launcher tab
   * of the same app, or as the node lists it.
   */
  hidden?: boolean;
  onClose: () => void;
  onHidden: (state: { replaced: boolean }) => void;
}

/**
 * Hides the publisher's own Q-App or website from the library, after saying
 * plainly that it can't be deleted. It can also put a small page in the
 * app's place (removedAppPage.ts) and empty its page text and screenshots.
 */
export const HideAppDialog = ({
  open,
  app,
  hasPage,
  hasShots,
  ready = true,
  hidden = false,
  onClose,
  onHidden,
}: HideAppDialogProps) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const [replace, setReplace] = useState(false);
  const [fee, setFee] = useState<number | null>(null);
  // The fee couldn't be looked up: said so, with Retry, and nothing is
  // published until it is known.
  const [feeError, setFeeError] = useState('');
  const [feeToken, setFeeToken] = useState(0);
  const [progress, setProgress] = useState<Partial<Record<Part, PartState>>>(
    {}
  );
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const service = normalizeAppService(app?.service);
  const isWebsite = service === 'WEBSITE';
  const title = app?.metadata?.title || app?.name || '';
  const ref = useMemo(
    () => ({ service, name: app?.name || '' }),
    [service, app?.name]
  );
  // Once anything is published, what is being done stays as it was.
  const started = Object.keys(progress).length > 0;
  // Put away, with what was chosen kept, while its launcher tab is hidden.
  const dialogShown = useLauncherTabDialog(open);

  // The same app's page can be open in several launcher tabs, each with this
  // window. A hide or show being published from one of them holds the others
  // back; once it is hidden, the others close.
  const runningElsewhere = !!useHiddenStateRun(ref) && !working;
  const changes = useHiddenStateChanges(ref);
  const openedAt = useRef(0);
  const hiddenNow = useRef(hidden);
  hiddenNow.current = hidden;
  // The stopped hide as last remembered by any tab, the one this window last
  // saw, and the one its progress goes on from (or null when it starts
  // afresh), so one stopped from another tab is taken up when it comes.
  const stoppedRun = useUnfinishedHide(ref);
  const seenRun = useRef<UnfinishedHide | null>(null);
  const goingOnFrom = useRef<UnfinishedHide | null>(null);

  // Goes on from a hide that stopped after publishing part of it: what it
  // published can't be taken back, nor what it chose.
  const goOnFrom = (unfinished: UnfinishedHide | null) => {
    goingOnFrom.current = unfinished;
    const kept: Partial<Record<Part, PartState>> = {};
    unfinished?.done.forEach((part) => {
      kept[part as Part] = 'done';
    });
    setReplace(!!unfinished?.replace);
    setProgress(kept);
    setError('');
  };

  // Each opening starts afresh. Only a try that failed after publishing part
  // of it is kept: the window goes on from there, also on a page opened
  // again.
  useEffect(() => {
    if (!open) return;
    openedAt.current = hiddenStateChangeCount(ref);
    seenRun.current = stoppedRun;
    goOnFrom(unfinishedHideOf(ref, app?.latestSignature));
    setWorking(false);
  }, [open]);

  // A hide that stopped halfway in another tab while this window was open:
  // this one goes on from it, rather than publish its parts again or leave
  // the record saying the app wasn't replaced. It stopped just now, so it is
  // taken as it is, also by a page that lists an older version of the app.
  useEffect(() => {
    if (!open || working || stoppedRun === seenRun.current) return;
    seenRun.current = stoppedRun;
    if (stoppedRun) goOnFrom(stoppedRun);
  }, [open, working, stoppedRun]);

  // Hidden or shown again since it opened, from another tab or as the node
  // now says: what it was opened for is gone.
  const outdated = () =>
    hiddenNow.current || hiddenStateChangeCount(ref) !== openedAt.current;
  useEffect(() => {
    if (open && !working && outdated()) onClose();
  }, [open, working, hidden, changes]);

  // The fee as the node says now, at each opening and on Retry.
  useEffect(() => {
    if (!open) return;
    setFee(null);
    setFeeError('');
    let cancelled = false;
    getFee('ARBITRARY')
      .then((value) => {
        const next = Number(value?.fee);
        if (cancelled) return;
        if (Number.isFinite(next)) setFee(next);
        else setFeeError(appPageErrorText(t, undefined));
      })
      .catch((cause) => {
        if (!cancelled) setFeeError(appPageErrorText(t, cause));
      });
    return () => {
      cancelled = true;
    };
  }, [open, feeToken]);

  const parts: Part[] = replace
    ? [
        'app',
        ...(hasPage ? (['page'] as Part[]) : []),
        ...(hasShots ? (['screenshots'] as Part[]) : []),
        'record',
      ]
    : ['record'];

  const partLabel = (part: Part) =>
    part === 'page' || part === 'screenshots'
      ? t(`core:app_page.edit.part_${part}`, {
          postProcess: 'capitalizeFirstChar',
        })
      : t(`core:app_page.hide.part_${part}`, {
          postProcess: 'capitalizeFirstChar',
        });

  // Gives the publish's answer for the app, whose signature is its new version.
  const publishPart = async (part: Part): Promise<unknown> => {
    if (part === 'app') {
      const lang = (i18n.language || 'en').split('-')[0];
      const messages = removedAppMessages(i18n, service);
      return publishRemovedApp(
        ref,
        buildRemovedAppPage({ title, lang, messages }),
        {
          category: app?.metadata?.category,
          description: limitQdnDescription(messages[lang] || messages.en || ''),
          title: limitQdnTitle(title),
        }
      );
    } else if (part === 'page') {
      await publishAppPage(ref, { ...EMPTY_APP_PAGE });
    } else if (part === 'screenshots') {
      await publishAppShots(ref, []);
    } else {
      await publishHiddenState(ref, { hidden: true, replaced: replace });
    }
  };

  // A retry after a failure publishes only what isn't done yet.
  const hide = async () => {
    if (working || !ref.name || !ready || fee === null) return;
    // Hidden meanwhile: nothing left to publish, and no second fee.
    if (outdated()) {
      onClose();
      return;
    }
    // Another tab is publishing it now.
    const release = claimHiddenStateRun(ref, 'hide');
    if (!release) return;
    setError('');
    setWorking(true);
    const todo = parts.filter((part) => progress[part] !== 'done');
    const done = parts.filter((part) => progress[part] === 'done');
    // The app's version before the run and the replacement's, so the run is
    // dropped once the app is published again (unfinishedHideOf).
    let versions = goingOnFrom.current?.versions;
    setProgress((value) => ({
      ...value,
      ...Object.fromEntries(todo.map((part) => [part, 'waiting'])),
    }));
    try {
      for (const part of todo) {
        setProgress((value) => ({ ...value, [part]: 'working' }));
        try {
          const response = await publishPart(part);
          if (part === 'app') {
            const replacement = publishSignature(response);
            versions =
              app?.latestSignature && replacement
                ? { before: app.latestSignature, replacement }
                : undefined;
          }
          done.push(part);
          setProgress((value) => ({ ...value, [part]: 'done' }));
        } catch (cause) {
          if (done.length > 0) {
            const stopped = { replace, done, versions };
            seenRun.current = stopped;
            goingOnFrom.current = stopped;
            rememberUnfinishedHide(ref, stopped);
          }
          setProgress((value) => ({ ...value, [part]: 'failed' }));
          setError(appPageErrorText(t, cause));
          setWorking(false);
          return;
        }
      }
      seenRun.current = null;
      goingOnFrom.current = null;
      rememberUnfinishedHide(ref, null);
      setWorking(false);
      // Says it is hidden before another tab may start: that one finds it so.
      onHidden({ replaced: replace });
    } finally {
      release();
    }
  };

  const feeTotal =
    fee === null
      ? null
      : (
          fee * parts.filter((part) => progress[part] !== 'done').length
        ).toFixed(2);

  return (
    <Dialog
      PaperProps={{ sx: { borderRadius: '18px' } }}
      aria-describedby="hide-app-explainer"
      fullWidth
      maxWidth="sm"
      onClose={working ? undefined : onClose}
      {...dialogShown}
    >
      <DialogTitle sx={{ pb: 1, pr: 6 }}>
        {t('core:app_page.hide.title', {
          title,
          postProcess: 'capitalizeFirstChar',
        })}
      </DialogTitle>
      <IconButton
        aria-label={t('core:action.close', {
          postProcess: 'capitalizeFirstChar',
        })}
        disabled={working}
        onClick={onClose}
        sx={{ position: 'absolute', right: 12, top: 12 }}
      >
        <CloseRoundedIcon />
      </IconButton>
      <DialogContent sx={{ pt: 0.5 }}>
        <Box id="hide-app-explainer">
          <Typography sx={{ fontWeight: 600, mb: 1 }}>
            {isWebsite
              ? t('core:app_page.hide.cant_delete_website')
              : t('core:app_page.hide.cant_delete_app')}
          </Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: '14px' }}>
            {t('core:app_page.hide.what_hiding_does')}
          </Typography>
        </Box>
        <Box
          sx={{
            backgroundColor: replace
              ? alpha(theme.palette.error.main, 0.06)
              : 'transparent',
            border: `1px solid ${
              replace
                ? alpha(theme.palette.error.main, 0.4)
                : theme.palette.divider
            }`,
            borderRadius: '14px',
            mt: 2,
            px: 1.5,
            py: 1,
            transition: 'background-color 150ms ease, border-color 150ms ease',
          }}
        >
          <FormControlLabel
            control={
              <Checkbox
                checked={replace}
                disabled={working || started}
                onChange={(event) => setReplace(event.target.checked)}
              />
            }
            label={
              <Box sx={{ py: 0.75 }}>
                <Typography sx={{ fontSize: '14.5px', fontWeight: 600 }}>
                  {t('core:app_page.hide.replace_label')}
                </Typography>
                <Typography sx={{ color: 'text.secondary', fontSize: '13px' }}>
                  {t('core:app_page.hide.replace_help')}
                </Typography>
              </Box>
            }
            sx={{ alignItems: 'flex-start', m: 0, width: '100%' }}
          />
        </Box>
        {feeError && (
          <Alert
            action={
              <Button
                color="inherit"
                onClick={() => setFeeToken((value) => value + 1)}
                size="small"
                sx={{ textTransform: 'none' }}
              >
                {t('core:retry', { postProcess: 'capitalizeFirstChar' })}
              </Button>
            }
            severity="error"
            sx={{ mt: 2 }}
          >
            {feeError}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
        {runningElsewhere && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {t('core:app_page.hide.busy_elsewhere')}
          </Alert>
        )}
      </DialogContent>
      <DialogActions
        sx={{
          alignItems: 'center',
          borderTop: `1px solid ${theme.palette.divider}`,
          flexWrap: 'wrap',
          gap: 1,
          justifyContent: 'space-between',
          px: 3,
          py: 1.5,
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.75,
          }}
        >
          {started &&
            parts.map((part) => {
              const state = progress[part];
              return (
                <Chip
                  icon={
                    state === 'working' ? (
                      <CircularProgress size={12} />
                    ) : state === 'done' ? (
                      <CheckCircleRoundedIcon color="success" />
                    ) : state === 'failed' ? (
                      <ErrorOutlineRoundedIcon color="error" />
                    ) : undefined
                  }
                  key={part}
                  label={partLabel(part)}
                  size="small"
                  variant="outlined"
                />
              );
            })}
          {feeTotal !== null && (
            <Typography sx={{ color: 'text.secondary', fontSize: '13px' }}>
              {t('core:message.generic.fee_qort', {
                fee: feeTotal,
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            disabled={working}
            onClick={onClose}
            sx={{ textTransform: 'none' }}
          >
            {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
          </Button>
          <Button
            color={replace ? 'error' : 'primary'}
            disableElevation
            disabled={
              working || runningElsewhere || !ref.name || !ready || fee === null
            }
            onClick={() => void hide()}
            startIcon={
              working ? (
                <CircularProgress color="inherit" size={14} />
              ) : (
                <VisibilityOffRoundedIcon />
              )
            }
            sx={{ borderRadius: '12px', textTransform: 'none' }}
            variant="contained"
          >
            {replace
              ? t('core:app_page.hide.action_replace', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('core:app_page.hide.action', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};
