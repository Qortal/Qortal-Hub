import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppCircle,
  AppCircleContainer,
  AppCircleLabel,
  AppLibrarySubTitle,
  AppsContainer,
  AppsDesktopLibraryBody,
  AppsDesktopLibraryHeader,
  AppsLibraryContainer,
  AppsSearchContainer,
  AppsSearchLeft,
  AppsSearchRight,
  AppsWidthLimiter,
  PublishQAppCTAButton,
  PublishQAppCTALeft,
  PublishQAppCTAParent,
  PublishQAppCTARight,
  PublishQAppDotsBG,
} from './Apps-styles';
import {
  Avatar,
  Box,
  ButtonBase,
  InputBase,
  Typography,
  styled,
  useTheme,
} from '@mui/material';
import { getBaseApiReact } from '../../App';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import SearchIcon from '@mui/icons-material/Search';
import IconClearInput from '../../assets/svgs/ClearInput.svg';
import { QappDevelopText } from '../../assets/Icons/QappDevelopText.tsx';
import { QappLibraryText } from '../../assets/Icons/QappLibraryText.tsx';
import RefreshIcon from '@mui/icons-material/Refresh';
import AppsIcon from '@mui/icons-material/Apps';
import { Spacer } from '../../common/Spacer';
import { AppInfoSnippet } from './AppInfoSnippet';
import { Virtuoso } from 'react-virtuoso';
import { executeEvent } from '../../utils/events';
import { ComposeP, ShowMessageReturnButton } from '../Group/Forum/Mail-styles';
import { ReturnIcon } from '../../assets/Icons/ReturnIcon.tsx';
import { useTranslation } from 'react-i18next';
import { TIME_MILLISECONDS_400, TIME_MILLISECONDS_500 } from '../../constants/constants.ts';

const officialAppList = [
  'q-tube',
  'q-blog',
  'q-share',
  'q-support',
  'q-mail',
  'q-fund',
  'q-shop',
  'q-trade',
  'q-support',
  'q-manager',
  'q-mintership',
  'q-wallets',
  'q-search',
  'q-node',
  'names',
  'q-follow',
];

const ScrollerStyled = styled('div')({
  // Hide scrollbar for WebKit browsers (Chrome, Safari)
  '::-webkit-scrollbar': {
    width: '0px',
    height: '0px',
  },

  // Hide scrollbar for Firefox
  scrollbarWidth: 'none',

  // Hide scrollbar for IE and older Edge
  msOverflowStyle: 'none',
});

const StyledVirtuosoContainer = styled('div')({
  position: 'relative',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',

  // Hide scrollbar for WebKit browsers (Chrome, Safari)
  '::-webkit-scrollbar': {
    width: '0px',
    height: '0px',
  },

  // Hide scrollbar for Firefox
  scrollbarWidth: 'none',

  // Hide scrollbar for IE and older Edge
  msOverflowStyle: 'none',
});

