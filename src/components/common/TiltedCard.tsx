import { ReactNode, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import './TiltedCard.css';

const springValues = {
  damping: 30,
  stiffness: 100,
  mass: 2,
};

type TiltedCardProps = {
  children: ReactNode;
  className?: string;
  captionText?: string;
  containerHeight?: string;
  containerWidth?: string;
  innerHeight?: string;
  innerWidth?: string;
  scaleOnHover?: number;
  rotateAmplitude?: number;
  showTooltip?: boolean;
  disabled?: boolean;
};

export default function TiltedCard({
  children,
  className = '',
  captionText = '',
  containerHeight,
  containerWidth,
  innerHeight,
  innerWidth,
  scaleOnHover = 1.06,
  rotateAmplitude = 10,
  showTooltip = false,
  disabled = false,
}: TiltedCardProps) {
  const ref = useRef<HTMLElement | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useSpring(0, springValues);
  const rotateY = useSpring(0, springValues);
  const scale = useSpring(1, springValues);
  const opacity = useSpring(0, springValues);
  const rotateFigcaption = useSpring(0, {
    stiffness: 350,
    damping: 30,
    mass: 1,
  });
  const [lastY, setLastY] = useState(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (disabled || !ref.current) return;

    const rect = ref.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left - rect.width / 2;
    const offsetY = e.clientY - rect.top - rect.height / 2;
    const rotationX = (offsetY / (rect.height / 2)) * -rotateAmplitude;
    const rotationY = (offsetX / (rect.width / 2)) * rotateAmplitude;

    rotateX.set(rotationX);
    rotateY.set(rotationY);
    x.set(e.clientX - rect.left);
    y.set(e.clientY - rect.top);

    const velocityY = offsetY - lastY;
    rotateFigcaption.set(-velocityY * 0.6);
    setLastY(offsetY);
  };

  const handleMouseEnter = () => {
    if (disabled) return;
    scale.set(scaleOnHover);
    opacity.set(1);
  };

  const handleMouseLeave = () => {
    opacity.set(0);
    scale.set(1);
    rotateX.set(0);
    rotateY.set(0);
    rotateFigcaption.set(0);
    setLastY(0);
  };

  return (
    <figure
      ref={ref}
      className={`tilted-card-figure ${className}`.trim()}
      style={{
        ...(containerHeight ? { height: containerHeight } : null),
        ...(containerWidth ? { width: containerWidth } : null),
      }}
      onMouseMove={handleMouseMove}
      onPointerMove={handleMouseMove as unknown as React.PointerEventHandler<HTMLElement>}
      onMouseEnter={handleMouseEnter}
      onPointerEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onPointerLeave={handleMouseLeave}
    >
      <motion.div
        className="tilted-card-inner"
        style={{
          ...(innerWidth ? { width: innerWidth } : null),
          ...(innerHeight ? { height: innerHeight } : null),
          rotateX,
          rotateY,
          scale,
          transformPerspective: 900,
          transformStyle: 'preserve-3d',
        }}
      >
        <div className="tilted-card-content">{children}</div>
      </motion.div>

      {showTooltip ? (
        <motion.figcaption
          className="tilted-card-caption"
          style={{
            x,
            y,
            opacity,
            rotate: rotateFigcaption,
          }}
        >
          {captionText}
        </motion.figcaption>
      ) : null}
    </figure>
  );
}
