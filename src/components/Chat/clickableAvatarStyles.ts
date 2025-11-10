import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

export const getClickableAvatarSx = (
  theme: Theme,
  isInteractive: boolean
): SxProps<Theme> => {
  const base: SxProps<Theme> = {
    cursor: isInteractive ? 'pointer' : 'default',
    transition: 'box-shadow 150ms ease, transform 150ms ease',
  };

  if (!isInteractive) {
    return base;
  }

  const glowColor = alpha(theme.palette.primary.main, 0.8);
  const fillColor = alpha(theme.palette.primary.main, 0.18);

  return {
    ...base,
    '&:hover': {
      boxShadow: `0 0 0 3px ${glowColor}`,
      backgroundColor: fillColor,
      transform: 'translateZ(0)',
    },
  };
};
