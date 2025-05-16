import React from 'react';
import {
  AppCircle,
  AppCircleContainer,
  AppDownloadButton,
  AppDownloadButtonText,
  AppInfoAppName,
  AppInfoSnippetContainer,
  AppInfoSnippetLeft,
  AppInfoSnippetMiddle,
  AppInfoSnippetRight,
  AppInfoUserName,
} from './Apps-styles';
import { Avatar, ButtonBase, useTheme } from '@mui/material';
import { getBaseApiReact } from '../../App';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
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

export const AppInfoSnippet = ({
  app,
  myName,
  isFromCategory,
  parentStyles = {},
}) => {
  const isInstalled = app?.status?.status === 'READY';
  const [sortablePinnedApps, setSortablePinnedApps] = useAtom(
    sortablePinnedAppsAtom
  );
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);

  const isSelectedAppPinned = !!sortablePinnedApps?.find(
    (item) => item?.name === app?.name && item?.service === app?.service
  );

  const theme = useTheme();
  const { t } = useTranslation(['core', 'auth', 'group']);

  return (
    <AppInfoSnippetContainer
      sx={{
        ...parentStyles,
      }}
    >
      <AppInfoSnippetLeft>
        <ButtonBase
          sx={{
            height: '80px',
            width: '60px',
          }}
          onClick={() => {
            if (isFromCategory) {
              executeEvent('selectedAppInfoCategory', {
                data: app,
              });
              return;
            }
            executeEvent('selectedAppInfo', {
              data: app,
            });
          }}
        >
          <AppCircleContainer>
            <AppCircle
              sx={{
                border: 'none',
              }}
            >
              <Avatar
                sx={{
                  height: '42px',
                  width: '42px',
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
                    width: '31px',
                    height: 'auto',
                  }}
                  src={LogoSelected}
                  alt="center-icon"
                />
              </Avatar>
            </AppCircle>
          </AppCircleContainer>
        </ButtonBase>

        <AppInfoSnippetMiddle>
          <ButtonBase
            onClick={() => {
              if (isFromCategory) {
                executeEvent('selectedAppInfoCategory', {
                  data: app,
                });
                return;
              }
              executeEvent('selectedAppInfo', {
                data: app,
              });
            }}
          >
            <AppInfoAppName>{app?.metadata?.title || app?.name}</AppInfoAppName>
          </ButtonBase>

          <Spacer height="6px" />

          <AppInfoUserName>{app?.name}</AppInfoUserName>

          <Spacer height="3px" />

          <AppRating app={app} myName={myName} />
        </AppInfoSnippetMiddle>
      </AppInfoSnippetLeft>

      <AppInfoSnippetRight
        sx={{
          gap: '10px',
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
                      item?.name === app?.name && item?.service === app?.service
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
            opacity: isSelectedAppPinned ? 0.6 : 1,
          }}
        >
          <AppDownloadButtonText>
            {isSelectedAppPinned
              ? t('core:action.unpin', {
                  postProcess: 'capitalizeFirst',
                })
              : t('core:action.pin', {
                  postProcess: 'capitalizeFirst',
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
          }}
        >
          <AppDownloadButtonText>
            {isInstalled
              ? t('core:action.open', {
                  postProcess: 'capitalizeFirst',
                })
              : t('core:action.download', {
                  postProcess: 'capitalizeFirst',
                })}
          </AppDownloadButtonText>
        </AppDownloadButton>
      </AppInfoSnippetRight>
    </AppInfoSnippetContainer>
  );
};
