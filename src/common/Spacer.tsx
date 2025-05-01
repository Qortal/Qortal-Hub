import { Box } from '@mui/material';

export const Spacer = ({ height, width, ...props }: any) => {
  return (
    <Box
      sx={{
        height: height ? height : '0px',
        display: 'flex',
        flexShrink: 0,
        width: width ? width : '0px',
        ...(props || {}),
      }}
    />
  );
};
