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
  const cardGap = isCompact ? '10px' : '12px';
  const imageHeight =
    imageCount > 1 ? (isCompact ? 118 : 142) : isCompact ? 172 : 204;
  const textFontSize = isCompact ? '0.78rem' : '0.83rem';
  const cardSurfaceColor =
    theme.palette.mode === 'dark'
      ? 'linear-gradient(180deg, rgba(46, 50, 61, 0.92) 0%, rgba(36, 39, 49, 0.96) 100%)'
      : alpha(theme.palette.text.primary, 0.038);
  const cardSurfaceHoverColor =
    theme.palette.mode === 'dark'
      ? 'linear-gradient(180deg, rgba(50, 55, 67, 0.96) 0%, rgba(39, 43, 53, 0.98) 100%)'
      : alpha(theme.palette.text.primary, 0.05);
  const cardBorderColor =
    theme.palette.mode === 'dark'
      ? 'rgba(255,255,255,0.06)'
      : alpha(theme.palette.border.main, 0.12);
  const cardHoverBorderColor =
    theme.palette.mode === 'dark'
      ? 'rgba(255,255,255,0.085)'
      : alpha(theme.palette.border.main, 0.18);
  const cardInsetShadow =
    theme.palette.mode === 'dark'
      ? `0 10px 24px rgba(0,0,0,0.2), inset 0 1px 0 ${alpha(theme.palette.common.white, 0.045)}`
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
        background: cardSurfaceColor,
        border: `1px solid ${cardBorderColor}`,
        borderRadius: '12px',
        boxShadow: cardInsetShadow,
        display: 'flex',
        flex: '0 0 auto',
        flexDirection: 'column',
        flexShrink: 0,
        gap: cardGap,
        minHeight: 'max-content',
        overflow: 'hidden',
        p: isCompact ? '14px 14px 15px' : '16px 16px 17px',
        position: 'relative',
        tabIndex: onOpen ? 0 : undefined,
        transition:
          'transform 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease',
        width: '100%',
        ...(onOpen
          ? {
              cursor: 'pointer',
              '&:hover': {
                background: cardSurfaceHoverColor,
                borderColor: cardHoverBorderColor,
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? `0 14px 28px rgba(0,0,0,0.24), inset 0 1px 0 ${alpha(theme.palette.common.white, 0.055)}`
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
                color:
                  theme.palette.mode === 'dark'
                    ? theme.palette.common.white
                    : theme.palette.text.primary,
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
                display: 'inline-flex',
                flexShrink: 0,
                gap: '6px',
              }}
            >
              <Box
                component="span"
                sx={{
                  bgcolor:
                    theme.palette.mode === 'dark'
                      ? 'rgba(112, 122, 138, 0.82)'
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
                      ? '#707a8a'
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
            <Box sx={{ mt: '8px' }}>
              <Typography
                component="div"
                ref={textRef}
                sx={{
                  color: theme.palette.text.primary,
                  display: isExpanded ? 'block' : '-webkit-box',
                  fontSize: textFontSize,
                  lineHeight: 1.58,
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
                    color: alpha(theme.palette.primary.main, 0.84),
                    display: 'inline-flex',
                    fontSize: isCompact ? '0.71rem' : '0.73rem',
                    fontWeight: 700,
                    justifyContent: 'flex-start',
                    minHeight: 'unset',
                    mt: '5px',
                    textAlign: 'left',
                    '&:hover': {
                      color: theme.palette.primary.main,
                      textDecoration: 'underline',
                    },
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
                ? `radial-gradient(82% 110% at 78% 0%, rgba(136, 188, 255, 0.34) 0%, rgba(81, 136, 196, 0.18) 28%, rgba(28, 45, 70, 0.22) 58%, rgba(18, 23, 34, 0.96) 100%), linear-gradient(180deg, rgba(33, 39, 51, 0.92) 0%, rgba(21, 25, 35, 0.98) 100%)`
                : `linear-gradient(180deg, ${alpha(theme.palette.text.primary, 0.04)} 0%, ${alpha(theme.palette.text.primary, 0.03)} 100%)`,
            border: `1px solid ${alpha(
              theme.palette.common.white,
              theme.palette.mode === 'dark' ? 0.08 : 0.12
            )}`,
            borderRadius: '10px',
            boxShadow:
              theme.palette.mode === 'dark'
                ? `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.045)}`
                : `inset 0 1px 0 ${alpha(theme.palette.common.white, 0.64)}`,
            minHeight: imageCount > 0 ? (isCompact ? 88 : 100) : isCompact ? 104 : 120,
            overflow: 'hidden',
            position: 'relative',
            px: isCompact ? 1.2 : 1.35,
            py: isCompact ? 1.05 : 1.25,
            '&::before': {
              background:
                theme.palette.mode === 'dark'
                  ? `radial-gradient(54% 92% at 30% 52%, rgba(90, 182, 255, 0.24) 0%, rgba(45, 97, 161, 0.14) 42%, transparent 76%)`
                  : `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.18)} 0%, ${alpha(theme.palette.primary.main, 0.08)} 42%, transparent 82%)`,
              content: '""',
              inset: 0,
              opacity: 0.9,
              pointerEvents: 'none',
              position: 'absolute',
            },
            '&::after': {
              background:
                theme.palette.mode === 'dark'
                  ? `linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 34%)`
                  : `repeating-linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.12)} 0px, ${alpha(theme.palette.primary.main, 0.12)} 2px, transparent 2px, transparent 10px)`,
              content: '""',
              inset: 0,
              opacity: 0.8,
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
                    ? alpha(theme.palette.common.white, 0.09)
                    : alpha(theme.palette.common.white, 0.76),
                border: `1px solid ${alpha(
                  theme.palette.common.white,
                  theme.palette.mode === 'dark' ? 0.12 : 0.12
                )}`,
                borderRadius: '50%',
                display: 'inline-flex',
                flexShrink: 0,
                height: isCompact ? 40 : 46,
                justifyContent: 'center',
                width: isCompact ? 40 : 46,
              }}
            >
              <PlayCircleOutlineRoundedIcon
                sx={{
                  color: alpha(theme.palette.common.white, 0.96),
                  fontSize: isCompact ? '1.42rem' : '1.62rem',
                }}
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
