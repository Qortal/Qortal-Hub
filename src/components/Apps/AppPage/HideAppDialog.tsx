import { useEffect, useMemo, useState } from 'react';
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
import { buildRemovedAppPage, removedAppMessages } from './removedAppPage';

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
  onClose,
  onHidden,
}: HideAppDialogProps) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const [replace, setReplace] = useState(false);
  const [fee, setFee] = useState<number | null>(null);
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

  // Each opening starts afresh, with the fee as the node says now.
  useEffect(() => {
    if (!open) return;
    setReplace(false);
    setProgress({});
    setError('');
    setWorking(false);
    setFee(null);
    let cancelled = false;
    getFee('ARBITRARY')
      .then((value) => {
        const next = Number(value?.fee);
        if (!cancelled) setFee(Number.isFinite(next) ? next : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

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

  const publishPart = async (part: Part) => {
    if (part === 'app') {
      const lang = (i18n.language || 'en').split('-')[0];
      const messages = removedAppMessages(i18n, service);
      await publishRemovedApp(
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
    if (working || !ref.name) return;
    setError('');
    setWorking(true);
    const todo = parts.filter((part) => progress[part] !== 'done');
    setProgress((value) => ({
      ...value,
      ...Object.fromEntries(todo.map((part) => [part, 'waiting'])),
    }));
    for (const part of todo) {
      setProgress((value) => ({ ...value, [part]: 'working' }));
      try {
        await publishPart(part);
        setProgress((value) => ({ ...value, [part]: 'done' }));
      } catch (cause) {
        setProgress((value) => ({ ...value, [part]: 'failed' }));
        setError(appPageErrorText(t, cause));
        setWorking(false);
        return;
      }
    }
    setWorking(false);
    onHidden({ replaced: replace });
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
      open={open}
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
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
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
            disabled={working || !ref.name}
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
