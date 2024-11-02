import React, { useMemo, useState } from "react";
import {
  AppCircle,
  AppCircleContainer,
  AppCircleLabel,
  AppLibrarySubTitle,
  AppsContainer,
  AppsParent,
} from "./Apps-styles";
import { Avatar, ButtonBase } from "@mui/material";
import { Add } from "@mui/icons-material";
import { getBaseApiReact, isMobile } from "../../App";
import LogoSelected from "../../assets/svgs/LogoSelected.svg";
import { executeEvent } from "../../utils/events";
import { Spacer } from "../../common/Spacer";
import { SortablePinnedApps } from "./SortablePinnedApps";

export const AppsHomeDesktop = ({
  setMode,
  myApp,
  myWebsite,
  availableQapps,
}) => {
  return (
    <>
     <AppsContainer
        sx={{
        
          justifyContent: "flex-start",
        }}
      >
      <AppLibrarySubTitle
        sx={{
          fontSize: "30px",
        }}
      >
        Apps Dashboard
      </AppLibrarySubTitle>
      </AppsContainer>
      <Spacer height="45px" />
      <AppsContainer
        sx={{
          gap: "75px",
          justifyContent: "flex-start",
        }}
      >
        <ButtonBase
          onClick={() => {
            setMode("library");
          }}
        >
          <AppCircleContainer
            sx={{
              gap: !isMobile ? "10px" : "5px",
            }}
          >
            <AppCircle>
              <Add>+</Add>
            </AppCircle>
            <AppCircleLabel>Library</AppCircleLabel>
          </AppCircleContainer>
        </ButtonBase>

        <SortablePinnedApps
          isDesktop={true}
          availableQapps={availableQapps}
          myWebsite={myWebsite}
          myApp={myApp}
        />
      </AppsContainer>
    </>
  );
};
