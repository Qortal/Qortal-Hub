import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, Box, Button, Rating, styled, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import LogoSelected from '../../../assets/svgs/LogoSelected.svg';
import { StarFilledIcon } from '../../../assets/Icons/StarFilled';
import { StarEmptyIcon } from '../../../assets/Icons/StarEmpty';
import AppsIcon from '@mui/icons-material/Apps';
import LanguageIcon from '@mui/icons-material/Language';

interface PublishedAppCardProps {
  app: any;
  onUpdate: () => void;
  onViewStats?: () => void;
}

const CardContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  padding: '16px',
  borderRadius: '12px',
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  gap: '12px',
  width: '320px',
  minHeight: '220px',
}));

const HeaderRow = styled(Box)({
  display: 'flex',
  alignItems: 'flex-start',
  gap: '16px',
});

const AppIcon = styled(Box)(({ theme }) => ({
  width: '64px',
  height: '64px',
  borderRadius: '12px',
  backgroundColor: theme.palette.action.hover,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  flexShrink: 0,
}));

const AppDetails = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  gap: '4px',
});

const AppTitle = styled(Typography)(({ theme }) => ({
  fontSize: '18px',
  fontWeight: 600,
  color: theme.palette.text.primary,
}));

const ServiceBadge = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'serviceType',
})<{ serviceType: 'app' | 'website' }>(({ theme, serviceType }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '12px',
  fontWeight: 500,
  backgroundColor:
    serviceType === 'app'
      ? theme.palette.primary.main + '20'
      : theme.palette.secondary.main + '20',
  color:
    serviceType === 'app'
      ? theme.palette.primary.main
      : theme.palette.secondary.main,
}));

const MetaRow = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
});

const MetaText = styled(Typography)(({ theme }) => ({
  fontSize: '13px',
  color: theme.palette.text.secondary,
}));

const RatingContainer = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
});

const ActionsRow = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
  paddingTop: '8px',
  borderTop: '1px solid',
  borderColor: 'divider',
});

const ActionButton = styled(Button)({
  textTransform: 'none',
  fontSize: '13px',
  padding: '6px 16px',
  borderRadius: '8px',
});

export const PublishedAppCard = ({
  app,
  onUpdate,
  onViewStats,
}: PublishedAppCardProps) => {
  const { t } = useTranslation(['core']);
  const [rating, setRating] = useState(0);
  const [ratingCount, setRatingCount] = useState(0);
  const hasCalledRef = useRef(false);

  const isWebsite =
    app?.service === 'WEBSITE' || app?.service?.includes('WEBSITE');
  const serviceType = isWebsite ? 'website' : 'app';

  const fetchRating = useCallback(async (name: string, service: string) => {
    try {
      hasCalledRef.current = true;
      const pollName = `app-library-${service}-rating-${name}`;
      const url = `${getBaseApiReact()}/polls/${pollName}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const responseData = await response.json();

      if (responseData?.pollName) {
        const urlVotes = `${getBaseApiReact()}/polls/votes/${pollName}`;
        const responseVotes = await fetch(urlVotes, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        const votesData = await responseVotes.json();
        const voteCount = votesData.voteCounts || [];

        const ratingVotes = voteCount.filter(
          (vote: any) => !vote.optionName.startsWith('initialValue-')
        );
        const initialValueVote = voteCount.find((vote: any) =>
          vote.optionName.startsWith('initialValue-')
        );

        let totalScore = 0;
        let totalVotes = 0;

        ratingVotes.forEach((vote: any) => {
          const ratingValue = parseInt(vote.optionName, 10);
          if (ratingValue >= 1 && ratingValue <= 5) {
            totalScore += ratingValue * vote.voteCount;
            totalVotes += vote.voteCount;
          }
        });

        if (initialValueVote) {
          const initialRating = parseInt(
            initialValueVote.optionName.split('-')[1],
            10
          );
          if (initialRating >= 1 && initialRating <= 5) {
            totalScore += initialRating;
            totalVotes += 1;
          }
        }

        setRating(totalVotes > 0 ? totalScore / totalVotes : 0);
        setRatingCount(totalVotes);
      }
    } catch (error) {
      console.error('Error fetching rating:', error);
    }
  }, []);

  useEffect(() => {
    if (hasCalledRef.current) return;
    if (!app?.name || !app?.service) return;
    fetchRating(app.name, app.service);
  }, [fetchRating, app?.name, app?.service]);

  const formatDate = (timestamp: number | undefined) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
    });
  };

  return (
    <CardContainer>
      <HeaderRow>
        <AppIcon>
          <Avatar
            sx={{
              height: '48px',
              width: '48px',
              '& img': {
                objectFit: 'fill',
              },
            }}
            alt={app?.name}
            src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${app?.name}/qortal_avatar?async=true`}
          >
            <img
              style={{
                width: '32px',
                height: 'auto',
              }}
              src={LogoSelected}
              alt="app-icon"
            />
          </Avatar>
        </AppIcon>

        <AppDetails>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AppTitle>{app?.metadata?.title || app?.name}</AppTitle>
            <ServiceBadge serviceType={serviceType}>
              {isWebsite ? (
                <LanguageIcon sx={{ fontSize: '14px' }} />
              ) : (
                <AppsIcon sx={{ fontSize: '14px' }} />
              )}
              {isWebsite
                ? t('core:website', { postProcess: 'capitalizeFirstChar' })
                : t('core:app', { postProcess: 'capitalizeFirstChar' })}
            </ServiceBadge>
          </Box>

          <MetaRow>
            {app?.name && (
              <MetaText>
                {t('core:name', { postProcess: 'capitalizeFirstChar' })}:{' '}
                {app.name}
              </MetaText>
            )}
            {app?.created && (
              <MetaText>
                {t('core:app_detail.published', {
                  postProcess: 'capitalizeFirstChar',
                })}
                : {formatDate(app.created)}
              </MetaText>
            )}
            {app?.metadata?.categoryName && (
              <MetaText>
                {t('core:category', { postProcess: 'capitalizeFirstChar' })}:{' '}
                {app.metadata.categoryName}
              </MetaText>
            )}
          </MetaRow>

          <RatingContainer>
            <Rating
              value={rating}
              precision={0.1}
              readOnly
              size="small"
              icon={<StarFilledIcon />}
              emptyIcon={<StarEmptyIcon />}
            />
            <MetaText>
              {rating.toFixed(1)} ({ratingCount})
            </MetaText>
          </RatingContainer>
        </AppDetails>
      </HeaderRow>

      {app?.metadata?.description && (
        <Typography
          sx={{
            fontSize: '14px',
            color: 'text.secondary',
            lineHeight: 1.5,
          }}
        >
          {app.metadata.description.length > 150
            ? app.metadata.description.substring(0, 150) + '...'
            : app.metadata.description}
        </Typography>
      )}

      <ActionsRow sx={{ borderColor: 'divider' }}>
        <ActionButton variant="contained" color="primary" onClick={onUpdate}>
          {t('core:developer.update', {
            postProcess: 'capitalizeFirstChar',
          })}
        </ActionButton>
        {onViewStats && (
          <ActionButton variant="outlined" onClick={onViewStats}>
            {t('core:developer.view_stats', {
              postProcess: 'capitalizeFirstChar',
            })}
          </ActionButton>
        )}
      </ActionsRow>
    </CardContainer>
  );
};
