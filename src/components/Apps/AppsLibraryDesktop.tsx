import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { Avatar, Box, ButtonBase, InputBase, Typography, styled } from "@mui/material";
import { Add } from "@mui/icons-material";
import { MyContext, getBaseApiReact } from "../../App";
import LogoSelected from "../../assets/svgs/LogoSelected.svg";
import IconSearch from "../../assets/svgs/Search.svg";
import IconClearInput from "../../assets/svgs/ClearInput.svg";
import qappDevelopText from "../../assets/svgs/qappDevelopText.svg";
import qappLibraryText from "../../assets/svgs/qappLibraryText.svg";
import RefreshIcon from "@mui/icons-material/Refresh";

import qappDots from "../../assets/svgs/qappDots.svg";

import { Spacer } from "../../common/Spacer";
import { AppInfoSnippet } from "./AppInfoSnippet";
import { Virtuoso } from "react-virtuoso";
import { executeEvent } from "../../utils/events";
import {
  AppsDesktopLibraryBody,
  AppsDesktopLibraryHeader,
} from "./AppsDesktop-styles";
import { AppsNavBarDesktop } from "./AppsNavBarDesktop";
import ReturnSVG from '../../assets/svgs/Return.svg'
import { ComposeP, MailIconImg, ShowMessageReturnButton } from "../Group/Forum/Mail-styles";
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
  "nodeinfo",
  "q-manager",
  "q-mintership"
];

