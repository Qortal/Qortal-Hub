import { Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { ComponentProps } from 'react';

type DotPatternProps = ComponentProps<typeof Box> & {
  color?: string;
  cr?: number;
  cx?: number;
  cy?: number;
  height?: number;
  width?: number;
};

export const DotPattern = ({
  color = '#8DB8FF',
  cr = 1,
  cx = 1,
  cy = 1,
  height = 20,
  sx,
  width = 20,
  ...rest
}: DotPatternProps) => {
  const innerDot = `${alpha(color, 0.72)} 0 ${cr}px, transparent ${cr + 0.45}px`;
  const outerGlow = `${alpha(color, 0.24)} 0 ${cr + 0.95}px, transparent ${
    cr + 1.95
  }px`;

  return (
    <Box
      aria-hidden="true"
      sx={{
        backgroundImage: `radial-gradient(circle at ${cx}px ${cy}px, ${innerDot}), radial-gradient(circle at ${cx}px ${cy}px, ${outerGlow})`,
        backgroundPosition: '0 0',
        backgroundRepeat: 'repeat',
        backgroundSize: `${width}px ${height}px`,
        height: '100%',
        inset: 0,
        position: 'absolute',
        width: '100%',
        ...sx,
      }}
      {...rest}
    />
  );
};
