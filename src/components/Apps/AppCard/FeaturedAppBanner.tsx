import { useState } from 'react';
import {
  Avatar,
  Box,
  ButtonBase,
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

const CarouselContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  gap: '16px',
  marginBottom: '40px',
}));

const BannerCard = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '24px',
  padding: '32px',
  borderRadius: '16px',
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  width: '100%',
  maxWidth: '700px',
  minHeight: '160px',
  transition: 'all 0.3s ease',
}));

const BannerAvatar = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100px',
  height: '100px',
  borderRadius: '16px',
  backgroundColor: theme.palette.background.default,
  flexShrink: 0,
}));

const BannerContent = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  flex: 1,
});

const BannerTitle = styled(Typography)(({ theme }) => ({
  fontSize: '24px',
  fontWeight: 600,
  color: theme.palette.text.primary,
}));

const BannerDescription = styled(Typography)(({ theme }) => ({
  fontSize: '14px',
  fontWeight: 400,
  color: theme.palette.text.secondary,
  lineHeight: 1.5,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
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

const DotsContainer = styled(Box)({
  display: 'flex',
  justifyContent: 'center',
  gap: '8px',
  marginTop: '16px',
});

const Dot = styled(Box)<{ active?: boolean }>(({ theme, active }) => ({
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  backgroundColor: active
    ? theme.palette.primary.main
    : theme.palette.action.disabled,
  cursor: 'pointer',
  transition: 'all 0.2s ease',
}));

interface FeaturedAppBannerProps {
  featuredApps: any[];
}

export const FeaturedAppBanner = ({ featuredApps }: FeaturedAppBannerProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  if (!featuredApps || featuredApps.length === 0) {
    return null;
  }

  const currentApp = featuredApps[currentIndex];
  const isInstalled = currentApp?.status?.status === 'READY';

  const handlePrev = () => {
    setCurrentIndex((prev) =>
      prev === 0 ? featuredApps.length - 1 : prev - 1
    );
  };

  const handleNext = () => {
    setCurrentIndex((prev) =>
      prev === featuredApps.length - 1 ? 0 : prev + 1
    );
  };

  const handleOpenApp = () => {
    executeEvent('addTab', { data: currentApp });
  };

  const handleViewDetails = () => {
    executeEvent('selectedAppInfo', { data: currentApp });
  };

  return (
    <Box sx={{ width: '100%' }}>
      <CarouselContainer>
        <NavButton onClick={handlePrev} size="small">
          <ChevronLeftIcon />
        </NavButton>

        <BannerCard>
          <BannerAvatar>
            <Avatar
              sx={{
                height: '80px',
                width: '80px',
                '& img': {
                  objectFit: 'fill',
                },
              }}
              alt={currentApp?.name}
              src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${currentApp?.name}/qortal_avatar?async=true`}
            >
              <img
                style={{
                  width: '50px',
                  height: 'auto',
                }}
                src={LogoSelected}
                alt="app-icon"
              />
            </Avatar>
          </BannerAvatar>

          <BannerContent>
            <BannerTitle>
              {currentApp?.metadata?.title || currentApp?.name}
            </BannerTitle>
            <BannerDescription>
              {currentApp?.metadata?.description ||
                t('core:message.generic.no_description', {
                  postProcess: 'capitalizeFirstChar',
                })}
            </BannerDescription>

            <Box sx={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <AppDownloadButton
                onClick={handleOpenApp}
                sx={{
                  backgroundColor: theme.palette.primary.main,
                  color: theme.palette.primary.contrastText,
                  width: 'auto',
                  padding: '0 20px',
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

              <ButtonBase
                onClick={handleViewDetails}
                sx={{
                  fontSize: '14px',
                  color: theme.palette.text.secondary,
                  '&:hover': {
                    color: theme.palette.text.primary,
                  },
                }}
              >
                {t('core:q_apps.about', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </ButtonBase>
            </Box>
          </BannerContent>
        </BannerCard>

        <NavButton onClick={handleNext} size="small">
          <ChevronRightIcon />
        </NavButton>
      </CarouselContainer>

      <DotsContainer>
        {featuredApps.map((_, index) => (
          <Dot
            key={index}
            active={index === currentIndex}
            onClick={() => setCurrentIndex(index)}
          />
        ))}
      </DotsContainer>
    </Box>
  );
};
