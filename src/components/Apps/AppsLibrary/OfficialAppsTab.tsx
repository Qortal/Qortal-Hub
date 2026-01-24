import { useMemo } from 'react';
import { Box, Typography, styled, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { AppLibrarySubTitle, AppsWidthLimiter } from '../Apps-styles';
import { Spacer } from '../../../common/Spacer';
import { AppCardEnhanced, FeaturedAppBanner } from '../AppCard';
import {
  officialAppList,
  officialAppsConfig,
} from '../config/officialApps';

const AppsGrid = styled(Box)({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: '16px',
  width: '100%',
});

const SectionHeader = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  marginBottom: '20px',
});

interface OfficialAppsTabProps {
  availableQapps: any[];
  myName?: string;
}

export const OfficialAppsTab = ({
  availableQapps,
  myName = '',
}: OfficialAppsTabProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  // Filter to get only official apps
  const officialApps = useMemo(() => {
    return availableQapps.filter(
      (app) =>
        app.service === 'APP' &&
        officialAppList.includes(app?.name?.toLowerCase())
    );
  }, [availableQapps]);

  // Get featured apps for the carousel
  const featuredApps = useMemo(() => {
    return officialApps.filter((app) =>
      officialAppsConfig.featured.includes(app?.name?.toLowerCase())
    );
  }, [officialApps]);

  return (
    <AppsWidthLimiter>
      {/* Featured Apps Carousel */}
      {featuredApps.length > 0 && (
        <>
          <AppLibrarySubTitle
            sx={{
              fontSize: '20px',
              marginBottom: '24px',
            }}
          >
            {t('core:official_apps.featured', {
              postProcess: 'capitalizeFirstChar',
              defaultValue: 'Featured',
            })}
          </AppLibrarySubTitle>

          <FeaturedAppBanner featuredApps={featuredApps} />

          <Spacer height="40px" />
        </>
      )}

      {/* All Official Apps Grid */}
      <SectionHeader>
        <AppLibrarySubTitle
          sx={{
            fontSize: '20px',
          }}
        >
          {t('core:apps_official', {
            postProcess: 'capitalizeFirstChar',
          })}{' '}
          <Typography
            component="span"
            sx={{
              fontSize: '16px',
              color: theme.palette.text.secondary,
              fontWeight: 400,
            }}
          >
            ({officialApps.length})
          </Typography>
        </AppLibrarySubTitle>
      </SectionHeader>

      <AppsGrid>
        {officialApps.map((app) => (
          <AppCardEnhanced
            key={`${app?.service}-${app?.name}`}
            app={app}
            myName={myName}
          />
        ))}
      </AppsGrid>
    </AppsWidthLimiter>
  );
};
