import { useId, type CSSProperties } from 'react';
import { keyframes } from '@emotion/react';
import { Box, type SxProps, type Theme } from '@mui/material';

const GROUP_EMPTY_RATIO = 156 / 320;
const GROUP_EMPTY_EASING = 'cubic-bezier(0.45, 0.05, 0.55, 0.95)';

const requesterNodeFloat = keyframes`
  0%, 100% {
    transform: translate3d(0px, 0px, 0px);
    opacity: 0.94;
  }
  38% {
    transform: translate3d(-1px, -4px, 0px);
    opacity: 1;
  }
  74% {
    transform: translate3d(1px, -1px, 0px);
    opacity: 0.97;
  }
`;

const groupNodeFloat = keyframes`
  0%, 100% {
    transform: translate3d(0px, 0px, 0px);
    opacity: 0.92;
  }
  44% {
    transform: translate3d(1px, -3px, 0px);
    opacity: 0.98;
  }
  78% {
    transform: translate3d(-1px, -5px, 0px);
    opacity: 0.95;
  }
`;

const bridgeStreamDrift = keyframes`
  0% {
    stroke-dashoffset: 0;
  }
  100% {
    stroke-dashoffset: -10.8;
  }
`;

const markerFloat = keyframes`
  0%, 100% {
    transform: translate3d(0px, 0px, 0px) rotate(0deg);
    opacity: 0.2;
  }
  50% {
    transform: translate3d(1px, -5px, 0px) rotate(1.8deg);
    opacity: 0.3;
  }
`;

const particleFade = keyframes`
  0%, 100% {
    opacity: 0.016;
    transform: translate3d(0px, 0px, 0px);
  }
  50% {
    opacity: 0.052;
    transform: translate3d(0px, -1.2px, 0px);
  }
`;

const ambientGlowBreathe = keyframes`
  0%, 100% {
    opacity: 0.68;
    transform: scale(1);
  }
  50% {
    opacity: 0.92;
    transform: scale(1.015);
  }
`;

const EMPTY_STATE_PARTICLES = [
  { cx: 112, cy: 47, r: 1.15, delay: '0s', duration: '6.9s' },
  { cx: 148, cy: 40, r: 1.35, delay: '1.2s', duration: '7.4s' },
  { cx: 192, cy: 95, r: 1.05, delay: '2.1s', duration: '7.1s' },
  { cx: 226, cy: 47, r: 1.25, delay: '3s', duration: '7.7s' },
] as const;

const REQUESTER_QORTAL_LOGO_PATH =
  'M0 -9.2L7.8 -4.6V4.7L0 9.3L-7.8 4.7V-4.6L0 -9.2ZM0 -4.7L-4.2 -2.3V2.5L0 5L4.2 2.5V-2.3L0 -4.7Z';
const REQUESTER_QORTAL_LOGO_TAIL_PATH = 'M4.5 2.5L7.8 4.5V10.8L4.5 8.9V2.5Z';

type GroupActivityEmptyStateGraphicProps = {
  size?: number;
  sx?: SxProps<Theme>;
  variant?: GroupActivityEmptyStateGraphicVariant;
};

export type GroupActivityEmptyStateGraphicVariant = 'requests' | 'invites';

