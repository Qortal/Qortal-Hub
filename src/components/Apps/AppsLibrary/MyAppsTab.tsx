import { useMemo } from 'react';
import { Box, Button, Divider, Typography, styled, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppsIcon from '@mui/icons-material/Apps';
import LanguageIcon from '@mui/icons-material/Language';
import AddIcon from '@mui/icons-material/Add';
import { AppLibrarySubTitle, AppsWidthLimiter } from '../Apps-styles';
import { Spacer } from '../../../common/Spacer';
import { PublishedAppCard } from '../AppCard';

interface MyAppsTabProps {
  myName: string;
  availableQapps: any[];
  setMode: (mode: string) => void;
}

const SectionContainer = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  width: '100%',
});

const SectionTitle = styled(Typography)(({ theme }) => ({
  fontSize: '18px',
  fontWeight: 600,
  color: theme.palette.text.primary,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
}));

const EmptyStateBox = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '40px',
  borderRadius: '12px',
  backgroundColor: theme.palette.background.paper,
  border: `1px dashed ${theme.palette.divider}`,
  textAlign: 'center',
}));

const PublishNewContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  gap: '16px',
  flexWrap: 'wrap',
}));

const PublishButton = styled(Button)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px 32px',
  borderRadius: '12px',
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  textTransform: 'none',
  minWidth: '160px',
  gap: '8px',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
    borderColor: theme.palette.primary.main,
  },
}));

const StyledDivider = styled(Divider)(({ theme }) => ({
  margin: '16px 0',
}));

export const MyAppsTab = ({
  myName,
  availableQapps,
  setMode,
}: MyAppsTabProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  // Find user's published apps and websites
  const myApps = useMemo(() => {
    if (!myName || !availableQapps) return [];
    return availableQapps.filter(
      (app) =>
        app.name === myName &&
        (app.service === 'APP' || app.service?.includes('APP'))
    );
  }, [myName, availableQapps]);

  const myWebsites = useMemo(() => {
    if (!myName || !availableQapps) return [];
    return availableQapps.filter(
      (app) =>
        app.name === myName &&
        (app.service === 'WEBSITE' || app.service?.includes('WEBSITE'))
    );
  }, [myName, availableQapps]);

  const hasPublishedContent = myApps.length > 0 || myWebsites.length > 0;

  if (!myName) {
    return (
      <AppsWidthLimiter>
        <EmptyStateBox>
          <Typography
            sx={{
              fontSize: '18px',
              fontWeight: 500,
              marginBottom: '12px',
            }}
          >
            {t('core:message.generic.name_publish', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
          <Typography
            sx={{
              fontSize: '14px',
              color: theme.palette.text.secondary,
            }}
          >
            {t('core:message.generic.register_name', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </EmptyStateBox>
      </AppsWidthLimiter>
    );
  }

  return (
    <AppsWidthLimiter>
      <SectionContainer>
        {/* Page Title */}
        <AppLibrarySubTitle
          sx={{
            fontSize: '28px',
          }}
        >
          {t('core:developer.my_apps', {
            postProcess: 'capitalizeFirstChar',
          })}
        </AppLibrarySubTitle>

        {/* Published Apps Section */}
        {myApps.length > 0 && (
          <Box>
            <SectionTitle>
              <AppsIcon sx={{ fontSize: '20px' }} />
              {t('core:developer.your_published_apps', {
                postProcess: 'capitalizeFirstChar',
              })}
            </SectionTitle>
            <Spacer height="16px" />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {myApps.map((app) => (
                <PublishedAppCard
                  key={`${app.service}-${app.name}`}
                  app={app}
                  onUpdate={() => setMode('publish')}
                />
              ))}
            </Box>
          </Box>
        )}

        {/* Published Websites Section */}
        {myWebsites.length > 0 && (
          <Box>
            <SectionTitle>
              <LanguageIcon sx={{ fontSize: '20px' }} />
              {t('core:developer.your_published_websites', {
                postProcess: 'capitalizeFirstChar',
              })}
            </SectionTitle>
            <Spacer height="16px" />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {myWebsites.map((site) => (
                <PublishedAppCard
                  key={`${site.service}-${site.name}`}
                  app={site}
                  onUpdate={() => setMode('publish')}
                />
              ))}
            </Box>
          </Box>
        )}

        {/* Empty State for Apps */}
        {myApps.length === 0 && (
          <Box>
            <SectionTitle>
              <AppsIcon sx={{ fontSize: '20px' }} />
              {t('core:developer.your_published_apps', {
                postProcess: 'capitalizeFirstChar',
              })}
            </SectionTitle>
            <Spacer height="16px" />
            <EmptyStateBox>
              <AppsIcon
                sx={{ fontSize: '48px', color: 'text.disabled', mb: 2 }}
              />
              <Typography
                sx={{
                  fontSize: '16px',
                  color: theme.palette.text.secondary,
                }}
              >
                {t('core:developer.no_apps_yet', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </EmptyStateBox>
          </Box>
        )}

        {/* Empty State for Websites */}
        {myWebsites.length === 0 && (
          <Box>
            <SectionTitle>
              <LanguageIcon sx={{ fontSize: '20px' }} />
              {t('core:developer.your_published_websites', {
                postProcess: 'capitalizeFirstChar',
              })}
            </SectionTitle>
            <Spacer height="16px" />
            <EmptyStateBox>
              <LanguageIcon
                sx={{ fontSize: '48px', color: 'text.disabled', mb: 2 }}
              />
              <Typography
                sx={{
                  fontSize: '16px',
                  color: theme.palette.text.secondary,
                }}
              >
                {t('core:developer.no_sites_yet', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </EmptyStateBox>
          </Box>
        )}

        <StyledDivider />

        {/* Publish New Section */}
        <Box>
          <SectionTitle>
            <AddIcon sx={{ fontSize: '20px' }} />
            {t('core:developer.publish_new', {
              postProcess: 'capitalizeFirstChar',
            })}
          </SectionTitle>
          <Spacer height="16px" />
          <PublishNewContainer>
            <PublishButton onClick={() => setMode('publish-app')}>
              <AppsIcon
                sx={{ fontSize: '32px', color: theme.palette.primary.main }}
              />
              <Typography
                sx={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: theme.palette.text.primary,
                }}
              >
                {t('core:developer.publish_app', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </PublishButton>
            <PublishButton onClick={() => setMode('publish-website')}>
              <LanguageIcon
                sx={{ fontSize: '32px', color: theme.palette.secondary.main }}
              />
              <Typography
                sx={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: theme.palette.text.primary,
                }}
              >
                {t('core:developer.publish_site', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </PublishButton>
          </PublishNewContainer>
        </Box>

        {/* Developer Note */}
        <Box
          sx={{
            padding: '16px',
            borderRadius: '8px',
            backgroundColor: theme.palette.action.hover,
          }}
        >
          <Typography
            sx={{
              fontSize: '13px',
              color: theme.palette.text.secondary,
              fontStyle: 'italic',
            }}
          >
            {t('core:message.generic.one_app_per_name', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      </SectionContainer>
    </AppsWidthLimiter>
  );
};
