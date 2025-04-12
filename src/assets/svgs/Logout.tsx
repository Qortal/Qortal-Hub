import { useTheme } from '@mui/material';
import { SVGProps } from './interfaces';

export const Logout: React.FC<SVGProps> = ({ color, opacity, ...children }) => {
  const theme = useTheme();

  const setColor = color ? color : theme.palette.text.primary;
  const setOpacity = opacity ? opacity : 1;

  return (
    <svg
      {...children}
      width="18"
      height="20"
      viewBox="0 0 18 20"
      fill={setColor}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M7.56485 0H16.3611C17.2662 0 18 0.727797 18 1.62558V18.3744C18 19.2722 17.2662 20 16.3611 20H7.56485C6.65969 20 5.92593 19.2722 5.92593 18.3744V12.6013H10.6168C11.4569 12.6013 12.1404 11.9039 12.1404 11.0467V8.87329C12.1404 8.01613 11.4569 7.31875 10.6168 7.31875H5.92593V1.62558C5.92593 0.727797 6.65969 0 7.56485 0ZM11.1667 11.0467C11.1667 11.3719 10.9205 11.6354 10.6168 11.6354H4.8144C4.74521 11.6354 4.68911 11.6955 4.68911 11.7696V12.8632C4.68911 13.3492 4.17007 13.6259 3.8078 13.3329L0.218431 10.4298C-0.0728102 10.1942 -0.0728102 9.72579 0.218431 9.49024L3.8078 6.58709C4.17005 6.29409 4.68911 6.57077 4.68911 7.05684V8.1504C4.68911 8.2245 4.74521 8.28454 4.8144 8.28454H10.6168C10.9205 8.28454 11.1667 8.54813 11.1667 8.87329V11.0467Z"
        fill={setColor}
        fill-opacity={setOpacity}
      />
    </svg>
  );
};
