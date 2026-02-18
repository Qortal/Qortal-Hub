import { useEffect, useMemo, useState } from 'react';
import {
  AppCardsGrid,
  AppLibrarySubTitle,
  AppsDesktopLibraryBody,
  AppsDesktopLibraryHeader,
  AppsLibraryContainer,
  AppsSearchContainer,
  AppsSearchLeft,
  AppsSearchRight,
  AppsWidthLimiter,
} from './Apps-styles';
import { Box, ButtonBase, InputBase, useTheme } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import IconClearInput from '../../assets/svgs/ClearInput.svg';
import { Spacer } from '../../common/Spacer';
import { AppCardEnhanced } from './AppCard';
import { useTranslation } from 'react-i18next';
import { ComposeP, ShowMessageReturnButton } from '../Group/Forum/Mail-styles';
import { executeEvent } from '../../utils/events';
import { ReturnIcon } from '../../assets/Icons/ReturnIcon';
import { useAtom } from 'jotai';
import { appSortAtom } from '../../atoms/appsAtoms';
import { SortDropdown, SortOption } from './Filters';

// Sorting function (same as CommunityAppsTab)
const sortApps = (apps: any[], sortOption: SortOption): any[] => {
  const sorted = [...apps];

  switch (sortOption) {
    case 'newest':
      return sorted.sort((a, b) => (b.created || 0) - (a.created || 0));
    case 'oldest':
      return sorted.sort((a, b) => (a.created || 0) - (b.created || 0));
    case 'alphabetical':
      return sorted.sort((a, b) => {
        const titleA = (a.metadata?.title || a.name || '').toLowerCase();
        const titleB = (b.metadata?.title || b.name || '').toLowerCase();
        return titleA.localeCompare(titleB);
      });
    default:
      return sorted;
  }
};

export const AppsCategoryDesktop = ({
  availableQapps,
  myName,
  category,
  isShow,
}) => {
  const [searchValue, setSearchValue] = useState('');
  const [sortOption, setSortOption] = useAtom(appSortAtom);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const categoryList = useMemo(() => {
    if (category?.id === 'all') return availableQapps;
    return availableQapps.filter(
      (app) => app?.metadata?.category === category?.id
    );
  }, [availableQapps, category]);

  const [debouncedValue, setDebouncedValue] = useState('');

  // Debounce logic
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(searchValue);
    }, 350);
    return () => {
      clearTimeout(handler);
    };
  }, [searchValue]);

  const searchedAndSortedList = useMemo(() => {
    let result = categoryList;

    if (debouncedValue) {
      result = result.filter(
        (app) =>
          app.name.toLowerCase().includes(debouncedValue.toLowerCase()) ||
          (app?.metadata?.title &&
            app?.metadata?.title
              ?.toLowerCase()
              .includes(debouncedValue.toLowerCase()))
      );
    }

    return sortApps(result, sortOption);
  }, [debouncedValue, categoryList, sortOption]);

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
            justifyContent: 'space-between',
            alignItems: 'center',
            flexDirection: 'row',
          }}
        >
          <ShowMessageReturnButton
            sx={{
              padding: '2px',
            }}
            onClick={() => {
              executeEvent('navigateBack', {});
              setSearchValue('');
            }}
          >
            <ReturnIcon />
            <ComposeP
              sx={{
                fontSize: '18px',
              }}
            >
              {t('core:action.return', {
                postProcess: 'capitalizeFirstChar',
              })}
            </ComposeP>
          </ShowMessageReturnButton>
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
        </AppsWidthLimiter>
      </AppsDesktopLibraryHeader>

      <AppsDesktopLibraryBody
        sx={{
          alignItems: 'center',
          height: `calc(100vh - 36px)`,
          overflow: 'auto',
          padding: '0px',
          width: '90%',
          maxWidth: '1200px',
        }}
      >
        <Spacer height="25px" />

        <AppsWidthLimiter>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%',
            }}
          >
            <AppLibrarySubTitle>{`Category: ${category?.name}`}</AppLibrarySubTitle>
            <SortDropdown value={sortOption} onChange={setSortOption} />
          </Box>

          <Spacer height="25px" />
        </AppsWidthLimiter>

        <AppsWidthLimiter>
          <AppCardsGrid>
            {searchedAndSortedList.map((app) => (
              <AppCardEnhanced
                key={`${app?.service}-${app?.name}`}
                app={app}
                myName={myName}
                isFromCategory={true}
              />
            ))}
          </AppCardsGrid>
          <Spacer height="25px" />
        </AppsWidthLimiter>
      </AppsDesktopLibraryBody>
    </AppsLibraryContainer>
  );
};
