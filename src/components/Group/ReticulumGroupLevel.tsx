import { useEffect, useId, useRef, useState } from 'react';
import {
  Box,
  ClickAwayListener,
  Popper,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import {
  getReticulumGroupScoreColor,
  type ReticulumGroupScoreBreakdown,
} from './reticulumGroupScore';

const SCORE_BANDS = [
  { color: '#EF4444', label: '0–24' },
  { color: '#F97316', label: '25–44' },
  { color: '#FACC15', label: '45–64' },
  { color: '#22C55E', label: '65–94' },
  { color: '#00A8FF', label: '95–100' },
];

const formatNumber = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    Math.max(0, Number(value) || 0)
  );

const contribution = (score: number, weight: number) =>
  (score * weight).toFixed(1).replace(/\.0$/, '');

type GroupScoreBadgeProps = {
  circleSize?: number;
  score?: ReticulumGroupScoreBreakdown;
  size?: 'compact' | 'full' | 'menu';
  popoverAlign?: 'start' | 'center';
  triggerVariant?: 'badge' | 'circle';
};

export const GroupScoreBadge = ({
  circleSize = 30,
  score,
  size = 'full',
  popoverAlign = 'start',
  triggerVariant = 'badge',
}: GroupScoreBadgeProps) => {
  const theme = useTheme();
  const badgeRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [popoverPositioned, setPopoverPositioned] = useState(false);
  const popoverId = useId();
  const menu = size === 'menu';
  const compact = size !== 'full';
  const circle = triggerVariant === 'circle';
  const available = Boolean(score);
  const color = getReticulumGroupScoreColor(score?.score);
  const activeBandIndex = SCORE_BANDS.findIndex((band, index) => {
    if (!score) return false;
    if (index === 0) return score.score <= 24;
    if (index === 1) return score.score <= 44;
    if (index === 2) return score.score <= 64;
    if (index === 3) return score.score <= 94;
    return true;
  });

  const clearCloseTimer = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const closePopover = () => {
    clearCloseTimer();
    setPopoverPositioned(false);
    setOpen(false);
  };
  const showPopover = () => {
    clearCloseTimer();
    if (available) {
      setPopoverPositioned(false);
      setOpen(true);
    }
  };
  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(closePopover, 170);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePopover();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearCloseTimer();
    };
  }, []);

  if (!score) return null;
  const badgeHeight = circle ? circleSize : menu ? 36 : compact ? 26 : 30;
  const label = `Group Score ${score.score} out of 100`;
  const rows = [
    {
      detail: `${formatNumber(score.balance)} QORT held`,
      icon: <AccountBalanceWalletRoundedIcon sx={{ fontSize: 21 }} />,
      label: 'QORT Holdings',
      points: contribution(score.holdingScore, 0.5),
      score: score.holdingScore,
      weight: '50%',
    },
    {
      detail: `${formatNumber(score.activity.activeAuthors7d)} active · ${formatNumber(score.activity.messages7d)} posts/7d · ${formatNumber(score.activity.messages24h)} p/24h`,
      icon: <BoltRoundedIcon sx={{ fontSize: 21 }} />,
      label: 'Activity',
      points: contribution(score.activityScore, 0.3),
      score: score.activityScore,
      weight: '30%',
    },
    {
      detail: `${formatNumber(score.memberCount)} ${score.memberCount === 1 ? 'member' : 'members'}`,
      icon: <GroupsRoundedIcon sx={{ fontSize: 21 }} />,
      label: 'Community',
      points: contribution(score.communityScore, 0.1),
      score: score.communityScore,
      weight: '10%',
    },
    {
      detail: `Created ${new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(score.created))}`,
      icon: <CalendarMonthRoundedIcon sx={{ fontSize: 21 }} />,
      label: 'Legacy',
      points: contribution(score.legacyScore, 0.1),
      score: score.legacyScore,
      weight: '10%',
    },
  ];

  return (
    <>
      <Box
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        component="button"
        onBlur={scheduleClose}
        onClick={(event) => {
          event.stopPropagation();
          open ? closePopover() : showPopover();
        }}
        onFocus={showPopover}
        onMouseEnter={showPopover}
        onMouseLeave={scheduleClose}
        onMouseDown={(event) => event.stopPropagation()}
        ref={badgeRef}
        sx={{
          alignItems: 'center',
          backgroundColor: circle ? color : alpha(color, 0.045),
          border: circle ? 0 : `0.75px solid ${alpha(color, 0.78)}`,
          borderRadius: circle ? '50%' : compact ? '6px' : '999px',
          boxShadow: circle ? `0 2px 7px ${alpha(color, 0.34)}` : 'none',
          color:
            circle && score.score >= 45 && score.score <= 64
              ? '#17120a'
              : circle
                ? '#ffffff'
                : color,
          cursor: 'pointer',
          display: 'inline-flex',
          flexShrink: 0,
          fontSize: circle
            ? Math.max(11, Math.round(circleSize * 0.39))
            : undefined,
          fontWeight: circle ? 800 : undefined,
          height: badgeHeight,
          justifyContent: circle ? 'center' : undefined,
          minWidth: circle ? circleSize : menu ? 0 : compact ? 112 : 152,
          overflow: 'hidden',
          p: 0,
          textAlign: 'left',
          transition:
            'background-color 140ms ease, box-shadow 140ms ease, transform 140ms ease',
          width: circle ? circleSize : menu ? '100%' : undefined,
          '&:focus-visible, &:hover': {
            backgroundColor: circle ? color : alpha(color, 0.08),
            boxShadow: circle
              ? `0 0 0 2px ${alpha(color, 0.2)}, 0 3px 9px ${alpha(color, 0.38)}`
              : `0 0 0 2px ${alpha(color, 0.1)}`,
            outline: 'none',
            transform: circle ? 'scale(1.05)' : 'none',
          },
        }}
      >
        {circle ? (
          score.score
        ) : (
          <>
            <Box
              sx={{
                alignItems: 'center',
                boxSizing: 'border-box',
                display: 'flex',
                height: '100%',
                justifyContent: menu ? 'flex-start' : 'center',
                minWidth: menu ? 38 : undefined,
                pl: menu ? 0.85 : compact ? 0.8 : 1,
                pr: menu ? 0 : compact ? 0.65 : 0.85,
              }}
            >
              <StarRoundedIcon
                sx={{ fontSize: menu ? 20 : compact ? 14 : 16 }}
              />
            </Box>
            <Typography
              noWrap
              sx={{
                alignItems: 'center',
                color: 'text.primary',
                display: 'flex',
                flex: 1,
                fontSize: menu ? 14 : compact ? 11.5 : 13,
                fontWeight: menu ? 600 : 500,
                height: '100%',
                lineHeight: 1,
                pl: menu ? 0 : 0.15,
                pr: compact ? 0.85 : 1.1,
              }}
            >
              Group Score
            </Typography>
            <Box
              sx={{
                alignItems: 'center',
                backgroundColor: alpha(color, 0.82),
                borderLeft: `0.75px solid ${alpha(color, 0.72)}`,
                borderRadius: compact ? '0 5px 5px 0' : '0 999px 999px 0',
                color:
                  score.score >= 45 && score.score <= 64
                    ? '#17120a'
                    : '#071018',
                display: 'flex',
                fontSize: menu ? 14 : compact ? 13 : 15,
                fontWeight: 750,
                height: '100%',
                justifyContent: 'center',
                lineHeight: 1,
                minWidth: menu ? 43 : compact ? 34 : 41,
                px: 0.7,
              }}
            >
              {score.score}
            </Box>
          </>
        )}
      </Box>

      <Popper
        anchorEl={badgeRef.current}
        modifiers={[
          { name: 'flip', options: { padding: 10 } },
          { name: 'offset', options: { offset: [0, 10] } },
          { name: 'preventOverflow', options: { padding: 10 } },
        ]}
        open={open}
        popperOptions={{ onFirstUpdate: () => setPopoverPositioned(true) }}
        placement={popoverAlign === 'center' ? 'bottom' : 'bottom-start'}
        sx={{
          visibility: popoverPositioned ? 'visible' : 'hidden',
          zIndex: 1800,
          '&[data-popper-placement*="top"] .reticulum-group-score-popover::before':
            {
              borderBottom: 0,
              borderTop: `7px solid ${alpha(color, 0.82)}`,
              bottom: -7,
              top: 'auto',
            },
        }}
      >
        <ClickAwayListener onClickAway={closePopover}>
          <Box
            aria-label={`${label} breakdown`}
            className="reticulum-group-score-popover"
            id={popoverId}
            onFocus={showPopover}
            onMouseEnter={showPopover}
            onMouseLeave={scheduleClose}
            role="dialog"
            sx={{
              background:
                theme.palette.mode === 'dark'
                  ? 'linear-gradient(180deg, #12161b 0%, #0c0f13 100%)'
                  : theme.palette.background.paper,
              border: `0.75px solid ${alpha(color, 0.82)}`,
              borderRadius: '10px',
              boxShadow: '0 14px 30px rgba(0,0,0,0.42)',
              color: 'text.primary',
              p: 1.7,
              position: 'relative',
              width: 292,
              '&::before': {
                borderBottom: `7px solid ${alpha(color, 0.82)}`,
                borderLeft: '7px solid transparent',
                borderRight: '7px solid transparent',
                content: '""',
                left: popoverAlign === 'center' ? '50%' : 22,
                position: 'absolute',
                top: -7,
                transform:
                  popoverAlign === 'center' ? 'translateX(-50%)' : 'none',
              },
            }}
            tabIndex={-1}
          >
            <Typography
              sx={{
                color,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.13em',
                textAlign: 'center',
              }}
            >
              GROUP SCORE {score.score}/100
            </Typography>
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: 11,
                mt: 0.45,
                textAlign: 'center',
              }}
            >
              Four public-group signals combined
              <br />
              into one score
            </Typography>
            <Box
              sx={{ borderTop: `1px solid ${theme.palette.divider}`, mt: 1.35 }}
            />
            {rows.map((row) => (
              <Box
                key={row.label}
                sx={{
                  alignItems: 'center',
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  display: 'grid',
                  gap: 1,
                  gridTemplateColumns: '23px minmax(0,1fr) auto',
                  py: 1.05,
                }}
              >
                <Box sx={{ color: 'text.secondary' }}>{row.icon}</Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
                    {row.label} · {row.weight}
                  </Typography>
                  <Typography
                    noWrap
                    sx={{ color: 'text.secondary', fontSize: 10.5, mt: 0.2 }}
                  >
                    {row.detail}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>
                    {Math.round(row.score)}/100
                  </Typography>
                  <Typography sx={{ color: 'text.secondary', fontSize: 10 }}>
                    +{row.points} pts
                  </Typography>
                </Box>
              </Box>
            ))}
            <Typography
              sx={{
                fontSize: 12,
                fontWeight: 650,
                mt: 1.15,
                textAlign: 'center',
              }}
            >
              Weighted total = {score.score}/100
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.55, mt: 1.35 }}>
              {SCORE_BANDS.map((band, index) => (
                <Box
                  key={band.label}
                  sx={{ flex: index === 3 ? 1.5 : 1, minWidth: 0 }}
                >
                  <Box
                    sx={{
                      backgroundColor: band.color,
                      borderRadius: 1,
                      boxShadow:
                        index === activeBandIndex
                          ? `0 0 0 2px ${alpha(band.color, 0.45)}`
                          : 'none',
                      height: 7,
                    }}
                  />
                  <Typography
                    sx={{
                      color:
                        index === activeBandIndex
                          ? band.color
                          : 'text.secondary',
                      fontSize: 8.5,
                      mt: 0.45,
                      textAlign: 'center',
                    }}
                  >
                    {band.label}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </ClickAwayListener>
      </Popper>
    </>
  );
};
