import { useTheme } from '@mui/material';
import { SVGProps } from './interfaces';

export const Search: React.FC<SVGProps> = ({ color, opacity, ...children }) => {
  const theme = useTheme();

  const setColor = color ? color : theme.palette.text.primary;
  const setOpacity = opacity ? opacity : 1;

  return (
    <svg
      {...children}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6.08728 0.00158245C2.72507 0.00158245 0 2.7262 0 6.08784C0 9.44948 2.72507 12.1741 6.08728 12.1741C7.62099 12.1741 9.02317 11.6043 10.0947 10.6668L13.3088 13.8803C13.3881 13.9596 13.4911 14 13.595 14C13.6988 14 13.8018 13.9596 13.8811 13.8803C14.0396 13.7218 14.0396 13.4643 13.8811 13.3066L10.667 10.093C11.6047 9.02162 12.1746 7.62202 12.1746 6.08626C12.1746 2.72461 9.44951 0 6.0873 0L6.08728 0.00158245ZM6.08728 11.3626C3.17756 11.3626 0.811637 8.99707 0.811637 6.08784C0.811637 3.17861 3.17756 0.813083 6.08728 0.813083C8.997 0.813083 11.3629 3.17861 11.3629 6.08784C11.3629 8.99707 8.997 11.3626 6.08728 11.3626Z"
        fill={setColor}
        opacity={setOpacity}
      />
    </svg>
  );
};
