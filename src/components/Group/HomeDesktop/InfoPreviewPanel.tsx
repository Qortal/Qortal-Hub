import {
  Box,
  ButtonBase,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import { alpha, type Theme } from '@mui/material/styles';
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { GROUP_ACTIVITY_BLUE } from '../groupActivityColorSystem';
import {
  dashboardPanelSx,
  handleDashboardPanelPointerLeave,
  handleDashboardPanelPointerMove,
  useDashboardPanelMouseLight,
} from '../dashboardPanelEffects';
import { ProgressiveBlur } from '../../ui/progressive-blur';
import {
  HOME_WIDE_DASHBOARD_MIN_WIDTH_PX,
  INFO_PANEL_EXPAND_CLOSE_DELAY_MS,
  INFO_PANEL_EXPAND_OPEN_DELAY_MS,
  INFO_PANEL_EXPANDED_EXTRA_BREATHING_PX,
  SYSTEM_BADGE_SX,
} from './homeDesktopConstants';

export type InfoPreviewStatusTone = 'operational' | 'syncing' | 'issue';

type InfoPreviewPrimaryRow = {
  label: string;
  emphasize?: boolean;
  value?: string;
  valueNode?: ReactNode;
  variant?: 'pill';
  pillTone?: 'negative' | 'warning' | 'positive';
};

type InfoPreviewMetricItem = {
  label: string;
  value: string;
  accent?: string;
};

type InfoPreviewFooterRow = {
  label: string;
  value?: string;
  valueNode?: ReactNode;
  labelAction?: {
    ariaLabel: string;
    isOpen: boolean;
    onClick: (event: MouseEvent<HTMLButtonElement>) => void;
    tooltip: string;
  };
};

type InfoPreviewFooterSection = {
  title: string;
  offsetTopPx?: number;
  items: InfoPreviewFooterRow[];
};

export type InfoPreviewPanelRows = {
  status: {
    tone: InfoPreviewStatusTone;
    isOperational?: boolean;
    label?: string;
  };
  primaryItems: InfoPreviewPrimaryRow[];
  metricItems: InfoPreviewMetricItem[];
  footerSections: InfoPreviewFooterSection[];
};

const sepSx = (theme) => ({
  borderBottom: `1px solid ${theme.palette.border.subtle}`,
});

const infoSepSx = (theme, _index, _total) => sepSx(theme);

export const InfoPreviewPanel = ({
  rows,
  theme,
  maxExpandedHeightPx = null,
  forceExpanded = false,
  resetKey = 'default',
}: {
  rows: InfoPreviewPanelRows;
  theme: Theme;
  maxExpandedHeightPx?: number | null;
  forceExpanded?: boolean;
  resetKey?: string;
}) => {
  const enableOverlay = useMediaQuery(
    theme.breakpoints.up(HOME_WIDE_DASHBOARD_MIN_WIDTH_PX)
  );
  const panelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [collapsedHeight, setCollapsedHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const footerSectionCount = rows.footerSections.length;
  const footerItemCount = rows.footerSections.reduce(
    (total, section) => total + section.items.length,
    0
  );

  const clearHoverTimers = () => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearHoverTimers();
  }, []);

  useEffect(() => {
    clearHoverTimers();
    setIsExpanded(false);
    setCollapsedHeight(0);
    setContentHeight(0);
  }, [resetKey]);

  useEffect(() => {
    if (!enableOverlay) {
      setIsExpanded(false);
      return;
    }

    const wrapperNode = wrapperRef.current;
    const contentNode = contentRef.current;
    if (!wrapperNode || !contentNode) return;

    const updateMeasurements = () => {
      setCollapsedHeight(wrapperNode.getBoundingClientRect().height);
      setContentHeight(contentNode.scrollHeight);
    };

    updateMeasurements();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateMeasurements);
      return () => {
        window.removeEventListener('resize', updateMeasurements);
      };
    }

    const resizeObserver = new ResizeObserver(updateMeasurements);
    resizeObserver.observe(wrapperNode);
    resizeObserver.observe(contentNode);
    window.addEventListener('resize', updateMeasurements);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateMeasurements);
    };
  }, [
    enableOverlay,
    footerItemCount,
    footerSectionCount,
    rows.metricItems.length,
    rows.primaryItems.length,
  ]);

  const hasOverflow =
    enableOverlay && collapsedHeight > 0 && contentHeight > collapsedHeight + 4;
  const isEffectivelyExpanded = isExpanded || (forceExpanded && hasOverflow);
  const resolvedCollapsedHeight =
    collapsedHeight > 0 ? collapsedHeight : undefined;
  const rawExpandedHeight = resolvedCollapsedHeight
    ? Math.max(
        resolvedCollapsedHeight,
        contentHeight + INFO_PANEL_EXPANDED_EXTRA_BREATHING_PX
      )
    : contentHeight + INFO_PANEL_EXPANDED_EXTRA_BREATHING_PX;
  const expandedHeight =
    maxExpandedHeightPx != null
      ? Math.max(
          resolvedCollapsedHeight ?? 0,
          Math.min(rawExpandedHeight, maxExpandedHeightPx)
        )
      : rawExpandedHeight;

  const handleMouseEnter = () => {
    if (!hasOverflow) return;
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (isExpanded || openTimerRef.current !== null) return;
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setIsExpanded(true);
    }, INFO_PANEL_EXPAND_OPEN_DELAY_MS);
  };

  const handleMouseLeave = (event: MouseEvent<HTMLDivElement>) => {
    handleDashboardPanelPointerLeave(event);
    if (forceExpanded) return;
    if (!hasOverflow) return;
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (!isExpanded || closeTimerRef.current !== null) return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setIsExpanded(false);
    }, INFO_PANEL_EXPAND_CLOSE_DELAY_MS);
  };

  const showCollapsedFade = hasOverflow && !isEffectivelyExpanded;
  const statusAccentColor =
    rows.status.tone === 'issue'
      ? theme.palette.mode === 'dark'
        ? alpha(theme.palette.error.light, 0.9)
        : alpha(theme.palette.error.main, 0.88)
      : rows.status.tone === 'syncing'
        ? theme.palette.mode === 'dark'
          ? alpha(theme.palette.warning.light, 0.9)
          : alpha(theme.palette.warning.main, 0.88)
        : theme.palette.mode === 'dark'
          ? alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.96)
          : alpha(GROUP_ACTIVITY_BLUE.gradientBottom, 0.92);
  const statusGlowColor =
    rows.status.tone === 'issue'
      ? alpha(theme.palette.error.light, 0.16)
      : rows.status.tone === 'syncing'
        ? alpha(theme.palette.warning.light, 0.18)
        : alpha(GROUP_ACTIVITY_BLUE.primary, 0.18);

  const renderPrimaryValue = (row: InfoPreviewPrimaryRow) => {
    if (row.valueNode) return row.valueNode;

    if (row.variant === 'pill') {
      const pillTone =
        row.pillTone === 'negative'
          ? {
              background:
                theme.palette.mode === 'dark'
                  ? 'rgba(104, 70, 74, 0.32)'
                  : 'rgba(168, 90, 90, 0.12)',
              border: alpha(
                theme.palette.error.light,
                theme.palette.mode === 'dark' ? 0.16 : 0.22
              ),
              color:
                theme.palette.mode === 'dark'
                  ? alpha(theme.palette.error.light, 0.88)
                  : alpha(theme.palette.error.dark, 0.88),
            }
          : row.pillTone === 'warning'
            ? {
                background:
                  theme.palette.mode === 'dark'
                    ? 'rgba(123, 102, 62, 0.3)'
                    : 'rgba(173, 140, 74, 0.14)',
                border: alpha(
                  theme.palette.warning.light,
                  theme.palette.mode === 'dark' ? 0.18 : 0.24
                ),
                color:
                  theme.palette.mode === 'dark'
                    ? alpha(theme.palette.warning.light, 0.9)
                    : alpha(theme.palette.warning.dark, 0.88),
              }
            : {
                background:
                  theme.palette.mode === 'dark'
                    ? 'rgba(88, 122, 178, 0.3)'
                    : 'rgba(117, 161, 227, 0.15)',
                border: alpha(
                  GROUP_ACTIVITY_BLUE.gradientTop,
                  theme.palette.mode === 'dark' ? 0.18 : 0.24
                ),
                color:
                  theme.palette.mode === 'dark'
                    ? alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.92)
                    : alpha(GROUP_ACTIVITY_BLUE.pressed, 0.9),
              };
      return (
        <Box
          sx={{
            alignItems: 'center',
            background: pillTone.background,
            border: `1px solid ${pillTone.border}`,
            boxShadow: 'boxShadow' in pillTone ? pillTone.boxShadow : 'none',
            color: pillTone.color,
            display: 'inline-flex',
            justifyContent: 'center',
            justifySelf: 'end',
            maxWidth: '100%',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            ...SYSTEM_BADGE_SX,
          }}
        >
          {row.value}
        </Box>
      );
    }

    return (
      <Typography
        sx={{
          color: row.emphasize
            ? theme.palette.text.primary
            : alpha(theme.palette.text.primary, 0.9),
          fontSize: row.emphasize ? '0.96rem' : '0.88rem',
          fontWeight: row.emphasize ? 700 : 600,
          letterSpacing: row.emphasize ? '0.01em' : '0.012em',
          lineHeight: 1.2,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {row.value}
      </Typography>
    );
  };

  return (
    <Box
      ref={wrapperRef}
      sx={{
        minWidth: 0,
        position: 'relative',
        width: '100%',
        ...(enableOverlay
          ? {
              height: '100%',
              minHeight: 0,
              zIndex: isEffectivelyExpanded ? 4 : 1,
            }
          : {}),
      }}
    >
      <Box
        ref={panelRef}
        sx={{
          ...dashboardPanelSx(theme, 'utility'),
          borderRadius: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          minWidth: 0,
          overflow: 'hidden',
          px: '16px',
          py: '12px',
          width: '100%',
          ...(enableOverlay
            ? {
                borderColor: isEffectivelyExpanded
                  ? theme.palette.border.main
                  : theme.palette.border.subtle,
                boxShadow: isEffectivelyExpanded
                  ? theme.palette.mode === 'dark'
                    ? '0 26px 34px -12px rgba(0, 0, 0, 0.34)'
                    : '0 24px 28px -12px rgba(15, 23, 42, 0.16)'
                  : undefined,
                height:
                  resolvedCollapsedHeight == null
                    ? '100%'
                    : `${
                        isEffectivelyExpanded
                          ? expandedHeight
                          : resolvedCollapsedHeight
                      }px`,
                left: 0,
                position: 'absolute',
                right: 0,
                top: 0,
                transition:
                  'height 160ms cubic-bezier(0.2, 0, 0, 1), box-shadow 140ms ease, border-color 140ms ease',
              }
            : {
                height: '100%',
              }),
        }}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleDashboardPanelPointerMove}
        onMouseLeave={handleMouseLeave}
      >
        <Box
          className="dashboard-panel-decoration"
          sx={{
            display: 'none',
          }}
        />
        <Box
          ref={contentRef}
          sx={{
            '& > *': {
              flexShrink: 0,
            },
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            position: 'relative',
            width: '100%',
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'flex-start',
              mb: '14px',
              width: '100%',
            }}
          >
            <Typography
              component="div"
              sx={{
                alignItems: 'center',
                color: theme.palette.text.primary,
                display: 'inline-flex',
                fontFamily:
                  '"IBM Plex Mono","SFMono-Regular","Cascadia Mono","Fira Code","Consolas",monospace',
                fontSize: '0.95rem',
                fontWeight: 600,
                letterSpacing: '0.02em',
                lineHeight: 1,
                textTransform: 'none',
              }}
            >
              <Box component="span">status</Box>
              <Box
                component="span"
                aria-hidden="true"
                sx={{
                  animation:
                    'homeStatusCursorBlink 1.08s steps(1, end) infinite',
                  color: statusAccentColor,
                  display: 'inline-block',
                  ml: '1px',
                  textShadow: `0 0 8px ${statusGlowColor}`,
                  '@keyframes homeStatusCursorBlink': {
                    '0%, 42%': {
                      opacity: 1,
                    },
                    '43%, 100%': {
                      opacity: 0.26,
                    },
                  },
                }}
              >
                _
              </Box>
            </Typography>
          </Box>

          <Box sx={{ ...sepSx(theme), pb: '12px', mb: '8px' }} />

          {rows.primaryItems.map((row, index) => (
            <Box
              key={row.label}
              sx={{
                ...(index < rows.primaryItems.length - 1
                  ? infoSepSx(theme, index, rows.primaryItems.length)
                  : {}),
                alignItems: 'center',
                columnGap: '18px',
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                height: '46px',
                minWidth: 0,
                overflow: 'hidden',
                py: 0,
              }}
            >
              <Typography
                sx={{
                  color:
                    theme.palette.mode === 'dark'
                      ? alpha(theme.palette.common.white, 0.56)
                      : alpha(theme.palette.text.primary, 0.62),
                  fontSize: '0.82rem',
                  fontWeight: 500,
                  letterSpacing: '0.012em',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.label}
              </Typography>
              <Box
                sx={{
                  alignItems: 'center',
                  color: theme.palette.text.primary,
                  display: 'flex',
                  height: '100%',
                  justifyContent: 'flex-end',
                  maxWidth: '100%',
                  minWidth: 0,
                  textAlign: 'right',
                }}
              >
                {renderPrimaryValue(row)}
              </Box>
            </Box>
          ))}

          <Box
            sx={{
              display: 'grid',
              gap: '10px',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              mb: '12px',
              mt: '16px',
            }}
          >
            {rows.metricItems.map((metric) => (
              <Box
                key={metric.label}
                sx={{
                  bgcolor:
                    theme.palette.mode === 'dark'
                      ? 'rgba(38, 42, 52, 0.9)'
                      : 'rgba(248, 244, 238, 0.96)',
                  border: `1px solid ${alpha(
                    theme.palette.border.subtle,
                    theme.palette.mode === 'dark' ? 0.92 : 0.68
                  )}`,
                  borderRadius: '10px',
                  boxShadow:
                    theme.palette.mode === 'dark'
                      ? 'inset 0 1px 0 rgba(255,255,255,0.04)'
                      : 'inset 0 1px 0 rgba(255,255,255,0.72)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minHeight: '70px',
                  minWidth: 0,
                  overflow: 'hidden',
                  position: 'relative',
                  px: '12px',
                  py: '10px',
                }}
              >
                <Typography
                  sx={{
                    color:
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.common.white, 0.46)
                        : alpha(theme.palette.text.primary, 0.52),
                    fontSize: '0.66rem',
                    fontWeight: 500,
                    letterSpacing: '0.03em',
                    lineHeight: 1.1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {metric.label}
                </Typography>
                <Typography
                  sx={{
                    color: theme.palette.text.primary,
                    fontSize: '1.08rem',
                    fontWeight: 700,
                    letterSpacing: '0.01em',
                    lineHeight: 1.1,
                    minWidth: 0,
                    mt: '8px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {metric.value}
                </Typography>
              </Box>
            ))}
          </Box>

          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              mt: '12px',
              width: '100%',
            }}
          >
            {rows.footerSections.map((section, sectionIndex) => {
              const isNodeSection = section.title === 'Node';
              const sectionHeaderLabel = isNodeSection
                ? '// node_info'
                : section.title;

              return (
                <Box
                  key={section.title}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    mt:
                      section.offsetTopPx != null
                        ? `${section.offsetTopPx}px`
                        : sectionIndex === 0
                          ? 0
                          : '2px',
                  }}
                >
                  <Typography
                    component="div"
                    sx={{
                      alignItems: 'center',
                      color: isNodeSection
                        ? theme.palette.mode === 'dark'
                          ? alpha(theme.palette.common.white, 0.38)
                          : alpha(theme.palette.text.secondary, 0.92)
                        : theme.palette.text.primary,
                      display: 'inline-flex',
                      fontFamily:
                        '"IBM Plex Mono","SFMono-Regular","Cascadia Mono","Fira Code","Consolas",monospace',
                      fontSize: '0.95rem',
                      fontWeight: 600,
                      letterSpacing: '0.02em',
                      lineHeight: 1,
                      mb: '8px',
                      textTransform: 'none',
                    }}
                  >
                    {sectionHeaderLabel}
                  </Typography>

                  {section.items.map((row, index) => (
                    <Box
                      key={row.label}
                      sx={{
                        ...(index < section.items.length - 1
                          ? infoSepSx(theme, index, section.items.length)
                          : {}),
                        ...(isNodeSection
                          ? {
                              alignItems: 'center',
                              columnGap: '18px',
                              display: 'grid',
                              gridTemplateColumns: 'minmax(0, 1fr) auto',
                              height: '46px',
                              minWidth: 0,
                              mt: index === 0 ? '14px' : 0,
                              overflow: 'hidden',
                              py: 0,
                              width: '100%',
                            }
                          : {
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px',
                              minHeight: '50px',
                              py: '6px',
                            }),
                      }}
                    >
                      {row.labelAction ? (
                        <Tooltip title={row.labelAction.tooltip}>
                          <ButtonBase
                            aria-label={row.labelAction.ariaLabel}
                            onClick={row.labelAction.onClick}
                            sx={{
                              alignItems: 'center',
                              borderRadius: '6px',
                              color:
                                theme.palette.mode === 'dark'
                                  ? alpha(theme.palette.common.white, 0.58)
                                  : alpha(theme.palette.text.primary, 0.64),
                              display: 'inline-flex',
                              gap: '3px',
                              justifySelf: 'start',
                              minWidth: 0,
                              px: '4px',
                              py: '3px',
                              transform: 'translateX(-4px)',
                              transition:
                                'background-color 140ms ease, color 140ms ease',
                              '&:hover': {
                                backgroundColor: alpha(
                                  GROUP_ACTIVITY_BLUE.primary,
                                  theme.palette.mode === 'dark' ? 0.13 : 0.09
                                ),
                                color:
                                  theme.palette.mode === 'dark'
                                    ? alpha(
                                        GROUP_ACTIVITY_BLUE.gradientTop,
                                        0.95
                                      )
                                    : alpha(GROUP_ACTIVITY_BLUE.pressed, 0.94),
                              },
                            }}
                          >
                            <Typography
                              component="span"
                              sx={{
                                color: 'inherit',
                                fontSize: '0.79rem',
                                fontWeight: 600,
                                letterSpacing: '0.012em',
                                lineHeight: 1.1,
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {row.label}
                            </Typography>
                            <KeyboardArrowDownRoundedIcon
                              sx={{
                                fontSize: '0.95rem',
                                transform: row.labelAction.isOpen
                                  ? 'rotate(180deg)'
                                  : 'none',
                                transition: 'transform 140ms ease',
                              }}
                            />
                          </ButtonBase>
                        </Tooltip>
                      ) : (
                        <Typography
                          sx={{
                            color:
                              theme.palette.mode === 'dark'
                                ? alpha(theme.palette.common.white, 0.52)
                                : alpha(theme.palette.text.primary, 0.58),
                            fontSize: '0.79rem',
                            fontWeight: 500,
                            letterSpacing: '0.012em',
                            lineHeight: 1.1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {row.label}
                        </Typography>
                      )}
                      {row.valueNode || (
                        <Typography
                          sx={{
                            color: alpha(theme.palette.text.primary, 0.88),
                            fontSize: '0.9rem',
                            fontWeight: 600,
                            letterSpacing: '0.01em',
                            lineHeight: 1.2,
                            maxWidth: '100%',
                            minWidth: 0,
                            overflow: 'hidden',
                            ...(isNodeSection
                              ? {
                                  justifySelf: 'end',
                                  textAlign: 'right',
                                }
                              : {}),
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {row.value}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              );
            })}
          </Box>

          <Box sx={{ minHeight: '8px', width: '100%' }} />
          {showCollapsedFade && (
            <ProgressiveBlur
              blurStrength={18}
              height="78px"
              position="bottom"
              sx={{
                bottom: -12,
                left: '-16px',
                right: '-16px',
              }}
              tintColor={
                theme.palette.mode === 'dark'
                  ? theme.palette.background.paper
                  : theme.palette.common.white
              }
            />
          )}
        </Box>
      </Box>
    </Box>
  );
};
