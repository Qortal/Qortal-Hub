import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Radio,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatBytes,
  modelTotalBytes,
  QORTINO_MODEL,
} from '../../../qortinoAgent/manifest';
import {
  addFileModel,
  addLinkModel,
  cancelOtherModelDownload,
  isLaterSplitPart,
  isOtherModelLink,
  QORTINO_OWN_MODEL_ID,
  removeOtherModel,
  retryOtherModelDownload,
  setActiveQortinoModel,
  SUGGESTED_OTHER_MODELS,
  useOtherModelDownloads,
  useQortinoModels,
  type OtherModel,
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

function linkHost(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

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

/**
 * Which model Qortino talks with: his own (from QDN), or open models the
 * user added from a file or a download link.
 */
export function QortinoModelsSection({ install, onUseQortino }: Props) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const models = useQortinoModels();
  const downloads = useOtherModelDownloads();
  const [tier, setTier] = useState<QortinoDeviceTier | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{
    id: string;
    reason: string;
  } | null>(null);

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

  const qortinoInstalled = Boolean(install.installed && install.llmPath);
  const qortinoDetails = [
    t('core:qortino_agent.models.recommended'),
    formatBytes(modelTotalBytes()),
    qortinoInstalled
      ? t('core:qortino_agent.models.on_computer')
      : t('core:qortino_agent.models.from_qdn'),
  ].join(' · ');

  const detailsOf = (model: OtherModel): string => {
    const parts: string[] = [];
    if (model.sizeBytes) parts.push(formatBytes(model.sizeBytes));
    parts.push(
      model.source === 'file'
        ? t('core:qortino_agent.models.source_file')
        : t('core:qortino_agent.models.source_link', {
            host: linkHost(model.url),
          })
    );
    return parts.join(' · ');
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
        {models.others.map((model) => {
          const progress = downloads[model.id];
          const ready = model.status === 'ready';
          const tooBig = ready && !modelFitsMemory(model.sizeBytes, tier);
          return (
            <Box key={model.id}>
              <ModelRow
                selected={models.activeId === model.id}
                disabled={!ready}
                title={model.label}
                details={detailsOf(model)}
                onSelect={() => setActiveQortinoModel(model.id)}
              >
                {model.status === 'failed' ? (
                  <IconButton
                    aria-label={t('core:qortino_agent.models.retry')}
                    onClick={() => void retryOtherModelDownload(model.id)}
                    size="small"
                    title={t('core:qortino_agent.models.retry')}
                  >
                    <RefreshRoundedIcon fontSize="small" />
                  </IconButton>
                ) : null}
                {model.status === 'downloading' ? (
                  <IconButton
                    aria-label={t('core:qortino_agent.models.cancel_download')}
                    onClick={() => void cancelOtherModelDownload(model.id)}
                    size="small"
                    title={t('core:qortino_agent.models.cancel_download')}
                  >
                    <CloseRoundedIcon fontSize="small" />
                  </IconButton>
                ) : (
                  <IconButton
                    aria-label={t('core:qortino_agent.models.remove')}
                    onClick={() => setConfirmRemove(model.id)}
                    size="small"
                    title={t('core:qortino_agent.models.remove')}
                  >
                    <DeleteOutlineRoundedIcon fontSize="small" />
                  </IconButton>
                )}
              </ModelRow>
              {model.status === 'downloading' ? (
                <Box sx={{ px: 1, pt: 0.5 }}>
                  <LinearProgress
                    variant={
                      progress?.bytesTotal ? 'determinate' : 'indeterminate'
                    }
                    value={
                      progress?.bytesTotal
                        ? (progress.bytesReceived / progress.bytesTotal) * 100
                        : 0
                    }
                  />
                  <Typography
                    sx={{ fontSize: '0.68rem', mt: 0.35, opacity: 0.7 }}
                  >
                    {progress?.bytesTotal
                      ? t('core:qortino_agent.models.downloading_bytes', {
                          done: formatBytes(progress.bytesReceived),
                          total: formatBytes(progress.bytesTotal),
                        })
                      : t('core:qortino_agent.models.downloading')}
                  </Typography>
                </Box>
              ) : null}
              {model.status === 'failed' ? (
                <Typography
                  sx={{
                    color: theme.palette.warning.main,
                    fontSize: '0.7rem',
                    pt: 0.4,
                    px: 1,
                  }}
                >
                  {model.error
                    ? t('core:qortino_agent.models.failed_reason', {
                        reason: model.error,
                      })
                    : t('core:qortino_agent.models.stopped')}
                </Typography>
              ) : null}
              {removeError?.id === model.id ? (
                <Typography
                  role="alert"
                  sx={{
                    color: theme.palette.error.main,
                    fontSize: '0.7rem',
                    pt: 0.4,
                    px: 1,
                  }}
                >
                  {t('core:qortino_agent.models.remove_failed', {
                    reason: removeError.reason,
                  })}
                </Typography>
              ) : null}
              {tooBig ? (
                <Typography
                  sx={{
                    color: theme.palette.warning.main,
                    fontSize: '0.7rem',
                    pt: 0.4,
                    px: 1,
                  }}
                >
                  {t('core:qortino_agent.models.too_big', {
                    ram: formatBytes(tier?.totalRamBytes ?? 0),
                  })}
                </Typography>
              ) : null}
              {confirmRemove === model.id ? (
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
                  <Typography sx={{ flex: 1, fontSize: '0.74rem' }}>
                    {model.source === 'link'
                      ? t('core:qortino_agent.models.remove_confirm_link')
                      : t('core:qortino_agent.models.remove_confirm_file')}
                  </Typography>
                  <Button
                    onClick={() => setConfirmRemove(null)}
                    size="small"
                    sx={{ textTransform: 'none' }}
                  >
                    {t('core:action.cancel', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Button>
                  <Button
                    color="error"
                    onClick={() => {
                      setConfirmRemove(null);
                      setRemoveError(null);
                      void removeOtherModel(model.id).catch((e: unknown) =>
                        setRemoveError({
                          id: model.id,
                          reason: e instanceof Error ? e.message : String(e),
                        })
                      );
                    }}
                    size="small"
                    sx={{ textTransform: 'none' }}
                    variant="contained"
                  >
                    {t('core:action.remove', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Button>
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Button
        onClick={() => setAdding(true)}
        startIcon={<AddRoundedIcon />}
        sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
        variant="outlined"
        size="small"
      >
        {t('core:qortino_agent.models.add')}
      </Button>
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
      <QortinoAddModelDialog
        open={adding}
        onClose={() => setAdding(false)}
        tier={tier}
      />
    </QortinoSettingsGroup>
  );
}

function QortinoAddModelDialog({
  open,
  onClose,
  tier,
}: {
  open: boolean;
  onClose: () => void;
  tier: QortinoDeviceTier | null;
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { t } = useTranslation(['core']);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl('');
    setLabel('');
    setError('');
    setBusy(false);
  }, [open]);

  const pickFile = async () => {
    setError('');
    try {
      const file = await QortinoLlm.pickModelFile({
        title: t('core:qortino_agent.models.pick_title'),
        filterName: t('core:qortino_agent.models.pick_filter'),
      });
      if (!file) return;
      if (isLaterSplitPart(file.name)) {
        setError(t('core:qortino_agent.models.first_part'));
        return;
      }
      addFileModel(file);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const download = async () => {
    setError('');
    if (!isOtherModelLink(url)) {
      setError(t('core:qortino_agent.models.invalid_link'));
      return;
    }
    if (!/\.gguf(\?|#|$)/i.test(url.trim())) {
      setError(t('core:qortino_agent.models.gguf_only'));
      return;
    }
    setBusy(true);
    try {
      await addLinkModel({ url, label });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      sx={{ zIndex: theme.zIndex.modal + 10 }}
    >
      <DialogTitle sx={{ fontWeight: 800, pb: 0.5 }}>
        {t('core:qortino_agent.models.add_title')}
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        <Typography
          sx={{
            color: alpha(theme.palette.text.primary, 0.75),
            fontSize: '0.84rem',
            lineHeight: 1.45,
          }}
        >
          {t('core:qortino_agent.models.add_intro')}
        </Typography>
        <Box
          sx={{
            border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
            p: 1.25,
          }}
        >
          <Typography sx={{ fontSize: '0.86rem', fontWeight: 800 }}>
            {t('core:qortino_agent.models.file_heading')}
          </Typography>
          <Typography sx={{ fontSize: '0.76rem', opacity: 0.72 }}>
            {t('core:qortino_agent.models.file_hint')}
          </Typography>
          <Button
            onClick={() => void pickFile()}
            startIcon={<FolderOpenRoundedIcon />}
            sx={{ alignSelf: 'flex-start', textTransform: 'none' }}
            variant="outlined"
          >
            {t('core:qortino_agent.models.choose_file')}
          </Button>
        </Box>
        <Box
          sx={{
            border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            p: 1.25,
          }}
        >
          <Typography sx={{ fontSize: '0.86rem', fontWeight: 800 }}>
            {t('core:qortino_agent.models.link_heading')}
          </Typography>
          <TextField
            label={t('core:qortino_agent.models.link_label')}
            placeholder="https://…/model-Q4_K_M.gguf"
            size="small"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            fullWidth
          />
          <TextField
            label={t('core:qortino_agent.models.name_label')}
            size="small"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            inputProps={{ maxLength: 80 }}
            fullWidth
          />
          <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, mt: 0.5 }}>
            {t('core:qortino_agent.models.suggested')}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {SUGGESTED_OTHER_MODELS.map((model) => {
              const chosen = url.trim() === model.url;
              const fits = modelFitsMemory(model.sizeBytes, tier);
              return (
                <ButtonBase
                  key={model.id}
                  onClick={() => {
                    setUrl(model.url);
                    setLabel(model.label);
                    setError('');
                  }}
                  sx={{
                    alignItems: 'center',
                    background: chosen
                      ? alpha(ACCENT, isDark ? 0.18 : 0.12)
                      : 'transparent',
                    border: `1px solid ${chosen ? alpha(ACCENT, 0.7) : alpha(theme.palette.divider, 0.5)}`,
                    borderRadius: '10px',
                    display: 'flex',
                    gap: 1,
                    justifyContent: 'space-between',
                    px: 1,
                    py: 0.6,
                    textAlign: 'left',
                  }}
                >
                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>
                    {model.label}
                  </Typography>
                  <Typography
                    sx={{
                      color: fits
                        ? alpha(theme.palette.text.primary, 0.6)
                        : theme.palette.warning.main,
                      flexShrink: 0,
                      fontSize: '0.7rem',
                    }}
                  >
                    {`${formatBytes(model.sizeBytes)} · ${model.license}`}
                  </Typography>
                </ButtonBase>
              );
            })}
          </Box>
          <Typography
            sx={{ fontSize: '0.7rem', opacity: 0.65, lineHeight: 1.4 }}
          >
            {t('core:qortino_agent.models.link_note')}
          </Typography>
        </Box>
        {error ? (
          <Typography
            role="alert"
            sx={{ color: theme.palette.error.main, fontSize: '0.8rem' }}
          >
            {error}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
        </Button>
        <Button
          disabled={busy || !url.trim()}
          onClick={() => void download()}
          startIcon={<DownloadRoundedIcon />}
          sx={{ textTransform: 'none' }}
          variant="contained"
        >
          {t('core:qortino_agent.models.download')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
