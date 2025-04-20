import { useTheme } from '@mui/material';

export const ExitIcon = () => {
  const theme = useTheme();

  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2 0L0 2L4 6L0 10L2 12L6 8L10 12L12 10L8 6L12 2L10 0L6 4L2 0Z"
        fill={theme.palette.text.primary}
      />
    </svg>
  );
};
