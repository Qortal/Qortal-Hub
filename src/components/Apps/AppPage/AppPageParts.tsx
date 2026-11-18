import { useEffect, useMemo, useState } from 'react';
import {
  alpha,
  Avatar,
  Box,
  ButtonBase,
  keyframes,
  Link,
  Paper,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import StarHalfRoundedIcon from '@mui/icons-material/StarHalfRounded';
import StarOutlineRoundedIcon from '@mui/icons-material/StarOutlineRounded';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import { appIconUrl } from './appPageQdn';
import { openTextLink } from '../../../utils/qortalLink/openQortalLink';
import { launcherTabLinkOptions, splitTextLinks } from './appPageLink';
import { useLauncherTabId } from '../launcherTabs';

export const SectionCard = ({
  children,
  sx = {},
  ...rest
}: {
  children: React.ReactNode;
  sx?: object;
  [key: string]: unknown;
}) => {
  const theme = useTheme();
  return (
    <Paper
      elevation={0}
      sx={{
        backgroundColor: alpha(theme.palette.background.paper, 0.72),
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '18px',
        p: { xs: 2, sm: 2.5 },
        ...sx,
      }}
      {...rest}
    >
      {children}
    </Paper>
  );
};

export const SectionTitle = ({
  children,
  action,
  id,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
}) => (
  <Box
    sx={{
      alignItems: 'center',
      display: 'flex',
      gap: 1,
      justifyContent: 'space-between',
      mb: 1.5,
      minHeight: '32px',
    }}
  >
    <Typography
      component="h2"
      id={id}
      sx={{ fontSize: '18px', fontWeight: 650, letterSpacing: '-0.01em' }}
    >
      {children}
    </Typography>
    {action}
  </Box>
);

/** Read-only stars, halves included. */
export const StarRow = ({
  value,
  size = 18,
  label,
}: {
  value: number;
  size?: number;
  label?: string;
}) => {
  const theme = useTheme();
  const stars = [1, 2, 3, 4, 5].map((star) => {
    const fill = value - star + 1;
    const Icon =
      fill >= 0.75
        ? StarRoundedIcon
        : fill >= 0.25
          ? StarHalfRoundedIcon
          : StarOutlineRoundedIcon;
    return (
      <Icon
        key={star}
        sx={{
          color:
            fill >= 0.25
              ? theme.palette.warning.main
              : alpha(theme.palette.text.secondary, 0.55),
          fontSize: size,
        }}
      />
    );
  });
  return (
    <Box
      aria-label={label}
      role={label ? 'img' : undefined}
      sx={{ alignItems: 'center', display: 'inline-flex', lineHeight: 0 }}
    >
      {stars}
    </Box>
  );
};

const pop = keyframes`
  0% { transform: scale(1); }
  40% { transform: scale(1.35); }
  100% { transform: scale(1); }
`;

/** Five stars to pick from, with a word for each while hovering. */
export const StarPicker = ({
  value,
  onPick,
  disabled,
  size = 34,
}: {
  value: number | null;
  onPick: (rating: number) => void;
  disabled?: boolean;
  size?: number;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [hover, setHover] = useState<number | null>(null);
  const [popped, setPopped] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  const words = [
    t('core:app_page.rating.word_1', { postProcess: 'capitalizeFirstChar' }),
    t('core:app_page.rating.word_2', { postProcess: 'capitalizeFirstChar' }),
    t('core:app_page.rating.word_3', { postProcess: 'capitalizeFirstChar' }),
    t('core:app_page.rating.word_4', { postProcess: 'capitalizeFirstChar' }),
    t('core:app_page.rating.word_5', { postProcess: 'capitalizeFirstChar' }),
  ];

  return (
    <Box
      sx={{ alignItems: 'center', display: 'flex', flexDirection: 'column' }}
    >
      <Box
        aria-label={t('core:app_page.rating.pick', {
          postProcess: 'capitalizeFirstChar',
        })}
        onMouseLeave={() => setHover(null)}
        role="radiogroup"
        sx={{ display: 'flex', gap: '2px' }}
      >
        {[1, 2, 3, 4, 5].map((star) => {
          const active = star <= shown;
          return (
            <ButtonBase
              aria-checked={value === star}
              aria-label={t('core:app_page.rating.pick_star', {
                count: star,
                postProcess: 'capitalizeFirstChar',
              })}
              disabled={disabled}
              key={star}
              onBlur={() => setHover(null)}
              onClick={() => {
                setPopped(star);
                onPick(star);
              }}
              onFocus={() => setHover(star)}
              onMouseEnter={() => setHover(star)}
              role="radio"
              sx={{
                borderRadius: '50%',
                p: '3px',
                transition: 'transform 120ms ease',
                '&:hover': { transform: 'scale(1.12)' },
                '&.Mui-focusVisible': {
                  outline: `2px solid ${theme.palette.primary.main}`,
                },
              }}
            >
              <StarRoundedIcon
                onAnimationEnd={() => setPopped(null)}
                sx={{
                  animation:
                    popped !== null && star <= popped
                      ? `${pop} 360ms ease ${(star - 1) * 40}ms`
                      : 'none',
                  color: active
                    ? theme.palette.warning.main
                    : alpha(theme.palette.text.secondary, 0.4),
                  filter: active
                    ? `drop-shadow(0 0 6px ${alpha(theme.palette.warning.main, 0.45)})`
                    : 'none',
                  fontSize: size,
                  transition: 'color 120ms ease, filter 120ms ease',
                }}
              />
            </ButtonBase>
          );
        })}
      </Box>
      <Typography
        aria-live="polite"
        sx={{
          color: 'text.secondary',
          fontSize: '13px',
          minHeight: '20px',
          mt: 0.5,
        }}
      >
        {shown ? words[shown - 1] : ' '}
      </Typography>
    </Box>
  );
};

/** A name's picture, or its first letter. */
export const NameAvatar = ({
  name,
  size = 36,
  fallback,
  decorative = false,
}: {
  name?: string;
  size?: number;
  fallback?: string;
  /** Next to the name in text: hidden from screen readers, read once. */
  decorative?: boolean;
}) => {
  const theme = useTheme();
  const letter = (name || fallback || '?').trim().charAt(0).toUpperCase();
  return (
    <Avatar
      alt={decorative ? '' : name || fallback || ''}
      aria-hidden={decorative || undefined}
      src={name ? appIconUrl(getBaseApiReact(), name) : undefined}
      sx={{
        bgcolor: alpha(theme.palette.primary.main, 0.22),
        color: theme.palette.text.primary,
        fontSize: size * 0.42,
        fontWeight: 600,
        height: size,
        width: size,
      }}
    >
      {letter}
    </Avatar>
  );
};

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600 * 1000],
  ['month', 30 * 24 * 3600 * 1000],
  ['week', 7 * 24 * 3600 * 1000],
  ['day', 24 * 3600 * 1000],
  ['hour', 3600 * 1000],
  ['minute', 60 * 1000],
];

