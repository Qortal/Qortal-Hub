import {
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import LayersRoundedIcon from '@mui/icons-material/LayersRounded';
import { useAtomValue } from 'jotai';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { isRunningPublicNodeAtom } from '../../../atoms/global';
import {
  checkDeviceForModel,
  readDeviceTier,
  type DeviceCheck,
} from '../../../qortinoAgent/deviceTier';
import { savedModelBytes } from '../../../qortinoAgent/download';
import {
  announceQortinoBackgroundDownload,
  cancelQortinoInstallJob,
  retryQortinoInstallNow,
  startQortinoInstallJob,
} from '../../../qortinoAgent/installJob';
import {
  attachQortinoInstallView,
  getQortinoInstallJob,
  isQortinoInstallJobActive,
  qortinoInstallErrorText,
  qortinoProgressRatio,
  qortinoProgressText,
  qortinoRetryCause,
  subscribeQortinoInstallJob,
} from '../../../qortinoAgent/installJobStore';
import {
  formatBytes,
  modelTotalBytes,
  QORTINO_MODEL,
} from '../../../qortinoAgent/manifest';
import type { QortinoInstallState } from '../../../qortinoAgent/store';

type Props = {
  /** Called as an assemble starts, so the panel can load the chat code meanwhile. */
  onAssembleStart?: () => void;
  onInstalled: (install: QortinoInstallState) => void;
  onCancel: () => void;
  /** Open the model list, to use another open model instead. */
  onOpenModels?: () => void;
};

export function QortinoAgentGate({
  onAssembleStart,
  onInstalled,
  onCancel,
  onOpenModels,
}: Props) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const isDark = theme.palette.mode === 'dark';
  const isPublicNode = useAtomValue(isRunningPublicNodeAtom);
  const [device, setDevice] = useState<DeviceCheck | null>(null);
  const [loading, setLoading] = useState(true);
  // The download is a job of its own (installJob.ts): it keeps going when the
  // panel closes and retries by itself; the panel only shows it.
  const job = useSyncExternalStore(
    subscribeQortinoInstallJob,
    getQortinoInstallJob
  );
  const installing = isQortinoInstallJobActive(job);
  const retrying = job.status === 'retrying';
  const progress = installing ? job.progress : null;
  const error =
    job.status === 'failed' && job.error
      ? {
          message: qortinoInstallErrorText(job.error, t),
          detail:
            job.error.code === 'low_storage' ? undefined : job.error.detail,
        }
      : null;
  const [now, setNow] = useState(() => Date.now());
  const reportedInstallRef = useRef<QortinoInstallState | null>(null);
  const totalBytes = modelTotalBytes();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [tier, saved] = await Promise.all([
          readDeviceTier(),
          savedModelBytes(),
        ]);
        if (cancelled) return;
        setDevice(checkDeviceForModel(tier, saved));
      } catch {
        // The check is advisory; assemble still verifies as it goes.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Closing the panel leaves the download running; say so once.
  useEffect(() => {
    const detach = attachQortinoInstallView();
    return () => {
      detach();
      announceQortinoBackgroundDownload();
    };
  }, []);

  useEffect(() => {
    if (job.status !== 'done' || !job.install) return;
    if (reportedInstallRef.current === job.install) return;
    reportedInstallRef.current = job.install;
    onInstalled(job.install);
  }, [job.status, job.install, onInstalled]);

  // Count down to the next try.
  useEffect(() => {
    if (!retrying) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [retrying]);

  const startInstall = useCallback(() => {
    onAssembleStart?.();
    startQortinoInstallJob();
  }, [onAssembleStart]);

  const progressRatio = qortinoProgressRatio(progress);
  const progressLabel = qortinoProgressText(progress, t);
  const retrySeconds =
    retrying && job.retryAt
      ? Math.max(0, Math.ceil((job.retryAt - now) / 1_000))
      : 0;
  // Why it waits, then when it tries again: two sentences.
  const retryLabel = `${t(
    `core:qortino_agent.gate.retry_reason.${qortinoRetryCause(job.error)}`
  )} ${
    retrySeconds >= 60
      ? t('core:qortino_agent.gate.retry_in_minutes', {
          minutes: Math.ceil(retrySeconds / 60),
        })
      : t('core:qortino_agent.gate.retry_in_seconds', {
          seconds: retrySeconds,
        })
  }`;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        px: 2,
        py: 1.5,
      }}
    >
      <Typography sx={{ fontWeight: 800, fontSize: '1.15rem' }}>
        {t('core:qortino_agent.gate.title')}
      </Typography>
      <Typography
        sx={{
          color: alpha(theme.palette.text.primary, 0.82),
          fontSize: '0.92rem',
          lineHeight: 1.5,
        }}
      >
        {t('core:qortino_agent.gate.intro')}
      </Typography>

      {/* The public node can fetch the model, but it is shared, cuts long
          transfers and drops what it fetched: recommend a private node
          before a multi-GB download rather than refusing it. */}
      {isPublicNode && (
        <Box
          sx={{
            background: alpha(theme.palette.warning.main, isDark ? 0.16 : 0.12),
            border: `1px solid ${alpha(theme.palette.warning.main, 0.45)}`,
            borderRadius: '12px',
            px: 1.25,
            py: 1.1,
          }}
        >
          <Typography sx={{ fontSize: '0.88rem', fontWeight: 700, mb: 0.35 }}>
            {t('core:qortino_agent.gate.public_node_title')}
          </Typography>
          <Typography
            sx={{
              color: alpha(theme.palette.text.primary, 0.85),
              fontSize: '0.82rem',
              lineHeight: 1.45,
            }}
          >
            {t('core:qortino_agent.gate.public_node_body', {
              size: formatBytes(totalBytes),
            })}
          </Typography>
        </Box>
      )}

      {loading ? (
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
          <CircularProgress size={18} />
          <Typography sx={{ fontSize: '0.85rem' }}>
            {t('core:qortino_agent.gate.checking')}
          </Typography>
        </Box>
      ) : (
        <>
          <Box
            sx={{
              background: alpha('#4A7FD4', isDark ? 0.28 : 0.14),
              border: `1px solid ${alpha('#4A7FD4', 0.7)}`,
              borderRadius: '12px',
              p: 1.25,
            }}
          >
            <Typography sx={{ fontWeight: 700 }}>
              {QORTINO_MODEL.label}
            </Typography>
            <Typography sx={{ fontSize: '0.8rem', mt: 0.35, opacity: 0.8 }}>
              {t('core:qortino_agent.gate.model_blurb')}
            </Typography>
            <Typography sx={{ fontSize: '0.75rem', mt: 0.5, opacity: 0.7 }}>
              {t('core:qortino_agent.gate.model_size', {
                size: formatBytes(totalBytes),
                license: QORTINO_MODEL.license,
              })}
            </Typography>
          </Box>

          {device?.lowRam && (
            <Typography
              sx={{ color: theme.palette.warning.main, fontSize: '0.8rem' }}
            >
              {t('core:qortino_agent.gate.low_ram', {
                ram: formatBytes(device.tier.totalRamBytes),
              })}
            </Typography>
          )}
          {device && !device.enoughStorage && (
            <Typography
              sx={{ color: theme.palette.warning.main, fontSize: '0.8rem' }}
            >
              {t('core:qortino_agent.gate.low_storage', {
                needed: formatBytes(device.neededBytes),
                free: formatBytes(device.tier.availStorageBytes),
              })}
            </Typography>
          )}

          <Typography
            sx={{ fontSize: '0.75rem', opacity: 0.65, lineHeight: 1.4 }}
          >
            {t('core:qortino_agent.gate.disclaimer')}
          </Typography>
          {onOpenModels && !installing ? (
            <Box
              sx={{
                alignItems: 'center',
                border: `1px dashed ${alpha(theme.palette.text.primary, 0.22)}`,
                borderRadius: '12px',
                display: 'flex',
                gap: 1,
                px: 1.25,
                py: 1,
              }}
            >
              <Typography
                sx={{
                  color: alpha(theme.palette.text.primary, 0.75),
                  flex: 1,
                  fontSize: '0.8rem',
                  lineHeight: 1.4,
                }}
              >
                {t('core:qortino_agent.gate.other_models')}
              </Typography>
              <Button
                onClick={onOpenModels}
                size="small"
                startIcon={<LayersRoundedIcon />}
                sx={{ flexShrink: 0, textTransform: 'none' }}
                variant="outlined"
              >
                {t('core:qortino_agent.gate.other_models_button')}
              </Button>
            </Box>
          ) : null}
        </>
      )}

      {installing && progress && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
          <Typography sx={{ fontSize: '0.85rem' }}>{progressLabel}</Typography>
          <LinearProgress
            variant={progress.bytesTotal > 0 ? 'determinate' : 'indeterminate'}
            value={progressRatio * 100}
          />
          {progress.bytesTotal > 0 && progress.phase === 'save' && (
            <Typography sx={{ fontSize: '0.75rem', opacity: 0.7 }}>
              {t('core:qortino_agent.progress.bytes', {
                done: formatBytes(progress.bytesDone),
                total: formatBytes(progress.bytesTotal),
              })}
            </Typography>
          )}
        </Box>
      )}

      {retrying && (
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
          <Typography
            sx={{
              color: theme.palette.warning.main,
              flex: 1,
              fontSize: '0.82rem',
            }}
          >
            {retryLabel}
          </Typography>
          <Button
            onClick={retryQortinoInstallNow}
            size="small"
            sx={{ flexShrink: 0, textTransform: 'none' }}
          >
            {t('core:qortino_agent.gate.try_now')}
          </Button>
        </Box>
      )}

      {installing && (
        <Typography sx={{ fontSize: '0.75rem', opacity: 0.7, lineHeight: 1.4 }}>
          {t('core:qortino_agent.gate.background_hint')}
        </Typography>
      )}

      {error && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.35 }}>
          <Typography
            sx={{ color: theme.palette.error.main, fontSize: '0.85rem' }}
          >
            {error.message}
          </Typography>
          {error.detail ? (
            <Typography
              sx={{
                color: alpha(theme.palette.text.primary, 0.55),
                fontSize: '0.7rem',
                wordBreak: 'break-word',
              }}
            >
              {t('core:qortino_agent.error.detail', { detail: error.detail })}
            </Typography>
          ) : null}
        </Box>
      )}

      <Box sx={{ display: 'flex', gap: 1, mt: 'auto', pt: 1 }}>
        <Button
          variant="outlined"
          onClick={() => {
            cancelQortinoInstallJob();
            onCancel();
          }}
          disabled={installing && progress?.phase === 'finalizing'}
          sx={{ textTransform: 'none' }}
        >
          {installing
            ? t('core:qortino_agent.gate.cancel')
            : t('core:qortino_agent.gate.not_now')}
        </Button>
        {installing ? (
          // Closes the panel only: the download goes on, and Hub says when
          // it is done.
          <Button
            variant="contained"
            onClick={onCancel}
            startIcon={<KeyboardArrowDownRoundedIcon />}
            sx={{ flex: 1, textTransform: 'none' }}
          >
            {t('core:qortino_agent.gate.minimize')}
          </Button>
        ) : (
          <Button
            variant="contained"
            disabled={loading}
            onClick={startInstall}
            sx={{ flex: 1, fontWeight: 800, textTransform: 'none' }}
          >
            {t('core:qortino_agent.gate.assemble')}
          </Button>
        )}
      </Box>
    </Box>
  );
}
