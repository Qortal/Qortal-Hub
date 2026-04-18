import { alpha, type Theme } from '@mui/material/styles';

export const APP_BLUE = {
  primary: '#84AFF0',
  hover: '#6FA3F0',
  pressed: '#5A8FE0',
  soft: 'rgba(132, 175, 240, 0.12)',
  glow: 'rgba(132, 175, 240, 0.25)',
  gradientTop: '#8FB8F3',
  gradientMid: '#79AAF0',
  gradientBottom: '#6FA3F0',
  gradientHoverTop: '#98BFF6',
  gradientHoverMid: '#83B1F3',
  gradientHoverBottom: '#76A7F1',
  gradientPressedTop: '#7FAEF0',
  gradientPressedBottom: '#6F9FE7',
} as const;

export const APP_BLUE_SURFACE_TEXT = 'rgba(10, 18, 30, 0.92)';

type AmbientIntensity = 'soft' | 'medium' | 'strong';

const getAmbientStrength = (intensity: AmbientIntensity) => {
  if (intensity === 'strong') {
    return {
      halo: 0.17,
      shoulder: 0.18,
      core: 0.52,
      field: 0.072,
      line: 0.11,
    };
  }

  if (intensity === 'medium') {
    return {
      halo: 0.12,
      shoulder: 0.14,
      core: 0.42,
      field: 0.056,
      line: 0.082,
    };
  }

  return {
    halo: 0.09,
    shoulder: 0.1,
    core: 0.3,
    field: 0.042,
    line: 0.06,
  };
};

export const getBlueTier1Gradient = (
  state: 'base' | 'hover' | 'pressed' = 'base'
) => {
  if (state === 'hover') {
    return `linear-gradient(180deg, ${APP_BLUE.gradientHoverTop} 0%, ${APP_BLUE.gradientHoverMid} 42%, ${APP_BLUE.gradientHoverBottom} 100%)`;
  }

  if (state === 'pressed') {
    return `linear-gradient(180deg, ${APP_BLUE.gradientPressedTop} 0%, ${APP_BLUE.gradientPressedBottom} 100%)`;
  }

  return `linear-gradient(180deg, ${APP_BLUE.gradientTop} 0%, ${APP_BLUE.gradientMid} 42%, ${APP_BLUE.gradientBottom} 100%)`;
};

export const getBlueTier1Shadow = (
  state: 'base' | 'hover' | 'pressed' = 'base'
) => {
  if (state === 'hover') {
    return '0 8px 22px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(255, 255, 255, 0.04) inset, 0 0 22px rgba(132, 175, 240, 0.22)';
  }

  if (state === 'pressed') {
    return '0 4px 12px rgba(0, 0, 0, 0.24), 0 0 0 1px rgba(255, 255, 255, 0.02) inset, 0 0 12px rgba(132, 175, 240, 0.14)';
  }

  return '0 6px 18px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(255, 255, 255, 0.03) inset, 0 0 18px rgba(132, 175, 240, 0.18)';
};

export const getBlueTier1ButtonSx = () => ({
  appearance: 'none',
  background: getBlueTier1Gradient('base'),
  border: '1px solid rgba(143, 184, 243, 0.22)',
  boxShadow: getBlueTier1Shadow('base'),
  color: APP_BLUE_SURFACE_TEXT,
  '&:hover': {
    background: getBlueTier1Gradient('hover'),
    boxShadow: getBlueTier1Shadow('hover'),
    filter: 'saturate(1.02)',
  },
  '&:active': {
    background: getBlueTier1Gradient('pressed'),
    boxShadow: getBlueTier1Shadow('pressed'),
    transform: 'translateY(1px)',
  },
  '&:focus-visible': {
    boxShadow:
      '0 0 0 2px rgba(132, 175, 240, 0.28), 0 6px 18px rgba(0, 0, 0, 0.28), 0 0 18px rgba(132, 175, 240, 0.18)',
    outline: 'none',
  },
});

export const getBlueTier1PillSurface = (theme: Theme) => ({
  background:
    theme.palette.mode === 'dark'
      ? `linear-gradient(180deg, ${alpha(APP_BLUE.gradientTop, 0.96)} 0%, ${alpha(
          APP_BLUE.gradientMid,
          0.92
        )} 42%, ${alpha(APP_BLUE.gradientBottom, 0.88)} 100%)`
      : `linear-gradient(180deg, ${alpha(APP_BLUE.gradientTop, 0.92)} 0%, ${alpha(
          APP_BLUE.gradientMid,
          0.88
        )} 42%, ${alpha(APP_BLUE.gradientBottom, 0.84)} 100%)`,
  boxShadow:
    '0 4px 14px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(255, 255, 255, 0.045) inset, 0 0 12px rgba(132, 175, 240, 0.13)',
});

