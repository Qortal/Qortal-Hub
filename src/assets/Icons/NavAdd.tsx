import { useTheme } from '@mui/material';
import { SVGProps } from './interfaces';

export const NavAdd: React.FC<SVGProps> = ({ color, opacity, ...children }) => {
  const theme = useTheme();

  const setColor = color ? color : theme.palette.text.primary;
  const setOpacity = opacity ? opacity : 1;

  return (
    <svg
      {...children}
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="20"
        cy="19.9999"
        r="18"
        fill={theme.palette.background.paper}
      />
      <path
        d="M30 21.6666H21.6666V30C21.6666 30.9166 20.9166 31.6666 20 31.6666C19.0833 31.6666 18.3333 30.9166 18.3333 30V21.6666H9.99998C9.08331 21.6666 8.33331 20.9166 8.33331 20C8.33331 19.0833 9.08331 18.3333 9.99998 18.3333H18.3333V9.99995C18.3333 9.08328 19.0833 8.33328 20 8.33328C20.9166 8.33328 21.6666 9.08328 21.6666 9.99995V18.3333H30C30.9166 18.3333 31.6666 19.0833 31.6666 20C31.6666 20.9166 30.9166 21.6666 30 21.6666Z"
        fill={setColor}
        fill-opacity={setOpacity}
      />
    </svg>
  );
};
