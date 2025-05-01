import { useTheme } from '@mui/material';
import React from 'react';

export const CopyIcon = ({ color, height = 11, width = 10 }) => {
  const theme = useTheme();

  const setColor = color ? color : theme.palette.text.primary;
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 10 11"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M3.92857 0.5H8.57143C9.36071 0.5 10 1.13929 10 1.92857V6.57143C10 7.36071 9.36071 8 8.57143 8H8.21429V4.42857C8.21429 3.24643 7.25357 2.28571 6.07143 2.28571H2.5V1.92857C2.5 1.13929 3.13929 0.5 3.92857 0.5ZM1.42857 3H6.07143C6.86041 3 7.5 3.63959 7.5 4.42857V9.07143C7.5 9.86041 6.86041 10.5 6.07143 10.5H1.42857C0.639593 10.5 0 9.86041 0 9.07143V4.42857C0 3.63959 0.639593 3 1.42857 3Z"
        fill={setColor}
        fill-opacity="0.5"
      />
    </svg>
  );
};
