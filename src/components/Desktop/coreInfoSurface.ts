import { alpha, type Theme } from '@mui/material/styles';

/**
 * The card the node's information shows on, in the title bar and the side
 * panel alike: Hub's paper, border and shadow, not a tooltip's.
 */
export const coreInfoSurfaceSx = (theme: Theme) => ({
  backgroundColor: theme.palette.background.paper,
  backgroundImage: 'none',
  border: `1px solid ${theme.palette.border?.main ?? theme.palette.divider}`,
  borderRadius: '12px',
  boxShadow: `0 14px 34px ${alpha('#000', theme.palette.mode === 'dark' ? 0.45 : 0.16)}`,
  color: theme.palette.text.primary,
  fontSize: 13,
  fontWeight: 400,
  maxWidth: 'none',
  px: 1.75,
  py: 1.5,
});
