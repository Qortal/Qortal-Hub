import { useTheme } from '@mui/material';
import { SVGProps } from './interfaces';

export const SaveIcon: React.FC<SVGProps> = ({ color, ...children }) => {
  const theme = useTheme();

  const setColor = color ? color : theme.palette.text.primary;

  return (
    <svg
      {...children}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2.18182 0C0.976833 0 0 0.976833 0 2.18182V21.8182C0 23.0232 0.976833 24 2.18182 24H21.8182C23.0232 24 24 23.0232 24 21.8182V7.4492C24 6.87053 23.7701 6.31559 23.3609 5.90641L18.0936 0.639044C17.6844 0.229866 17.1295 0 16.5508 0H16.3636C15.7611 0 15.2727 0.488422 15.2727 1.09091V5.45455C15.2727 6.65953 14.2959 7.63636 13.0909 7.63636H6.54545C5.34047 7.63636 4.36364 6.65953 4.36364 5.45455V1.09091C4.36364 0.488422 3.87521 0 3.27273 0H2.18182ZM12 18.5455C13.8075 18.5455 15.2727 17.0803 15.2727 15.2727C15.2727 13.4652 13.8075 12 12 12C10.1925 12 8.72727 13.4652 8.72727 15.2727C8.72727 17.0803 10.1925 18.5455 12 18.5455Z"
        fill={setColor}
      />
    </svg>
  );
};
