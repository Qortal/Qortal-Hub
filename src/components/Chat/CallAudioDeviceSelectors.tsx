import {
  Box,
  Button,
  Collapse,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import SettingsVoiceRoundedIcon from '@mui/icons-material/SettingsVoiceRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { alpha } from '@mui/material/styles';
import { useAtom } from 'jotai';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import type { TooltipProps } from '@mui/material/Tooltip';
import { callAudioDevicesAtom } from '../../atoms/global';
import {
  ensureMicPermissionForLabels,
  listAudioDevices,
} from '../../lib/call/audioDevices';
import { traceGcallAudioSurface } from '../../lib/group-call/gcallAudioSurfaceTrace';

type CallAudioDeviceOption = {
  deviceId: string;
  groupId?: string;
  kind?: string;
  label: string;
};

type Props = {
  /** Match surrounding IconButton size in call toolbars */
  iconButtonSize?: 'small' | 'medium' | 'large';
  /** Toolbar glyph; defaults to voice-settings icon */
  IconComponent?: ComponentType<SvgIconProps>;
  /** Tooltip position; e.g. sidebar docks use `"left"` so popovers open away from the edge. */
  tooltipPlacement?: TooltipProps['placement'];
  /** Optional call-specific content shown below device controls. */
  advancedContent?: ReactNode;
  /** Optional advanced call-specific actions, such as diagnostics export. */
  advancedActions?: ReactNode;
};

/** Group/support call floaters use z-index 1400; modal defaults to 1300 and would sit underneath. */
const CALL_AUDIO_DIALOG_Z_INDEX = 1600;
/** Portaled Select menus must stack above the dialog backdrop + paper. */
const CALL_AUDIO_MENU_Z_INDEX = 1700;
const AUDIO_SURFACE_DEVICE_LIST_TIMEOUT_MS = 1500;

function defaultDeviceLabel(
  devices: CallAudioDeviceOption[],
  fallback: string
): string {
  const device =
    devices.find((d) => d.deviceId === 'default') ??
    devices.find((d) => d.label.toLowerCase().startsWith('default'));
  const label = device?.label?.trim();
  if (!label) return fallback;
  if (label.toLowerCase() === 'default') return fallback;
  return label.replace(/^default\s*[-–—:]\s*/i, '').trim() || fallback;
}

function normalizeDevice(device: MediaDeviceInfo): CallAudioDeviceOption {
  return {
    deviceId: device.deviceId,
    groupId: device.groupId,
    kind: device.kind,
    label: device.label,
  };
}

function parseAudioSurfaceDevicePayload(payload: unknown): {
  inputs: CallAudioDeviceOption[];
  outputs: CallAudioDeviceOption[];
} | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { inputs?: unknown; outputs?: unknown };
  if (!Array.isArray(record.inputs) || !Array.isArray(record.outputs)) {
    return null;
  }
  const normalize = (items: unknown[]): CallAudioDeviceOption[] =>
    items
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const d = item as Record<string, unknown>;
        if (typeof d.deviceId !== 'string') return null;
        const normalized: CallAudioDeviceOption = {
          deviceId: d.deviceId,
          groupId: typeof d.groupId === 'string' ? d.groupId : undefined,
          kind: typeof d.kind === 'string' ? d.kind : undefined,
          label: typeof d.label === 'string' ? d.label : '',
        };
        return normalized;
      })
      .filter((item): item is CallAudioDeviceOption => item !== null);
  return {
    inputs: normalize(record.inputs),
    outputs: normalize(record.outputs),
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | null> {
  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => resolve(null), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(null))
      .finally(() => window.clearTimeout(timeoutId));
  });
}

async function sendAudioSurfaceDevicePreferencesIfReady(preferences: {
  inputDeviceGroupId: string | null;
  inputDeviceId: string | null;
  inputDeviceLabel: string | null;
  outputDeviceGroupId: string | null;
  outputDeviceId: string | null;
  outputDeviceLabel: string | null;
}): Promise<void> {
  const audioSurface = window.audioSurface;
  if (!audioSurface) return;
  const ready = (await audioSurface.isReady?.().catch(() => false)) === true;
  if (!ready) return;
  await audioSurface.sendCommand({
    type: 'set-device-preferences',
    ...preferences,
  });
}

