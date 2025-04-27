import { useTheme } from '@mui/material';
import { SVGProps } from './interfaces';

export const ComposeIcon: React.FC<SVGProps> = ({
  color,
  height = 20,
  width = 20,
  opacity,
  ...children
}) => {
  const theme = useTheme();

  const setColor = color ? color : theme.palette.text.primary;
  const setOpacity = opacity ? opacity : 1;

  return (
    <svg
      {...children}
      width={width}
      height={height}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M50.3 3c1.5 0 3.9 0.6 5.5 1.4 1.5 0.7 3.3 2.5 4 4 0.6 1.4 1.2 3.7 1.2 5.1 0 1.4-0.6 3.7-1.4 5.3-0.8 1.5-9.9 11.1-39.1 40l-6.7 1.6c-3.8 0.9-7.9 1.6-9.3 1.6-1.8 0-2.5-0.5-2.5-2 0-1.1 0.7-5.3 3.2-16.5l18.1-18.4c10-10 19.6-19.2 21.2-20.2 1.7-1 4.2-1.9 5.8-1.9zm-8.4 11.3c0 0.7 1.5 2.7 3.3 4.4 1.8 1.8 3.9 3.3 4.6 3.3 0.6 0 2.3-1.4 3.7-3 1.4-1.7 2.5-4 2.5-5.3 0.1-1.2-0.7-3-1.7-3.9-1-1-2.8-1.8-4-1.8-1.2 0-3.5 1.2-5.3 2.6-1.7 1.4-3.1 3.1-3.1 3.7z"
        fill={setColor}
        opacity={setOpacity}
        fillRule="evenodd"
      />
    </svg>
  );
};
