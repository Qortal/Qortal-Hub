import { useMemo } from 'react';
import {
  alpha,
  Box,
  ButtonBase,
  Portal,
  Typography,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { QortPayment } from '../QortPayment';

type SendQortOriginRect = {
  left: number;
  top: number;
  width: number;
  height: number;
} | null;

type SendQortOverlayProps = {
  balance: number;
  paymentTo: string;
  originRect?: SendQortOriginRect;
  targetRect?: SendQortOriginRect;
  onReturn: () => void;
  onSuccess: () => void;
  show: (data: any) => Promise<unknown>;
};

export function SendQortOverlay({
  balance,
  paymentTo,
  originRect = null,
  targetRect = null,
  onReturn,
  onSuccess,
  show,
}: SendQortOverlayProps) {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const td = (key: string, defaultValue: string) =>
    t(`group:dashboard.${key}`, { defaultValue });
  const prefersReducedMotion = useReducedMotion();
  const isDarkMode = theme.palette.mode === 'dark';
  const isAnchoredLayout = !!targetRect;
  const surfaceBorder = alpha(theme.palette.divider, 0.38);
  const headerDivider = alpha(theme.palette.divider, 0.28);

  const fallbackPanelWidth = useMemo(() => {
    if (typeof window === 'undefined') return 620;
    return Math.min(700, Math.max(560, window.innerWidth - 48));
  }, []);

  const panelLayout = useMemo(() => {
    if (targetRect) {
      return {
        height: targetRect.height,
        left: targetRect.left,
        top: targetRect.top,
        width: targetRect.width,
      };
    }

    return {
      width: fallbackPanelWidth,
    };
  }, [fallbackPanelWidth, targetRect]);

  const panelAnimation = useMemo(() => {
    if (originRect && targetRect && !prefersReducedMotion) {
      return {
        initial: {
          borderRadius: 10,
          opacity: 0.9,
          scaleX: Math.max(0.18, originRect.width / targetRect.width),
          scaleY: Math.max(0.12, originRect.height / targetRect.height),
          x: originRect.left - targetRect.left,
          y:
            originRect.top +
            originRect.height -
            (targetRect.top + targetRect.height),
        },
        animate: {
          borderRadius: 18,
          opacity: 1,
          scaleX: 1,
          scaleY: 1,
          x: 0,
          y: 0,
        },
        exit: {
          borderRadius: 10,
          opacity: 0.9,
          scaleX: Math.max(0.18, originRect.width / targetRect.width),
          scaleY: Math.max(0.12, originRect.height / targetRect.height),
          x: originRect.left - targetRect.left,
          y:
            originRect.top +
            originRect.height -
            (targetRect.top + targetRect.height),
        },
      };
    }

    return {
      initial: prefersReducedMotion
        ? { opacity: 0 }
        : { opacity: 0, y: 18, scale: 0.985 },
      animate: prefersReducedMotion
        ? { opacity: 1 }
        : { opacity: 1, y: 0, scale: 1 },
      exit: prefersReducedMotion
        ? { opacity: 0 }
        : { opacity: 0, y: 10, scale: 0.985 },
    };
  }, [prefersReducedMotion]);

  return (
    <Portal>
      <>
        <Box
          component={motion.button}
          type="button"
          aria-label={td('close_send_qort_modal', 'Close send QORT modal')}
          initial={{
            opacity: 0,
            backdropFilter: 'blur(0px) brightness(1) saturate(1)',
            WebkitBackdropFilter: 'blur(0px) brightness(1) saturate(1)',
            backgroundColor: isDarkMode
              ? 'rgba(6, 8, 12, 0)'
              : 'rgba(22, 26, 34, 0)',
          }}
          animate={{
            opacity: 1,
            backdropFilter: isDarkMode
              ? 'blur(12px) brightness(0.76) saturate(0.88)'
              : 'blur(12px) brightness(0.9) saturate(0.94)',
            WebkitBackdropFilter: isDarkMode
              ? 'blur(12px) brightness(0.76) saturate(0.88)'
              : 'blur(12px) brightness(0.9) saturate(0.94)',
            backgroundColor: isDarkMode
              ? 'rgba(6, 8, 12, 0.4)'
              : 'rgba(22, 26, 34, 0.14)',
          }}
          exit={{
            opacity: 0,
            backdropFilter: 'blur(0px) brightness(1) saturate(1)',
            WebkitBackdropFilter: 'blur(0px) brightness(1) saturate(1)',
            backgroundColor: isDarkMode
              ? 'rgba(6, 8, 12, 0)'
              : 'rgba(22, 26, 34, 0)',
          }}
          transition={{
            duration: prefersReducedMotion ? 0.06 : 0.1,
            ease: [0.2, 0, 0, 1],
            delay: 0,
          }}
          onClick={onReturn}
          sx={{
            appearance: 'none',
            border: 0,
            inset: 0,
            padding: 0,
            position: 'fixed',
            zIndex: 1398,
          }}
        />

        <Box
          component={motion.div}
          initial={panelAnimation.initial}
          animate={panelAnimation.animate}
          exit={panelAnimation.exit}
          transition={{
            duration: prefersReducedMotion ? 0.08 : 0.16,
            ease: [0.22, 1, 0.36, 1],
          }}
          onClick={(event) => event.stopPropagation()}
          sx={{
            position: 'fixed',
            inset: isAnchoredLayout ? undefined : 0,
            left: isAnchoredLayout ? `${panelLayout.left}px` : undefined,
            top: isAnchoredLayout ? `${panelLayout.top}px` : undefined,
            alignItems: isAnchoredLayout ? undefined : 'center',
            display: isAnchoredLayout ? undefined : 'flex',
            justifyContent: isAnchoredLayout ? undefined : 'center',
            overflow: 'visible',
            p: isAnchoredLayout ? 0 : 3,
            pointerEvents: 'none',
            transformOrigin: targetRect ? 'bottom left' : 'center center',
            height: isAnchoredLayout ? `${panelLayout.height}px` : undefined,
            willChange: 'transform, opacity',
            width: isAnchoredLayout ? `${panelLayout.width}px` : undefined,
            zIndex: 1399,
          }}
        >
          <Box
            sx={{
              background: isDarkMode
                ? 'linear-gradient(180deg, rgba(20,23,30,0.985) 0%, rgba(15,17,23,0.99) 100%)'
                : 'linear-gradient(180deg, rgba(251,253,255,0.985) 0%, rgba(244,247,251,0.99) 100%)',
              border: `1px solid ${surfaceBorder}`,
              borderRadius: '14px',
              boxShadow: isDarkMode
                ? '0 34px 120px rgba(0,0,0,0.46)'
                : '0 28px 88px rgba(18,28,45,0.16)',
              clipPath: 'inset(0 round 14px)',
              display: 'flex',
              flexDirection: 'column',
              height: isAnchoredLayout ? '100%' : 'auto',
              isolation: 'isolate',
              maxHeight: isAnchoredLayout ? undefined : 'calc(100vh - 48px)',
              overflow: 'hidden',
              pointerEvents: 'auto',
              width: isAnchoredLayout ? '100%' : 'min(700px, 100%)',
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                justifyContent: 'space-between',
                px: 2.3,
                py: 1.45,
              }}
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <Typography
                  sx={{
                    color: theme.palette.text.primary,
                    fontSize: '1rem',
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {td('send_qort', 'Send QORT')}
                </Typography>
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: '0.8rem',
                    fontWeight: 400,
                    lineHeight: 1.45,
                  }}
                >
                  {td(
                    'send_qort_subtitle',
                    'Transfer QORT to any registered name or address.'
                  )}
                </Typography>
              </Box>
              <ButtonBase
                onClick={onReturn}
                sx={{
                  borderRadius: '8px',
                  color: theme.palette.text.secondary,
                  height: 30,
                  width: 30,
                  '&:hover': {
                    backgroundColor: alpha(theme.palette.common.white, isDarkMode ? 0.05 : 0.55),
                    color: theme.palette.text.primary,
                  },
                }}
              >
                <CloseIcon sx={{ fontSize: 17 }} />
              </ButtonBase>
            </Box>

            <Box
              sx={{
                borderTop: `1px solid ${headerDivider}`,
                flex: isAnchoredLayout ? 1 : '0 1 auto',
                minHeight: 0,
                overflowY: 'auto',
                overscrollBehavior: 'contain',
                px: { xs: 0, sm: 0 },
                py: 0.25,
              }}
            >
              <QortPayment
                balance={balance}
                show={show}
                onSuccess={onSuccess}
                defaultPaymentTo={paymentTo}
                compact
              />
            </Box>
          </Box>
        </Box>
      </>
    </Portal>
  );
}