/**
 * In-call audio I/O: icon opens a dialog. Refreshes device lists every time the dialog
 * opens so plugging a mic in mid-session works without rejoining.
 */
export function CallAudioSettingsButton({
  iconButtonSize = 'small',
  IconComponent = SettingsVoiceRoundedIcon,
  tooltipPlacement,
  advancedContent,
  advancedActions,
}: Props) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useAtom(callAudioDevicesAtom);
  const [inputs, setInputs] = useState<CallAudioDeviceOption[]>([]);
  const [outputs, setOutputs] = useState<CallAudioDeviceOption[]>([]);
  const [outputSupported, setOutputSupported] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const hasAdvancedInformation = Boolean(advancedContent || advancedActions);

  useEffect(() => {
    const el = document.createElement('audio');
    setOutputSupported(typeof el.setSinkId === 'function');
  }, []);

  const loadDevices = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const audioSurface = window.audioSurface;
      const audioSurfaceReady =
        (await audioSurface?.isReady?.().catch(() => false)) === true;
      const audioSurfaceResponse =
        audioSurfaceReady && audioSurface
          ? await withTimeout(
              audioSurface.sendCommand({ type: 'list-audio-devices' }),
              AUDIO_SURFACE_DEVICE_LIST_TIMEOUT_MS
            )
          : null;
      const audioSurfaceDevices =
        audioSurfaceResponse?.ok === true
          ? parseAudioSurfaceDevicePayload(audioSurfaceResponse.payload)
          : null;
      if (audioSurfaceDevices) {
        setInputs(audioSurfaceDevices.inputs);
        setOutputs(audioSurfaceDevices.outputs);
      } else {
        await ensureMicPermissionForLabels();
        const { inputs: inList, outputs: outList } = await listAudioDevices();
        setInputs(inList.map(normalizeDevice));
        setOutputs(outList.map(normalizeDevice));
      }
    } catch (e) {
      setRefreshError(
        e instanceof Error ? e.message : 'Could not list devices'
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadDevices();
  }, [open, loadDevices]);

  useEffect(() => {
    if (!open) return;
    const onChange = () => {
      void loadDevices();
    };
    navigator.mediaDevices?.addEventListener('devicechange', onChange);
    return () =>
      navigator.mediaDevices?.removeEventListener('devicechange', onChange);
  }, [open, loadDevices]);

  const inputSelectValue = useMemo(() => {
    const id = prefs.inputDeviceId;
    if (!id) return '';
    return inputs.some((d) => d.deviceId === id) ? id : '';
  }, [prefs.inputDeviceId, inputs]);

  const outputSelectValue = useMemo(() => {
    const id = prefs.outputDeviceId;
    if (!id) return '';
    return outputs.some((d) => d.deviceId === id) ? id : '';
  }, [prefs.outputDeviceId, outputs]);

  const defaultInputLabel = useMemo(
    () => defaultDeviceLabel(inputs, 'System microphone'),
    [inputs]
  );

  const defaultOutputLabel = useMemo(
    () => defaultDeviceLabel(outputs, 'System speaker'),
    [outputs]
  );

  const selectMenuProps = {
    PaperProps: {
      sx: { maxHeight: 280 },
    },
    slotProps: {
      root: {
        sx: { zIndex: CALL_AUDIO_MENU_Z_INDEX },
      },
    },
  } as const;

  const onIn = (e: SelectChangeEvent<string>) => {
    const v = e.target.value;
    const inputDeviceId = v === '' ? null : v;
    const selected = inputs.find((d) => d.deviceId === inputDeviceId);
    const inputDeviceLabel = selected?.label ?? null;
    const inputDeviceGroupId = selected?.groupId ?? null;
    setPrefs((p) => ({
      ...p,
      inputDeviceGroupId,
      inputDeviceId,
      inputDeviceLabel,
    }));
    traceGcallAudioSurface('settings.devices: selected input', {
      hasGroupId: Boolean(inputDeviceGroupId),
      hasLabel: Boolean(inputDeviceLabel),
      inputDeviceId,
    });
    void sendAudioSurfaceDevicePreferencesIfReady({
      inputDeviceGroupId,
      inputDeviceId,
      inputDeviceLabel,
      outputDeviceGroupId: prefs.outputDeviceGroupId ?? null,
      outputDeviceId: prefs.outputDeviceId,
      outputDeviceLabel: prefs.outputDeviceLabel ?? null,
    });
  };

  const onOut = (e: SelectChangeEvent<string>) => {
    const v = e.target.value;
    const outputDeviceId = v === '' ? null : v;
    const selected = outputs.find((d) => d.deviceId === outputDeviceId);
    const outputDeviceLabel = selected?.label ?? null;
    const outputDeviceGroupId = selected?.groupId ?? null;
    setPrefs((p) => ({
      ...p,
      outputDeviceGroupId,
      outputDeviceId,
      outputDeviceLabel,
    }));
    traceGcallAudioSurface('settings.devices: selected output', {
      hasGroupId: Boolean(outputDeviceGroupId),
      hasLabel: Boolean(outputDeviceLabel),
      outputDeviceId,
    });
    void sendAudioSurfaceDevicePreferencesIfReady({
      inputDeviceGroupId: prefs.inputDeviceGroupId ?? null,
      inputDeviceId: prefs.inputDeviceId,
      inputDeviceLabel: prefs.inputDeviceLabel ?? null,
      outputDeviceGroupId,
      outputDeviceId,
      outputDeviceLabel,
    });
  };

  return (
    <>
      <Tooltip title="Call audio settings" placement={tooltipPlacement}>
        <IconButton
          size={iconButtonSize}
          onClick={() => setOpen(true)}
          aria-label="Call audio settings"
          sx={{ p: iconButtonSize === 'small' ? 0.5 : 1 }}
        >
          <IconComponent
            sx={{ fontSize: iconButtonSize === 'small' ? 18 : 22 }}
          />
        </IconButton>
      </Tooltip>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="xs"
        fullWidth
        disableScrollLock
        slotProps={{
          root: {
            sx: { zIndex: CALL_AUDIO_DIALOG_Z_INDEX },
          },
          paper: {
            sx: {
              background: isDarkMode
                ? 'linear-gradient(145deg, rgba(35,40,50,0.98) 0%, rgba(23,27,35,0.99) 100%)'
                : 'linear-gradient(180deg, rgba(251,253,255,0.99) 0%, rgba(241,245,250,0.99) 100%)',
              border: `1px solid ${alpha(
                isDarkMode
                  ? theme.palette.common.white
                  : theme.palette.text.primary,
                isDarkMode ? 0.09 : 0.1
              )}`,
              borderRadius: '8px',
              boxShadow: isDarkMode
                ? '0 28px 70px rgba(0,0,0,0.46)'
                : '0 24px 56px rgba(24,32,44,0.18)',
              overflow: 'hidden',
            },
          },
        }}
      >
        <DialogTitle
          sx={{
            fontSize: '1rem',
            fontWeight: 800,
            letterSpacing: '0.01em',
            px: 3,
            pb: 0.75,
            pt: 2.5,
          }}
        >
          Call audio
        </DialogTitle>
        <DialogContent sx={{ px: 3 }}>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ lineHeight: 1.55, mb: 2.25 }}
          >
            Choose your microphone and speaker. Lists refresh when you open this
            dialog.
          </Typography>

          {refreshing && (
            <Box
              sx={{ display: 'flex', justifyContent: 'center', py: 1, mb: 1 }}
            >
              <CircularProgress size={22} />
            </Box>
          )}

          {refreshError && (
            <Typography
              variant="caption"
              color="error"
              sx={{ display: 'block', mb: 1 }}
            >
              {refreshError}
            </Typography>
          )}

          <Box
            sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 0.5 }}
          >
            <FormControl size="small" fullWidth variant="outlined">
              <InputLabel id="qortal-call-mic-dialog">Microphone</InputLabel>
              <Select
                labelId="qortal-call-mic-dialog"
                label="Microphone"
                value={inputSelectValue}
                onChange={onIn}
                disabled={refreshing}
                MenuProps={selectMenuProps}
                sx={{
                  borderRadius: '8px',
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: alpha(theme.palette.text.primary, 0.18),
                  },
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: alpha(theme.palette.primary.main, 0.42),
                  },
                }}
              >
                <MenuItem value="">
                  <em>Default - {defaultInputLabel}</em>
                </MenuItem>
                {inputs.map((d, i) => (
                  <MenuItem key={d.deviceId || `in-${i}`} value={d.deviceId}>
                    {d.label || `Microphone ${i + 1}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {inputs.length === 0 && !refreshing && (
              <Typography
                variant="caption"
                color="warning.main"
                sx={{ mt: -1 }}
              >
                No microphones reported. Plug in a mic, then tap &quot;Refresh
                devices&quot;.
              </Typography>
            )}

            <FormControl
              size="small"
              fullWidth
              variant="outlined"
              disabled={!outputSupported || refreshing}
            >
              <InputLabel id="qortal-call-out-dialog">Speaker</InputLabel>
              <Select
                labelId="qortal-call-out-dialog"
                label="Speaker"
                value={outputSelectValue}
                onChange={onOut}
                MenuProps={selectMenuProps}
                sx={{
                  borderRadius: '8px',
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: alpha(theme.palette.text.primary, 0.18),
                  },
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: alpha(theme.palette.primary.main, 0.42),
                  },
                }}
              >
                <MenuItem value="">
                  <em>Default - {defaultOutputLabel}</em>
                </MenuItem>
                {outputs.map((d, i) => (
                  <MenuItem key={d.deviceId || `out-${i}`} value={d.deviceId}>
                    {d.label || `Speaker ${i + 1}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {!outputSupported && (
              <Typography variant="caption" color="text.secondary">
                Speaker selection is not available in this browser; playback
                uses the system default.
              </Typography>
            )}

            {hasAdvancedInformation && (
              <Box
                sx={{
                  border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}
              >
                <Button
                  fullWidth
                  onClick={() => setAdvancedOpen((prev) => !prev)}
                  endIcon={
                    <ExpandMoreRoundedIcon
                      sx={{
                        transform: advancedOpen
                          ? 'rotate(180deg)'
                          : 'rotate(0deg)',
                        transition: 'transform 160ms ease',
                      }}
                    />
                  }
                  sx={{
                    color: 'text.primary',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    justifyContent: 'space-between',
                    letterSpacing: '0.04em',
                    px: 1.5,
                    py: 1,
                    textTransform: 'uppercase',
                  }}
                >
                  Advanced information
                </Button>
                <Collapse in={advancedOpen} timeout="auto" unmountOnExit>
                  <Box
                    sx={{
                      borderTop: `1px solid ${alpha(
                        theme.palette.text.primary,
                        0.08
                      )}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1.25,
                      p: 1.25,
                    }}
                  >
                    {advancedContent}
                    {advancedActions}
                  </Box>
                </Collapse>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions
          sx={{
            borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
            gap: 1,
            justifyContent: 'space-between',
            mt: 0.5,
            px: 3,
            py: 2,
          }}
        >
          <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
            <Button
              onClick={() => void loadDevices()}
              disabled={refreshing}
              size="small"
            >
              Refresh devices
            </Button>
            <Button
              onClick={() => setOpen(false)}
              variant="contained"
              size="small"
              sx={{ borderRadius: '8px', fontWeight: 800, px: 2 }}
            >
              Done
            </Button>
          </Box>
        </DialogActions>
      </Dialog>
    </>
  );
}
