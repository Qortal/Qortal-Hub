import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, LinearProgress, Rating, styled, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import { StarFilledIcon } from '../../../assets/Icons/StarFilled';
import { StarEmptyIcon } from '../../../assets/Icons/StarEmpty';

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
  const [averageRating, setAverageRating] = useState(0);
  const [totalVotes, setTotalVotes] = useState(0);
  const [distribution, setDistribution] = useState<RatingDistribution[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const hasCalledRef = useRef(false);

  const fetchRatingData = useCallback(async (name: string, service: string) => {
    try {
      hasCalledRef.current = true;
      setIsLoading(true);
      const pollName = `app-library-${service}-rating-${name}`;
      const url = `${getBaseApiReact()}/polls/${pollName}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const responseData = await response.json();

      if (responseData?.message?.includes('POLL_NO_EXISTS')) {
        setIsLoading(false);
        return;
      }

      if (responseData?.pollName) {
        const urlVotes = `${getBaseApiReact()}/polls/votes/${pollName}`;
        const responseVotes = await fetch(urlVotes, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        const votesData = await responseVotes.json();
        const voteCount = votesData.voteCounts || [];

        // Separate regular votes from initial value
        const ratingVotes = voteCount.filter(
          (vote: any) => !vote.optionName.startsWith('initialValue-')
        );
        const initialValueVote = voteCount.find((vote: any) =>
          vote.optionName.startsWith('initialValue-')
        );

        // Build distribution for ratings 1-5
        const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

        ratingVotes.forEach((vote: any) => {
          const rating = parseInt(vote.optionName, 10);
          if (rating >= 1 && rating <= 5) {
            counts[rating] = vote.voteCount;
          }
        });

        // Add initial value vote
        if (initialValueVote) {
          const initialRating = parseInt(
            initialValueVote.optionName.split('-')[1],
            10
          );
          if (initialRating >= 1 && initialRating <= 5) {
            counts[initialRating] += 1;
          }
        }

        // Calculate totals
        let total = 0;
        let weightedSum = 0;
        Object.entries(counts).forEach(([rating, count]) => {
          total += count;
          weightedSum += parseInt(rating) * count;
        });

        setTotalVotes(total);
        setAverageRating(total > 0 ? weightedSum / total : 0);

        // Build distribution array (sorted 5 to 1)
        const dist: RatingDistribution[] = [5, 4, 3, 2, 1].map((rating) => ({
          rating,
          count: counts[rating],
          percentage: total > 0 ? (counts[rating] / total) * 100 : 0,
        }));

        setDistribution(dist);
      }
    } catch (error) {
      console.error('Error fetching rating breakdown:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasCalledRef.current) return;
    if (!app?.name || !app?.service) return;
    fetchRatingData(app.name, app.service);
  }, [fetchRatingData, app?.name, app?.service]);

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
              <ProgressBar
                variant="determinate"
                value={item.percentage}
              />
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