export const formatRelative = (
  timestamp: number,
  language: string,
  now = Date.now()
): string => {
  const diff = timestamp - now;
  let formatter: Intl.RelativeTimeFormat;
  try {
    formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  } catch {
    formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  }
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms)
      return formatter.format(Math.round(diff / ms), unit);
  }
  return formatter.format(0, 'minute');
};

export const formatLongDate = (timestamp: number, language: string) => {
  try {
    return new Date(timestamp).toLocaleDateString(language, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return new Date(timestamp).toLocaleDateString();
  }
};

/** "3 days ago", with the full date on hover. */
export const RelativeTime = ({
  timestamp,
  sx = {},
}: {
  timestamp: number;
  sx?: object;
}) => {
  const { i18n } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!timestamp) return null;
  return (
    <Tooltip title={formatLongDate(timestamp, i18n.language)}>
      <Typography
        component="time"
        dateTime={new Date(timestamp).toISOString()}
        sx={{ color: 'text.secondary', fontSize: '13px', ...sx }}
      >
        {formatRelative(timestamp, i18n.language, now)}
      </Typography>
    </Tooltip>
  );
};

/** Text with its http(s) and qortal:// links clickable. */
export const LinkifiedText = ({
  text,
  sx = {},
}: {
  text: string;
  sx?: object;
}) => {
  const parts = useMemo(() => splitTextLinks(text || ''), [text]);
  const launcherTabId = useLauncherTabId();
  return (
    <Typography
      component="div"
      sx={{
        fontSize: '14.5px',
        lineHeight: 1.65,
        overflowWrap: 'anywhere',
        whiteSpace: 'pre-wrap',
        ...sx,
      }}
    >
      {parts.map((part, index) =>
        part.kind === 'link' ? (
          <Link
            component="button"
            key={index}
            onClick={() =>
              void openTextLink(
                part.value,
                launcherTabLinkOptions(launcherTabId)
              )
            }
            sx={{
              font: 'inherit',
              textAlign: 'left',
              verticalAlign: 'baseline',
            }}
            type="button"
            underline="hover"
          >
            {part.value}
          </Link>
        ) : (
          <span key={index}>{part.value}</span>
        )
      )}
    </Typography>
  );
};