export const getBlueTier2BadgeSx = (theme: Theme, active = false) => ({
  background: active
    ? `linear-gradient(180deg, ${alpha(APP_BLUE.hover, 0.84)} 0%, ${alpha(
        APP_BLUE.pressed,
        0.94
      )} 100%)`
    : `linear-gradient(180deg, ${alpha(
        APP_BLUE.gradientTop,
        theme.palette.mode === 'dark' ? 0.34 : 0.26
      )} 0%, ${alpha(
        APP_BLUE.gradientBottom,
        theme.palette.mode === 'dark' ? 0.22 : 0.18
      )} 100%)`,
  border: `1px solid ${
    active
      ? alpha(APP_BLUE.gradientTop, theme.palette.mode === 'dark' ? 0.26 : 0.22)
      : alpha(APP_BLUE.gradientTop, theme.palette.mode === 'dark' ? 0.22 : 0.17)
  }`,
  boxShadow: active
    ? '0 3px 10px rgba(0, 0, 0, 0.16), 0 0 0 1px rgba(255, 255, 255, 0.03) inset, 0 0 10px rgba(132, 175, 240, 0.12)'
    : `0 0 0 1px rgba(255, 255, 255, ${
        theme.palette.mode === 'dark' ? 0.03 : 0.02
      }) inset, 0 0 8px rgba(132, 175, 240, ${
        theme.palette.mode === 'dark' ? 0.06 : 0.04
      })`,
});

export const getBlueTier3DotSx = (theme: Theme, filled: boolean) =>
  filled
    ? {
        background: `linear-gradient(180deg, ${alpha(APP_BLUE.gradientTop, 0.9)} 0%, ${alpha(
          APP_BLUE.gradientBottom,
          0.82
        )} 100%)`,
        boxShadow: `0 0 0 1px ${alpha(APP_BLUE.gradientTop, 0.18)}, 0 0 10px ${alpha(
          APP_BLUE.primary,
          theme.palette.mode === 'dark' ? 0.12 : 0.08
        )}`,
      }
    : {
        background:
          theme.palette.mode === 'dark'
            ? 'rgba(255,255,255,0.06)'
            : 'rgba(27,29,36,0.08)',
        boxShadow: 'none',
      };

export const getBlueTier3StepperState = (
  isDarkMode: boolean,
  status: 'inactive' | 'active' | 'complete'
) => {
  if (status === 'inactive') {
    return {
      background:
        isDarkMode ? 'rgba(255,255,255,0.06)' : 'rgba(27,29,36,0.08)',
      borderColor:
        isDarkMode ? 'rgba(255,255,255,0.16)' : 'rgba(27,29,36,0.14)',
      boxShadow: 'none',
      scale: 1,
    };
  }

  if (status === 'complete') {
    return {
      background: `linear-gradient(180deg, ${alpha(APP_BLUE.hover, 0.82)} 0%, ${alpha(
        APP_BLUE.pressed,
        0.88
      )} 100%)`,
      borderColor: alpha(APP_BLUE.gradientTop, 0.28),
      boxShadow: '0 0 0 1px rgba(255,255,255,0.02) inset',
      scale: 1,
    };
  }

  return {
    background: getBlueTier1Gradient('base'),
    borderColor: alpha(APP_BLUE.gradientTop, 0.28),
    boxShadow: isDarkMode
      ? '0 0 0 1px rgba(143,184,243,0.22), 0 0 12px rgba(132,175,240,0.16)'
      : '0 0 0 1px rgba(143,184,243,0.18), 0 0 8px rgba(132,175,240,0.1)',
    scale: 1,
  };
};

export const getBlueTier3ProgressBackground = () =>
  `linear-gradient(90deg, ${APP_BLUE.gradientTop} 0%, ${APP_BLUE.primary} 58%, ${APP_BLUE.hover} 100%)`;

