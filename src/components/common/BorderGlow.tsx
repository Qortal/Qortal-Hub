import { CSSProperties, ReactNode, useCallback, useEffect, useRef } from 'react';
import './BorderGlow.css';

type BorderGlowProps = {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  alwaysOn?: boolean;
  foregroundGlow?: boolean;
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
    vars[GRADIENT_KEYS[i]] = `radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${c} 0px, transparent 50%)`;
  }
  vars['--gradient-base'] = `linear-gradient(${colors[0]} 0 100%)`;
  return vars;
}

function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - x, 3);
}

function easeInCubic(x: number) {
  return x * x * x;
}

function animateValue({
  start = 0,
  end = 100,
  duration = 1000,
  delay = 0,
  ease = easeOutCubic,
  onUpdate,
  onEnd,
}: {
  start?: number;
  end?: number;
  duration?: number;
  delay?: number;
  ease?: (x: number) => number;
  onUpdate: (value: number) => void;
  onEnd?: () => void;
}) {
  const t0 = performance.now() + delay;
  function tick() {
    const elapsed = performance.now() - t0;
    const t = Math.min(elapsed / duration, 1);
    onUpdate(start + (end - start) * ease(t));
    if (t < 1) requestAnimationFrame(tick);
    else if (onEnd) onEnd();
  }
  window.setTimeout(() => requestAnimationFrame(tick), delay);
}

const BorderGlow = ({
  children,
  className = '',
  interactive = true,
  alwaysOn = false,
  foregroundGlow = false,
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

  const getCenterOfElement = useCallback((el: HTMLDivElement) => {
    const { width, height } = el.getBoundingClientRect();
    return [width / 2, height / 2] as const;
  }, []);

  const getEdgeProximity = useCallback(
    (el: HTMLDivElement, x: number, y: number) => {
      const [cx, cy] = getCenterOfElement(el);
      const dx = x - cx;
      const dy = y - cy;
      let kx = Infinity;
      let ky = Infinity;
      if (dx !== 0) kx = cx / Math.abs(dx);
      if (dy !== 0) ky = cy / Math.abs(dy);
      return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
    },
    [getCenterOfElement]
  );

  const getCursorAngle = useCallback(
    (el: HTMLDivElement, x: number, y: number) => {
      const [cx, cy] = getCenterOfElement(el);
      const dx = x - cx;
      const dy = y - cy;
      if (dx === 0 && dy === 0) return 0;
      const radians = Math.atan2(dy, dx);
      let degrees = radians * (180 / Math.PI) + 90;
      if (degrees < 0) degrees += 360;
      return degrees;
    },
    [getCenterOfElement]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const card = cardRef.current;
      if (!card) return;

      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const edge = getEdgeProximity(card, x, y);
      const angle = getCursorAngle(card, x, y);

      card.style.setProperty('--edge-proximity', `${(edge * 100).toFixed(3)}`);
      card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`);
    },
    [getCursorAngle, getEdgeProximity]
  );

  useEffect(() => {
    if (!cardRef.current) return;

    const card = cardRef.current;
    let rafId: number | null = null;
    let cancelled = false;
    let intervalId: number | null = null;

    if (alwaysOn) {
      card.classList.add('sweep-active');
      card.style.setProperty('--edge-proximity', '100');
      card.style.setProperty('--cursor-angle', '110deg');

      const animateContinuousSweep = (timestamp: number) => {
        if (cancelled) return;
        const progress =
          ((timestamp % animationDurationMs) + animationDurationMs) %
          animationDurationMs;
        const angle = 110 + (progress / animationDurationMs) * 360;
        card.style.setProperty('--cursor-angle', `${angle}deg`);
        rafId = requestAnimationFrame(animateContinuousSweep);
      };

      rafId = requestAnimationFrame(animateContinuousSweep);

      return () => {
        cancelled = true;
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }
        card.classList.remove('sweep-active');
        card.style.setProperty('--edge-proximity', '0');
      };
    }

    if (!animated) return;

    const runSweep = () => {
      if (cancelled) return;

      const angleStart = 110;
      const angleEnd = 465;
      card.classList.add('sweep-active');
      card.style.setProperty('--cursor-angle', `${angleStart}deg`);

      animateValue({
        duration: 500,
        onUpdate: (v) => {
          if (cancelled) return;
          card.style.setProperty('--edge-proximity', `${v}`);
        },
      });
      animateValue({
        ease: easeInCubic,
        duration: 1500,
        end: 50,
        onUpdate: (v) => {
          if (cancelled) return;
          card.style.setProperty(
            '--cursor-angle',
            `${((angleEnd - angleStart) * v) / 100 + angleStart}deg`
          );
        },
      });
      animateValue({
        ease: easeOutCubic,
        delay: 1500,
        duration: 2250,
        start: 50,
        end: 100,
        onUpdate: (v) => {
          if (cancelled) return;
          card.style.setProperty(
            '--cursor-angle',
            `${((angleEnd - angleStart) * v) / 100 + angleStart}deg`
          );
        },
      });
      animateValue({
        ease: easeInCubic,
        delay: 2500,
        duration: 1500,
        start: 100,
        end: 0,
        onUpdate: (v) => {
          if (cancelled) return;
          card.style.setProperty('--edge-proximity', `${v}`);
        },
        onEnd: () => {
          if (cancelled) return;
          card.classList.remove('sweep-active');
        },
      });
    };

    runSweep();

    if (loopAnimated) {
      intervalId = window.setInterval(runSweep, animationDurationMs);
    }

    return () => {
      cancelled = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      card.classList.remove('sweep-active');
      card.style.setProperty('--edge-proximity', '0');
    };
  }, [alwaysOn, animated, animationDurationMs, loopAnimated]);

  const glowVars = buildGlowVars(glowColor, glowIntensity);
  const gradientVars = buildGradientVars(colors);

  return (
    <div
      ref={cardRef}
      onPointerMove={interactive ? handlePointerMove : undefined}
      className={`border-glow-card ${interactive ? '' : 'non-interactive'} ${
        alwaysOn ? 'border-glow-card--always-on' : ''
      } ${foregroundGlow ? 'border-glow-card--foreground' : ''} ${
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
