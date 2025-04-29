import { useTheme } from '@mui/material';
import { SVGProps } from './interfaces';

export const SuccessIcon: React.FC<SVGProps> = ({
  color,
  height = 155,
  width = 156,
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
      viewBox="0 0 156 155"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M78 0C57.4456 0 37.7349 8.16507 23.1984 22.6984C8.66507 37.2332 0.5 56.9446 0.5 77.5C0.5 98.0554 8.66507 117.765 23.1984 132.302C37.7332 146.835 57.4445 155 78 155C98.5554 155 118.265 146.835 132.802 132.302C147.335 117.767 155.5 98.0554 155.5 77.5C155.48 56.9522 147.308 37.2523 132.779 22.7227C118.249 8.19318 98.5489 0.0215072 78.0014 0.00138561L78 0ZM66.5377 111.48L29.1001 77.2273L39.5907 65.765L66.0523 89.992L115.768 40.2557L126.764 51.2517L66.5377 111.48Z"
        fill={setColor}
        opacity={setOpacity}
      />
    </svg>
  );
};
