import { Box, ButtonBase, Typography } from '@mui/material';
import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';

export type AuthGlowSettings = {
  cardGlowColor: string;
  cardGlowFade: number;
  cardGlowHeight: number;
  cardGlowIntensity: number;
  cardGlowWidth: number;
  cardGlowX: number;
  cardGlowY: number;
  edgeCenterColor: string;
  edgeCenterPosition: number;
  edgeCenterSize: number;
  edgeColor: string;
  edgeGlowIntensity: number;
  edgeHold: number;
};

type AuthGlowDebugPanelProps = {
  settings: AuthGlowSettings;
  onChange: (settings: AuthGlowSettings) => void;
};

export const AUTH_GLOW_DEBUG_STORAGE_KEY = 'qortal_auth_glow_debug_settings';
const AUTH_GLOW_DEBUG_OPEN_STORAGE_KEY = 'qortal_auth_glow_debug_open';

export const DEFAULT_AUTH_GLOW_SETTINGS: AuthGlowSettings = {
  cardGlowColor: '#2b7eff',
  cardGlowFade: 78,
  cardGlowHeight: 270,
  cardGlowIntensity: 0.34,
  cardGlowWidth: 500,
  cardGlowX: 50,
  cardGlowY: -8,
  edgeCenterColor: '#5d8cff',
  edgeCenterPosition: 50,
  edgeCenterSize: 24,
  edgeColor: '#9ab5e0',
  edgeGlowIntensity: 0.34,
  edgeHold: 24,
};

export function loadAuthGlowSettings(): AuthGlowSettings {
  if (typeof window === 'undefined') return DEFAULT_AUTH_GLOW_SETTINGS;

  try {
    const storedValue = window.localStorage.getItem(
      AUTH_GLOW_DEBUG_STORAGE_KEY
    );

    if (!storedValue) return DEFAULT_AUTH_GLOW_SETTINGS;

    const parsed = JSON.parse(storedValue) as Partial<AuthGlowSettings>;

    return {
      ...DEFAULT_AUTH_GLOW_SETTINGS,
      ...parsed,
    };
  } catch {
    return DEFAULT_AUTH_GLOW_SETTINGS;
  }
}

export function buildAuthCardGlowBackground(settings: AuthGlowSettings) {
  const primaryAlpha = clamp(settings.cardGlowIntensity, 0, 1);
  const secondaryAlpha = clamp(settings.cardGlowIntensity * 0.53, 0, 1);
  const washAlpha = clamp(settings.cardGlowIntensity * 0.53, 0, 1);

  return [
    `radial-gradient(ellipse ${settings.cardGlowWidth}px ${settings.cardGlowHeight}px at ${settings.cardGlowX}% ${settings.cardGlowY}%, ${rgbaFromHex(settings.cardGlowColor, primaryAlpha)}, ${rgbaFromHex(settings.cardGlowColor, secondaryAlpha)} 35%, transparent ${settings.cardGlowFade}%)`,
    `linear-gradient(180deg, ${rgbaFromHex(settings.cardGlowColor, washAlpha)} 0%, rgba(8,13,22,0) 44%)`,
  ].join(', ');
}

export function buildAuthEdgeGradient(settings: AuthGlowSettings) {
  const centerStart = clamp(
    settings.edgeCenterPosition - settings.edgeCenterSize / 2,
    0,
    100
  );
  const centerEnd = clamp(
    settings.edgeCenterPosition + settings.edgeCenterSize / 2,
    0,
    100
  );
  const leftHold = Math.min(settings.edgeHold, Math.max(centerStart - 1, 0));
  const rightHold = Math.max(100 - settings.edgeHold, centerEnd + 1);

  return [
    'linear-gradient(90deg',
    `${settings.edgeColor} 0%`,
    `${settings.edgeColor} ${leftHold}%`,
    `${settings.edgeCenterColor} ${centerStart}%`,
    `${settings.edgeCenterColor} ${centerEnd}%`,
    `${settings.edgeColor} ${Math.min(rightHold, 100)}%`,
    `${settings.edgeColor} 100%)`,
  ].join(', ');
}

