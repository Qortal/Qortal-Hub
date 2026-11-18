import { Box } from '@mui/material';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

type Size = { height: number; width: number };

/**
 * How big `natural` can show in `available`: the scale that fits both ways,
 * kept between `min` and `max`, to two decimals. 1 for a box not laid out.
 */
export const fitScale = (
  available: Size,
  natural: Size,
  { max = 1, min = 0.4 }: { max?: number; min?: number } = {}
) => {
  if (available.width <= 0 || available.height <= 0) return 1;
  const scale = Math.min(
    available.width / natural.width,
    available.height / natural.height
  );
  return Math.round(Math.max(min, Math.min(max, scale)) * 100) / 100;
};

/**
 * Content made at one size (`natural`, in px), shown as big as the box lets
 * it, in the middle: it grows in a big window and shrinks in a small one,
 * all of it showing (CSS zoom, so it takes the room it shows in).
 */
export const QortinoFitBox = ({
  children,
  max,
  min,
  natural,
}: {
  children: ReactNode;
  max?: number;
  min?: number;
  natural: Size;
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const { height, width } = natural;

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const measure = () =>
      setScale(
        fitScale(
          { height: node.clientHeight, width: node.clientWidth },
          { height, width },
          { max, min }
        )
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [height, max, min, width]);

  return (
    <Box
      ref={ref}
      sx={{
        alignItems: 'center',
        display: 'flex',
        height: '100%',
        justifyContent: 'center',
        minHeight: 0,
        minWidth: 0,
        width: '100%',
      }}
    >
      <Box sx={{ flexShrink: 0, width: `${width}px`, zoom: scale }}>
        {children}
      </Box>
    </Box>
  );
};
