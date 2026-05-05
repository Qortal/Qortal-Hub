import {
  CSSProperties,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import './BorderGlow.css';

type BorderGlowProps = {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  alwaysOn?: boolean;
  foregroundGlow?: boolean;
  reverseSweep?: boolean;
  edgeSensitivity?: number;
  glowColor?: string;
  backgroundColor?: string;
  borderRadius?: number;
  glowRadius?: number;
  glowIntensity?: number;
  coneSpread?: number;
  animated?: boolean;
  loopAnimated?: boolean;
  animationDurationMs?: number;
  colors?: string[];
  fillOpacity?: number;
  style?: CSSProperties;
};

function parseHSL(hslStr: string) {
  const match = hslStr.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/);
  if (!match) return { h: 40, s: 80, l: 80 };
  return {
    h: parseFloat(match[1]),
    s: parseFloat(match[2]),
    l: parseFloat(match[3]),
  };
}

function buildGlowVars(glowColor: string, intensity: number) {
  const { h, s, l } = parseHSL(glowColor);
  const base = `${h}deg ${s}% ${l}%`;
  const opacities = [100, 60, 50, 40, 30, 20, 10];
  const keys = ['', '-60', '-50', '-40', '-30', '-20', '-10'];
  const vars: Record<string, string> = {};

  for (let i = 0; i < opacities.length; i += 1) {
    vars[`--glow-color${keys[i]}`] = `hsl(${base} / ${Math.min(
      opacities[i] * intensity,
      100
    )}%)`;
  }

  return vars;
}

const GRADIENT_POSITIONS = [
  '80% 55%',
  '69% 34%',
  '8% 6%',
  '41% 38%',
  '86% 85%',
  '82% 18%',
  '51% 4%',
];
const GRADIENT_KEYS = [
  '--gradient-one',
  '--gradient-two',
  '--gradient-three',
  '--gradient-four',
  '--gradient-five',
  '--gradient-six',
  '--gradient-seven',
];
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1];

function buildGradientVars(colors: string[]) {
  const vars: Record<string, string> = {};
  for (let i = 0; i < 7; i += 1) {
    const c = colors[Math.min(COLOR_MAP[i], colors.length - 1)];
    vars[GRADIENT_KEYS[i]] =
      `radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${c} 0px, transparent 50%)`;
  }
  vars['--gradient-base'] = `linear-gradient(${colors[0]} 0 100%)`;
  return vars;
}

function getEdgeProximity(width: number, height: number, x: number, y: number) {
  const cx = width / 2;
  const cy = height / 2;
  const dx = x - cx;
  const dy = y - cy;
  let kx = Infinity;
  let ky = Infinity;
  if (dx !== 0) kx = cx / Math.abs(dx);
  if (dy !== 0) ky = cy / Math.abs(dy);
  return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
}

function getCursorAngle(width: number, height: number, x: number, y: number) {
  const dx = x - width / 2;
  const dy = y - height / 2;
  if (dx === 0 && dy === 0) return 0;
  const radians = Math.atan2(dy, dx);
  let degrees = radians * (180 / Math.PI) + 90;
  if (degrees < 0) degrees += 360;
  return degrees;
}

const BorderGlow = ({
  children,
  className = '',
  interactive = true,
  alwaysOn = false,
  foregroundGlow = false,
  reverseSweep = false,
  edgeSensitivity = 30,
  glowColor = '40 80 80',
  backgroundColor = '#120F17',
  borderRadius = 28,
  glowRadius = 40,
  glowIntensity = 1.0,
  coneSpread = 25,
  animated = false,
  loopAnimated = false,
  animationDurationMs = 4000,
  colors = ['#c084fc', '#f472b6', '#38bdf8'],
  fillOpacity = 0.5,
  style,
}: BorderGlowProps) => {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const pointerRef = useRef({ clientX: 0, clientY: 0 });
  const pointerRafRef = useRef<number | null>(null);

  const updatePointerGlow = useCallback(() => {
    pointerRafRef.current = null;
    const card = cardRef.current;
    const rect = rectRef.current;
    if (!card || !rect) return;

    const x = pointerRef.current.clientX - rect.left;
    const y = pointerRef.current.clientY - rect.top;
    const edge = getEdgeProximity(rect.width, rect.height, x, y);
    const angle = getCursorAngle(rect.width, rect.height, x, y);

    card.style.setProperty('--edge-proximity', `${(edge * 100).toFixed(3)}`);
    card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`);
  }, []);

  const cacheCardRect = useCallback(() => {
    if (!cardRef.current) return;
    rectRef.current = cardRef.current.getBoundingClientRect();
  }, []);

  const handlePointerEnter = useCallback(() => {
    cacheCardRect();
  }, [cacheCardRect]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!rectRef.current) {
        cacheCardRect();
      }

      pointerRef.current.clientX = e.clientX;
      pointerRef.current.clientY = e.clientY;

      if (pointerRafRef.current === null) {
        pointerRafRef.current = requestAnimationFrame(updatePointerGlow);
      }
    },
    [cacheCardRect, updatePointerGlow]
  );

  const handlePointerLeave = useCallback(() => {
    rectRef.current = null;
    if (pointerRafRef.current !== null) {
      cancelAnimationFrame(pointerRafRef.current);
      pointerRafRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pointerRafRef.current !== null) {
        cancelAnimationFrame(pointerRafRef.current);
      }
    };
  }, []);

  const glowVars = useMemo(
    () => buildGlowVars(glowColor, glowIntensity),
    [glowColor, glowIntensity]
  );
  const gradientVars = useMemo(() => buildGradientVars(colors), [colors]);
  const useCssSweep = alwaysOn || animated;
  const sweepIterationCount = loopAnimated || alwaysOn ? 'infinite' : 1;

  return (
    <div
      ref={cardRef}
      onPointerEnter={interactive ? handlePointerEnter : undefined}
      onPointerMove={interactive ? handlePointerMove : undefined}
      onPointerLeave={interactive ? handlePointerLeave : undefined}
      className={`border-glow-card ${interactive ? '' : 'non-interactive'} ${
        alwaysOn ? 'border-glow-card--always-on' : ''
      } ${foregroundGlow ? 'border-glow-card--foreground' : ''} ${
        useCssSweep ? 'sweep-active border-glow-css-sweep' : ''
      } ${animated && !alwaysOn ? 'border-glow-css-sweep-intro' : ''} ${
        reverseSweep ? 'border-glow-css-sweep-reverse' : ''
      } ${
        className
      }`.trim()}
      style={
        {
          '--card-bg': backgroundColor,
          '--edge-sensitivity': edgeSensitivity,
          '--border-radius': `${borderRadius}px`,
          '--glow-padding': `${glowRadius}px`,
          '--cone-spread': coneSpread,
          '--fill-opacity': fillOpacity,
          '--sweep-duration': `${animationDurationMs}ms`,
          '--sweep-iteration-count': sweepIterationCount,
          ...glowVars,
          ...gradientVars,
          ...style,
        } as CSSProperties
      }
    >
      <span className="edge-light" />
      <div className="border-glow-inner">{children}</div>
    </div>
  );
};

export default BorderGlow;
