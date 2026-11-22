import {
  Box,
  Button,
  ButtonBase,
  IconButton,
  LinearProgress,
  Radio,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { useAtomValue } from 'jotai';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isRunningPublicNodeAtom } from '../../../atoms/global';
import {
  qortinoInstallErrorText,
  qortinoProgressRatio,
  qortinoProgressText,
  qortinoRetryCause,
} from '../../../qortinoAgent/installJobStore';
import {
  formatBytes,
  modelTotalBytes,
  QDN_OTHER_MODELS,
  QORTINO_MODEL,
  type QortinoModelSpec,
} from '../../../qortinoAgent/manifest';
import {
  addFileModel,
  downloadQdnOtherModel,
  isLaterSplitPart,
  isOfferedQdnModel,
  qdnModelEntryId,
  QORTINO_OWN_MODEL_ID,
  removeOtherModel,
  retryOtherModelDownload,
  setActiveQortinoModel,
  stopOtherModelDownload,
  useOtherModelDownloads,
  useQortinoModels,
  type OtherModel,
  type OtherModelDownload,
} from '../../../qortinoAgent/models';
import QortinoLlm, {
  type QortinoDeviceTier,
} from '../../../qortinoAgent/qortinoLlm';
import type { QortinoInstallState } from '../../../qortinoAgent/store';
import { QortinoSettingsGroup } from './QortinoSettingsSection';

const ACCENT = '#7EB6FF';

/** A model needs about its file size in memory, plus room for the conversation. */
export function modelFitsMemory(
  sizeBytes: number,
  tier: Pick<QortinoDeviceTier, 'totalRamBytes'> | null
): boolean {
  if (!tier?.totalRamBytes || !sizeBytes) return true;
  return sizeBytes + 1024 ** 3 <= tier.totalRamBytes * 0.8;
}

type Props = {
  install: QortinoInstallState;
  /** Qortino's own model was chosen while it is not downloaded: show the download. */
  onUseQortino: () => void;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

function ModelRow({
  selected,
  disabled,
  title,
  details,
  onSelect,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  title: string;
  details: string;
  onSelect: () => void;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  return (
    <Box
      sx={{
        background: selected
          ? alpha(ACCENT, isDark ? 0.16 : 0.12)
          : alpha(theme.palette.background.paper, isDark ? 0.25 : 0.6),
        border: `1px solid ${selected ? alpha(ACCENT, 0.7) : alpha(theme.palette.divider, 0.5)}`,
        borderRadius: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        px: 0.75,
        py: 0.6,
      }}
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.5 }}>
        <ButtonBase
          disabled={disabled}
          onClick={onSelect}
          sx={{
            alignItems: 'center',
            borderRadius: '10px',
            display: 'flex',
            flex: 1,
            gap: 0.5,
            justifyContent: 'flex-start',
            minWidth: 0,
            textAlign: 'left',
          }}
        >
          <Radio
            checked={selected}
            disabled={disabled}
            inputProps={{ 'aria-label': title }}
            size="small"
            sx={{ p: 0.5 }}
            tabIndex={-1}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography
              noWrap
              sx={{ fontSize: '0.84rem', fontWeight: 800 }}
              title={title}
            >
              {title}
            </Typography>
            <Typography
              noWrap
              sx={{
                color: alpha(theme.palette.text.primary, 0.62),
                fontSize: '0.7rem',
              }}
              title={details}
            >
              {details}
            </Typography>
          </Box>
        </ButtonBase>
        {children}
      </Box>
    </Box>
  );
}

function RowNote({
  children,
  tone,
  role,
}: {
  children: ReactNode;
  tone: 'warning' | 'error';
  role?: string;
}) {
  const theme = useTheme();
  return (
    <Typography
      role={role}
      sx={{
        color: theme.palette[tone].main,
        fontSize: '0.7rem',
        pt: 0.4,
        px: 1,
      }}
    >
      {children}
    </Typography>
  );
}