export function rgbaFromHex(hex: string, alpha: number) {
  const normalized = hex.replace('#', '').trim();
  const fullHex =
    normalized.length === 3
      ? normalized
          .split('')
          .map((character) => `${character}${character}`)
          .join('')
      : normalized.padEnd(6, '0').slice(0, 6);
  const red = parseInt(fullHex.slice(0, 2), 16);
  const green = parseInt(fullHex.slice(2, 4), 16);
  const blue = parseInt(fullHex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${clamp(alpha, 0, 1)})`;
}

export function AuthGlowDebugPanel({
  settings,
  onChange,
}: AuthGlowDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(AUTH_GLOW_DEBUG_OPEN_STORAGE_KEY) === '1';
  });
  const settingsJson = useMemo(
    () => JSON.stringify(settings, null, 2),
    [settings]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(AUTH_GLOW_DEBUG_STORAGE_KEY, settingsJson);
  }, [settingsJson]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      AUTH_GLOW_DEBUG_OPEN_STORAGE_KEY,
      isOpen ? '1' : '0'
    );
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== 'g') {
        return;
      }

      event.preventDefault();
      setIsOpen((currentValue) => !currentValue);
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const updateSetting = <Key extends keyof AuthGlowSettings>(
    key: Key,
    value: AuthGlowSettings[Key]
  ) => {
    onChange({
      ...settings,
      [key]: value,
    });
  };

  const copySettings = async () => {
    try {
      await navigator.clipboard.writeText(settingsJson);
    } catch {
      // Clipboard access is optional for this debug-only tool.
    }
  };

  if (!isOpen) {
    return (
      <ButtonBase
        onClick={() => setIsOpen(true)}
        sx={{
          backgroundColor: 'rgba(13,20,32,0.92)',
          border: '1px solid rgba(120,158,222,0.18)',
          borderRadius: '8px',
          bottom: 18,
          color: 'rgba(214,221,233,0.74)',
          fontSize: '0.72rem',
          fontWeight: 600,
          left: 18,
          px: 1.1,
          py: 0.75,
          position: 'fixed',
          zIndex: 13000,
        }}
      >
        Glow debug
      </ButtonBase>
    );
  }

  return (
    <Box
      sx={{
        background:
          'linear-gradient(180deg, rgba(21,28,41,0.98), rgba(10,14,22,0.98))',
        border: '1px solid rgba(120,158,222,0.22)',
        borderRadius: '10px',
        bottom: 18,
        boxShadow: '0 22px 54px rgba(0,0,0,0.44)',
        color: 'rgba(236,241,250,0.92)',
        left: 18,
        maxHeight: 'calc(100vh - 36px)',
        overflowY: 'auto',
        p: 1.5,
        position: 'fixed',
        width: 340,
        zIndex: 13000,
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          mb: 1.25,
        }}
      >
        <Box>
          <Typography sx={{ fontSize: '0.92rem', fontWeight: 700 }}>
            Auth glow debug
          </Typography>
          <Typography
            sx={{ color: 'rgba(214,221,233,0.52)', fontSize: '0.72rem' }}
          >
            Ctrl + Shift + G toggles this panel
          </Typography>
        </Box>
        <ButtonBase sx={toolButtonSx} onClick={() => setIsOpen(false)}>
          Hide
        </ButtonBase>
      </Box>

      <DebugSection title="Card glow">
        <ColorControl
          label="Glow color"
          value={settings.cardGlowColor}
          onChange={(value) => updateSetting('cardGlowColor', value)}
        />
        <RangeControl
          label="Sideways spread"
          min={220}
          max={900}
          step={10}
          suffix="px"
          value={settings.cardGlowWidth}
          onChange={(value) => updateSetting('cardGlowWidth', value)}
        />
        <RangeControl
          label="Downward reach"
          min={120}
          max={620}
          step={10}
          suffix="px"
          value={settings.cardGlowHeight}
          onChange={(value) => updateSetting('cardGlowHeight', value)}
        />
        <RangeControl
          label="Horizontal origin"
          min={0}
          max={100}
          step={1}
          suffix="%"
          value={settings.cardGlowX}
          onChange={(value) => updateSetting('cardGlowX', value)}
        />
        <RangeControl
          label="Vertical origin"
          min={-30}
          max={30}
          step={1}
          suffix="%"
          value={settings.cardGlowY}
          onChange={(value) => updateSetting('cardGlowY', value)}
        />
        <RangeControl
          label="Intensity"
          min={0}
          max={1}
          step={0.01}
          value={settings.cardGlowIntensity}
          onChange={(value) => updateSetting('cardGlowIntensity', value)}
        />
        <RangeControl
          label="Fade edge"
          min={35}
          max={100}
          step={1}
          suffix="%"
          value={settings.cardGlowFade}
          onChange={(value) => updateSetting('cardGlowFade', value)}
        />
      </DebugSection>

      <DebugSection title="Card edge gradient">
        <ColorControl
          label="Edge color"
          value={settings.edgeColor}
          onChange={(value) => updateSetting('edgeColor', value)}
        />
        <ColorControl
          label="Center color"
          value={settings.edgeCenterColor}
          onChange={(value) => updateSetting('edgeCenterColor', value)}
        />
        <RangeControl
          label="Edge hold"
          min={0}
          max={48}
          step={1}
          suffix="%"
          value={settings.edgeHold}
          onChange={(value) => updateSetting('edgeHold', value)}
        />
        <RangeControl
          label="Center position"
          min={0}
          max={100}
          step={1}
          suffix="%"
          value={settings.edgeCenterPosition}
          onChange={(value) => updateSetting('edgeCenterPosition', value)}
        />
        <RangeControl
          label="Center size"
          min={0}
          max={80}
          step={1}
          suffix="%"
          value={settings.edgeCenterSize}
          onChange={(value) => updateSetting('edgeCenterSize', value)}
        />
        <RangeControl
          label="Edge intensity"
          min={0}
          max={1}
          step={0.01}
          value={settings.edgeGlowIntensity}
          onChange={(value) => updateSetting('edgeGlowIntensity', value)}
        />
      </DebugSection>

      <Box sx={{ display: 'flex', gap: 0.8, mt: 1.35 }}>
        <ButtonBase sx={toolButtonSx} onClick={copySettings}>
          Copy JSON
        </ButtonBase>
        <ButtonBase
          sx={toolButtonSx}
          onClick={() => onChange(DEFAULT_AUTH_GLOW_SETTINGS)}
        >
          Reset
        </ButtonBase>
      </Box>
    </Box>
  );
}

function DebugSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <Box
      sx={{
        borderTop: '1px solid rgba(255,255,255,0.07)',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.9,
        mt: 1.2,
        pt: 1.1,
      }}
    >
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function RangeControl({
  label,
  max,
  min,
  onChange,
  step,
  suffix = '',
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  suffix?: string;
  value: number;
}) {
  return (
    <Box>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          mb: 0.35,
        }}
      >
        <Typography sx={controlLabelSx}>{label}</Typography>
        <Typography sx={controlValueSx}>
          {Number.isInteger(value) ? value : value.toFixed(2)}
          {suffix}
        </Typography>
      </Box>
      <Box
        component="input"
        max={max}
        min={min}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onChange(Number(event.target.value))
        }
        step={step}
        type="range"
        value={value}
        sx={{
          accentColor: '#6da2ff',
          display: 'block',
          width: '100%',
        }}
      />
    </Box>
  );
}

function ColorControl({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        justifyContent: 'space-between',
      }}
    >
      <Typography sx={controlLabelSx}>{label}</Typography>
      <Box sx={{ alignItems: 'center', display: 'inline-flex', gap: 0.75 }}>
        <Typography sx={controlValueSx}>{value}</Typography>
        <Box
          component="input"
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onChange(event.target.value)
          }
          type="color"
          value={value}
          sx={{
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '6px',
            height: 28,
            p: 0.2,
            width: 42,
          }}
        />
      </Box>
    </Box>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const controlLabelSx = {
  color: 'rgba(214,221,233,0.7)',
  fontSize: '0.74rem',
  fontWeight: 500,
};

const controlValueSx = {
  color: 'rgba(236,241,250,0.82)',
  fontSize: '0.72rem',
  fontWeight: 600,
};

const toolButtonSx = {
  backgroundColor: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: '7px',
  color: 'rgba(236,241,250,0.78)',
  fontSize: '0.74rem',
  fontWeight: 600,
  px: 1,
  py: 0.6,
  '&:hover': {
    backgroundColor: 'rgba(255,255,255,0.065)',
    borderColor: 'rgba(255,255,255,0.14)',
  },
};
