import { alpha, Theme } from '@mui/material/styles';

export const dashboardPanelSx = (theme: Theme) => ({
  position: 'relative',
  overflow: 'visible',
  isolation: 'isolate',
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.border.subtle}`,
  boxShadow:
    theme.palette.mode === 'dark'
      ? '0 12px 28px rgba(0, 0, 0, 0.16)'
      : '0 10px 22px rgba(15, 23, 42, 0.05)',
  backgroundImage:
    theme.palette.mode === 'dark'
      ? `linear-gradient(180deg, rgba(255,255,255,0.024), rgba(255,255,255,0) 22%)`
      : `linear-gradient(180deg, rgba(255,255,255,0.72), rgba(255,255,255,0) 24%)`,
  transition:
    'border-color 180ms ease, background-color 180ms ease, box-shadow 180ms ease',
  '&::before': {
    content: '""',
    position: 'absolute',
    inset: '-10px',
    pointerEvents: 'none',
    zIndex: -1,
    background:
      theme.palette.mode === 'dark'
        ? `radial-gradient(120% 78% at 18% 8%, rgba(86, 155, 255, 0.125), transparent 40%),
           radial-gradient(86% 72% at 78% 16%, rgba(86, 155, 255, 0.07), transparent 44%),
           radial-gradient(62% 42% at 50% 100%, rgba(86, 155, 255, 0.02), transparent 52%)`
        : `radial-gradient(120% 78% at 18% 8%, rgba(86, 155, 255, 0.09), transparent 40%),
           radial-gradient(86% 72% at 78% 16%, rgba(86, 155, 255, 0.05), transparent 44%),
           radial-gradient(62% 42% at 50% 100%, rgba(86, 155, 255, 0.014), transparent 52%)`,
    filter: 'blur(16px)',
    opacity: 1,
  },
  '&::after': {
    content: '""',
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    borderRadius: 'inherit',
    padding: '1px',
    background: `radial-gradient(190px circle at var(--panel-mx, 50%) var(--panel-my, 50%), ${alpha(
      theme.palette.common.white,
      theme.palette.mode === 'dark' ? 0.16 : 0.12
    )}, transparent 38%) border-box`,
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
