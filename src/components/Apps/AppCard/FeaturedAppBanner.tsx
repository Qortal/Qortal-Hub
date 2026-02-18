import { memo, useState } from 'react';
import {
  Avatar,
  Box,
  IconButton,
  Typography,
  styled,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import LogoSelected from '../../../assets/svgs/LogoSelected.svg';
import { executeEvent } from '../../../utils/events';
import { AppButton, AppButtonText } from '../Apps-styles';

const CarouselContainer = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  gap: '8px',
});

const CardsContainer = styled(Box)({
  display: 'flex',
  gap: '12px',
  overflow: 'hidden',
  flex: 1,
  justifyContent: 'center',
  flexWrap: 'nowrap',
});

const FeaturedCard = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '8px',
  padding: '12px',
  borderRadius: '12px',
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  width: '170px',
  minWidth: '140px',
  maxWidth: '170px',
  flex: '1 1 140px',
  minHeight: '175px',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: theme.shadows[4],
  },
  [theme.breakpoints.down('sm')]: {
    width: '160px',
    minWidth: '140px',
    maxWidth: '180px',
    padding: '12px',
    minHeight: '170px',
  },
}));

const CardAvatar = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '55px',
  height: '55px',
  borderRadius: '12px',
  backgroundColor: theme.palette.background.default,
  flexShrink: 0,
  [theme.breakpoints.down('sm')]: {
    width: '50px',
    height: '50px',
  },
}));

const CardTitle = styled(Typography)(({ theme }) => ({
  fontSize: '14px',
  fontWeight: 600,
  color: theme.palette.text.primary,
  textAlign: 'center',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  width: '100%',
  [theme.breakpoints.down('sm')]: {
    fontSize: '13px',
  },
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
  [theme.breakpoints.down('sm')]: {
    fontSize: '11px',
    minHeight: '30px',
  },
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

const FeaturedAppBannerInner = ({ featuredApps }: FeaturedAppBannerProps) => {
  const [startIndex, setStartIndex] = useState(0);
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  // Responsive breakpoints
  const isXSmall = useMediaQuery(theme.breakpoints.down('sm')); // < 600px
  const isSmall = useMediaQuery(theme.breakpoints.between('sm', 'md')); // 600-900px
  const isMedium = useMediaQuery(theme.breakpoints.between('md', 'lg')); // 900-1200px

  // Determine number of visible cards based on screen size
  const getVisibleCount = () => {
    if (isXSmall) return 2;
    if (isSmall) return 3;
    if (isMedium) return 4;
    return 6; // Large screens
  };

  const visibleCount = getVisibleCount();

  if (!featuredApps || featuredApps.length === 0) {
    return null;
  }

  // Get the visible apps based on screen size
  const visibleApps = featuredApps.slice(startIndex, startIndex + visibleCount);

  // Fill remaining slots if we have fewer apps at the end
  const displayApps =
    visibleApps.length < visibleCount && featuredApps.length >= visibleCount
      ? [
          ...visibleApps,
          ...featuredApps.slice(0, visibleCount - visibleApps.length),
        ]
      : visibleApps;

  const canGoBack = startIndex > 0;
  const canGoForward = startIndex + visibleCount < featuredApps.length;

  const handlePrev = () => {
    setStartIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNext = () => {
    setStartIndex((prev) =>
      Math.min(featuredApps.length - visibleCount, prev + 1)
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
            featuredApps.length <= visibleCount ? 'hidden' : 'visible',
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
                    height: { xs: '36px', sm: '42px' },
                    width: { xs: '36px', sm: '42px' },
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

              <AppButton
                onClick={(e) => handleOpenApp(app, e)}
                sx={{
                  backgroundColor: isInstalled
                    ? theme.palette.primary.main
                    : theme.palette.background.default,
                  color: isInstalled
                    ? theme.palette.primary.contrastText
                    : theme.palette.text.primary,
                  marginTop: 'auto',
                }}
              >
                <AppButtonText>
                  {isInstalled
                    ? t('core:action.open', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    : t('core:action.download', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                </AppButtonText>
              </AppButton>
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
            featuredApps.length <= visibleCount ? 'hidden' : 'visible',
        }}
      >
        <ChevronRightIcon />
      </NavButton>
    </CarouselContainer>
  );
};

FeaturedAppBannerInner.displayName = 'FeaturedAppBanner';

export const FeaturedAppBanner = memo(FeaturedAppBannerInner);
