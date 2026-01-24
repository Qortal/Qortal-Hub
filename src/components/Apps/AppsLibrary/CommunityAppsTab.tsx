import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  InputBase,
  ButtonBase,
  Typography,
  styled,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid } from 'react-virtuoso';
import SearchIcon from '@mui/icons-material/Search';
import IconClearInput from '../../../assets/svgs/ClearInput.svg';
import {
  AppsSearchContainer,
  AppsSearchLeft,
  AppsSearchRight,
  AppsWidthLimiter,
} from '../Apps-styles';
import { AppCardEnhanced } from '../AppCard';
import { Spacer } from '../../../common/Spacer';

const officialAppList = [
  'q-tube',
  'q-blog',
  'q-share',
  'q-support',
  'q-mail',
  'q-fund',
  'q-shop',
  'q-trade',
  'q-manager',
  'q-mintership',
  'q-wallets',
  'q-search',
  'q-node',
  'names',
  'q-follow',
  'q-assets',
  'quitter',
];

const GridContainer = styled('div')({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: '16px',
  width: '100%',
  paddingBottom: '20px',
});

const GridItemWrapper = styled('div')({
  display: 'flex',
});

const StyledVirtuosoContainer = styled('div')({
  position: 'relative',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  '::-webkit-scrollbar': {
    width: '0px',
    height: '0px',
  },
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
});

interface CommunityAppsTabProps {
  availableQapps: any[];
  myName: string;
}

export const CommunityAppsTab = ({
  availableQapps,
  myName,
}: CommunityAppsTabProps) => {
  const [searchValue, setSearchValue] = useState('');
  const [debouncedValue, setDebouncedValue] = useState('');
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  // Filter out official apps to show only community apps
  const communityApps = useMemo(() => {
    return availableQapps.filter(
      (app) => !officialAppList.includes(app?.name?.toLowerCase())
    );
  }, [availableQapps]);

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(searchValue);
    }, 350);
    return () => {
      clearTimeout(handler);
    };
  }, [searchValue]);

  const filteredApps = useMemo(() => {
    if (!debouncedValue) return communityApps;
    return communityApps.filter(
      (app) =>
        app.name.toLowerCase().includes(debouncedValue.toLowerCase()) ||
        (app?.metadata?.title &&
          app?.metadata?.title
            ?.toLowerCase()
            .includes(debouncedValue.toLowerCase()))
    );
  }, [debouncedValue, communityApps]);

  return (
    <AppsWidthLimiter>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          marginBottom: '20px',
        }}
      >
        <Typography
          sx={{
            fontSize: '16px',
            color: theme.palette.text.secondary,
          }}
        >
          {t('core:filter.showing_apps', {
            count: filteredApps.length,
            postProcess: 'capitalizeFirstChar',
            defaultValue: 'Showing {{count}} apps',
          })}
        </Typography>

        <AppsSearchContainer
          sx={{
            width: '300px',
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
      </Box>

      <Spacer height="20px" />

      {filteredApps.length > 0 ? (
        <StyledVirtuosoContainer
          sx={{
            height: 'calc(100vh - 350px)',
          }}
        >
          <VirtuosoGrid
            totalCount={filteredApps.length}
            components={{
              List: GridContainer as any,
              Item: GridItemWrapper,
            }}
            itemContent={(index) => {
              const app = filteredApps[index];
              return (
                <AppCardEnhanced
                  key={`${app?.service}-${app?.name}`}
                  app={app}
                  myName={myName}
                />
              );
            }}
          />
        </StyledVirtuosoContainer>
      ) : (
        <Typography>
          {t('core:message.generic.no_results', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      )}
    </AppsWidthLimiter>
  );
};
