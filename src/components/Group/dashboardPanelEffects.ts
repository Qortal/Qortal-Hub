import { useEffect, useRef } from 'react';
import { alpha, Theme } from '@mui/material/styles';

const PANEL_MOUSE_LIGHT_PROXIMITY_PX = 18;

export const dashboardPanelSx = (theme: Theme) => ({
  position: 'relative',
  overflow: 'visible',
  isolation: 'isolate',
  backgroundColor:
    theme.palette.mode === 'dark'
      ? theme.palette.background.surface
      : theme.palette.background.paper,
  border: `1px solid ${theme.palette.border.subtle}`,
  boxShadow:
    theme.palette.mode === 'dark'
      ? '0 12px 28px rgba(0, 0, 0, 0.16)'
      : '0 10px 22px rgba(15, 23, 42, 0.05)',
  backgroundImage:
    theme.palette.mode === 'dark'
      ? 'linear-gradient(180deg, #1D1F27 0%, #1B1D24 100%)'
      : `linear-gradient(180deg, rgba(255,255,255,0.72), rgba(255,255,255,0) 24%)`,
  transition:
    'border-color 180ms ease, background-color 180ms ease, box-shadow 180ms ease',
  '&::before': {
    content: '""',
    position: 'absolute',
    inset: '-8px -4px',
    pointerEvents: 'none',
    zIndex: -1,
    background:
      theme.palette.mode === 'dark'
        ? `radial-gradient(34% 18px at 18% 0%, rgba(60, 76, 90, 0.08), transparent 78%),
           radial-gradient(40% 20px at 82% 0%, rgba(60, 76, 90, 0.1), transparent 80%),
           radial-gradient(54% 24px at 50% 100%, rgba(60, 76, 90, 0.08), transparent 82%),
           radial-gradient(22% 16px at 14% 100%, rgba(60, 76, 90, 0.05), transparent 82%)`
        : `radial-gradient(34% 18px at 18% 0%, rgba(255, 255, 255, 0.24), transparent 78%),
           radial-gradient(40% 20px at 82% 0%, rgba(86, 155, 255, 0.08), transparent 80%),
           radial-gradient(54% 24px at 50% 100%, rgba(86, 155, 255, 0.07), transparent 82%),
           radial-gradient(22% 16px at 14% 100%, rgba(255, 255, 255, 0.12), transparent 82%)`,
    filter: 'blur(10px)',
    opacity: theme.palette.mode === 'dark' ? 0.92 : 0.82,
  },
  '&::after': {
    content: '""',
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    borderRadius: 'inherit',
    padding: '1px',
    background: `radial-gradient(320px circle at var(--panel-mx, 50%) var(--panel-my, 50%), ${alpha(
      '#3C4C5A',
      theme.palette.mode === 'dark' ? 0.24 : 0.16
    )} 0%, ${alpha(
      '#3C4C5A',
      theme.palette.mode === 'dark' ? 0.12 : 0.08
    )} 17%, transparent 46%) border-box`,
    WebkitMask:
      'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor',
    maskComposite: 'exclude',
    opacity: 'var(--panel-edge-opacity, 0)',
    transition: 'opacity 160ms ease',
    zIndex: 0,
  },
  '& > *': {
    position: 'relative',
    zIndex: 1,
  },
});

export const handleDashboardPanelPointerMove = (
  event: React.MouseEvent<HTMLElement>
) => {
  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  target.style.setProperty('--panel-mx', `${event.clientX - rect.left}px`);
  target.style.setProperty('--panel-my', `${event.clientY - rect.top}px`);
  target.style.setProperty('--panel-edge-opacity', '1');
};

export const handleDashboardPanelPointerLeave = (
  event: React.MouseEvent<HTMLElement>
) => {
  event.currentTarget.style.setProperty('--panel-edge-opacity', '0');
};

export const useDashboardPanelMouseLight = <T extends HTMLElement>() => {
  const panelRef = useRef<T | null>(null);

  useEffect(() => {
    const panelNode = panelRef.current;
    if (!panelNode) return;

    const resetLight = () => {
      panelNode.style.setProperty('--panel-edge-opacity', '0');
    };

    const updateLight = (event: MouseEvent) => {
      const rect = panelNode.getBoundingClientRect();
      const clampedX = Math.min(Math.max(event.clientX, rect.left), rect.right);
      const clampedY = Math.min(Math.max(event.clientY, rect.top), rect.bottom);
      const offsetX = event.clientX - clampedX;
      const offsetY = event.clientY - clampedY;
      const distance = Math.hypot(offsetX, offsetY);

      if (distance > PANEL_MOUSE_LIGHT_PROXIMITY_PX) {
        resetLight();
        return;
      }

      const relativeX = clampedX - rect.left;
      const relativeY = clampedY - rect.top;
      const intensity = Math.max(
        0,
        Math.min(1, 1 - distance / PANEL_MOUSE_LIGHT_PROXIMITY_PX)
      );
      const resolvedOpacity = rect.width > 0 && rect.height > 0
        ? Math.min(1, (0.2 + intensity * 0.9) * 1.5)
        : 0;

      panelNode.style.setProperty('--panel-mx', `${relativeX}px`);
      panelNode.style.setProperty('--panel-my', `${relativeY}px`);
      panelNode.style.setProperty(
        '--panel-edge-opacity',
        resolvedOpacity.toFixed(3)
      );
    };

    window.addEventListener('mousemove', updateLight, { passive: true });
    window.addEventListener('blur', resetLight);
    document.addEventListener('mouseleave', resetLight);

    return () => {
      window.removeEventListener('mousemove', updateLight);
      window.removeEventListener('blur', resetLight);
      document.removeEventListener('mouseleave', resetLight);
      resetLight();
    };
  }, []);

  return panelRef;
};
