import { useState } from 'react';
import {
  Avatar,
  Box,
  IconButton,
  Typography,
  styled,
  useTheme,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import LogoSelected from '../../../assets/svgs/LogoSelected.svg';
import { executeEvent } from '../../../utils/events';
import { AppDownloadButton, AppDownloadButtonText } from '../Apps-styles';

const CarouselContainer = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  gap: '16px',
});

const CardsContainer = styled(Box)({
  display: 'flex',
  gap: '16px',
  overflow: 'hidden',
  flex: 1,
  justifyContent: 'center',
});

const FeaturedCard = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '10px',
  padding: '16px',
  borderRadius: '12px',
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  width: '220px',
  minWidth: '220px',
  minHeight: '190px',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: theme.shadows[4],
  },
}));

const CardAvatar = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '70px',
  height: '70px',
  borderRadius: '12px',
  backgroundColor: theme.palette.background.default,
  flexShrink: 0,
}));

const CardTitle = styled(Typography)(({ theme }) => ({
  fontSize: '16px',
  fontWeight: 600,
  color: theme.palette.text.primary,
  textAlign: 'center',
}));

const CardDescription = styled(Typography)(({ theme }) => ({
  fontSize: '12px',
  fontWeight: 400,
  color: theme.palette.text.secondary,
  lineHeight: 1.4,
  textAlign: 'center',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  minHeight: '34px',
}));

const NavButton = styled(IconButton)(({ theme }) => ({
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
  '&.Mui-disabled': {
    opacity: 0.3,
  },
}));

interface FeaturedAppBannerProps {
  featuredApps: any[];
}

export const FeaturedAppBanner = ({ featuredApps }: FeaturedAppBannerProps) => {
  const [startIndex, setStartIndex] = useState(0);
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  const FEATURED_APPS_MAX: number = 4;

  if (!featuredApps || featuredApps.length === 0) {
    return null;
  }

  // Get the visible apps (3 at a time)
  const visibleApps = featuredApps.slice(
    startIndex,
    startIndex + FEATURED_APPS_MAX
  );

  // Fill remaining slots if we have fewer than 3 apps at the end
  const displayApps =
    visibleApps.length < FEATURED_APPS_MAX &&
    featuredApps.length >= FEATURED_APPS_MAX
      ? [
          ...visibleApps,
          ...featuredApps.slice(0, FEATURED_APPS_MAX - visibleApps.length),
        ]
      : visibleApps;

  const canGoBack = startIndex > 0;
  const canGoForward = startIndex + FEATURED_APPS_MAX < featuredApps.length;

  const handlePrev = () => {
    setStartIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNext = () => {
    setStartIndex((prev) =>
      Math.min(featuredApps.length - FEATURED_APPS_MAX, prev + 1)
    );
  };

  const handleOpenApp = (app: any, e: React.MouseEvent) => {
    e.stopPropagation();
    executeEvent('addTab', { data: app });
  };

  const handleViewDetails = (app: any) => {
    executeEvent('selectedAppInfo', { data: app });
  };

  return (
    <CarouselContainer>
      <NavButton
        onClick={handlePrev}
        size="small"
        disabled={!canGoBack}
        sx={{
          visibility:
            featuredApps.length <= FEATURED_APPS_MAX ? 'hidden' : 'visible',
        }}
      >
        <ChevronLeftIcon />
      </NavButton>

      <CardsContainer>
        {displayApps.map((app, index) => {
          const isInstalled = app?.status?.status === 'READY';

          return (
            <FeaturedCard
              key={`${app?.name}-${index}`}
              onClick={() => handleViewDetails(app)}
            >
              <CardAvatar>
                <Avatar
                  sx={{
                    height: '50px',
                    width: '50px',
                    '& img': {
                      objectFit: 'fill',
                    },
                  }}
                  alt={app?.name}
                  src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${app?.name}/qortal_avatar?async=true`}
                >
                  <img
                    style={{
                      width: '35px',
                      height: 'auto',
                    }}
                    src={LogoSelected}
                    alt="app-icon"
                  />
                </Avatar>
              </CardAvatar>

              <CardTitle>{app?.metadata?.title || app?.name}</CardTitle>

              <CardDescription>
                {app?.metadata?.description ||
                  t('core:message.generic.no_description', {
                    postProcess: 'capitalizeFirstChar',
                  })}
              </CardDescription>

              <AppDownloadButton
                onClick={(e) => handleOpenApp(app, e)}
                sx={{
                  backgroundColor: theme.palette.primary.main,
                  color: theme.palette.primary.contrastText,
                  width: 'auto',
                  padding: '0 24px',
                  marginTop: 'auto',
                }}
              >
                <AppDownloadButtonText>
                  {isInstalled
                    ? t('core:action.open', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    : t('core:action.download', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                </AppDownloadButtonText>
              </AppDownloadButton>
            </FeaturedCard>
          );
        })}
      </CardsContainer>

      <NavButton
        onClick={handleNext}
        size="small"
        disabled={!canGoForward}
        sx={{
          visibility:
            featuredApps.length <= FEATURED_APPS_MAX ? 'hidden' : 'visible',
        }}
      >
        <ChevronRightIcon />
      </NavButton>
    </CarouselContainer>
  );
};
