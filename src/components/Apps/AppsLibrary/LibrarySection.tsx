import { type ReactNode, type Ref, useEffect, useId, useState } from 'react';
import { Box, Skeleton, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import SearchOffRoundedIcon from '@mui/icons-material/SearchOffRounded';
import { useTranslation } from 'react-i18next';
import { fittedColumnsTemplate, type SkeletonShape } from './libraryLayout';
import {
  accentTileSx,
  cap,
  formatLibraryNumber,
  libraryMuted,
  libraryPanelSx,
  usePrefersReducedMotion,
  visuallyHiddenSx,
} from './libraryStyles';
import type { LibraryStatus } from './useLibraryStatus';
import type { LibraryView } from './libraryView';

type HeadingLevel = 'h1' | 'h2' | 'h3';

/** One section of the library: a rounded panel. */
export const LibraryPanel = ({
  children,
  sx,
  labelledBy,
}: {
  children: ReactNode;
  sx?: Record<string, any>;
  labelledBy?: string;
}) => (
  <Box
    aria-labelledby={labelledBy}
    component="section"
    sx={(theme) => ({
      ...libraryPanelSx(theme),
      boxSizing: 'border-box',
      minWidth: 0,
      p: { xs: 2, md: 2.5 },
      width: '100%',
      ...sx,
    })}
  >
    {children}
  </Box>
);

/**
 * A count beside a title. It is hidden from screen readers by default: the
 * heading names the section, and the list says how many items it holds.
 */
export const CountBadge = ({
  children,
  decorative = true,
}: {
  children: ReactNode;
  decorative?: boolean;
}) => {
  const { i18n } = useTranslation(['core']);
  const content =
    typeof children === 'number'
      ? formatLibraryNumber(children, i18n?.language)
      : children;
  return (
    <Box
      aria-hidden={decorative || undefined}
      component="span"
      sx={(theme) => ({
        alignItems: 'center',
        backgroundColor: alpha(theme.palette.text.primary, 0.07),
        borderRadius: '999px',
        boxSizing: 'border-box',
        color: libraryMuted(theme),
        display: 'inline-flex',
        flexShrink: 0,
        fontSize: '12px',
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 600,
        height: 22,
        justifyContent: 'center',
        lineHeight: 1,
        minWidth: 22,
        px: 1,
        whiteSpace: 'nowrap',
      })}
    >
      {content}
    </Box>
  );
};

interface LibrarySectionHeaderProps {
  title: ReactNode;
  titleId?: string;
  count?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  headingLevel?: HeadingLevel;
  /** Lets the section move focus to its title (it is not in the tab order). */
  headingRef?: Ref<HTMLHeadingElement>;
}

/** A section's title, its count, a one-line hint and its own tools. */
export const LibrarySectionHeader = ({
  title,
  titleId,
  count,
  hint,
  action,
  icon,
  headingLevel = 'h2',
  headingRef,
}: LibrarySectionHeaderProps) => (
  <Box
    sx={{
      alignItems: 'flex-start',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '8px 16px',
      minWidth: 0,
    }}
  >
    <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1, minWidth: 0 }}>
        {icon ? (
          <Box
            aria-hidden
            sx={(theme) => ({
              ...accentTileSx(theme, 36, 12),
              '& .MuiSvgIcon-root': { fontSize: 20 },
            })}
          >
            {icon}
          </Box>
        ) : null}
        <Typography
          component={headingLevel}
          id={titleId}
          ref={headingRef}
          tabIndex={headingRef ? -1 : undefined}
          sx={(theme) => ({
            '&:focus': { outline: 'none' },
            color: theme.palette.text.primary,
            fontSize: '17px',
            fontWeight: 650,
            lineHeight: '28px',
            m: 0,
            minWidth: 0,
            overflowWrap: 'anywhere',
          })}
        >
          {title}
        </Typography>
        {count !== undefined && count !== null && count !== '' ? (
          <CountBadge>{count}</CountBadge>
        ) : null}
      </Box>
      {hint ? (
        <Typography
          sx={(theme) => ({
            color: libraryMuted(theme),
            fontSize: '13px',
            lineHeight: 1.45,
            mt: 0.25,
          })}
        >
          {hint}
        </Typography>
      ) : null}
    </Box>
    {action ? (
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1,
          justifyContent: 'flex-end',
          ml: 'auto',
          minWidth: 0,
        }}
      >
        {action}
      </Box>
    ) : null}
  </Box>
);

interface LibrarySectionProps extends Omit<
  LibrarySectionHeaderProps,
  'titleId'
> {
  children: ReactNode;
  sx?: Record<string, any>;
}

/** A panel with its header. */
export const LibrarySection = ({
  children,
  sx,
  ...header
}: LibrarySectionProps) => {
  const titleId = useId();
  return (
    <LibraryPanel labelledBy={titleId} sx={sx}>
      <LibrarySectionHeader {...header} titleId={titleId} />
      <Box sx={{ mt: 2, minWidth: 0 }}>{children}</Box>
    </LibraryPanel>
  );
};

interface LibraryEmptyStateProps {
  icon: ReactNode;
  title: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  /** A one-line row, for a part of a section. */
  compact?: boolean;
  tone?: 'neutral' | 'error';
}

