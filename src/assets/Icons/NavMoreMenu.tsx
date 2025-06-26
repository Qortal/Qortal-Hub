import { useTheme } from '@mui/material';
import { SVGProps } from './interfaces';

export const NavMoreMenu: React.FC<SVGProps> = ({
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
        d="M8.49996 14.1666C6.94163 14.1666 5.66663 15.4416 5.66663 16.9999C5.66663 18.5583 6.94163 19.8333 8.49996 19.8333C10.0583 19.8333 11.3333 18.5583 11.3333 16.9999C11.3333 15.4416 10.0583 14.1666 8.49996 14.1666ZM25.5 14.1666C23.9416 14.1666 22.6666 15.4416 22.6666 16.9999C22.6666 18.5583 23.9416 19.8333 25.5 19.8333C27.0583 19.8333 28.3333 18.5583 28.3333 16.9999C28.3333 15.4416 27.0583 14.1666 25.5 14.1666ZM17 14.1666C15.4416 14.1666 14.1666 15.4416 14.1666 16.9999C14.1666 18.5583 15.4416 19.8333 17 19.8333C18.5583 19.8333 19.8333 18.5583 19.8333 16.9999C19.8333 15.4416 18.5583 14.1666 17 14.1666Z"
        fill={setColor}
        fillOpacity={setOpacity}
      />
    </svg>
  );
};
