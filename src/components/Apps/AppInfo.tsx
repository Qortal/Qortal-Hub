import {
  AppCircle,
  AppCircleContainer,
  AppDownloadButton,
  AppDownloadButtonText,
  AppInfoAppName,
  AppInfoSnippetContainer,
  AppInfoSnippetLeft,
  AppInfoSnippetMiddle,
  AppInfoUserName,
  AppsCategoryInfo,
  AppsCategoryInfoLabel,
  AppsCategoryInfoSub,
  AppsCategoryInfoValue,
  AppsInfoDescription,
  AppsLibraryContainer,
  AppsWidthLimiter,
} from './Apps-styles';
import { Avatar, Box, useTheme } from '@mui/material';
import { getBaseApiReact } from '../../App';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import DefaultAppImage from '../../assets/qortal-grey.png';
import { Spacer } from '../../common/Spacer';
import { executeEvent } from '../../utils/events';
import { AppRating } from './AppRating';
import {
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../atoms/global';
import { saveToLocalStorage } from './AppsNavBarDesktop';
import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

export const AppInfo = ({ app, myName }) => {
  const isInstalled = app?.status?.status === 'READY';
  const [sortablePinnedApps, setSortablePinnedApps] = useAtom(
    sortablePinnedAppsAtom
  );

  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const isSelectedAppPinned = !!sortablePinnedApps?.find(
    (item) => item?.name === app?.name && item?.service === app?.service
  );
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);

  return (
    <AppsLibraryContainer
      sx={{
        height: '100%',
        justifyContent: 'flex-start',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          maxWidth: '500px',
          width: '90%',
        }}
      >
        <Spacer height="30px" />

        <AppsWidthLimiter>
          <AppInfoSnippetContainer>
            <AppInfoSnippetLeft
              sx={{
                flexGrow: 1,
                gap: '18px',
              }}
            >
              <AppCircleContainer
                sx={{
                  width: 'auto',
                }}
              >
                <AppCircle
                  sx={{
                    border: 'none',
                    height: '100px',
                    width: '100px',
                  }}
                >
                  <Avatar
                    sx={{
                      height: '43px',
                      width: '43px',
                      '& img': {
                        objectFit: 'fill',
                      },
                    }}
                    alt={app?.name}
                    src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
                      app?.name
                    }/qortal_avatar?async=true`}
                  >
                    <img
                      style={{
                        width: '43px',
                        height: 'auto',
                      }}
                      src={LogoSelected}
                      alt="center-icon"
                    />
                  </Avatar>
                </AppCircle>
              </AppCircleContainer>

              <AppInfoSnippetMiddle>
                <AppInfoAppName>
                  {app?.metadata?.title || app?.name}
                </AppInfoAppName>

                <Spacer height="6px" />

                <AppInfoUserName>{app?.name}</AppInfoUserName>

                <Spacer height="3px" />
              </AppInfoSnippetMiddle>
            </AppInfoSnippetLeft>
          </AppInfoSnippetContainer>

          <Spacer height="11px" />

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: '20px',
              width: '100%',
            }}
          >
            <AppDownloadButton
              onClick={() => {
                setSortablePinnedApps((prev) => {
                  let updatedApps;

                  if (isSelectedAppPinned) {
                    // Remove the selected app if it is pinned
                    updatedApps = prev.filter(
                      (item) =>
                        !(
                          item?.name === app?.name &&
                          item?.service === app?.service
                        )
                    );
                  } else {
                    // Add the selected app if it is not pinned
                    updatedApps = [
                      ...prev,
                      {
                        name: app?.name,
                        service: app?.service,
                      },
                    ];
                  }

                  saveToLocalStorage(
                    'ext_saved_settings',
                    'sortablePinnedApps',
                    updatedApps
                  );
                  return updatedApps;
                });
                setSettingsLocalLastUpdated(Date.now());
              }}
              sx={{
                backgroundColor: theme.palette.background.paper,
                height: '29px',
                maxWidth: '320px',
                opacity: isSelectedAppPinned ? 0.6 : 1,
                width: '100%',
              }}
            >
              <AppDownloadButtonText>
                {isSelectedAppPinned
                  ? t('core:action.unpin_from_dashboard', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('core:action.pin_from_dashboard', {
                      postProcess: 'capitalizeFirstChar',
                    })}
              </AppDownloadButtonText>
            </AppDownloadButton>

            <AppDownloadButton
              onClick={() => {
                executeEvent('addTab', {
                  data: app,
                });
              }}
              sx={{
                backgroundColor: isInstalled
                  ? theme.palette.primary.main
                  : theme.palette.background.paper,
                height: '29px',
                maxWidth: '320px',
                width: '100%',
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
          </Box>
        </AppsWidthLimiter>

        <Spacer height="20px" />

        <AppsWidthLimiter>
          <AppsCategoryInfo>
            <AppRating ratingCountPosition="top" myName={myName} app={app} />

            <Spacer width="16px" />

            <Spacer
              backgroundColor={theme.palette.background.paper}
              height="40px"
              width="1px"
            />

            <Spacer width="16px" />

            <AppsCategoryInfoSub>
              <AppsCategoryInfoLabel>
                {t('core:category', {
                  postProcess: 'capitalizeFirstChar',
                })}
                :
              </AppsCategoryInfoLabel>

              <Spacer height="4px" />

              <AppsCategoryInfoValue>
                {app?.metadata?.categoryName ||
                  t('core:none', {
                    postProcess: 'capitalizeFirstChar',
                  })}
              </AppsCategoryInfoValue>
            </AppsCategoryInfoSub>
          </AppsCategoryInfo>

          <Spacer height="30px" />

          <AppInfoAppName>
            {t('core:q_apps.about', {
              postProcess: 'capitalizeFirstChar',
            })}
          </AppInfoAppName>
        </AppsWidthLimiter>

        <Spacer height="20px" />

        <AppsInfoDescription>
          {app?.metadata?.description ||
            t('core:message.generic.no_description', {
              postProcess: 'capitalizeFirstChar',
            })}
        </AppsInfoDescription>
      </Box>
    </AppsLibraryContainer>
  );
};
