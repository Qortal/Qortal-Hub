import { useTheme } from '@mui/material';
import { SVGProps } from './interfaces';

export const NavCloseTab: React.FC<SVGProps> = ({
  color,
  opacity,
  ...children
}) => {
  const theme = useTheme();

  const setColor = color ? color : theme.palette.text.primary;
  const setOpacity = opacity ? opacity : 1;

  return (
    <svg
      {...children}
      width="17"
      height="17"
      viewBox="0 0 17 17"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8.5" cy="8.5" r="8.5" fill={theme.palette.text.primary} />
      <circle
        cx="8.5"
        cy="8.50003"
        r="6.61111"
        fill={theme.palette.background.paper}
      />
      <path
        d="M5.66675 5.66669L11.3334 11.3334"
        stroke={theme.palette.text.primary}
        stroke-width="2"
        fill={setColor}
        fill-opacity={setOpacity}
      />
      <path
        d="M11.3333 5.66675L5.66658 11.3334"
        stroke={theme.palette.text.primary}
        stroke-width="2"
        fill={setColor}
        fill-opacity={setOpacity}
      />
    </svg>
  );
};