function RemoveConfirm({
  text,
  onCancel,
  onRemove,
}: {
  text: string;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  return (
    <Box
      role="alertdialog"
      sx={{
        alignItems: 'center',
        background: alpha(theme.palette.error.main, 0.08),
        border: `1px solid ${alpha(theme.palette.error.main, 0.4)}`,
        borderRadius: '10px',
        display: 'flex',
        gap: 0.75,
        mt: 0.5,
        p: 0.75,
      }}
    >
      <Typography sx={{ flex: 1, fontSize: '0.74rem' }}>{text}</Typography>
      <Button onClick={onCancel} size="small" sx={{ textTransform: 'none' }}>
        {t('core:action.cancel', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Button>
      <Button
        color="error"
        onClick={onRemove}
        size="small"
        sx={{ textTransform: 'none' }}
        variant="contained"
      >
        {t('core:action.remove', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Button>
    </Box>
  );
}

/** "Part 2 of 11 · …", or why it waits and when it tries again. */
function downloadText(
  download: OtherModelDownload | undefined,
  now: number,
  t: Translate
): string {
  if (download?.retry) {
    const seconds = Math.max(
      0,
      Math.ceil((download.retry.retryAt - now) / 1_000)
    );
    // Not found at all: no peer is to blame.
    const reason =
      download.retry.error.code === 'not_published'
        ? t('core:qortino_agent.models.retry_not_found')
        : t(
            `core:qortino_agent.gate.retry_reason.${qortinoRetryCause(download.retry.error)}`
          );
    return `${reason} ${
      seconds >= 60
        ? t('core:qortino_agent.gate.retry_in_minutes', {
            minutes: Math.ceil(seconds / 60),
          })
        : t('core:qortino_agent.gate.retry_in_seconds', { seconds })
    }`;
  }
  const progress = download?.progress ?? null;
  if (!progress || progress.phase === 'locate') {
    return t('core:qortino_agent.models.locate');
  }
  const text = qortinoProgressText(progress, t);
  return progress.phase === 'save' && progress.bytesTotal > 0
    ? `${text} ${t('core:qortino_agent.progress.bytes', {
        done: formatBytes(progress.bytesDone),
        total: formatBytes(progress.bytesTotal),
      })}`
    : text;
}

function failureText(entry: OtherModel, t: Translate): string {
  if (!entry.failure) return t('core:qortino_agent.models.stopped');
  // The note under the row says it: only through the user's own node.
  if (entry.failure.code === 'public_node') return '';
  if (entry.failure.code === 'not_published') {
    return t('core:qortino_agent.models.not_published');
  }
  if (entry.failure.code === 'generic') {
    return t('core:qortino_agent.error.download');
  }
  if (entry.failure.code === 'low_storage') {
    return t('core:qortino_agent.models.low_storage', {
      needed: formatBytes(entry.failure.neededBytes),
      free: formatBytes(entry.failure.freeBytes),
    });
  }
  return qortinoInstallErrorText(entry.failure, t);
}

/**
 * Which model Qortino talks with: his own, a bigger one Hub downloads from
 * QDN, or an open model the user added as a file from this computer.
 */
export function QortinoModelsSection({ install, onUseQortino }: Props) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const models = useQortinoModels();
  const downloads = useOtherModelDownloads();
  const publicNode = useAtomValue(isRunningPublicNodeAtom);
  const [tier, setTier] = useState<QortinoDeviceTier | null>(null);
  const [addError, setAddError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{
    id: string;
    reason: string;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const waiting = Object.values(downloads).some((item) => item.retry);

  useEffect(() => {
    let cancelled = false;
    void QortinoLlm.getDeviceTier()
      .then((value) => {
        if (!cancelled) setTier(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // The wait before a download's next try counts down.
  useEffect(() => {
    if (!waiting) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [waiting]);

  const remove = (id: string) => {
    setConfirmRemove(null);
    setRemoveError(null);
    void removeOtherModel(id).catch((e: unknown) =>
      setRemoveError({
        id,
        reason: e instanceof Error ? e.message : String(e),
      })
    );
  };

  const removeParts = (id: string, confirmText: string) => (
    <>
      {removeError?.id === id ? (
        <RowNote role="alert" tone="error">
          {t('core:qortino_agent.models.remove_failed', {
            reason: removeError.reason,
          })}
        </RowNote>
      ) : null}
      {confirmRemove === id ? (
        <RemoveConfirm
          onCancel={() => setConfirmRemove(null)}
          onRemove={() => remove(id)}
          text={confirmText}
        />
      ) : null}
    </>
  );

  const removeButton = (id: string) => (
    <IconButton
      aria-label={t('core:qortino_agent.models.remove')}
      onClick={() => setConfirmRemove(id)}
      size="small"
      title={t('core:qortino_agent.models.remove')}
    >
      <DeleteOutlineRoundedIcon fontSize="small" />
    </IconButton>
  );

  const pickFile = async () => {
    setAddError('');
    try {
      const file = await QortinoLlm.pickModelFile({
        title: t('core:qortino_agent.models.pick_title'),
        filterName: t('core:qortino_agent.models.pick_filter'),
      });
      if (!file) return;
      if (isLaterSplitPart(file.name)) {
        setAddError(t('core:qortino_agent.models.first_part'));
        return;
      }
      addFileModel(file);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    }
  };

  const qortinoInstalled = Boolean(install.installed && install.llmPath);
  const qortinoDetails = [
    t('core:qortino_agent.models.recommended'),
    formatBytes(modelTotalBytes()),
    qortinoInstalled
      ? t('core:qortino_agent.models.on_computer')
      : t('core:qortino_agent.models.from_qdn'),
  ].join(' · ');

  const qdnRow = (spec: QortinoModelSpec) => {
    const id = qdnModelEntryId(spec);
    const entry = models.others.find((model) => model.id === id);
    const download = downloads[id];
    const ready = entry?.status === 'ready';
    const downloading = entry?.status === 'downloading';
    const failed = entry?.status === 'failed';
    const totalBytes = modelTotalBytes(spec);
    // Where it is comes before the memory note, which a narrow panel cuts.
    const details = [
      formatBytes(totalBytes),
      ready
        ? t('core:qortino_agent.models.on_computer')
        : t('core:qortino_agent.models.from_qdn'),
      t('core:qortino_agent.models.needs_memory', {
        ram: formatBytes(spec.recommendedRamBytes),
      }),
    ].join(' · ');
    return (
      <Box key={id}>
        <ModelRow
          selected={models.activeId === id}
          disabled={!ready}
          title={spec.label}
          details={details}
          onSelect={() => setActiveQortinoModel(id)}
        >
          {!entry ? (
            <Button
              disabled={publicNode}
              onClick={() => void downloadQdnOtherModel(spec)}
              size="small"
              startIcon={<DownloadRoundedIcon />}
              sx={{ flexShrink: 0, textTransform: 'none' }}
            >
              {t('core:qortino_agent.models.get')}
            </Button>
          ) : null}
          {failed || download?.retry ? (
            <IconButton
              disabled={publicNode}
              aria-label={
                failed
                  ? t('core:qortino_agent.models.retry')
                  : t('core:qortino_agent.gate.try_now')
              }
              onClick={() => void retryOtherModelDownload(id)}
              size="small"
              title={
                failed
                  ? t('core:qortino_agent.models.retry')
                  : t('core:qortino_agent.gate.try_now')
              }
            >
              <RefreshRoundedIcon fontSize="small" />
            </IconButton>
          ) : null}
          {downloading ? (
            <IconButton
              aria-label={t('core:qortino_agent.models.cancel_download')}
              onClick={() => stopOtherModelDownload(id)}
              size="small"
              title={t('core:qortino_agent.models.cancel_download')}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          ) : null}
          {entry && !downloading ? removeButton(id) : null}
        </ModelRow>
        {downloading ? (
          <Box sx={{ px: 1, pt: 0.5 }}>
            <LinearProgress
              variant={
                download?.progress?.bytesTotal ? 'determinate' : 'indeterminate'
              }
              value={qortinoProgressRatio(download?.progress ?? null) * 100}
            />
            <Typography sx={{ fontSize: '0.68rem', mt: 0.35, opacity: 0.7 }}>
              {downloadText(download, now, t)}
            </Typography>
          </Box>
        ) : null}
        {failed && failureText(entry, t) ? (
          <RowNote tone="warning">{failureText(entry, t)}</RowNote>
        ) : null}
        {!ready && (publicNode || entry?.failure?.code === 'public_node') ? (
          <RowNote tone="warning">
            {t('core:qortino_agent.models.own_node_only')}
          </RowNote>
        ) : null}
        {!modelFitsMemory(totalBytes, tier) ? (
          <RowNote tone="warning">
            {t('core:qortino_agent.models.too_big', {
              ram: formatBytes(tier?.totalRamBytes ?? 0),
            })}
          </RowNote>
        ) : null}
        {removeParts(id, t('core:qortino_agent.models.remove_confirm_hub'))}
      </Box>
    );
  };

  return (
    <QortinoSettingsGroup title={t('core:qortino_agent.models.title')}>
      <Typography
        sx={{
          color: alpha(theme.palette.text.primary, 0.7),
          fontSize: '0.74rem',
          lineHeight: 1.4,
        }}
      >
        {t('core:qortino_agent.models.intro')}
      </Typography>
      <Box
        role="radiogroup"
        aria-label={t('core:qortino_agent.models.title')}
        sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}
      >
        <ModelRow
          selected={models.activeId === QORTINO_OWN_MODEL_ID}
          title={`${t('core:qortino_agent.name')} · ${QORTINO_MODEL.label}`}
          details={qortinoDetails}
          onSelect={() => {
            setActiveQortinoModel(QORTINO_OWN_MODEL_ID);
            if (!qortinoInstalled) onUseQortino();
          }}
        >
          {!qortinoInstalled ? (
            <Button
              onClick={() => {
                setActiveQortinoModel(QORTINO_OWN_MODEL_ID);
                onUseQortino();
              }}
              size="small"
              startIcon={<DownloadRoundedIcon />}
              sx={{ flexShrink: 0, textTransform: 'none' }}
            >
              {t('core:qortino_agent.models.get')}
            </Button>
          ) : null}
        </ModelRow>
        {QDN_OTHER_MODELS.map(qdnRow)}
        {models.others
          .filter((model) => !isOfferedQdnModel(model))
          .map((model) => {
            const ready = model.status === 'ready';
            const tooBig = ready && !modelFitsMemory(model.sizeBytes, tier);
            const details = [
              ...(model.sizeBytes ? [formatBytes(model.sizeBytes)] : []),
              model.source === 'file'
                ? t('core:qortino_agent.models.source_file')
                : t('core:qortino_agent.models.on_computer'),
            ].join(' · ');
            return (
              <Box key={model.id}>
                <ModelRow
                  selected={models.activeId === model.id}
                  disabled={!ready}
                  title={model.label}
                  details={details}
                  onSelect={() => setActiveQortinoModel(model.id)}
                >
                  {removeButton(model.id)}
                </ModelRow>
                {/* From a web link (an earlier test build), or a model from
                    QDN this build no longer offers: nothing carries it on. */}
                {!ready ? (
                  <RowNote tone="warning">
                    {t('core:qortino_agent.models.download_unsupported')}
                  </RowNote>
                ) : null}
                {tooBig ? (
                  <RowNote tone="warning">
                    {t('core:qortino_agent.models.too_big', {
                      ram: formatBytes(tier?.totalRamBytes ?? 0),
                    })}
                  </RowNote>
                ) : null}
                {removeParts(
                  model.id,
                  model.source === 'file'
                    ? t('core:qortino_agent.models.remove_confirm_file')
                    : t('core:qortino_agent.models.remove_confirm_hub')
                )}
              </Box>
            );
          })}
      </Box>
      <Button
        onClick={() => void pickFile()}
        startIcon={<FolderOpenRoundedIcon />}
        sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
        variant="outlined"
        size="small"
      >
        {t('core:qortino_agent.models.add_file')}
      </Button>
      <Typography
        sx={{
          color: alpha(theme.palette.text.primary, 0.55),
          fontSize: '0.68rem',
        }}
      >
        {t('core:qortino_agent.models.file_hint')}
      </Typography>
      {addError ? (
        <Typography
          role="alert"
          sx={{ color: theme.palette.error.main, fontSize: '0.74rem' }}
        >
          {addError}
        </Typography>
      ) : null}
      {tier?.totalRamBytes ? (
        <Typography
          sx={{
            color: alpha(theme.palette.text.primary, 0.55),
            fontSize: '0.68rem',
          }}
        >
          {t('core:qortino_agent.models.memory', {
            ram: formatBytes(tier.totalRamBytes),
          })}
        </Typography>
      ) : null}
    </QortinoSettingsGroup>
  );
}
