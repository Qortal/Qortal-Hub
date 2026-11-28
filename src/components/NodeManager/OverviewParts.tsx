import { type ReactNode } from 'react';
import { Box, Button, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded';
import { useTranslation } from 'react-i18next';
import type { NodeRead } from './useNodeOverviewData';
import { formatAgo } from './nodeOverview';
import {
  metricLabelSx,
  metricRowSx,
  metricValueSx,
  sectionLabelSx,
  surfaceCardSx,
  textButtonSx,
  toneCardSx,
  toneOf,
  type Tone,
} from './nodeManagerLook';

/**
 * One card of the Node Manager, with its heading: the minting window's card
 * surface and uppercase label. A `tone` tints it as the minting window's
 * status card.
 */
export const OverviewCard = ({
  action,
  children,
  icon,
  id,
  title,
  tone,
  wide = false,
}: {
  action?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  id: string;
  title: string;
  tone?: Tone;
  wide?: boolean;
}) => {
  const theme = useTheme();
  const headingId = `node-manager-${id}`;
  return (
    <Box
      aria-labelledby={headingId}
      component="section"
      data-overview-card={id}
      sx={{
        ...surfaceCardSx(theme),
        ...(tone ? toneCardSx(theme, tone) : {}),
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        gridColumn: wide ? '1 / -1' : 'auto',
        minWidth: 0,
        p: { md: 2.15, xs: 2 },
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1,
          justifyContent: 'space-between',
          minHeight: 28,
        }}
      >
        <Box
          sx={{ alignItems: 'center', display: 'flex', gap: 0.85, minWidth: 0 }}
        >
          {icon ? (
            <Box
              aria-hidden
              sx={{
                color: alpha(theme.palette.text.secondary, 0.64),
                display: 'flex',
                '& svg': { fontSize: 15 },
              }}
            >
              {icon}
            </Box>
          ) : null}
          <Typography
            component="h3"
            id={headingId}
            sx={{ ...sectionLabelSx(theme), color: theme.palette.text.primary }}
          >
            {title}
          </Typography>
        </Box>
        {action}
      </Box>
      {children}
    </Box>
  );
};

/** Label and value rows, as the minting window's statistics. */
export const DetailRows = ({ rows }: { rows: [string, ReactNode][] }) => {
  const theme = useTheme();
  return (
    <Box component="dl" sx={{ display: 'flex', flexDirection: 'column', m: 0 }}>
      {rows.map(([label, value]) => (
        <Box key={label} sx={metricRowSx(theme)}>
          <Typography component="dt" sx={metricLabelSx(theme)}>
            {label}
          </Typography>
          <Typography component="dd" sx={{ ...metricValueSx(theme), m: 0 }}>
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
};

/**
 * A status in large type, as "Minting active" in the minting window, in the
 * colour of its tone.
 */
export const StatusTitle = ({
  children,
  tone,
}: {
  children: ReactNode;
  tone: Tone;
}) => {
  const theme = useTheme();
  return (
    <Typography
      sx={{
        color: toneOf(theme, tone).accent,
        fontSize: { sm: '1.9rem', xs: '1.55rem' },
        fontWeight: 800,
        letterSpacing: '-0.04em',
        lineHeight: 1.05,
        overflowWrap: 'anywhere',
      }}
    >
      {children}
    </Typography>
  );
};

/** Plain text in a card, in the secondary colour. */
export const CardText = ({ children }: { children: ReactNode }) => {
  const theme = useTheme();
  return (
    <Typography
      sx={{
        color: theme.palette.text.secondary,
        fontSize: '0.84rem',
        lineHeight: 1.45,
      }}
    >
      {children}
    </Typography>
  );
};

/**
 * What a card says while its answer isn't there: loading, failed (with
 * Retry), or an older answer that couldn't be refreshed. Nothing once read.
 */
export const ReadNote = ({ read }: { read: NodeRead<unknown> }) => {
  const { i18n, t } = useTranslation(['node', 'core']);
  if (read.status === 'ok') return null;
  if (read.status === 'loading' && read.value === null) {
    return (
      <CardText>
        {t('core:message.generic.loading', {
          postProcess: 'capitalizeFirstChar',
        })}
      </CardText>
    );
  }
  if (read.status === 'loading') return null;
  return (
    <Box
      role="status"
      sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 1 }}
    >
      <CardText>
        {read.value !== null && read.at !== null
          ? t('node:manager.read_stale', {
              ago: formatAgo(read.at, i18n.language),
            })
          : t('node:manager.read_failed')}
      </CardText>
      <Button
        onClick={read.retry}
        size="small"
        sx={textButtonSx}
        variant="text"
      >
        {t('core:retry', { postProcess: 'capitalizeFirstChar' })}
      </Button>
    </Box>
  );
};

export type CheckState = 'ok' | 'todo' | 'unknown';

/** A checklist: each line with its state's mark. */
export const CheckList = ({
  items,
}: {
  items: { id: string; state: CheckState; text: string }[];
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['node']);
  const marks = {
    ok: {
      color: theme.palette.success.main,
      icon: CheckCircleRoundedIcon,
      label: t('node:manager.check.ok', { postProcess: 'capitalizeFirstChar' }),
    },
    todo: {
      color: theme.palette.warning.main,
      icon: RadioButtonUncheckedRoundedIcon,
      label: t('node:manager.check.todo', {
        postProcess: 'capitalizeFirstChar',
      }),
    },
    unknown: {
      color: theme.palette.text.secondary,
      icon: HelpOutlineRoundedIcon,
      label: t('node:manager.check.unknown', {
        postProcess: 'capitalizeFirstChar',
      }),
    },
  };
  return (
    <Box
      component="ul"
      sx={{ display: 'grid', gap: 1, listStyle: 'none', m: 0, p: 0 }}
    >
      {items.map(({ id, state, text }) => {
        const mark = marks[state];
        const Icon = mark.icon;
        return (
          <Box
            component="li"
            data-check={id}
            data-check-state={state}
            key={id}
            sx={{ alignItems: 'flex-start', display: 'flex', gap: 1 }}
          >
            <Icon
              aria-label={mark.label}
              role="img"
              sx={{ color: mark.color, flexShrink: 0, fontSize: 20, mt: '1px' }}
            />
            <CardText>{text}</CardText>
          </Box>
        );
      })}
    </Box>
  );
};
