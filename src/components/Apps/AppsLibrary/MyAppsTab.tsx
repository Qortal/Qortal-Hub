import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  Typography,
  styled,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppsIcon from '@mui/icons-material/Apps';
import LanguageIcon from '@mui/icons-material/Language';
import AddIcon from '@mui/icons-material/Add';
import { useAtomValue, useSetAtom } from 'jotai';
import { userInfoAtom } from '../../../atoms/global';
import { publishEditTargetAtom } from '../../../atoms/appsAtoms';
import { getBaseApiReact } from '../../../App';
import { AppsWidthLimiter } from '../Apps-styles';
import { Spacer } from '../../../common/Spacer';
import { PublishedAppCard } from '../AppCard';

interface MyAppsTabProps {
  myName: string;
  availableQapps: any[];
  setMode: (mode: string) => void;
  searchValue?: string;
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
  width: '320px',
  minHeight: '220px',
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
  searchValue = '',
}: MyAppsTabProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const userInfo = useAtomValue(userInfoAtom);
  const setPublishEditTarget = useSetAtom(publishEditTargetAtom);
  const myAddress = userInfo?.address ?? null;
  const [myNames, setMyNames] = useState<string[]>([]);
  const [namesLoaded, setNamesLoaded] = useState(false);

  const getNames = useCallback(async () => {
    if (!myAddress) {
      setMyNames([]);
      setNamesLoaded(true);
      return;
    }
    try {
      const res = await fetch(
        `${getBaseApiReact()}/names/address/${myAddress}?limit=0`
      );
      const data = await res.json();
      setMyNames(data?.map((item: { name: string }) => item.name) ?? []);
    } catch (error) {
      console.error(error);
    } finally {
      setNamesLoaded(true);
    }
  }, [myAddress]);

  useEffect(() => {
    setNamesLoaded(false);
    getNames();
  }, [getNames]);

  // Find user's published apps and websites (all names), applying search filter
  const myApps = useMemo(() => {
    if (!myNames.length || !availableQapps) return [];
    const nameSet = new Set(myNames);
    let result = availableQapps.filter(
      (app) =>
        nameSet.has(app.name) &&
        (app.service === 'APP' || app.service?.includes('APP'))
    );
    if (searchValue) {
      const searchLower = searchValue.toLowerCase();
      result = result.filter(
        (app) =>
          app.name.toLowerCase().includes(searchLower) ||
          (app?.metadata?.title &&
            app.metadata.title.toLowerCase().includes(searchLower)) ||
          (app?.metadata?.description &&
            app.metadata.description.toLowerCase().includes(searchLower))
      );
    }
    return result;
  }, [myNames, availableQapps, searchValue]);

  const myWebsites = useMemo(() => {
    if (!myNames.length || !availableQapps) return [];
    const nameSet = new Set(myNames);
    let result = availableQapps.filter(
      (app) =>
        nameSet.has(app.name) &&
        (app.service === 'WEBSITE' || app.service?.includes('WEBSITE'))
    );
    if (searchValue) {
      const searchLower = searchValue.toLowerCase();
      result = result.filter(
        (app) =>
          app.name.toLowerCase().includes(searchLower) ||
          (app?.metadata?.title &&
            app.metadata.title.toLowerCase().includes(searchLower)) ||
          (app?.metadata?.description &&
            app.metadata.description.toLowerCase().includes(searchLower))
      );
    }
    return result;
  }, [myNames, availableQapps, searchValue]);

  const isLoadingNames = myAddress != null && !namesLoaded;
  const hasNoNames =
    myAddress != null && namesLoaded && myNames.length === 0;

  if (isLoadingNames) {
    return (
      <AppsWidthLimiter>
        <EmptyStateBox>
          <CircularProgress sx={{ mb: 2 }} />
          <Typography
            sx={{
              fontSize: '14px',
              color: theme.palette.text.secondary,
            }}
          >
            {t('core:loading.generic', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </EmptyStateBox>
      </AppsWidthLimiter>
    );
  }

  if (!myAddress || hasNoNames) {
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
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
              {myApps.map((app) => (
                <PublishedAppCard
                  key={`${app.service}-${app.name}`}
                  app={app}
                  onUpdate={() => {
                    setPublishEditTarget({
                      name: app.name,
                      service:
                        app.service === 'WEBSITE' ||
                        app.service?.includes?.('WEBSITE')
                          ? 'WEBSITE'
                          : 'APP',
                    });
                    setMode('publish');
                  }}
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
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
              {myWebsites.map((site) => (
                <PublishedAppCard
                  key={`${site.service}-${site.name}`}
                  app={site}
                  onUpdate={() => {
                    setPublishEditTarget({
                      name: site.name,
                      service:
                        site.service === 'WEBSITE' ||
                        site.service?.includes?.('WEBSITE')
                          ? 'WEBSITE'
                          : 'APP',
                    });
                    setMode('publish');
                  }}
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
