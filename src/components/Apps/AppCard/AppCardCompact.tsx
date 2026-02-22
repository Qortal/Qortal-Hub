import { Avatar, Box, ButtonBase, Rating, styled, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import LogoSelected from '../../../assets/svgs/LogoSelected.svg';
import { StarFilledIcon } from '../../../assets/Icons/StarFilled';
import { StarEmptyIcon } from '../../../assets/Icons/StarEmpty';
import { executeEvent } from '../../../utils/events';

interface AppCardCompactProps {
  app: any;
  myName: string;
}

const CardContainer = styled(ButtonBase)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  padding: '12px 16px',
  borderRadius: '8px',
  backgroundColor: theme.palette.background.paper,
  textAlign: 'left',
  gap: '12px',
  transition: 'background-color 0.2s',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
}));

const AppIcon = styled(Box)(({ theme }) => ({
  width: '48px',
  height: '48px',
  borderRadius: '10px',
  backgroundColor: theme.palette.action.hover,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  flexShrink: 0,
}));

const ContentContainer = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  gap: '2px',
});

const TitleRow = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
});

const AppTitle = styled(Typography)(({ theme }) => ({
  fontSize: '15px',
  fontWeight: 600,
  color: theme.palette.text.primary,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}));

const DeveloperName = styled(Typography)(({ theme }) => ({
  fontSize: '13px',
  color: theme.palette.text.secondary,
}));

const RatingContainer = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
});

const RatingText = styled(Typography)(({ theme }) => ({
  fontSize: '12px',
  color: theme.palette.text.secondary,
}));

const CategoryBadge = styled(Box)(({ theme }) => ({
  display: 'inline-flex',
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '11px',
  backgroundColor: theme.palette.action.hover,
  color: theme.palette.text.secondary,
  flexShrink: 0,
}));

export const AppCardCompact = ({ app, myName }: AppCardCompactProps) => {
  const { t } = useTranslation(['core']);

  const handleClick = () => {
    executeEvent('selectedAppInfo', {
      data: app,
    });
  };

  return (
    <CardContainer onClick={handleClick}>
      <AppIcon>
        <Avatar
          sx={{
            height: '36px',
            width: '36px',
            '& img': {
              objectFit: 'fill',
            },
          }}
          alt={app?.name}
          src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${app?.name}/qortal_avatar?async=true`}
        >
          <img
            style={{
              width: '24px',
              height: 'auto',
            }}
            src={LogoSelected}
            alt="app-icon"
          />
        </Avatar>
      </AppIcon>

      <ContentContainer>
        <TitleRow>
          <AppTitle>{app?.metadata?.title || app?.name}</AppTitle>
          {app?.metadata?.categoryName && (
            <CategoryBadge>{app.metadata.categoryName}</CategoryBadge>
          )}
        </TitleRow>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <DeveloperName>@{app?.name}</DeveloperName>
          <RatingContainer>
            <Rating
              value={app?.averageRating || 0}
              precision={0.5}
              readOnly
              size="small"
              icon={<StarFilledIcon />}
              emptyIcon={<StarEmptyIcon />}
              sx={{ fontSize: '14px' }}
            />
            {app?.ratingCount > 0 && (
              <RatingText>({app.ratingCount})</RatingText>
            )}
          </RatingContainer>
        </Box>
      </ContentContainer>
    </CardContainer>
  );
};
