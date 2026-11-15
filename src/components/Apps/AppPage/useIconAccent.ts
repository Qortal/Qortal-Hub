import { useEffect, useState } from 'react';

/**
 * The icon's main colour, for the soft glow behind the page's header; null
 * until it's known or when the picture can't be read.
 */
export const averageColor = (
  data: Uint8ClampedArray
): { r: number; g: number; b: number } | null => {
  let r = 0;
  let g = 0;
  let b = 0;
  let weight = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    if (alpha < 0.5) continue;
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    // Colourful pixels count more than greys, whites and blacks.
    const saturation = max === 0 ? 0 : (max - min) / max;
    const w = alpha * (0.15 + saturation);
    r += data[i] * w;
    g += data[i + 1] * w;
    b += data[i + 2] * w;
    weight += w;
  }
  if (weight === 0) return null;
  return {
    r: Math.round(r / weight),
    g: Math.round(g / weight),
    b: Math.round(b / weight),
  };
};

export const useIconAccent = (url: string | null): string | null => {
  const [accent, setAccent] = useState<string | null>(null);
  useEffect(() => {
    setAccent(null);
    if (!url || typeof document === 'undefined') return;
    let alive = true;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (!alive) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0, 24, 24);
        const color = averageColor(context.getImageData(0, 0, 24, 24).data);
        if (color) setAccent(`rgb(${color.r}, ${color.g}, ${color.b})`);
      } catch {
        // A picture without CORS headers can't be read; keep the default.
      }
    };
    image.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return accent;
};
