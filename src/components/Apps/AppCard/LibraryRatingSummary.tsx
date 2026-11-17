import { useEffect, useState } from 'react';
import { Box, Skeleton } from '@mui/material';
import { alpha } from '@mui/material/styles';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import { useTranslation } from 'react-i18next';
import { useAppRating } from '../../../hooks/useAppRatings';
import { ratingWithPendingVote } from '../AppPage/appVotes';
import { usePendingVoteFor } from '../AppPage/optimisticRatings';
import { RATING_GRACE_MS } from '../AppsLibrary/libraryLayout';
import {
  formatLibraryNumber,
  isDark,
  libraryMuted,
  usePrefersReducedMotion,
  visuallyHiddenSx,
} from '../AppsLibrary/libraryStyles';

interface LibraryRatingSummaryProps {
  name?: string;
  service?: string;
  align?: 'start' | 'center';
  className?: string;
}

/**
 * An app's rating, to read only. Voting is on the app's page: on a card a
 * star click would also open that page. A vote the account just sent there
 * is counted at once, before its block.
 */
export const LibraryRatingSummary = ({
  name,
  service,
  align = 'start',
  className,
}: LibraryRatingSummaryProps) => {
  const { t, i18n } = useTranslation(['core']);
  const reduce = usePrefersReducedMotion();
  // The ref lets the rating load once the card scrolls into view.
  const { rating: storedRating, containerRef } = useAppRating(name, service);
  const pendingVote = usePendingVoteFor(name, service);
  const rating = pendingVote
    ? ratingWithPendingVote(storedRating, pendingVote)
    : storedRating;
  const votes = rating?.totalVotes ?? 0;
  const isMissing = !rating;
  // A placeholder only for a short while: a rating that has not come by then
  // is shown as none, as an app without a poll is, instead of loading for ever.
  const [hasWaited, setHasWaited] = useState(false);

  useEffect(() => {
    if (!isMissing) return;
    const timer = window.setTimeout(() => setHasWaited(true), RATING_GRACE_MS);
    return () => {
      window.clearTimeout(timer);
      setHasWaited(false);
    };
  }, [isMissing]);

  let content;
  if (!rating && !hasWaited) {
    content = (
      <Skeleton
        animation={reduce ? false : 'wave'}
        height={14}
        sx={(theme) => ({ bgcolor: alpha(theme.palette.text.primary, 0.07) })}
        variant="rounded"
        width={44}
      />
    );
  } else if (!rating || votes === 0) {
    content = (
      <>
        <Box
          aria-hidden
          component="span"
          sx={(theme) => ({ color: libraryMuted(theme), fontSize: '13px' })}
        >
          —
        </Box>
        <Box component="span" sx={visuallyHiddenSx}>
          {t('core:launcher.library.rating_none', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Box>
      </>
    );
  } else {
    const average = formatLibraryNumber(
      rating.averageRating ?? 0,
      i18n?.language,
      { maximumFractionDigits: 1, minimumFractionDigits: 1 }
    );
    content = (
      <Box
        aria-label={t('core:launcher.library.rating_summary', {
          count: votes,
          postProcess: 'capitalizeFirstChar',
          rating: average,
        })}
        component="span"
        role="img"
        sx={{ alignItems: 'center', display: 'inline-flex', gap: 0.5 }}
      >
        <StarRoundedIcon
          aria-hidden
          sx={(theme) => ({
            color: isDark(theme)
              ? theme.palette.warning.main
              : theme.palette.warning.dark,
            fontSize: 16,
          })}
        />
        <Box
          aria-hidden
          component="span"
          sx={(theme) => ({
            color: theme.palette.text.primary,
            fontSize: '13px',
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 600,
          })}
        >
          {average}
        </Box>
        <Box
          aria-hidden
          component="span"
          sx={(theme) => ({
            color: libraryMuted(theme),
            fontSize: '12px',
            fontVariantNumeric: 'tabular-nums',
          })}
        >
          {`(${formatLibraryNumber(votes, i18n?.language)})`}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      className={className}
      ref={containerRef}
      sx={{
        alignItems: 'center',
        display: 'flex',
        height: 18,
        justifyContent: align === 'center' ? 'center' : 'flex-start',
        minWidth: 0,
      }}
    >
      {content}
    </Box>
  );
};
