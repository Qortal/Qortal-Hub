import { useRef } from 'react';
import { Theme } from '@mui/material/styles';

type DashboardPanelVariant = 'base' | 'accent' | 'utility';

const resolvePanelVariant = (theme: Theme, variant: DashboardPanelVariant) => {
  const isDarkMode = theme.palette.mode === 'dark';

  if (variant === 'accent') {
    return isDarkMode
      ? {
          backgroundColor: '#232730',
          backgroundImage:
            'linear-gradient(180deg, rgba(255,255,255,0.028) 0%, rgba(255,255,255,0.012) 34%, rgba(255,255,255,0) 100%)',
          borderColor: 'rgba(255,255,255,0.082)',
          boxShadow: '0 12px 24px rgba(0, 0, 0, 0.14)',
          topEdge: 'rgba(255,255,255,0.105)',
          topGlow:
            'radial-gradient(62% 36px at 50% 0%, rgba(132,175,240,0.19) 0%, rgba(132,175,240,0.09) 38%, rgba(132,175,240,0.03) 62%, transparent 82%)',
          topGlowOpacity: 1,
        }
      : {
          backgroundColor: '#F6F1E9',
          backgroundImage:
            'linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.26) 34%, rgba(255,255,255,0) 100%)',
          borderColor: 'rgba(28,36,52,0.08)',
          boxShadow: '0 12px 24px rgba(72, 58, 40, 0.08)',
          topEdge: 'rgba(255,255,255,0.76)',
          topGlow:
            'radial-gradient(62% 34px at 50% 0%, rgba(132,175,240,0.16) 0%, rgba(132,175,240,0.06) 44%, transparent 82%)',
          topGlowOpacity: 0.9,
        };
  }

  if (variant === 'utility') {
    return isDarkMode
      ? {
          backgroundColor: '#191c23',
          backgroundImage:
            'linear-gradient(180deg, rgba(255,255,255,0.016) 0%, rgba(255,255,255,0.006) 22%, rgba(255,255,255,0) 100%)',
          borderColor: 'rgba(255,255,255,0.06)',
          boxShadow: '0 10px 20px rgba(0, 0, 0, 0.1)',
          topEdge: 'rgba(255,255,255,0.075)',
          topGlow: 'none',
          topGlowOpacity: 0,
        }
      : {
          backgroundColor: '#F2ECE2',
          backgroundImage:
            'linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.2) 22%, rgba(255,255,255,0) 100%)',
          borderColor: 'rgba(28,36,52,0.07)',
          boxShadow: '0 10px 20px rgba(72, 58, 40, 0.06)',
          topEdge: 'rgba(255,255,255,0.68)',
          topGlow: 'none',
          topGlowOpacity: 0,
        };
  }

  return isDarkMode
    ? {
        backgroundColor: '#1D2027',
        backgroundImage:
          'linear-gradient(180deg, rgba(255,255,255,0.018) 0%, rgba(255,255,255,0.008) 22%, rgba(255,255,255,0) 100%)',
        borderColor: 'rgba(255,255,255,0.064)',
        boxShadow: '0 10px 22px rgba(0, 0, 0, 0.12)',
        topEdge: 'rgba(255,255,255,0.082)',
        topGlow: 'none',
        topGlowOpacity: 0,
      }
    : {
        backgroundColor: '#F7F1E8',
        backgroundImage:
          'linear-gradient(180deg, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.22) 22%, rgba(255,255,255,0) 100%)',
        borderColor: 'rgba(28,36,52,0.07)',
        boxShadow: '0 10px 20px rgba(72, 58, 40, 0.06)',
        topEdge: 'rgba(255,255,255,0.7)',
        topGlow: 'none',
        topGlowOpacity: 0,
      };
};

export const dashboardPanelSx = (
  theme: Theme,
  variant: DashboardPanelVariant = 'base'
) => {
  const surface = resolvePanelVariant(theme, variant);

  return {
    position: 'relative',
    overflow: 'visible',
    isolation: 'isolate',
    backgroundColor: surface.backgroundColor,
    border: `1px solid ${surface.borderColor}`,
    boxShadow: surface.boxShadow,
    backgroundImage: surface.backgroundImage,
    transition:
      'border-color 180ms ease, background-color 180ms ease, box-shadow 180ms ease, background-image 180ms ease',
    '&::before': {
      content: '""',
      position: 'absolute',
      left: '12px',
      right: '12px',
      top: 0,
      height: '1px',
      pointerEvents: 'none',
      zIndex: 0,
      background: `linear-gradient(90deg, transparent 0%, ${surface.topEdge} 16%, ${surface.topEdge} 84%, transparent 100%)`,
      opacity: 0.95,
    },
    '&::after': {
      content: '""',
      position: 'absolute',
      left: '18%',
      right: '18%',
      top: '-10px',
      height: '26px',
      pointerEvents: 'none',
      zIndex: -1,
      background: surface.topGlow,
      filter: 'blur(12px)',
      opacity: surface.topGlowOpacity,
    },
    '& > :not(.dashboard-panel-decoration)': {
      position: 'relative',
      zIndex: 1,
    },
  };
};

export const handleDashboardPanelPointerMove = (
  _event: React.MouseEvent<HTMLElement>
) => undefined;

export const handleDashboardPanelPointerLeave = (
  _event: React.MouseEvent<HTMLElement>
) => undefined;

export const useDashboardPanelMouseLight = <T extends HTMLElement>() => {
  return useRef<T | null>(null);
};
