import { useMemo, useRef } from 'react';
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Portal,
  Typography,
  useTheme,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import CloseIcon from '@mui/icons-material/Close';
import { motion, useReducedMotion } from 'framer-motion';
import QRCode from 'react-qr-code';

type ReceiveQortOverlayProps = {
  address: string;
  originRect?: {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;
  targetRect?: {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;
  onReturn: () => void;
};

export function ReceiveQortOverlay({
  address,
  originRect = null,
  targetRect = null,
  onReturn,
}: ReceiveQortOverlayProps) {
  const theme = useTheme();
  const prefersReducedMotion = useReducedMotion();
  const isDarkMode = theme.palette.mode === 'dark';
  const qrContainerRef = useRef<HTMLDivElement | null>(null);

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

    const viewportWidth =
      typeof window !== 'undefined' ? window.innerWidth : fallbackPanelWidth + 48;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900;
    const fallbackHeight = 560;

    return {
      height: fallbackHeight,
      left: Math.max(24, (viewportWidth - fallbackPanelWidth) / 2),
      top: Math.max(40, (viewportHeight - fallbackHeight) / 2),
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
  }, [originRect, prefersReducedMotion, targetRect]);

  const qrSize = useMemo(() => {
    const widthBound = Math.max(170, panelLayout.width - 176);
    const heightBound = Math.max(170, panelLayout.height - 320);
    return Math.min(240, widthBound, heightBound);
  }, [panelLayout.height, panelLayout.width]);

  const handleCopyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
    } catch (error) {
      console.error('Failed to copy address:', error);
    }
  };

  const handleDownloadQr = () => {
    if (!address || !qrContainerRef.current) return;
    const svg = qrContainerRef.current.querySelector('svg');
    if (!svg) return;

    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const blob = new Blob([source], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'qort-wallet-qr.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Portal>
      <>
        <Box
          component={motion.button}
          type="button"
          aria-label="Close receive QORT modal"
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
            left: `${panelLayout.left}px`,
            overflow: 'hidden',
            position: 'fixed',
            top: `${panelLayout.top}px`,
            transformOrigin: targetRect ? 'bottom left' : 'center center',
            height: `${panelLayout.height}px`,
            width: `${panelLayout.width}px`,
            willChange: 'transform, opacity',
            zIndex: 1399,
          }}
        >
          <Box
            sx={{
              backgroundColor: isDarkMode ? '#2C303A' : '#FBF8F2',
              border: isDarkMode
                ? '1px solid rgba(255,255,255,0.075)'
                : '1px solid rgba(28,36,52,0.08)',
              borderRadius: '18px',
              boxShadow: isDarkMode
                ? '0 38px 92px rgba(0,0,0,0.54), 0 14px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.035)'
                : '0 32px 72px rgba(28, 36, 52, 0.2), 0 12px 26px rgba(28, 36, 52, 0.1), inset 0 1px 0 rgba(255,255,255,0.45)',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                justifyContent: 'space-between',
                px: 2.25,
                py: 1.7,
              }}
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <Typography
                  sx={{
                    color: theme.palette.text.primary,
                    fontSize: '1.04rem',
                    fontWeight: 650,
                    letterSpacing: '0.014em',
                  }}
                >
                  Receive QORT
                </Typography>
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: '0.79rem',
                    fontWeight: 400,
                    lineHeight: 1.42,
                  }}
                >
                  Scan to receive QORT
                </Typography>
              </Box>
              <ButtonBase
                onClick={onReturn}
                sx={{
                  borderRadius: '9px',
                  color: theme.palette.text.secondary,
                  height: 28,
                  width: 28,
                  '&:hover': {
                    backgroundColor: theme.palette.action.hover,
                    color: theme.palette.text.primary,
                  },
                }}
              >
                <CloseIcon sx={{ fontSize: 17 }} />
              </ButtonBase>
            </Box>

            <Box
              sx={{
                borderTop: `1px solid ${theme.palette.border.subtle}`,
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.8,
                minHeight: 0,
                overflowY: 'auto',
                px: 2.25,
                pb: 2.25,
                pt: 2,
              }}
            >
              <Box
                ref={qrContainerRef}
                sx={{
                  alignItems: 'center',
                  background:
                    isDarkMode
                      ? 'linear-gradient(180deg, rgba(40,44,54,0.98) 0%, rgba(34,37,45,1) 100%)'
                      : 'linear-gradient(180deg, rgba(248,243,234,0.96) 0%, rgba(242,235,225,1) 100%)',
                  border: isDarkMode
                    ? '1px solid rgba(255,255,255,0.075)'
                    : '1px solid rgba(28,36,52,0.08)',
                  borderRadius: '16px',
                  display: 'flex',
                  justifyContent: 'center',
                  minHeight: Math.max(252, qrSize + 76),
                  p: 3,
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    backgroundColor: '#ffffff',
                    borderRadius: '18px',
                    boxShadow:
                      '0 10px 24px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.7)',
                    display: 'flex',
                    justifyContent: 'center',
                    p: 2.2,
                  }}
                >
                  <QRCode
                    value={address || ''}
                    size={qrSize}
                    level="M"
                    bgColor="#FFFFFF"
                    fgColor="#000000"
                  />
                </Box>
              </Box>

              <Box
                sx={{
                  background:
                    isDarkMode
                      ? 'linear-gradient(180deg, rgba(40,44,54,0.98) 0%, rgba(34,37,45,1) 100%)'
                      : 'linear-gradient(180deg, rgba(248,243,234,0.96) 0%, rgba(242,235,225,1) 100%)',
                  border: isDarkMode
                    ? '1px solid rgba(255,255,255,0.075)'
                    : '1px solid rgba(28,36,52,0.08)',
                  borderRadius: '14px',
                  px: 1.5,
                  py: 1.2,
                }}
              >
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.secondary, isDarkMode ? 0.88 : 0.8),
                    fontFamily: 'monospace',
                    fontSize: '0.78rem',
                    lineHeight: 1.55,
                    textAlign: 'center',
                    wordBreak: 'break-all',
                  }}
                >
                  {address || '—'}
                </Typography>
              </Box>

              <Box
                sx={{
                  display: 'grid',
                  gap: '10px',
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                }}
              >
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={handleCopyAddress}
                  startIcon={<ContentCopyIcon sx={{ fontSize: '0.95rem' }} />}
                  sx={{
                    backgroundColor: isDarkMode ? '#1C2027' : '#FFFDFC',
                    borderColor: theme.palette.border.subtle,
                    borderRadius: '12px',
                    color: theme.palette.text.primary,
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    minHeight: 44,
                    textTransform: 'none',
                    '&:hover': {
                      backgroundColor: theme.palette.action.hover,
                      borderColor: theme.palette.border.main,
                    },
                  }}
                >
                  Copy address
                </Button>
                <Button
                  variant="contained"
                  fullWidth
                  onClick={handleDownloadQr}
                  startIcon={<DownloadRoundedIcon sx={{ fontSize: '1rem' }} />}
                  sx={{
                    backgroundColor: theme.palette.primary.main,
                    border: isDarkMode
                      ? '1px solid rgba(255,255,255,0.07)'
                      : '1px solid rgba(255,255,255,0.3)',
                    borderRadius: '12px',
                    boxShadow: isDarkMode
                      ? '0 12px 28px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.08)'
                      : '0 10px 24px rgba(45, 84, 138, 0.18), inset 0 1px 0 rgba(255,255,255,0.28)',
                    color: '#fff',
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    minHeight: 44,
                    textTransform: 'none',
                    '&:hover': {
                      backgroundColor: theme.palette.primary.main,
                      filter: 'brightness(1.05)',
                    },
                  }}
                >
                  Download QR
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>
      </>
    </Portal>
  );
}
