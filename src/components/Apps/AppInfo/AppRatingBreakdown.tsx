import { useMemo } from 'react';
import { Box, LinearProgress, Rating, styled, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { StarFilledIcon } from '../../../assets/Icons/StarFilled';
import { StarEmptyIcon } from '../../../assets/Icons/StarEmpty';
import { useAppRating } from '../../../hooks/useAppRatings';

interface RatingDistribution {
  rating: number;
  count: number;
  percentage: number;
}

interface AppRatingBreakdownProps {
  app: any;
  myName: string;
  onRate?: (rating: number) => void;
}

const BreakdownContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  width: '100%',
}));

const SummaryRow = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '24px',
  marginBottom: '16px',
});

const AverageContainer = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  minWidth: '80px',
});

const AverageValue = styled(Typography)(({ theme }) => ({
  fontSize: '48px',
  fontWeight: 700,
  color: theme.palette.text.primary,
  lineHeight: 1,
}));

const TotalRatings = styled(Typography)(({ theme }) => ({
  fontSize: '13px',
  color: theme.palette.text.secondary,
  marginTop: '4px',
}));

const DistributionContainer = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  flex: 1,
});

const RatingRow = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
});

const RatingLabel = styled(Typography)(({ theme }) => ({
  fontSize: '13px',
  color: theme.palette.text.secondary,
  width: '20px',
  textAlign: 'right',
}));

const ProgressBar = styled(LinearProgress)(({ theme }) => ({
  flex: 1,
  height: '8px',
  borderRadius: '4px',
  backgroundColor: theme.palette.action.hover,
  '& .MuiLinearProgress-bar': {
    backgroundColor: theme.palette.warning.main,
    borderRadius: '4px',
  },
}));

const CountLabel = styled(Typography)(({ theme }) => ({
  fontSize: '12px',
  color: theme.palette.text.secondary,
  width: '40px',
  textAlign: 'right',
}));

const RateSection = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '16px',
  backgroundColor: theme.palette.action.hover,
  borderRadius: '8px',
  marginTop: '8px',
}));

const RateLabel = styled(Typography)(({ theme }) => ({
  fontSize: '14px',
  color: theme.palette.text.secondary,
}));

export const AppRatingBreakdown = ({
  app,
  myName,
  onRate,
}: AppRatingBreakdownProps) => {
  const { t } = useTranslation(['core']);

  // Use centralized rating store
  const { rating, isLoading } = useAppRating(app?.name, app?.service);

  // Compute distribution from voteCounts
  const { averageRating, totalVotes, distribution } = useMemo(() => {
    if (!rating) {
      return { averageRating: 0, totalVotes: 0, distribution: [] };
    }

    const voteCounts = rating.voteCounts || [];

    // Build counts for ratings 1-5
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    // Process regular votes first, then add initial value on top
    // (order matters: initialValue uses +=, regular uses =)
    voteCounts.forEach((vote) => {
      if (!vote.optionName.startsWith('initialValue-')) {
        const ratingValue = parseInt(vote.optionName, 10);
        if (ratingValue >= 1 && ratingValue <= 5) {
          counts[ratingValue] = vote.voteCount;
        }
      }
    });
    voteCounts.forEach((vote) => {
      if (vote.optionName.startsWith('initialValue-')) {
        const initialRating = parseInt(vote.optionName.split('-')[1], 10);
        if (initialRating >= 1 && initialRating <= 5) {
          counts[initialRating] += 1;
        }
      }
    });

    // Calculate total
    let total = 0;
    Object.values(counts).forEach((count) => {
      total += count;
    });

    // Build distribution array (sorted 5 to 1)
    const dist: RatingDistribution[] = [5, 4, 3, 2, 1].map((r) => ({
      rating: r,
      count: counts[r],
      percentage: total > 0 ? (counts[r] / total) * 100 : 0,
    }));

    return {
      averageRating: rating.averageRating,
      totalVotes: total,
      distribution: dist,
    };
  }, [rating]);

  if (isLoading) {
    return (
      <BreakdownContainer>
        <Typography color="text.secondary">
          {t('core:loading.generic', { postProcess: 'capitalizeFirstChar' })}
        </Typography>
      </BreakdownContainer>
    );
  }

  return (
    <BreakdownContainer>
      <SummaryRow>
        <AverageContainer>
          <AverageValue>{averageRating.toFixed(1)}</AverageValue>
          <Rating
            value={averageRating}
            precision={0.1}
            readOnly
            size="small"
            icon={<StarFilledIcon />}
            emptyIcon={<StarEmptyIcon />}
            sx={{ mt: 1 }}
          />
          <TotalRatings>
            {totalVotes}{' '}
            {t('core:app_detail.ratings', {
              postProcess: 'capitalizeFirstChar',
            })}
          </TotalRatings>
        </AverageContainer>

        <DistributionContainer>
          {distribution.map((item) => (
            <RatingRow key={item.rating}>
              <RatingLabel>{item.rating}</RatingLabel>
              <ProgressBar variant="determinate" value={item.percentage} />
              <CountLabel>({item.count})</CountLabel>
            </RatingRow>
          ))}
        </DistributionContainer>
      </SummaryRow>

      {onRate && (
        <RateSection>
          <RateLabel>
            {t('core:app_detail.rate_this_app', {
              postProcess: 'capitalizeFirstChar',
            })}
            :
          </RateLabel>
          <Rating
            value={0}
            onChange={(_, value) => value && onRate(value)}
            precision={1}
            size="large"
            icon={<StarFilledIcon />}
            emptyIcon={<StarEmptyIcon />}
          />
        </RateSection>
      )}
    </BreakdownContainer>
  );
};
