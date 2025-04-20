import { useTheme } from '@mui/material';
import { SVGProps } from './interfaces';

export const NavBack: React.FC<SVGProps> = ({
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
      width="34"
      height="34"
      viewBox="0 0 34 34"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M28.3334 15.5833H11.0925L19.0117 7.6641L17 5.6666L5.66669 16.9999L17 28.3333L18.9975 26.3358L11.0925 18.4166H28.3334V15.5833Z"
        fill={setColor}
        opacity={setOpacity}
      />
    </svg>
  );
};