export const getBlueAmbientSeamBackground = (
  theme: Theme,
  intensity: AmbientIntensity = 'medium'
) => {
  const strength = getAmbientStrength(intensity);

  if (theme.palette.mode === 'dark') {
    return `linear-gradient(90deg, transparent 0%, rgba(60, 76, 90, 0) 12%, rgba(60, 76, 90, ${strength.shoulder * 0.72}) 26%, rgba(132, 175, 240, ${strength.shoulder}) 40%, rgba(132, 175, 240, ${strength.core * 0.82}) 46%, rgba(132, 175, 240, ${strength.core}) 50%, rgba(132, 175, 240, ${strength.core * 0.82}) 54%, rgba(132, 175, 240, ${strength.shoulder}) 60%, rgba(60, 76, 90, ${strength.shoulder * 0.72}) 74%, rgba(60, 76, 90, 0) 88%, transparent 100%), radial-gradient(92% 92% at 50% 100%, rgba(132, 175, 240, ${strength.halo}) 0%, rgba(132, 175, 240, ${strength.halo * 0.56}) 30%, rgba(14, 15, 20, 0.032) 52%, transparent 76%)`;
  }

  return `linear-gradient(90deg, transparent 0%, rgba(60, 76, 90, 0) 12%, rgba(60, 76, 90, ${strength.shoulder * 0.44}) 26%, rgba(132, 175, 240, ${strength.shoulder * 0.52}) 44%, rgba(132, 175, 240, ${strength.core * 0.38}) 50%, rgba(132, 175, 240, ${strength.shoulder * 0.52}) 56%, rgba(60, 76, 90, ${strength.shoulder * 0.44}) 74%, rgba(60, 76, 90, 0) 88%, transparent 100%), radial-gradient(92% 92% at 50% 100%, rgba(132, 175, 240, ${strength.halo * 0.5}) 0%, rgba(132, 175, 240, ${strength.halo * 0.24}) 30%, rgba(14, 15, 20, 0.014) 52%, transparent 76%)`;
};

export const getBlueAmbientFieldBackground = (
  theme: Theme,
  intensity: AmbientIntensity = 'soft'
) => {
  const strength = getAmbientStrength(intensity);

  if (theme.palette.mode === 'dark') {
    return `radial-gradient(88% 140% at 50% 0%, rgba(132, 175, 240, ${strength.field}) 0%, rgba(132, 175, 240, ${strength.field * 0.54}) 26%, rgba(14, 15, 20, 0.022) 56%, transparent 82%), linear-gradient(90deg, transparent 0%, rgba(132, 175, 240, ${strength.field * 0.18}) 18%, rgba(132, 175, 240, ${strength.field * 0.5}) 50%, rgba(132, 175, 240, ${strength.field * 0.18}) 82%, transparent 100%)`;
  }

  return `radial-gradient(88% 140% at 50% 0%, rgba(132, 175, 240, ${strength.field * 0.62}) 0%, rgba(132, 175, 240, ${strength.field * 0.34}) 26%, rgba(14, 15, 20, 0.014) 56%, transparent 82%), linear-gradient(90deg, transparent 0%, rgba(132, 175, 240, ${strength.field * 0.12}) 18%, rgba(132, 175, 240, ${strength.field * 0.34}) 50%, rgba(132, 175, 240, ${strength.field * 0.12}) 82%, transparent 100%)`;
};

export const getBlueAmbientLineBackground = (
  theme: Theme,
  intensity: AmbientIntensity = 'soft'
) => {
  const strength = getAmbientStrength(intensity);

  if (theme.palette.mode === 'dark') {
    return `linear-gradient(90deg, transparent 0%, rgba(60,76,90,0.02) 10%, rgba(60,76,90,0.07) 24%, rgba(132,175,240,${strength.line}) 50%, rgba(60,76,90,0.07) 76%, rgba(60,76,90,0.02) 90%, transparent 100%)`;
  }

  return `linear-gradient(90deg, transparent 0%, rgba(60,76,90,0.015) 10%, rgba(60,76,90,0.05) 24%, rgba(132,175,240,${strength.line * 0.72}) 50%, rgba(60,76,90,0.05) 76%, rgba(60,76,90,0.015) 90%, transparent 100%)`;
};

export const getBlueAmbientPillGlowBackground = (theme: Theme) => {
  if (theme.palette.mode === 'dark') {
    return 'radial-gradient(58% 136% at 50% 50%, rgba(132,175,240,0.096) 0%, rgba(132,175,240,0.058) 22%, rgba(132,175,240,0.026) 44%, rgba(14,15,20,0.01) 72%, transparent 100%)';
  }

  return 'radial-gradient(58% 136% at 50% 50%, rgba(132,175,240,0.06) 0%, rgba(132,175,240,0.034) 22%, rgba(132,175,240,0.015) 44%, rgba(255,255,255,0.006) 72%, transparent 100%)';
};
