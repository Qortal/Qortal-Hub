import React from "react";
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
} from "./Apps-styles";
import { Avatar,  ButtonBase } from "@mui/material";
import { getBaseApiReact, isMobile } from "../../App";
import LogoSelected from "../../assets/svgs/LogoSelected.svg";

import { Spacer } from "../../common/Spacer";
import { executeEvent } from "../../utils/events";
import { AppRating } from "./AppRating";
import { useRecoilState, useSetRecoilState } from "recoil";
import { settingsLocalLastUpdatedAtom, sortablePinnedAppsAtom } from "../../atoms/global";
import { saveToLocalStorage } from "./AppsNavBar";

export const AppInfoSnippet = ({ app, myName, isFromCategory, parentStyles = {} }) => {

  const isInstalled = app?.status?.status === 'READY'
   const [sortablePinnedApps, setSortablePinnedApps] = useRecoilState(sortablePinnedAppsAtom);

  const isSelectedAppPinned = !!sortablePinnedApps?.find((item)=> item?.name === app?.name && item?.service === app?.service)
  const setSettingsLocalLastUpdated = useSetRecoilState(settingsLocalLastUpdatedAtom);
  return (
    <AppInfoSnippetContainer sx={{
      ...parentStyles
    }}>
      <AppInfoSnippetLeft>
      <ButtonBase
        sx={{
          height: "80px",
          width: "60px",
        }}
        onClick={()=> {
          if(isFromCategory){
            executeEvent("selectedAppInfoCategory", {
              data: app,
            });
            return
          }
          executeEvent("selectedAppInfo", {
            data: app,
          });
        }}
      >
        <AppCircleContainer>
          <AppCircle
            sx={{
              border: "none",
            }}
          >
            <Avatar
              sx={{
                height: "31px",
                width: "31px",
                '& img': { 
                  objectFit: 'fill',
                }
              }}
              alt={app?.name}
              src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
                app?.name
              }/qortal_avatar?async=true`}
            >
              <img
                style={{
                  width: "31px",
                  height: "auto",
                }}
                src={LogoSelected}
                alt="center-icon"
              />
            </Avatar>
          </AppCircle>
        </AppCircleContainer>
      </ButtonBase>
      <AppInfoSnippetMiddle>
        
        <ButtonBase onClick={()=> {
           if(isFromCategory){
            executeEvent("selectedAppInfoCategory", {
              data: app,
            });
            return
          }
          executeEvent("selectedAppInfo", {
            data: app,
          });
        }}>
        <AppInfoAppName   >
        {app?.metadata?.title || app?.name}
        </AppInfoAppName>
        </ButtonBase>
        <Spacer height="6px" />
        <AppInfoUserName>
        { app?.name}
          </AppInfoUserName>
          <Spacer height="3px" />
          <AppRating app={app} myName={myName} />
      </AppInfoSnippetMiddle>
      </AppInfoSnippetLeft>
      <AppInfoSnippetRight sx={{
        gap: '10px'
      }}>
        {!isMobile && (
               <AppDownloadButton onClick={()=> {
          
                setSortablePinnedApps((prev) => {
                    let updatedApps;
            
                    if (isSelectedAppPinned) {
                        // Remove the selected app if it is pinned
                        updatedApps = prev.filter(
                            (item) => !(item?.name === app?.name && item?.service === app?.service)
                        );
                    } else {
                        // Add the selected app if it is not pinned
                        updatedApps = [...prev, {
                            name: app?.name,
                            service: app?.service,
                        }];
                    }
            
                    saveToLocalStorage('ext_saved_settings', 'sortablePinnedApps', updatedApps)
                    return updatedApps;
                });
                setSettingsLocalLastUpdated(Date.now())
              }}  sx={{
          backgroundColor: '#359ff7ff',
                            opacity: isSelectedAppPinned ? 0.6 : 1
      
        }}>
          <AppDownloadButtonText> {isSelectedAppPinned ? 'Unpin' : 'Pin'}</AppDownloadButtonText>
        </AppDownloadButton>
          )}
 
        <AppDownloadButton onClick={()=> {
          
                executeEvent("addTab", {
                  data: app
                })
              }}  sx={{
          backgroundColor: isInstalled ? '#0091E1' : '#247C0E',
        
        }}>
          <AppDownloadButtonText>{isInstalled ? 'Open' : 'Download'}</AppDownloadButtonText>
        </AppDownloadButton>
      </AppInfoSnippetRight>
    </AppInfoSnippetContainer>
  );
};