export const AppsLibraryDesktop = ({
  availableQapps,
  setMode,
  myName,
  hasPublishApp,
  isShow,
  categories,
  getQapps,
}) => {
  const [searchValue, setSearchValue] = useState('');
  const virtuosoRef = useRef(null);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const officialApps = useMemo(() => {
    return availableQapps.filter(
      (app) =>
        app.service === 'APP' &&
        officialAppList.includes(app?.name?.toLowerCase())
    );
  }, [availableQapps]);

  const [debouncedValue, setDebouncedValue] = useState(''); // Debounced value

  // Debounce logic
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(searchValue);
    }, TIME_MILLISECONDS_400);
    setTimeout(() => {
      if (virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({ index: 0 });
      }
    }, TIME_MILLISECONDS_500);
    // Cleanup timeout if searchValue changes before the timeout completes
    return () => {
      clearTimeout(handler);
    };
  }, [searchValue]); // Runs effect when searchValue changes

  // Example: Perform search or other actions based on debouncedValue

  const searchedList = useMemo(() => {
    if (!debouncedValue) return [];
    return availableQapps.filter(
      (app) =>
        app.name.toLowerCase().includes(debouncedValue.toLowerCase()) ||
        (app?.metadata?.title &&
          app?.metadata?.title
            ?.toLowerCase()
            .includes(debouncedValue.toLowerCase()))
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
          padding: '0px 10px',
        }}
      />
    );
  };

  return (
    <AppsLibraryContainer
      sx={{
        display: !isShow && 'none',
        padding: '0px',
        height: '100vh',
        overflow: 'hidden',
        paddingTop: '30px',
      }}
    >
      <AppsDesktopLibraryHeader
        sx={{
          maxWidth: '1500px',
          width: '90%',
        }}
      >
        <AppsWidthLimiter>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <QappLibraryText />
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: '20px',
              }}
            >
              <AppsSearchContainer
                sx={{
                  width: '412px',
                }}
              >
                <AppsSearchLeft>
                  <SearchIcon />

                  <InputBase
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    sx={{
                      background: theme.palette.background.paper,
                      borderRadius: '6px',
                      flex: 1,
                      ml: 1,
                      paddingLeft: '12px',
                    }}
                    placeholder={t('core:action.search_apps', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    inputProps={{
                      'aria-label': t('core:action.search_apps', {
                        postProcess: 'capitalizeFirstChar',
                      }),
                      fontSize: '16px',
                      fontWeight: 400,
                    }}
                  />
                </AppsSearchLeft>

                <AppsSearchRight>
                  {searchValue && (
                    <ButtonBase
                      onClick={() => {
                        setSearchValue('');
                      }}
                    >
                      <img src={IconClearInput} />
                    </ButtonBase>
                  )}
                </AppsSearchRight>
              </AppsSearchContainer>

              <ButtonBase
                onClick={(e) => {
                  getQapps();
                }}
              >
                <RefreshIcon
                  sx={{
                    width: '40px',
                    height: 'auto',
                  }}
                />
              </ButtonBase>
            </Box>
          </Box>
        </AppsWidthLimiter>
      </AppsDesktopLibraryHeader>

      <AppsDesktopLibraryBody
        sx={{
          alignItems: 'center',
          height: `calc(100vh - 36px)`,
          overflow: 'auto',
          padding: '0px',
        }}
      >
        <AppsDesktopLibraryBody
          sx={{
            height: `calc(100vh - 36px)`,
            flexGrow: 'unset',
            maxWidth: '1500px',
            width: '90%',
          }}
        >
          <Spacer height="70px" />

          <ShowMessageReturnButton
            sx={{
              padding: '2px',
            }}
            onClick={() => {
              executeEvent('navigateBack', {});
            }}
          >
            <ReturnIcon />
            <ComposeP>
              {t('core:action.return_apps_dashboard', {
                postProcess: 'capitalizeFirstChar',
              })}
            </ComposeP>
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
              <Typography>
                {t('core:message.generic.no_results', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </AppsWidthLimiter>
          ) : (
            <>
              <AppLibrarySubTitle
                sx={{
                  fontSize: '30px',
                }}
              >
                {t('core:apps_official', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </AppLibrarySubTitle>

              <Spacer height="45px" />

              <AppsContainer
                sx={{
                  gap: '15px',
                  justifyContent: 'center',
                }}
              >
                {officialApps?.map((qapp) => {
                  return (
                    <ButtonBase
                      key={`${qapp?.service}-${qapp?.name}`}
                      sx={{
                        width: '80px',
                      }}
                      onClick={() => {
                        executeEvent('selectedAppInfo', {
                          data: qapp,
                        });
                      }}
                    >
                      <AppCircleContainer
                        sx={{
                          gap: '10px',
                        }}
                      >
                        <AppCircle
                          sx={{
                            border: 'none',
                          }}
                        >
                          <Avatar
                            sx={{
                              height: '42px',
                              width: '42px',
                            }}
                            alt={qapp?.name}
                            src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
                              qapp?.name
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
                  width: '100%',
                  gap: '250px',
                  display: 'flex',
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <AppLibrarySubTitle
                    sx={{
                      fontSize: '30px',
                      width: '100%',
                      textAlign: 'start',
                    }}
                  >
                    {hasPublishApp
                      ? t('core:action.update_app', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : t('core:action.publish_app', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                  </AppLibrarySubTitle>

                  <Spacer height="18px" />

                  <PublishQAppCTAParent
                    sx={{
                      gap: '25px',
                    }}
                  >
                    <PublishQAppCTALeft>
                      <PublishQAppDotsBG>
                        <AppsIcon fontSize="large" />
                      </PublishQAppDotsBG>

                      <Spacer width="29px" />

                      <QappDevelopText />
                    </PublishQAppCTALeft>

                    <PublishQAppCTARight
                      onClick={() => {
                        setMode('publish');
                      }}
                    >
                      <PublishQAppCTAButton>
                        {hasPublishApp
                          ? t('core:action.update', {
                              postProcess: 'capitalizeFirstChar',
                            })
                          : t('core:action.publish', {
                              postProcess: 'capitalizeFirstChar',
                            })}
                      </PublishQAppCTAButton>

                      <Spacer width="20px" />
                    </PublishQAppCTARight>
                  </PublishQAppCTAParent>
                </Box>

                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <AppLibrarySubTitle
                    sx={{
                      fontSize: '30px',
                    }}
                  >
                    {t('core:category_other', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </AppLibrarySubTitle>

                  <Spacer height="18px" />

                  <Box
                    sx={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '20px',
                      width: '100%',
                    }}
                  >
                    <ButtonBase
                      onClick={() => {
                        executeEvent('selectedCategory', {
                          data: {
                            id: 'all',
                            name: 'All',
                          },
                        });
                      }}
                    >
                      <Box
                        sx={{
                          alignItems: 'center',
                          borderColor: theme.palette.background.paper,
                          borderRadius: '6px',
                          borderStyle: 'solid',
                          borderWidth: '4px',
                          display: 'flex',
                          height: '50px',
                          justifyContent: 'center',
                          padding: '0px 20px',
                          '&:hover': {
                            backgroundColor: 'action.hover', // background on hover
                          },
                        }}
                      >
                        {t('core:all', { postProcess: 'capitalizeFirstChar' })}
                      </Box>
                    </ButtonBase>

                    {categories?.map((category) => {
                      return (
                        <ButtonBase
                          key={category?.id}
                          onClick={() => {
                            executeEvent('selectedCategory', {
                              data: category,
                            });
                          }}
                        >
                          <Box
                            sx={{
                              alignItems: 'center',
                              borderColor: theme.palette.background.paper,
                              borderRadius: '6px',
                              borderStyle: 'solid',
                              borderWidth: '4px',
                              display: 'flex',
                              height: '50px',
                              justifyContent: 'center',
                              padding: '0px 20px',
                              '&:hover': {
                                backgroundColor: 'action.hover', // background on hover
                              },
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
