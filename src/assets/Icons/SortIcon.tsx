import { useTheme } from '@mui/material';
import { SVGProps } from './interfaces';

export const SortIcon: React.FC<SVGProps> = ({
  color,
  height = 16,
  width = 15,
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
      viewBox="0 0 15 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M14.3347 0.271977C14.0797 0.0885134 13.79 0 13.5034 0C13.0191 0 12.5424 0.251056 12.2542 0.711326L12.0008 1.11366L10.6942 3.20097L9.44204 5.19976C9.15388 5.66003 9 6.19916 9 6.75116V14.3987C9 15.2822 9.67136 16 10.4996 16C10.9145 16 11.2902 15.8214 11.5602 15.5301C11.8318 15.2404 11.9992 14.8397 11.9992 14.3987V7.57353C11.9992 7.11809 12.1275 6.6723 12.3628 6.29411L14.7465 2.48964C14.917 2.21605 15 1.90706 15 1.60129C15 1.08469 14.7646 0.577751 14.3332 0.270368L14.3347 0.271977Z"
        fill={setColor}
        opacity={setOpacity}
      />
      <path
        d="M4.30727 3.20032L3.00075 1.11344L2.74881 0.711183C2.46065 0.251006 1.98391 0 1.49962 0C1.21297 0 0.923309 0.0884956 0.668343 0.271923C0.235353 0.579244 0 1.08608 0 1.60257C0 1.90829 0.0829771 2.21722 0.254966 2.49075L2.63716 6.29445C2.87403 6.67257 3.00075 7.11826 3.00075 7.57361V14.399C3.00075 15.2824 3.67211 16 4.50038 16C5.32864 16 6 15.2824 6 14.399V6.75141C6 6.19952 5.84762 5.6605 5.55947 5.20032L4.30576 3.20193L4.30727 3.20032Z"
        fill={setColor}
        opacity={setOpacity}
      />
    </svg>
  );
};
