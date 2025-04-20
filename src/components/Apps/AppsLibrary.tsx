import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppCircle,
  AppCircleContainer,
  AppCircleLabel,
  AppLibrarySubTitle,
  AppsContainer,
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
  styled,
  useTheme,
} from '@mui/material';
import { MyContext, getBaseApiReact } from '../../App';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import IconSearch from '../../assets/svgs/Search.svg';
import IconClearInput from '../../assets/svgs/ClearInput.svg';
import qappDevelopText from '../../assets/svgs/qappDevelopText.svg';
import qappDots from '../../assets/svgs/qappDots.svg';
// import { Return } from './assets/svgs/Return.tsx';
import ReturnSVG from '../../assets/svgs/Return.svg';
import { Spacer } from '../../common/Spacer';
import { AppInfoSnippet } from './AppInfoSnippet';
import { Virtuoso } from 'react-virtuoso';
import { executeEvent } from '../../utils/events';
import {
  ComposeP,
  MailIconImg,
  ShowMessageReturnButton,
} from '../Group/Forum/Mail-styles';

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
  'q-wallets',
  'q-search',
  'q-nodecontrol',
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
  '-msOverflowStyle': 'none',
});

const StyledVirtuosoContainer = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  width: '100%',

  // Hide scrollbar for WebKit browsers (Chrome, Safari)
  '::-webkit-scrollbar': {
    width: '0px',
    height: '0px',
  },

  // Hide scrollbar for Firefox
  scrollbarWidth: 'none',

  // Hide scrollbar for IE and older Edge
  '-msOverflowStyle': 'none',
});

export const AppsLibrary = ({
  availableQapps,
  setMode,
  myName,
  hasPublishApp,
  isShow,
  categories = { categories },
}) => {
  const [searchValue, setSearchValue] = useState('');
  const virtuosoRef = useRef();
  const { rootHeight } = useContext(MyContext);

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
    }, 350);

    // Cleanup timeout if searchValue changes before the timeout completes
    return () => {
      clearTimeout(handler);
    };
  }, [searchValue]); // Runs effect when searchValue changes

  // Example: Perform search or other actions based on debouncedValue

  const searchedList = useMemo(() => {
    if (!debouncedValue) return [];
    return availableQapps.filter((app) =>
      app.name.toLowerCase().includes(debouncedValue.toLowerCase())
    );
  }, [debouncedValue]);

  const rowRenderer = (index) => {
    let app = searchedList[index];
    return (
      <AppInfoSnippet
        key={`${app?.service}-${app?.name}`}
        app={app}
        myName={myName}
      />
    );
  };

  const theme = useTheme();

  return (
    <AppsLibraryContainer
      sx={{
        display: !isShow && 'none',
      }}
    >
      <AppsWidthLimiter>
        <Box
          sx={{
            display: 'flex',
            width: '100%',
            justifyContent: 'center',
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
                  'aria-label': 'Search for apps',
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
        </Box>
      </AppsWidthLimiter>

      <Spacer height="25px" />

      <ShowMessageReturnButton
        sx={{
          padding: '2px',
        }}
        onClick={() => {
          executeEvent('navigateBack', {});
        }}
      >
        <MailIconImg src={ReturnSVG} /> // TODO return icon
        <ComposeP>Return to Apps Dashboard</ComposeP>
      </ShowMessageReturnButton>

      <Spacer height="25px" />

      {searchedList?.length > 0 ? (
        <AppsWidthLimiter>
          <StyledVirtuosoContainer
            sx={{
              height: rootHeight,
            }}
          >
            <Virtuoso
              ref={virtuosoRef}
              data={searchedList}
              itemContent={rowRenderer}
              atBottomThreshold={50}
              followOutput="smooth"
              components={{
                Scroller: ScrollerStyled, // Use the styled scroller component
              }}
            />
          </StyledVirtuosoContainer>
        </AppsWidthLimiter>
      ) : (
        <>
          <AppsWidthLimiter>
            <AppLibrarySubTitle>Official Apps</AppLibrarySubTitle>

            <Spacer height="18px" />

            <AppsContainer>
              {officialApps?.map((qapp) => {
                return (
                  <ButtonBase
                    sx={{
                      height: '80px',
                      width: '60px',
                    }}
                    onClick={() => {
                      // executeEvent("addTab", {
                      //   data: qapp
                      // })
                      executeEvent('selectedAppInfo', {
                        data: qapp,
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
                            height: '31px',
                            width: '31px',
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

            <Spacer height="30px" />

            <AppLibrarySubTitle>
              {hasPublishApp ? 'Update Apps!' : 'Create Apps!'}
            </AppLibrarySubTitle>

            <Spacer height="18px" />
          </AppsWidthLimiter>

          <PublishQAppCTAParent>
            <PublishQAppCTALeft>
              <PublishQAppDotsBG>
                <img src={qappDots} />
              </PublishQAppDotsBG>

              <Spacer width="29px" />

              <img src={qappDevelopText} />
            </PublishQAppCTALeft>

            <PublishQAppCTARight
              onClick={() => {
                setMode('publish');
              }}
            >
              <PublishQAppCTAButton>
                {hasPublishApp ? 'Update' : 'Publish'}
              </PublishQAppCTAButton>

              <Spacer width="20px" />
            </PublishQAppCTARight>
          </PublishQAppCTAParent>

          <AppsWidthLimiter>
            <Spacer height="18px" />

            <AppLibrarySubTitle>Categories</AppLibrarySubTitle>

            <Spacer height="18px" />

            <AppsWidthLimiter
              sx={{
                flexDirection: 'row',
                overflowX: 'auto',
                width: '100%',
                gap: '5px',
                '::-webkit-scrollbar': {
                  width: '0px',
                  height: '0px',
                },

                // Hide scrollbar for Firefox
                scrollbarWidth: 'none',

                // Hide scrollbar for IE and older Edge
                '-msOverflowStyle': 'none',
              }}
            >
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
                        background: theme.palette.background.default,
                        borderRadius: '11px',
                        color: theme.palette.text.primary,
                        display: 'flex',
                        flexShrink: 0,
                        fontSize: '16px',
                        fontWeight: 700,
                        height: '110px',
                        justifyContent: 'center',
                        width: '110px',
                      }}
                    >
                      {category?.name}
                    </Box>
                  </ButtonBase>
                );
              })}
            </AppsWidthLimiter>
          </AppsWidthLimiter>
        </>
      )}
    </AppsLibraryContainer>
  );
};
