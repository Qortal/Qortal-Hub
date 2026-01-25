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
import { ButtonBase, InputBase, useTheme } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import IconClearInput from '../../assets/svgs/ClearInput.svg';
import { Spacer } from '../../common/Spacer';
import { AppCardEnhanced } from './AppCard';
import { useTranslation } from 'react-i18next';
import { ComposeP, ShowMessageReturnButton } from '../Group/Forum/Mail-styles';
import { executeEvent } from '../../utils/events';
import { ReturnIcon } from '../../assets/Icons/ReturnIcon';

export const AppsCategoryDesktop = ({
  availableQapps,
  myName,
  category,
  isShow,
}) => {
  const [searchValue, setSearchValue] = useState('');
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
            aliginItems: 'center',
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
          <AppLibrarySubTitle>{`Category: ${category?.name}`}</AppLibrarySubTitle>

          <Spacer height="25px" />
        </AppsWidthLimiter>

        <AppsWidthLimiter>
          <AppCardsGrid>
            {searchedList.map((app) => (
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
