import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppLibrarySubTitle,
  AppsDesktopLibraryBody,
  AppsDesktopLibraryHeader,
  AppsLibraryContainer,
  AppsSearchContainer,
  AppsSearchLeft,
  AppsSearchRight,
  AppsWidthLimiter,
} from './Apps-styles';
import { ButtonBase, InputBase, styled, useTheme } from '@mui/material';
import { MyContext } from '../../App';
import SearchIcon from '@mui/icons-material/Search';
import IconClearInput from '../../assets/svgs/ClearInput.svg';
import { Spacer } from '../../common/Spacer';
import { AppInfoSnippet } from './AppInfoSnippet';
import { Virtuoso } from 'react-virtuoso';

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

export const AppsCategoryDesktop = ({
  availableQapps,
  myName,
  category,
  isShow,
}) => {
  const [searchValue, setSearchValue] = useState('');
  const virtuosoRef = useRef();
  const theme = useTheme();
  const { rootHeight } = useContext(MyContext);

  const categoryList = useMemo(() => {
    if (category?.id === 'all') return availableQapps;
    return availableQapps.filter(
      (app) => app?.metadata?.category === category?.id
    );
  }, [availableQapps, category]);

  const [debouncedValue, setDebouncedValue] = useState(''); // Debounced value

  // Debounce logic
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(searchValue);
    }, 350);
    setTimeout(() => {
      if (virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({ index: 0 });
      }
    }, 500);
    // Cleanup timeout if searchValue changes before the timeout completes
    return () => {
      clearTimeout(handler);
    };
  }, [searchValue]); // Runs effect when searchValue changes

  // Example: Perform search or other actions based on debouncedValue

  const searchedList = useMemo(() => {
    if (!debouncedValue) return categoryList;
    return categoryList.filter(
      (app) =>
        app.name.toLowerCase().includes(debouncedValue.toLowerCase()) ||
        (app?.metadata?.title &&
          app?.metadata?.title
            ?.toLowerCase()
            .includes(debouncedValue.toLowerCase()))
    );
  }, [debouncedValue, categoryList]);

  const rowRenderer = (index) => {
    let app = searchedList[index];
    return (
      <AppInfoSnippet
        key={`${app?.service}-${app?.name}`}
        app={app}
        myName={myName}
        isFromCategory={true}
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
        height: '100vh',
        overflow: 'hidden',
        padding: '0px',
        paddingTop: '30px',
      }}
    >
      <AppsDesktopLibraryHeader
        sx={{
          maxWidth: '1200px',
          width: '90%',
        }}
      >
        <AppsWidthLimiter
          sx={{
            alignItems: 'flex-end',
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
        </AppsWidthLimiter>
      </AppsDesktopLibraryHeader>

      <AppsDesktopLibraryBody
        sx={{
          alignItems: 'center',
          height: `calc(100vh - 36px)`,
          overflow: 'auto',
          padding: '0px',
          width: '70%',
        }}
      >
        <Spacer height="25px" />

        <AppsWidthLimiter>
          <AppLibrarySubTitle>{`Category: ${category?.name}`}</AppLibrarySubTitle>

          <Spacer height="25px" />
        </AppsWidthLimiter>

        <AppsWidthLimiter>
          <StyledVirtuosoContainer
            sx={{
              height: `calc(100vh - 36px - 90px - 25px)`,
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
      </AppsDesktopLibraryBody>
    </AppsLibraryContainer>
  );
};
