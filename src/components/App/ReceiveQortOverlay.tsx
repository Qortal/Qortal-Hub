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
import { useTranslation } from 'react-i18next';
import { getBlueTier1ButtonSx } from '../../styles/blueMaterial';

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
  const { t } = useTranslation(['group']);
  const td = (key: string, defaultValue: string) =>
    t(`group:dashboard.${key}`, { defaultValue });
  const prefersReducedMotion = useReducedMotion();
  const isDarkMode = theme.palette.mode === 'dark';
  const qrContainerRef = useRef<HTMLDivElement | null>(null);
  const isAnchoredLayout = !!targetRect;
  const surfaceBorder = alpha(theme.palette.divider, 0.38);
  const softSectionSurface = alpha(
    isDarkMode ? theme.palette.common.white : theme.palette.text.primary,
    isDarkMode ? 0.022 : 0.03
  );
  const shellDivider = alpha(theme.palette.divider, 0.28);
  const innerDivider = alpha(theme.palette.divider, isDarkMode ? 0.16 : 0.2);

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
          aria-label={td('close_receive_qort_modal', 'Close receive QORT modal')}
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
            width: isAnchoredLayout ? `${panelLayout.width}px` : undefined,
            willChange: 'transform, opacity',
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
              height: isAnchoredLayout
                ? '100%'
                : 'min(620px, calc(100vh - 48px))',
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
                  {td('receive_qort', 'Receive QORT')}
                </Typography>
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: '0.8rem',
                    fontWeight: 400,
                    lineHeight: 1.45,
                  }}
                >
                  {td('receive_qort_subtitle', 'Scan to receive QORT')}
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
                borderTop: `1px solid ${shellDivider}`,
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
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
                  display: 'flex',
                  borderBottom: `1px solid ${innerDivider}`,
                  justifyContent: 'center',
                  minHeight: Math.max(252, qrSize + 76),
                  pb: 2,
                  px: 0.25,
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
                  borderBottom: `1px solid ${innerDivider}`,
                  px: 0.25,
                  py: 1.45,
                }}
              >
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.secondary, isDarkMode ? 0.9 : 0.82),
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    letterSpacing: '-0.01em',
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
                  pt: 1.6,
                }}
              >
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={handleCopyAddress}
                  startIcon={<ContentCopyIcon sx={{ fontSize: '0.95rem' }} />}
                  sx={{
                    backgroundColor: alpha(
                      isDarkMode ? theme.palette.common.white : theme.palette.background.paper,
                      isDarkMode ? 0.024 : 0.72
                    ),
                    borderColor: alpha(theme.palette.divider, 0.18),
                    borderRadius: '10px',
                    color: theme.palette.text.primary,
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    minHeight: 42,
                    textTransform: 'none',
                    '&:hover': {
                      backgroundColor: alpha(theme.palette.primary.main, 0.06),
                      borderColor: alpha(theme.palette.primary.main, 0.34),
                    },
                  }}
                >
                  {td('copy_address', 'Copy address')}
                </Button>
                <Button
                  variant="contained"
                  fullWidth
                  onClick={handleDownloadQr}
                  startIcon={<DownloadRoundedIcon sx={{ fontSize: '1rem' }} />}
                  sx={{
                    borderRadius: '10px',
                    ...getBlueTier1ButtonSx(),
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    minHeight: 42,
                    textTransform: 'none',
                  }}
                >
                  {td('download_qr', 'Download QR')}
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>
      </>
    </Portal>
  );
}
