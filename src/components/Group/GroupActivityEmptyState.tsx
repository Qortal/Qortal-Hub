import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  GroupActivityEmptyStateGraphic,
  type GroupActivityEmptyStateGraphicVariant,
} from './GroupActivityEmptyStateGraphic';

type GroupActivityEmptyStateProps = {
  compact?: boolean;
  isVisible?: boolean;
  title: string;
  secondaryLines: [string, string] | string[];
  tertiaryText?: string;
  ctaLabel: string;
  onCtaClick: () => void;
  graphicVariant?: GroupActivityEmptyStateGraphicVariant;
};

export const GroupActivityEmptyState = ({
  compact = false,
  isVisible = true,
  title,
  secondaryLines,
  tertiaryText,
  ctaLabel,
  onCtaClick,
  graphicVariant = 'requests',
}: GroupActivityEmptyStateProps) => {
  const theme = useTheme();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const graphicFrameRef = useRef<HTMLDivElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const extraLiftPxRef = useRef(0);
  const [extraLiftPx, setExtraLiftPx] = useState(0);

  const baseLiftPx = compact ? 44 : 40;
  const totalLiftPx = baseLiftPx + extraLiftPx;

  useEffect(() => {
    extraLiftPxRef.current = extraLiftPx;
  }, [extraLiftPx]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || !isVisible) return undefined;

    const scheduleMeasurement = (callback: () => void) => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        callback();
      });
    };

    const updateLift = () => {
      const ghostBarNode = document.querySelector(
        '[data-group-activity-ghost-bar="true"]'
      ) as HTMLElement | null;
      const graphicFrameNode = graphicFrameRef.current;

      if (!ghostBarNode || !graphicFrameNode) return;
      if (
        ghostBarNode.getClientRects().length === 0 ||
        graphicFrameNode.getClientRects().length === 0
      ) {
        return;
      }

      const ghostBarBottom = ghostBarNode.getBoundingClientRect().bottom;
      const graphicTop = graphicFrameNode.getBoundingClientRect().top;
      const actualGapPx = graphicTop - ghostBarBottom;
      const baselineGapPx = actualGapPx + extraLiftPxRef.current;
      const targetGapPx = baselineGapPx * 0.4;
      const nextExtraLiftPx = Math.max(0, baselineGapPx - targetGapPx);

      if (Math.abs(nextExtraLiftPx - extraLiftPxRef.current) > 0.5) {
        extraLiftPxRef.current = nextExtraLiftPx;
        setExtraLiftPx(nextExtraLiftPx);
      }
    };

    const handleMeasurement = () => {
      scheduleMeasurement(updateLift);
    };

    updateLift();
    window.addEventListener('resize', handleMeasurement);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleMeasurement);

      const ghostBarNode = document.querySelector(
        '[data-group-activity-ghost-bar="true"]'
      );
      if (ghostBarNode) {
        resizeObserver.observe(ghostBarNode);
      }
      if (rootRef.current) {
        resizeObserver.observe(rootRef.current);
      }
    }

    return () => {
      window.removeEventListener('resize', handleMeasurement);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeObserver?.disconnect();
    };
  }, [
    baseLiftPx,
    compact,
    graphicVariant,
    isVisible,
    secondaryLines,
    tertiaryText,
    title,
  ]);

  return (
    <Box
      ref={rootRef}
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        margin: '0 auto',
        maxWidth: '360px',
        position: 'relative',
        textAlign: 'center',
        transform: `translateY(-${totalLiftPx}px)`,
        width: '100%',
      }}
      className="group-empty-state"
    >
      <Box
        ref={graphicFrameRef}
        sx={{
          marginBottom: '18px',
          maxWidth: '100%',
          position: 'relative',
          width: compact ? '292px' : '254px',
        }}
      >
        <GroupActivityEmptyStateGraphic
          size={compact ? 292 : 254}
          sx={{ margin: 0 }}
          variant={graphicVariant}
        />
      </Box>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          maxWidth: '360px',
          width: '100%',
        }}
      >
        <Typography
          className="group-empty-title"
          sx={{
            color:
              theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.96)'
                : alpha(theme.palette.text.primary, 0.94),
            fontSize: compact ? '1.18rem' : '1.25rem',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            lineHeight: 1.15,
            margin: '0 0 12px',
          }}
        >
          {title}
        </Typography>
        <Typography
          className="group-empty-copy"
          component="div"
          sx={{
            color:
              theme.palette.mode === 'dark'
                ? 'rgba(221, 229, 243, 0.72)'
                : alpha(theme.palette.text.primary, 0.68),
            fontSize: compact ? '1rem' : '1.0625rem',
            fontWeight: 500,
            letterSpacing: '-0.015em',
            lineHeight: 1.34,
            margin: 0,
            maxWidth: '340px',
          }}
        >
          {secondaryLines.map((line) => (
            <Box
              key={line}
              component="span"
              className="group-empty-copy--secondary-break"
              sx={{ display: 'block' }}
            >
              {line}
            </Box>
          ))}
        </Typography>
        {tertiaryText ? (
          <Typography
            className="group-empty-copy"
            component="p"
            sx={{
              color:
                theme.palette.mode === 'dark'
                  ? 'rgba(221, 229, 243, 0.58)'
                  : alpha(theme.palette.text.primary, 0.56),
              fontSize: compact ? '1rem' : '1.0625rem',
              fontWeight: 500,
              letterSpacing: '-0.015em',
              lineHeight: 1.45,
              margin: '10px 0 0',
              maxWidth: '296px',
            }}
          >
            {tertiaryText}
          </Typography>
        ) : null}
      </Box>
      <Box className="group-empty-cta-wrap" sx={{ marginTop: '18px' }}>
        <Button
          className="group-empty-cta"
          variant="contained"
          disableElevation
          onClick={onCtaClick}
          sx={{
            appearance: 'none',
            background:
              'linear-gradient(180deg, #8fb8f3 0%, #79aaf0 42%, #6fa3f0 100%)',
            border: '1px solid rgba(143, 184, 243, 0.22)',
            borderRadius: '999px',
            boxShadow:
              '0 6px 18px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(255, 255, 255, 0.03) inset, 0 0 18px rgba(132, 175, 240, 0.18)',
            color: 'rgba(10, 18, 30, 0.92)',
            fontSize: '15px',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            lineHeight: 1,
            minHeight: '46px',
            minWidth: '168px',
            padding: '12px 22px',
            textTransform: 'none',
            transition:
              'transform 180ms ease, box-shadow 180ms ease, filter 180ms ease, background 180ms ease',
            '&:hover': {
              background:
                'linear-gradient(180deg, #98bff6 0%, #83b1f3 42%, #76a7f1 100%)',
              boxShadow:
                '0 8px 22px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(255, 255, 255, 0.04) inset, 0 0 22px rgba(132, 175, 240, 0.22)',
              filter: 'saturate(1.02)',
            },
            '&:active': {
              background: 'linear-gradient(180deg, #7faef0 0%, #6f9fe7 100%)',
              boxShadow:
                '0 4px 12px rgba(0, 0, 0, 0.24), 0 0 0 1px rgba(255, 255, 255, 0.02) inset, 0 0 12px rgba(132, 175, 240, 0.14)',
              transform: 'translateY(1px)',
            },
            '&:focus-visible': {
              boxShadow:
                '0 0 0 2px rgba(132, 175, 240, 0.28), 0 6px 18px rgba(0, 0, 0, 0.28), 0 0 18px rgba(132, 175, 240, 0.18)',
              outline: 'none',
            },
          }}
        >
          {ctaLabel}
        </Button>
      </Box>
    </Box>
  );
};
