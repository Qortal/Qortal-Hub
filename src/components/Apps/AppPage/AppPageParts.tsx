import { useMemo } from 'react';
import {
  alpha,
  Avatar,
  Box,
  Link,
  Paper,
  Typography,
  useTheme,
} from '@mui/material';
import { getBaseApiReact } from '../../../App';
import { appIconUrl } from './appPageQdn';
import { openTextLink } from '../../../utils/qortalLink/openQortalLink';
import { splitTextLinks } from './appPageLink';

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

/** Text with its http(s) and qortal:// links clickable. */
export const LinkifiedText = ({
  text,
  sx = {},
}: {
  text: string;
  sx?: object;
}) => {
  const parts = useMemo(() => splitTextLinks(text || ''), [text]);
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
            onClick={() => void openTextLink(part.value)}
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
