import React, { useEffect, useMemo, useState } from 'react';
import {
  AppCircle,
  AppCircleContainer,
  AppCircleLabel,
  AppDownloadButton,
  AppDownloadButtonText,
  AppInfoAppName,
  AppInfoSnippetContainer,
  AppInfoSnippetLeft,
  AppInfoSnippetMiddle,
  AppInfoSnippetRight,
  AppInfoUserName,
  AppsCategoryInfo,
  AppsCategoryInfoLabel,
  AppsCategoryInfoSub,
  AppsCategoryInfoValue,
  AppsInfoDescription,
  AppsLibraryContainer,
  AppsParent,
  AppsWidthLimiter,
} from './Apps-styles';
import { Avatar, Box, ButtonBase, InputBase } from '@mui/material';
import { Add } from '@mui/icons-material';
import { getBaseApiReact, isMobile } from '../../App';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';

import { Spacer } from '../../common/Spacer';
import { executeEvent } from '../../utils/events';
import { AppRating } from './AppRating';
import {
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../atoms/global';
import { saveToLocalStorage } from './AppsNavBarDesktop';
import { useRecoilState, useSetRecoilState } from 'recoil';

export const AppInfo = ({ app, myName }) => {
  const isInstalled = app?.status?.status === 'READY';
  const [sortablePinnedApps, setSortablePinnedApps] = useRecoilState(
    sortablePinnedAppsAtom
  );

  const isSelectedAppPinned = !!sortablePinnedApps?.find(
    (item) => item?.name === app?.name && item?.service === app?.service
  );
  const setSettingsLocalLastUpdated = useSetRecoilState(
    settingsLocalLastUpdatedAtom
  );

  return (
    <AppsLibraryContainer
      sx={{
        height: !isMobile && '100%',
        justifyContent: !isMobile && 'flex-start',
        alignItems: isMobile && 'center',
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
        {!isMobile && <Spacer height="30px" />}
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
            <AppInfoSnippetRight></AppInfoSnippetRight>
          </AppInfoSnippetContainer>
          <Spacer height="11px" />
          <Box
            sx={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '20px',
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
                backgroundColor: '#359ff7ff',
                width: '100%',
                maxWidth: '320px',
                height: '29px',
                opacity: isSelectedAppPinned ? 0.6 : 1,
              }}
            >
              <AppDownloadButtonText>
                {!isMobile ? (
                  <>
                    {isSelectedAppPinned
                      ? 'Unpin from dashboard'
                      : 'Pin to dashboard'}
                  </>
                ) : (
                  <>{isSelectedAppPinned ? 'Unpin' : 'Pin'}</>
                )}
              </AppDownloadButtonText>
            </AppDownloadButton>
            <AppDownloadButton
              onClick={() => {
                executeEvent('addTab', {
                  data: app,
                });
              }}
              sx={{
                backgroundColor: isInstalled ? '#0091E1' : '#247C0E',
                width: '100%',
                maxWidth: '320px',
                height: '29px',
              }}
            >
              <AppDownloadButtonText>
                {isInstalled ? 'Open' : 'Download'}
              </AppDownloadButtonText>
            </AppDownloadButton>
          </Box>
        </AppsWidthLimiter>
        <Spacer height="20px" />
        <AppsWidthLimiter>
          <AppsCategoryInfo>
            <AppRating ratingCountPosition="top" myName={myName} app={app} />
            <Spacer width="16px" />
            <Spacer height="40px" width="1px" backgroundColor="white" />
            <Spacer width="16px" />
            <AppsCategoryInfoSub>
              <AppsCategoryInfoLabel>Category:</AppsCategoryInfoLabel>
              <Spacer height="4px" />
              <AppsCategoryInfoValue>
                {app?.metadata?.categoryName || 'none'}
              </AppsCategoryInfoValue>
            </AppsCategoryInfoSub>
          </AppsCategoryInfo>
          <Spacer height="30px" />
          <AppInfoAppName>About this Q-App</AppInfoAppName>
        </AppsWidthLimiter>
        <Spacer height="20px" />
        <AppsInfoDescription>
          {app?.metadata?.description || 'No description'}
        </AppsInfoDescription>
      </Box>
    </AppsLibraryContainer>
  );
};