export const GroupActivityEmptyStateGraphic = ({
  size = 292,
  sx,
  variant = 'requests',
}: GroupActivityEmptyStateGraphicProps) => {
  const height = Math.round(size * GROUP_EMPTY_RATIO);
  const isInviteVariant = variant === 'invites';
  const idBase = useId().replace(/:/g, '');
  const fieldGradientId = `${idBase}-field-gradient`;
  const requesterFillId = `${idBase}-requester-fill`;
  const requesterRingId = `${idBase}-requester-ring`;
  const groupFillId = `${idBase}-group-fill`;
  const groupRingId = `${idBase}-group-ring`;
  const bridgeFadeGradientId = `${idBase}-bridge-fade-gradient`;
  const bridgeFadeMaskId = `${idBase}-bridge-fade-mask`;
  const ambientFilterId = `${idBase}-ambient-blur`;
  const haloFilterId = `${idBase}-halo-blur`;
  const requesterCoreSoftFilterId = `${idBase}-requester-core-soft`;
  const bridgeStartX = isInviteVariant ? 210 : 110;
  const bridgeEndX = isInviteVariant ? 118 : 202;
  const bridgeMinX = Math.min(bridgeStartX, bridgeEndX);
  const bridgeMaxX = Math.max(bridgeStartX, bridgeEndX);
  const bridgePath = `M${bridgeStartX} 80H${bridgeEndX}`;

  return (
    <Box
      aria-hidden="true"
      sx={{
        position: 'relative',
        width: `${size}px`,
        height: `${height}px`,
        margin: '0 auto 18px',
        pointerEvents: 'none',
        overflow: 'visible',
        filter: 'drop-shadow(0 9px 22px rgba(0, 0, 0, 0.18))',
        '& .group-empty-graphic__glow': {
          position: 'absolute',
          inset: '20px 36px 18px 36px',
          borderRadius: '999px',
          background:
            'radial-gradient(circle, rgba(132, 175, 240, 0.055) 0%, rgba(132, 175, 240, 0.03) 42%, rgba(132, 175, 240, 0.012) 62%, rgba(132, 175, 240, 0) 78%)',
          filter: 'blur(12px)',
          animation: `${ambientGlowBreathe} 5.3s ease-in-out infinite`,
        },
        '& .group-empty-graphic__svg': {
          position: 'relative',
          zIndex: 1,
          width: '100%',
          height: '100%',
          overflow: 'visible',
        },
        '& .group-empty-node': {
          transformBox: 'fill-box',
          transformOrigin: 'center',
        },
        '& .group-empty-node--requester': {
          animation: `${requesterNodeFloat} 5s ${GROUP_EMPTY_EASING} infinite`,
        },
        '& .group-empty-node--group': {
          animation: `${groupNodeFloat} 5.6s ${GROUP_EMPTY_EASING} infinite`,
        },
        '& .group-empty-bridge-stream': {
          animation: `${bridgeStreamDrift} 2.8s linear infinite`,
        },
        '& .group-empty-marker': {
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `${markerFloat} 4.8s ${GROUP_EMPTY_EASING} infinite`,
        },
        '& .group-empty-particle': {
          fill: 'rgba(132, 175, 240, 0.095)',
          opacity: 0.024,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `${particleFade} var(--particle-duration) ease-in-out infinite`,
          animationDelay: 'var(--particle-delay)',
        },
        ...sx,
      }}
    >
      <Box className="group-empty-graphic__glow" />
      <svg
        className="group-empty-graphic__svg"
        viewBox="0 0 320 156"
        fill="none"
        role="presentation"
      >
        <defs>
          <filter id={ambientFilterId} x="44" y="44" width="232" height="74" filterUnits="userSpaceOnUse">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id={haloFilterId} x="-20" y="-20" width="220" height="220" filterUnits="userSpaceOnUse">
            <feGaussianBlur stdDeviation="3.8" />
          </filter>
          <filter id={requesterCoreSoftFilterId} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="0.5" />
          </filter>
          <radialGradient id={fieldGradientId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(160 80) rotate(90) scale(28 96)">
            <stop stopColor="rgba(132, 175, 240, 0.06)" />
            <stop offset="0.46" stopColor="rgba(132, 175, 240, 0.022)" />
            <stop offset="1" stopColor="rgba(132, 175, 240, 0)" />
          </radialGradient>
          <radialGradient id={requesterFillId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(76 80) rotate(90) scale(31)">
            <stop stopColor="#567099" />
            <stop offset="0.48" stopColor="#3C5275" />
            <stop offset="1" stopColor="#2A3A52" />
          </radialGradient>
          <linearGradient id={requesterRingId} x1="49" y1="52" x2="103" y2="106" gradientUnits="userSpaceOnUse">
            <stop stopColor="rgba(176, 206, 250, 0.22)" />
            <stop offset="1" stopColor="rgba(176, 206, 250, 0.08)" />
          </linearGradient>
          <radialGradient id={groupFillId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(244 80) rotate(90) scale(31)">
            <stop stopColor="#536E95" />
            <stop offset="0.48" stopColor="#3A5072" />
            <stop offset="1" stopColor="#2A3A52" />
          </radialGradient>
          <linearGradient id={groupRingId} x1="217" y1="52" x2="271" y2="106" gradientUnits="userSpaceOnUse">
            <stop stopColor="rgba(176, 206, 250, 0.2)" />
            <stop offset="1" stopColor="rgba(176, 206, 250, 0.08)" />
          </linearGradient>
          <linearGradient id={bridgeFadeGradientId} x1={bridgeMinX} y1="80" x2={bridgeMaxX} y2="80" gradientUnits="userSpaceOnUse">
            {isInviteVariant ? (
              <>
                <stop offset="0" stopColor="rgba(255, 255, 255, 0)" />
                <stop offset="0.05" stopColor="rgba(255, 255, 255, 0.42)" />
                <stop offset="0.14" stopColor="white" />
                <stop offset="1" stopColor="white" />
              </>
            ) : (
              <>
                <stop offset="0" stopColor="white" />
                <stop offset="0.86" stopColor="white" />
                <stop offset="0.95" stopColor="rgba(255, 255, 255, 0.42)" />
                <stop offset="1" stopColor="rgba(255, 255, 255, 0)" />
              </>
            )}
          </linearGradient>
          <mask id={bridgeFadeMaskId} x={bridgeMinX} y="72" width={bridgeMaxX - bridgeMinX} height="16" maskUnits="userSpaceOnUse">
            <rect x={bridgeMinX} y="72" width={bridgeMaxX - bridgeMinX} height="16" fill={`url(#${bridgeFadeGradientId})`} />
          </mask>
        </defs>

        <ellipse
          cx="160"
          cy="80"
          rx="96"
          ry="18"
          fill={`url(#${fieldGradientId})`}
          filter={`url(#${ambientFilterId})`}
        />

        {EMPTY_STATE_PARTICLES.map((particle, index) => (
          <circle
            key={`${particle.cx}-${particle.cy}-${index}`}
            className="group-empty-particle"
            cx={particle.cx}
            cy={particle.cy}
            r={particle.r}
            style={
              {
                ['--particle-delay' as string]: particle.delay,
                ['--particle-duration' as string]: particle.duration,
              } as CSSProperties
            }
          />
        ))}

        <g className="group-empty-node group-empty-node--requester">
          <circle cx="76" cy="80" r="33.2" fill="rgba(132, 175, 240, 0.05)" filter={`url(#${haloFilterId})`} />
          <circle cx="76" cy="80" r="30.4" fill={`url(#${requesterFillId})`} />
          <circle cx="76" cy="80" r="29.2" stroke={`url(#${requesterRingId})`} strokeWidth="1.35" />
          <circle cx="76" cy="80" r="11.4" fill="rgba(196, 218, 251, 0.05)" />
          <g transform="translate(76 79.2) scale(0.87)">
            <path
              d={REQUESTER_QORTAL_LOGO_PATH}
              fill="rgba(196, 218, 251, 0.14)"
              filter={`url(#${requesterCoreSoftFilterId})`}
              fillRule="evenodd"
            />
            <path
              d={REQUESTER_QORTAL_LOGO_TAIL_PATH}
              fill="rgba(196, 218, 251, 0.14)"
              filter={`url(#${requesterCoreSoftFilterId})`}
            />
            <path
              d={REQUESTER_QORTAL_LOGO_PATH}
              fill="rgba(196, 218, 251, 0.23)"
              fillRule="evenodd"
            />
            <path
              d={REQUESTER_QORTAL_LOGO_TAIL_PATH}
              fill="rgba(196, 218, 251, 0.23)"
            />
          </g>
        </g>

        <path
          className="group-empty-bridge-stream"
          d={bridgePath}
          stroke="rgba(166, 202, 255, 0.34)"
          strokeWidth="3.8"
          strokeLinecap="round"
          strokeDasharray="0.01 10.8"
          mask={`url(#${bridgeFadeMaskId})`}
        />

        <g className="group-empty-node group-empty-node--group">
          <circle cx="244" cy="80" r="33.2" fill="rgba(132, 175, 240, 0.05)" filter={`url(#${haloFilterId})`} />
          <circle cx="244" cy="80" r="30.4" fill={`url(#${groupFillId})`} />
          <circle cx="244" cy="80" r="29.2" stroke={`url(#${groupRingId})`} strokeWidth="1.35" />
          <circle cx="234.8" cy="79.5" r="4.7" fill="rgba(196, 218, 251, 0.18)" />
          <circle cx="244" cy="74.3" r="5.2" fill="rgba(196, 218, 251, 0.22)" />
          <circle cx="253.2" cy="79.5" r="4.7" fill="rgba(196, 218, 251, 0.18)" />
          <path
            d="M232.4 90.8C235 84.4 239.6 81.6 244 81.6C248.4 81.6 253 84.4 255.6 90.8"
            stroke="rgba(196, 218, 251, 0.14)"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>

        {isInviteVariant ? (
          <g transform="translate(0.8 -6.2)">
            <g className="group-empty-marker">
              <circle
                cx="211.6"
                cy="58.6"
                r="8.2"
                fill="rgba(132, 175, 240, 0.03)"
                stroke="rgba(132, 175, 240, 0.18)"
                strokeWidth="1.4"
              />
              <circle cx="208.6" cy="56.2" r="0.92" fill="rgba(132, 175, 240, 0.19)" />
              <circle cx="214.7" cy="56.2" r="0.92" fill="rgba(132, 175, 240, 0.19)" />
              <path
                d="M208.2 60.1C209.5 61.6 210.6 62.2 211.7 62.2C212.8 62.2 214 61.6 215.2 60.1"
                stroke="rgba(132, 175, 240, 0.2)"
                strokeWidth="1.55"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          </g>
        ) : (
          <g transform="translate(-2.8 -3.2)">
            <g className="group-empty-marker">
              <path
                d="M204.6 58C204.6 54.2 207.6 51.7 211.6 51.7C215.3 51.7 218.3 53.8 218.3 57.3C218.3 59.8 217 61.4 214.9 62.8C212.9 64 211.9 65.1 211.9 67.6"
                stroke="rgba(132, 175, 240, 0.26)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="211.6" cy="72.7" r="1.95" fill="rgba(132, 175, 240, 0.26)" />
            </g>
          </g>
        )}
      </svg>
    </Box>
  );
};
