import {
  Box,
  Button,
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
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import SettingsVoiceRoundedIcon from '@mui/icons-material/SettingsVoiceRounded';
import { useAtom } from 'jotai';
import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import type { TooltipProps } from '@mui/material/Tooltip';
import { callAudioDevicesAtom } from '../../atoms/global';
import { ensureMicPermissionForLabels, listAudioDevices } from '../../lib/call/audioDevices';

type Props = {
  /** Match surrounding IconButton size in call toolbars */
  iconButtonSize?: 'small' | 'medium' | 'large';
  /** Toolbar glyph; defaults to voice-settings icon */
  IconComponent?: ComponentType<SvgIconProps>;
  /** Tooltip position; e.g. sidebar docks use `"left"` so popovers open away from the edge. */
  tooltipPlacement?: TooltipProps['placement'];
};

/** Group/support call floaters use z-index 1400; modal defaults to 1300 and would sit underneath. */
const CALL_AUDIO_DIALOG_Z_INDEX = 1600;
/** Portaled Select menus must stack above the dialog backdrop + paper. */
const CALL_AUDIO_MENU_Z_INDEX = 1700;

/**
 * In-call audio I/O: icon opens a dialog. Refreshes device lists every time the dialog
 * opens so plugging a mic in mid-session works without rejoining.
 */
export function CallAudioSettingsButton({
  iconButtonSize = 'small',
  IconComponent = SettingsVoiceRoundedIcon,
  tooltipPlacement,
}: Props) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useAtom(callAudioDevicesAtom);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [outputSupported, setOutputSupported] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    const el = document.createElement('audio');
    setOutputSupported(typeof el.setSinkId === 'function');
  }, []);

  const loadDevices = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await ensureMicPermissionForLabels();
      const { inputs: inList, outputs: outList } = await listAudioDevices();
      setInputs(inList);
      setOutputs(outList);
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : 'Could not list devices');
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
    return () => navigator.mediaDevices?.removeEventListener('devicechange', onChange);
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
    setPrefs((p) => ({ ...p, inputDeviceId: v === '' ? null : v }));
  };

  const onOut = (e: SelectChangeEvent<string>) => {
    const v = e.target.value;
    setPrefs((p) => ({ ...p, outputDeviceId: v === '' ? null : v }));
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
          <IconComponent sx={{ fontSize: iconButtonSize === 'small' ? 18 : 22 }} />
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
            sx: { borderRadius: 2 },
          },
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>Call audio</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose your microphone and speaker. Lists refresh when you open this dialog.
          </Typography>

          {refreshing && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 1, mb: 1 }}>
              <CircularProgress size={22} />
            </Box>
          )}

          {refreshError && (
            <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1 }}>
              {refreshError}
            </Typography>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 0.5 }}>
            <FormControl size="small" fullWidth variant="outlined">
              <InputLabel id="qortal-call-mic-dialog">Microphone</InputLabel>
              <Select
                labelId="qortal-call-mic-dialog"
                label="Microphone"
                value={inputSelectValue}
                onChange={onIn}
                disabled={refreshing}
                MenuProps={selectMenuProps}
              >
                <MenuItem value="">
                  <em>Default</em>
                </MenuItem>
                {inputs.map((d, i) => (
                  <MenuItem key={d.deviceId || `in-${i}`} value={d.deviceId}>
                    {d.label || `Microphone ${i + 1}`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {inputs.length === 0 && !refreshing && (
              <Typography variant="caption" color="warning.main" sx={{ mt: -1 }}>
                No microphones reported. Plug in a mic, then tap &quot;Refresh devices&quot;.
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
              >
                <MenuItem value="">
                  <em>Default</em>
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
                Speaker selection is not available in this browser; playback uses the system default.
              </Typography>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1, flexWrap: 'wrap' }}>
          <Button onClick={() => void loadDevices()} disabled={refreshing} size="small">
            Refresh devices
          </Button>
          <Button onClick={() => setOpen(false)} variant="contained" size="small">
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
