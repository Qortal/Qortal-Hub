import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AppCircle,
  AppCircleContainer,
  AppCircleLabel,
  AppLibrarySubTitle,
  AppsContainer,
  AppsLibraryContainer,
  AppsParent,
  AppsSearchContainer,
  AppsSearchLeft,
  AppsSearchRight,
  AppsWidthLimiter,
  PublishQAppCTAButton,
  PublishQAppCTALeft,
  PublishQAppCTAParent,
  PublishQAppCTARight,
  PublishQAppDotsBG,
} from "./Apps-styles";
import { Avatar, Box, ButtonBase, InputBase, styled } from "@mui/material";
import { Add } from "@mui/icons-material";
import { MyContext, getBaseApiReact } from "../../App";
import LogoSelected from "../../assets/svgs/LogoSelected.svg";
import IconSearch from "../../assets/svgs/Search.svg";
import IconClearInput from "../../assets/svgs/ClearInput.svg";
import qappDevelopText from "../../assets/svgs/qappDevelopText.svg";
import qappDots from "../../assets/svgs/qappDots.svg";

import { Spacer } from "../../common/Spacer";
import { AppInfoSnippet } from "./AppInfoSnippet";
import { Virtuoso } from "react-virtuoso";
import { executeEvent } from "../../utils/events";
const officialAppList = [
  "q-tube",
  "q-blog",
  "q-share",
  "q-support",
  "q-mail",
  "qombo",
  "q-fund",
  "q-shop",
  "q-trade",
  "q-support",
  "nodeinfo"
];

const ScrollerStyled = styled('div')({
    // Hide scrollbar for WebKit browsers (Chrome, Safari)
    "::-webkit-scrollbar": {
      width: "0px",
      height: "0px",
    },
    
    // Hide scrollbar for Firefox
    scrollbarWidth: "none",
  
    // Hide scrollbar for IE and older Edge
    "-ms-overflow-style": "none",
  });
  
  const StyledVirtuosoContainer = styled('div')({
    position: 'relative',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    
    // Hide scrollbar for WebKit browsers (Chrome, Safari)
    "::-webkit-scrollbar": {
      width: "0px",
      height: "0px",
    },
    
    // Hide scrollbar for Firefox
    scrollbarWidth: "none",
  
    // Hide scrollbar for IE and older Edge
    "-ms-overflow-style": "none",
  });

export const AppsCategory = ({  availableQapps,  myName, category, isShow }) => {
  const [searchValue, setSearchValue] = useState("");
  const virtuosoRef = useRef();
  const { rootHeight } = useContext(MyContext);


  
  const categoryList = useMemo(() => {
    return availableQapps.filter(
      (app) =>
        app?.metadata?.category === category?.id
    );
  }, [availableQapps, category]);

  const [debouncedValue, setDebouncedValue] = useState(""); // Debounced value

  // Debounce logic
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(searchValue);
    }, 350);

    // Cleanup timeout if searchValue changes before the timeout completes
    return () => {
      clearTimeout(handler);
    };
  }, [searchValue]); // Runs effect when searchValue changes

  // Example: Perform search or other actions based on debouncedValue

  const searchedList = useMemo(() => {
    if (!debouncedValue) return categoryList
    return categoryList.filter((app) =>
      app.name.toLowerCase().includes(debouncedValue.toLowerCase())
    );
  }, [debouncedValue, categoryList]);

  const rowRenderer = (index) => {
   
    let app = searchedList[index];
    return <AppInfoSnippet key={`${app?.service}-${app?.name}`} app={app} myName={myName} isFromCategory={true} />;
  };



  return (
      <AppsLibraryContainer sx={{
        display: !isShow && 'none'
      }}>
        <AppsWidthLimiter>
        <Box
          sx={{
            display: "flex",
            width: "100%",
            justifyContent: "center",
          }}
        >
          <AppsSearchContainer>
            <AppsSearchLeft>
              <img src={IconSearch} />
              <InputBase
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                sx={{ ml: 1, flex: 1 }}
                placeholder="Search for apps"
                inputProps={{
                  "aria-label": "Search for apps",
                  fontSize: "16px",
                  fontWeight: 400,
                }}
              />
            </AppsSearchLeft>
            <AppsSearchRight>
              {searchValue && (
                <ButtonBase
                  onClick={() => {
                    setSearchValue("");
                  }}
                >
                  <img src={IconClearInput} />
                </ButtonBase>
              )}
            </AppsSearchRight>
          </AppsSearchContainer>
        </Box>
        </AppsWidthLimiter>
        <Spacer height="25px" />
        <AppsWidthLimiter>
            <AppLibrarySubTitle>{`Category: ${category?.name}`}</AppLibrarySubTitle>
            
            <Spacer height="25px" />
            </AppsWidthLimiter>
           <AppsWidthLimiter>
          <StyledVirtuosoContainer sx={{
            height: rootHeight
          }}>
            <Virtuoso
              ref={virtuosoRef}
              data={searchedList}
              itemContent={rowRenderer}
              atBottomThreshold={50}
              followOutput="smooth"
              components={{
                Scroller: ScrollerStyled // Use the styled scroller component
              }}
            />
          </StyledVirtuosoContainer>
          </AppsWidthLimiter>
        
      </AppsLibraryContainer>
  );
};
