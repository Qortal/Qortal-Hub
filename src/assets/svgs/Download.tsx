import { useTheme } from '@mui/material';
import { SVGProps } from './interfaces';

export const Download: React.FC<SVGProps> = ({
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
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill={setColor}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M12.8047 0.393196V7.21185H16.3036L10.0003 13.5139L3.69697 7.21185H7.19584V0H12.8045L12.8047 0.393196ZM2.7047 16.8587V13.9861H0V18.6179C0 19.3774 0.622589 20 1.38213 20H18.6179C19.3774 20 20 19.3774 20 18.6179V13.9861H17.2962V17.2963L2.70461 17.2954L2.7047 16.8587Z"
        fill={setColor}
        fill-opacity={setOpacity}
      />
    </svg>
  );
};
