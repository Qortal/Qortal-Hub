import { Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { ComponentProps } from 'react';

type ProgressiveBlurProps = Omit<ComponentProps<typeof Box>, 'position'> & {
  blurStrength?: number;
  height?: number | string;
  position?: 'bottom' | 'top';
  tintColor?: string;
};

export const ProgressiveBlur = ({
  blurStrength = 16,
  height = '50%',
  position = 'bottom',
  sx,
  tintColor = '#ffffff',
  ...rest
}: ProgressiveBlurProps) => {
  const isBottom = position === 'bottom';
  const blurMask = isBottom
    ? 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.12) 18%, rgba(0,0,0,0.34) 42%, rgba(0,0,0,0.72) 72%, rgba(0,0,0,1) 100%)'
    : 'linear-gradient(0deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.12) 18%, rgba(0,0,0,0.34) 42%, rgba(0,0,0,0.72) 72%, rgba(0,0,0,1) 100%)';
  const tintGradient = isBottom
    ? `linear-gradient(180deg, ${alpha(tintColor, 0)} 0%, ${alpha(
        tintColor,
        0.08
      )} 24%, ${alpha(tintColor, 0.22)} 52%, ${alpha(
        tintColor,
        0.5
      )} 78%, ${alpha(tintColor, 0.82)} 100%)`
    : `linear-gradient(0deg, ${alpha(tintColor, 0)} 0%, ${alpha(
        tintColor,
        0.08
      )} 24%, ${alpha(tintColor, 0.22)} 52%, ${alpha(
        tintColor,
        0.5
      )} 78%, ${alpha(tintColor, 0.82)} 100%)`;
  const sheenGradient = isBottom
    ? `linear-gradient(180deg, ${alpha(tintColor, 0)} 0%, ${alpha(
        tintColor,
        0.03
      )} 38%, ${alpha(tintColor, 0.1)} 68%, ${alpha(
        tintColor,
        0.18
      )} 100%)`
    : `linear-gradient(0deg, ${alpha(tintColor, 0)} 0%, ${alpha(
        tintColor,
        0.03
      )} 38%, ${alpha(tintColor, 0.1)} 68%, ${alpha(
        tintColor,
        0.18
      )} 100%)`;

  return (
    <Box
      aria-hidden="true"
      sx={{
        height,
        insetInline: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        position: 'absolute',
        [position]: 0,
        ...sx,
      }}
      {...rest}
    >
      <Box
        sx={{
          backdropFilter: `blur(${blurStrength}px) saturate(118%)`,
          inset: 0,
          maskImage: blurMask,
          maskRepeat: 'no-repeat',
          maskSize: '100% 100%',
          position: 'absolute',
          WebkitBackdropFilter: `blur(${blurStrength}px) saturate(118%)`,
          WebkitMaskImage: blurMask,
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskSize: '100% 100%',
        }}
      />
      <Box
        sx={{
          background: tintGradient,
          inset: 0,
          position: 'absolute',
        }}
      />
      <Box
        sx={{
          background: sheenGradient,
          inset: 0,
          position: 'absolute',
        }}
      />
    </Box>
  );
};