/** What a section shows when it has nothing (it always sits in a panel). */
export const LibraryEmptyState = ({
  icon,
  title,
  text,
  action,
  compact = false,
  tone = 'neutral',
}: LibraryEmptyStateProps) => {
  const circle = (size: number, iconSize: number) => (
    <Box
      aria-hidden
      sx={(theme) => ({
        alignItems: 'center',
        backgroundColor:
          tone === 'error'
            ? alpha(theme.palette.error.main, 0.12)
            : alpha(theme.palette.text.primary, 0.06),
        borderRadius: '50%',
        color:
          tone === 'error' ? theme.palette.error.main : libraryMuted(theme),
        display: 'flex',
        flexShrink: 0,
        height: size,
        justifyContent: 'center',
        width: size,
        '& .MuiSvgIcon-root': { fontSize: iconSize },
      })}
    >
      {icon}
    </Box>
  );

  if (compact) {
    return (
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 1.5,
          minWidth: 0,
          py: 1.5,
        }}
      >
        {circle(36, 20)}
        <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
          <Typography
            sx={(theme) => ({
              color:
                tone === 'error'
                  ? theme.palette.text.primary
                  : libraryMuted(theme),
              fontSize: '14px',
              fontWeight: 500,
            })}
          >
            {title}
          </Typography>
          {text ? (
            <Typography
              sx={(theme) => ({ color: libraryMuted(theme), fontSize: '13px' })}
            >
              {text}
            </Typography>
          ) : null}
        </Box>
        {action ? <Box sx={{ ml: 'auto' }}>{action}</Box> : null}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        py: 4,
        textAlign: 'center',
      }}
    >
      {circle(56, 28)}
      <Typography
        sx={(theme) => ({
          color: theme.palette.text.primary,
          fontSize: '15px',
          fontWeight: 600,
          overflowWrap: 'anywhere',
        })}
      >
        {title}
      </Typography>
      {text ? (
        <Typography
          sx={(theme) => ({
            color: libraryMuted(theme),
            fontSize: '13px',
            maxWidth: 440,
          })}
        >
          {text}
        </Typography>
      ) : null}
      {action ? <Box sx={{ mt: 1.5 }}>{action}</Box> : null}
    </Box>
  );
};

interface LibrarySkeletonProps extends SkeletonShape {
  view: LibraryView;
  count: number;
}

/**
 * Placeholders laid out like the real items, so nothing shifts when the data
 * arrives.
 */
export const LibrarySkeleton = ({
  view,
  count,
  grid,
  list,
}: LibrarySkeletonProps) => {
  const { t } = useTranslation(['core']);
  const reduce = usePrefersReducedMotion();
  const isList = view === 'list';
  return (
    <Box
      aria-busy="true"
      sx={{
        display: 'grid',
        gap: `${isList ? list.gap : grid.gap}px`,
        gridTemplateColumns: isList
          ? fittedColumnsTemplate(list.minWidth, list.gap, list.maxColumns)
          : fittedColumnsTemplate(grid.minWidth, grid.gap),
        position: 'relative',
        width: '100%',
      }}
    >
      <Box component="span" role="status" sx={visuallyHiddenSx}>
        {t('core:loading.generic', cap)}
      </Box>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton
          animation={reduce ? false : 'wave'}
          data-library-skeleton
          height={isList ? list.height : grid.height}
          key={index}
          sx={(theme) => ({
            bgcolor: alpha(theme.palette.text.primary, 0.07),
            borderRadius: isList ? '14px' : '16px',
          })}
          variant="rounded"
        />
      ))}
    </Box>
  );
};

interface LibraryWaitingProps extends LibrarySkeletonProps {
  status: LibraryStatus;
}

/**
 * The library while its list is still on the way, or after it came empty.
 * Once the node has sent apps, a section that waits here has none of them.
 */
export const LibraryWaiting = ({
  status,
  ...skeleton
}: LibraryWaitingProps) => {
  const { t } = useTranslation(['core']);
  if (status === 'empty') {
    return (
      <LibraryEmptyState
        icon={<CloudOffRoundedIcon />}
        text={t('core:launcher.library.empty_text', cap)}
        title={t('core:launcher.library.empty_title', cap)}
      />
    );
  }
  if (status === 'ready') {
    return (
      <LibraryEmptyState
        compact
        icon={<SearchOffRoundedIcon />}
        title={t('core:message.generic.no_results', cap)}
      />
    );
  }
  return <LibrarySkeleton {...skeleton} />;
};

/**
 * Tells screen readers what a search or a filter left. It is empty while
 * nothing narrows the list, so it speaks only after a change; with `delay`,
 * once the typing has stopped.
 */
export const LibraryResultsStatus = ({
  message,
  delay = 0,
}: {
  message: string;
  delay?: number;
}) => {
  const [delayed, setDelayed] = useState(message);

  useEffect(() => {
    if (!delay) return;
    const timer = window.setTimeout(() => setDelayed(message), delay);
    return () => window.clearTimeout(timer);
  }, [delay, message]);

  return (
    <Box component="span" role="status" sx={visuallyHiddenSx}>
      {delay ? delayed : message}
    </Box>
  );
};
