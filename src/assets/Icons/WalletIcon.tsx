import { useTheme } from '@mui/material';
import { SVGProps } from './interfaces';

export const WalletIcon: React.FC<SVGProps> = ({
  color,
  width,
  ...children
}) => {
  const theme = useTheme();

  const setColor = color ? color : theme.palette.text.primary;

  return (
    <svg
      {...children}
      width={width || 30}
      height={width || 30}
      viewBox="0 0 31 31"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M19.0118 22.0891C18.0124 22.8671 16.6997 23.3391 15.2618 23.3391C13.8241 23.3391 12.5113 22.8671 11.5118 22.0891"
        stroke={setColor}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M3.20108 17.356C2.7598 14.4844 2.53917 13.0486 3.08205 11.7758C3.62493 10.503 4.82938 9.63215 7.23827 7.89044L9.03808 6.58911C12.0347 4.42245 13.5331 3.33911 15.2618 3.33911C16.9907 3.33911 18.4889 4.42245 21.4856 6.58911L23.2854 7.89044C25.6943 9.63215 26.8988 10.503 27.4417 11.7758C27.9846 13.0486 27.7639 14.4844 27.3226 17.356L26.9463 19.8046C26.3208 23.8752 26.0079 25.9106 24.5481 27.1249C23.0882 28.3391 20.9539 28.3391 16.6853 28.3391H13.8383C9.56977 28.3391 7.43548 28.3391 5.97559 27.1249C4.5157 25.9106 4.20293 23.8752 3.57738 19.8046L3.20108 17.356Z"
        stroke={setColor}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
};
