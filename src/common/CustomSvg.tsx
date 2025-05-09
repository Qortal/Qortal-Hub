export const CustomSvg = ({ src, color = 'black', size = 24 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ fill: color }}
    >
      {src}
    </svg>
  );
};
