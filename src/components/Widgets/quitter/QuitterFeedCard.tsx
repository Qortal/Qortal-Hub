import PlayCircleOutlineRoundedIcon from '@mui/icons-material/PlayCircleOutlineRounded';
import { Avatar, Box, ButtonBase, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useEffect, useRef, useState } from 'react';
import { formatTimestamp } from '../../../utils/time';
import type { WidgetDisplayMode } from '../DashboardWidgetFrame';
import type { QuitterFeedItem } from './quitterFeedTypes';

type QuitterFeedCardProps = {
  displayMode?: WidgetDisplayMode;
  item: QuitterFeedItem;
  onOpen?: () => void;
};

export const QuitterFeedCard = ({
  displayMode = 'compact',
  item,
  onOpen,
}: QuitterFeedCardProps) => {
  const theme = useTheme();
  const hasText = item.text.trim().length > 0;
  const imageCount = item.images.length;
  const hasMedia = imageCount > 0 || item.hasVideo;
  const isCompact = displayMode === 'compact';
  const collapsedLineCount = hasMedia
    ? isCompact
      ? 2
      : 3
    : isCompact
      ? 3
      : 4;
  const cardGap = isCompact ? '8px' : '11px';
  const imageHeight =
    imageCount > 1 ? (isCompact ? 118 : 142) : isCompact ? 172 : 204;
  const textFontSize = isCompact ? '0.78rem' : '0.83rem';
  const cardSurfaceColor =
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.common.white, 0.046)
      : alpha(theme.palette.text.primary, 0.038);
  const cardSurfaceHoverColor =
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.common.white, 0.064)
      : alpha(theme.palette.text.primary, 0.05);
  const cardBorderColor = alpha(
    theme.palette.border.main,
    theme.palette.mode === 'dark' ? 0.2 : 0.12
  );
  const cardHoverBorderColor = alpha(
    theme.palette.border.main,
    theme.palette.mode === 'dark' ? 0.3 : 0.18
  );
  const cardInsetShadow =
    theme.palette.mode === 'dark'
      ? `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.05)}`
      : `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.76)}`;
  const textRef = useRef<HTMLDivElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTextExpandable, setIsTextExpandable] = useState(false);

  useEffect(() => {
    setIsExpanded(false);
  }, [item.id]);

  useEffect(() => {
    if (!hasText) {
      setIsTextExpandable(false);
      return;
    }

    const node = textRef.current;
    if (!node) {
      return;
    }

    const measureOverflow = () => {
      if (isExpanded) {
        return;
      }

      setIsTextExpandable(node.scrollHeight - node.clientHeight > 1);
    };

    measureOverflow();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureOverflow);

      return () => {
        window.removeEventListener('resize', measureOverflow);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      measureOverflow();
    });

    resizeObserver.observe(node);

    return () => {
      resizeObserver.disconnect();
    };
  }, [collapsedLineCount, hasText, isExpanded, item.text]);

  return (
    <Box
      onClick={onOpen}
      onKeyDown={(event) => {
        if (!onOpen) {
          return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      role={onOpen ? 'link' : undefined}
      sx={{
        backgroundColor: cardSurfaceColor,
        border: `1px solid ${cardBorderColor}`,
        borderRadius: '9px',
        boxShadow: cardInsetShadow,
        display: 'flex',
        flex: '0 0 auto',
        flexDirection: 'column',
        flexShrink: 0,
        gap: cardGap,
        minHeight: 'max-content',
        overflow: 'hidden',
        p: isCompact ? '11px 11px 12px' : '13px 13px 14px',
        position: 'relative',
        tabIndex: onOpen ? 0 : undefined,
        transition:
          'transform 140ms ease, border-color 140ms ease, background-color 140ms ease',
        width: '100%',
        ...(onOpen
          ? {
              cursor: 'pointer',
              '&:hover': {
                backgroundColor: cardSurfaceHoverColor,
                borderColor: cardHoverBorderColor,
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.06)}`
                    : `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.84)}`,
                transform: 'translateY(-1px)',
              },
              '&:focus-visible': {
                outline: `2px solid ${alpha(theme.palette.primary.main, 0.48)}`,
                outlineOffset: '-2px',
              },
            }
          : null),
      }}
    >
      <Box sx={{ display: 'flex', gap: isCompact ? '9px' : '10px' }}>
        <Avatar
          alt={item.author}
          src={item.avatarUrl}
          sx={{
            bgcolor:
              theme.palette.mode === 'dark'
                ? alpha(theme.palette.common.white, 0.08)
                : alpha(theme.palette.text.primary, 0.08),
            border: `1px solid ${alpha(theme.palette.border.main, theme.palette.mode === 'dark' ? 0.34 : 0.16)}`,
            color: theme.palette.text.primary,
            flexShrink: 0,
            height: isCompact ? 34 : 38,
            width: isCompact ? 34 : 38,
          }}
        >
          {item.author.charAt(0).toUpperCase()}
        </Avatar>

        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          <Box
            sx={{
              alignItems: 'center',
              columnGap: '8px',
              display: 'flex',
              flexWrap: 'wrap',
              rowGap: '6px',
            }}
          >
            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontSize: isCompact ? '0.82rem' : '0.87rem',
                fontWeight: 700,
                letterSpacing: '-0.01em',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.author}
            </Typography>
            <Box
              sx={{
                alignItems: 'center',
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? alpha(theme.palette.common.white, 0.045)
                    : alpha(theme.palette.text.primary, 0.035),
                border: `1px solid ${alpha(
                  theme.palette.border.main,
                  theme.palette.mode === 'dark' ? 0.22 : 0.12
                )}`,
                borderRadius: '999px',
                color: theme.palette.text.secondary,
                display: 'inline-flex',
                flexShrink: 0,
                gap: '5px',
                px: 0.75,
                py: 0.28,
              }}
            >
              <Box
                sx={{
                  bgcolor:
                    theme.palette.mode === 'dark'
                      ? alpha(theme.palette.common.white, 0.28)
                      : alpha(theme.palette.text.primary, 0.22),
                  borderRadius: '50%',
                  height: 4,
                  width: 4,
                }}
              />
              <Typography
                sx={{
                  color:
                    theme.palette.mode === 'dark'
                      ? 'rgba(223, 228, 238, 0.64)'
                      : 'rgba(72, 78, 92, 0.72)',
                  fontSize: isCompact ? '0.67rem' : '0.69rem',
                  fontWeight: 600,
                  letterSpacing: '0.01em',
                  lineHeight: 1,
                }}
              >
                {formatTimestamp(item.publishedAt)}
              </Typography>
            </Box>
          </Box>

          {hasText ? (
            <Box sx={{ mt: '6px' }}>
              <Typography
                component="div"
                ref={textRef}
                sx={{
                  color: theme.palette.text.primary,
                  display: isExpanded ? 'block' : '-webkit-box',
                  fontSize: textFontSize,
                  lineHeight: 1.52,
                  overflow: 'hidden',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: isExpanded ? 'unset' : collapsedLineCount,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {item.text}
              </Typography>
              {isTextExpandable || isExpanded ? (
                <ButtonBase
                  disableRipple
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsExpanded((value) => !value);
                  }}
                  sx={{
                    alignItems: 'center',
                    color: theme.palette.primary.main,
                    display: 'inline-flex',
                    fontSize: isCompact ? '0.71rem' : '0.73rem',
                    fontWeight: 700,
                    justifyContent: 'flex-start',
                    minHeight: 'unset',
                    mt: '3px',
                    textAlign: 'left',
                  }}
                >
                  {isExpanded ? 'Show less' : 'Show more'}
                </ButtonBase>
              ) : null}
            </Box>
          ) : null}
        </Box>
      </Box>

      {item.hasVideo ? (
        <Box
          sx={{
            background:
              theme.palette.mode === 'dark'
                ? `linear-gradient(180deg, ${alpha(theme.palette.common.white, 0.045)} 0%, ${alpha(theme.palette.common.white, 0.032)} 100%)`
                : `linear-gradient(180deg, ${alpha(theme.palette.text.primary, 0.04)} 0%, ${alpha(theme.palette.text.primary, 0.03)} 100%)`,
            border: `1px solid ${alpha(
              theme.palette.border.main,
              theme.palette.mode === 'dark' ? 0.2 : 0.12
            )}`,
            borderRadius: '8px',
            boxShadow:
              theme.palette.mode === 'dark'
                ? `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.03)}`
                : `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.64)}`,
            minHeight: imageCount > 0 ? (isCompact ? 88 : 100) : isCompact ? 104 : 120,
            overflow: 'hidden',
            position: 'relative',
            px: isCompact ? 1.2 : 1.35,
            py: isCompact ? 1.05 : 1.25,
            '&::before': {
              background:
                theme.palette.mode === 'dark'
                  ? `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.16)} 0%, ${alpha(theme.palette.primary.main, 0.06)} 42%, transparent 82%)`
                  : `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.18)} 0%, ${alpha(theme.palette.primary.main, 0.08)} 42%, transparent 82%)`,
              content: '""',
              height: '1px',
              left: isCompact ? 14 : 16,
              opacity: 0.95,
              pointerEvents: 'none',
              position: 'absolute',
              right: isCompact ? 14 : 16,
              top: isCompact ? 14 : 16,
            },
            '&::after': {
              background:
                theme.palette.mode === 'dark'
                  ? `repeating-linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.12)} 0px, ${alpha(theme.palette.primary.main, 0.12)} 2px, transparent 2px, transparent 10px)`
                  : `repeating-linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.12)} 0px, ${alpha(theme.palette.primary.main, 0.12)} 2px, transparent 2px, transparent 10px)`,
              content: '""',
              inset: 0,
              maskImage:
                'linear-gradient(115deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.18) 44%, transparent 76%)',
              opacity: 0.65,
              pointerEvents: 'none',
              position: 'absolute',
            },
          }}
        >
          <Box
            sx={{
              background:
                theme.palette.mode === 'dark'
                  ? `radial-gradient(74% 88% at 100% 0%, ${alpha(theme.palette.primary.main, 0.14)} 0%, ${alpha(theme.palette.primary.main, 0.04)} 42%, transparent 76%)`
                  : `radial-gradient(74% 88% at 100% 0%, ${alpha(theme.palette.primary.main, 0.12)} 0%, ${alpha(theme.palette.primary.main, 0.04)} 42%, transparent 76%)`,
              inset: 0,
              pointerEvents: 'none',
              position: 'absolute',
            }}
          />
          <Box
            sx={{
              alignItems: 'center',
              color:
                theme.palette.mode === 'dark'
                  ? alpha(theme.palette.common.white, 0.96)
                  : alpha(theme.palette.text.primary, 0.9),
              display: 'flex',
              gap: '10px',
              justifyContent: 'space-between',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: isCompact ? '0.74rem' : '0.78rem',
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                }}
              >
                Video attachment
              </Typography>
              <Typography
                sx={{
                  color:
                    theme.palette.mode === 'dark'
                      ? 'rgba(223, 228, 238, 0.62)'
                      : 'rgba(72, 78, 92, 0.68)',
                  fontSize: isCompact ? '0.66rem' : '0.69rem',
                  lineHeight: 1.45,
                  mt: '2px',
                }}
              >
                Preview stays read-only in Hub
              </Typography>
            </Box>
            <Box
              sx={{
                alignItems: 'center',
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? alpha(theme.palette.common.white, 0.085)
                    : alpha(theme.palette.common.white, 0.76),
                border: `1px solid ${alpha(
                  theme.palette.border.main,
                  theme.palette.mode === 'dark' ? 0.22 : 0.12
                )}`,
                borderRadius: '50%',
                display: 'inline-flex',
                flexShrink: 0,
                height: isCompact ? 38 : 44,
                justifyContent: 'center',
                width: isCompact ? 38 : 44,
              }}
            >
              <PlayCircleOutlineRoundedIcon
                sx={{ fontSize: isCompact ? '1.4rem' : '1.6rem' }}
              />
            </Box>
          </Box>
        </Box>
      ) : null}

      {imageCount > 0 ? (
        <Box
          sx={{
            display: 'grid',
            gap: '6px',
            gridTemplateColumns:
              imageCount > 1 ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
          }}
        >
          {item.images.map((image) => (
            <Box
              key={image.src}
              sx={{
                border: `1px solid ${alpha(
                  theme.palette.border.main,
                  theme.palette.mode === 'dark' ? 0.24 : 0.12
                )}`,
                borderRadius: '8px',
                maxHeight: imageHeight,
                overflow: 'hidden',
              }}
            >
              <Box
                component="img"
                alt={image.alt}
                loading="lazy"
                src={image.src}
                sx={{
                  aspectRatio: imageCount > 1 ? '1 / 1' : '16 / 10',
                  display: 'block',
                  height: imageHeight,
                  maxHeight: imageHeight,
                  objectFit: 'cover',
                  width: '100%',
                }}
              />
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
};