const ScrollerStyled = styled("div")({
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

const StyledVirtuosoContainer = styled("div")({
  position: "relative",
  width: "100%",
  display: "flex",
  flexDirection: "column",

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

export const AppsLibraryDesktop = ({
  availableQapps,
  setMode,
  myName,
  hasPublishApp,
  isShow,
  categories,
  getQapps
}) => {
  const [searchValue, setSearchValue] = useState("");
  const virtuosoRef = useRef();

  const officialApps = useMemo(() => {
    return availableQapps.filter(
      (app) =>
        app.service === "APP" &&
        officialAppList.includes(app?.name?.toLowerCase())
    );
  }, [availableQapps]);

  const [debouncedValue, setDebouncedValue] = useState(""); // Debounced value

  // Debounce logic
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(searchValue);
    }, 350);
    setTimeout(() => {
      virtuosoRef.current.scrollToIndex({
        index: 0
      });
    }, 500);
    // Cleanup timeout if searchValue changes before the timeout completes
    return () => {
      clearTimeout(handler);
    };
  }, [searchValue]); // Runs effect when searchValue changes

  // Example: Perform search or other actions based on debouncedValue

  const searchedList = useMemo(() => {
    if (!debouncedValue) return [];
    return availableQapps.filter((app) =>
      app.name.toLowerCase().includes(debouncedValue.toLowerCase()) || (app?.metadata?.title && app?.metadata?.title?.toLowerCase().includes(debouncedValue.toLowerCase()))
    );
  }, [debouncedValue]);

  const rowRenderer = (index) => {
    let app = searchedList[index];
    return (
      <AppInfoSnippet
        key={`${app?.service}-${app?.name}`}
        app={app}
        myName={myName}
        parentStyles={{
          padding: '0px 10px'
        }}
      />
    );
  };

  return (
    <AppsLibraryContainer
      sx={{
        display: !isShow && "none",
        padding: "0px",
        height: "100vh",
        overflow: "hidden",
        paddingTop: '30px'
      }}
    >
  
      <AppsDesktopLibraryHeader
        sx={{
          maxWidth: "1500px",
          width: "90%",
        }}
      >
        <AppsWidthLimiter>
          <Box
            sx={{
              display: "flex",
              width: "100%",
              justifyContent: "space-between",
            }}
          >
            <img src={qappLibraryText} />
            <Box sx={{
              display: 'flex',
              gap: '20px',
              alignItems: 'center'
            }}>
            <AppsSearchContainer
              sx={{
                width: "412px",
              }}
            >
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
            <ButtonBase
          onClick={(e) => {
            getQapps()
          }}
        >
          <RefreshIcon
             
              sx={{
                color: "rgba(250, 250, 250, 0.5)",
                width: '40px',
                height: 'auto'
              }}
            />
        </ButtonBase>
            </Box>
        
          </Box>
        </AppsWidthLimiter>
      </AppsDesktopLibraryHeader>
      <AppsDesktopLibraryBody
        sx={{
          height: `calc(100vh - 36px)`,
          overflow: "auto",
          padding: "0px",
          alignItems: "center",
        }}
      >
        <AppsDesktopLibraryBody
          sx={{
            height: `calc(100vh - 36px)`,
            flexGrow: "unset",
            maxWidth: "1500px",
            width: "90%",
          }}
        >
           
          <Spacer height="70px" />
          <ShowMessageReturnButton sx={{
            padding: '2px'
          }} onClick={() => {
            executeEvent("navigateBack", {});
                  }}>
                    <MailIconImg src={ReturnSVG} />
                    <ComposeP>Return to Apps Dashboard</ComposeP>
                  </ShowMessageReturnButton>
                  <Spacer height="20px" />
          {searchedList?.length > 0 ? (
            <AppsWidthLimiter>
              <StyledVirtuosoContainer
                sx={{
                  height: `calc(100vh - 36px - 90px - 90px)`,
                }}
              >
                <Virtuoso
                  ref={virtuosoRef}
                  data={searchedList}
                  itemContent={rowRenderer}
                  atBottomThreshold={50}
                  followOutput="smooth"
                  // components={{
                  //   Scroller: ScrollerStyled, // Use the styled scroller component
                  // }}
                />
              </StyledVirtuosoContainer>
            </AppsWidthLimiter>
          ) : searchedList?.length === 0 && debouncedValue ? (
            <AppsWidthLimiter>
              <Typography>No results</Typography>
            </AppsWidthLimiter>
          ) : (
            <>
              <AppLibrarySubTitle
                sx={{
                  fontSize: "30px",
                }}
              >
                Official Apps
              </AppLibrarySubTitle>
              <Spacer height="45px" />
              <AppsContainer sx={{
                gap: '50px',
                justifyContent: 'flex-start'
              }}>
                {officialApps?.map((qapp) => {
                  return (
                    <ButtonBase
                      sx={{
                        // height: "80px",
                        width: "80px",
                      }}
                      onClick={() => {
                        // executeEvent("addTab", {
                        //   data: qapp
                        // })
                        executeEvent("selectedAppInfo", {
                          data: qapp,
                        });
                      }}
                    >
                      <AppCircleContainer
                        sx={{
                          gap: "10px",
                        }}
                      >
                        <AppCircle
                          sx={{
                            border: "none",
                          }}
                        >
                          <Avatar
                            sx={{
                              height: "42px",
                              width: "42px",
                            }}
                            alt={qapp?.name}
                            src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
                              qapp?.name
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
                        <AppCircleLabel>
                          {qapp?.metadata?.title || qapp?.name}
                        </AppCircleLabel>
                      </AppCircleContainer>
                    </ButtonBase>
                  );
                })}
              </AppsContainer>
              <Spacer height="80px" />
              <Box
                sx={{
                  width: "100%",
                  gap: "250px",
                  display: "flex",
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <AppLibrarySubTitle
                    sx={{
                      fontSize: "30px",
                      width: "100%",
                      textAlign: "start",
                    }}
                  >
                    {hasPublishApp ? "Update Apps!" : "Create Apps!"}
                  </AppLibrarySubTitle>
                  <Spacer height="18px" />
                  <PublishQAppCTAParent
                    sx={{
                      gap: "25px",
                    }}
                  >
                    <PublishQAppCTALeft>
                      <PublishQAppDotsBG>
                        <img src={qappDots} />
                      </PublishQAppDotsBG>
                      <Spacer width="29px" />
                      <img src={qappDevelopText} />
                    </PublishQAppCTALeft>
                    <PublishQAppCTARight
                      onClick={() => {
                        setMode("publish");
                      }}
                    >
                      <PublishQAppCTAButton>
                        {hasPublishApp ? "Update" : "Publish"}
                      </PublishQAppCTAButton>
                      <Spacer width="20px" />
                    </PublishQAppCTARight>
                  </PublishQAppCTAParent>
                </Box>
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <AppLibrarySubTitle
                    sx={{
                      fontSize: "30px",
                    }}
                  >
                    Categories
                  </AppLibrarySubTitle>
                  <Spacer height="18px" />
                  <Box
                    sx={{
                      width: "100%",
                      display: "flex",
                      gap: "20px",
                      flexWrap: "wrap",
                    }}
                  >
                     <ButtonBase
                        
                          onClick={() => {
                            executeEvent("selectedCategory", {
                              data: {
                                id: 'all',
                                name: 'All'
                              },
                            });
                          }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              height: "60px",
                              padding: "0px 24px",
                              border: "4px solid #10242F",
                              borderRadius: "6px",
                              boxShadow: "2px 4px 0px 0px #000000",
                            }}
                          >
                            All
                          </Box>
                        </ButtonBase>
                    {categories?.map((category) => {
                      return (
                        <ButtonBase
                          key={category?.id}
                          onClick={() => {
                            executeEvent("selectedCategory", {
                              data: category,
                            });
                          }}
                        >
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              height: "60px",
                              padding: "0px 24px",
                              border: "4px solid #10242F",
                              borderRadius: "6px",
                              boxShadow: "2px 4px 0px 0px #000000",
                            }}
                          >
                            {category?.name}
                          </Box>
                        </ButtonBase>
                      );
                    })}
                  </Box>
                </Box>
              </Box>
            </>
          )}
        </AppsDesktopLibraryBody>
      </AppsDesktopLibraryBody>
    </AppsLibraryContainer>
  );
};
