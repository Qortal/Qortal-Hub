import { useMemo } from 'react';
import { Box, Tab, Tabs, styled } from '@mui/material';
import { alpha, ThemeProvider, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import {
  LIBRARY_EASE,
  libraryAccent,
  libraryFocusRing,
  libraryMuted,
  REDUCED_MOTION,
  usePrefersReducedMotion,
} from './libraryStyles';

export type AppsLibraryTabValue =
  | 'official'
  | 'community'
  | 'categories'
  | 'widgets'
  | 'my-apps'
  | 'private';

interface AppsTabsProps {
  currentTab: AppsLibraryTabValue;
  isSearchActive?: boolean;
  onTabChange: (tab: AppsLibraryTabValue) => void;
  /** Links each tab to its panel: `<prefix>-tab-<tab>`, `<prefix>-panel-<tab>`. */
  idPrefix?: string;
}

const StyledTabs = styled(Tabs)(({ theme }) => ({
  backgroundColor: alpha(theme.palette.background.paper, 0.72),
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: '14px',
  boxSizing: 'border-box',
  maxWidth: '100%',
  minHeight: '42px',
  padding: '3px',
  width: 'fit-content',
  '& .MuiTabs-flexContainer': {
    gap: '2px',
  },
  // The selected tab's pill slides from one tab to the next.
  '& .MuiTabs-indicator': {
    backgroundColor: alpha(theme.palette.primary.main, 0.18),
    borderRadius: '11px',
    bottom: 'auto',
    height: '100%',
    top: 0,
    transition: `left 240ms ${LIBRARY_EASE}, width 240ms ${LIBRARY_EASE}`,
    zIndex: 0,
    [REDUCED_MOTION]: { transition: 'none' },
  },
  '& .MuiTabs-scrollButtons': {
    borderRadius: '10px',
    color: libraryMuted(theme),
    width: 28,
    '&.Mui-disabled': { opacity: 0 },
  },
}));

const StyledTab = styled(Tab)(({ theme }) => ({
  borderRadius: '11px',
  color: libraryMuted(theme),
  cursor: 'default',
  fontSize: '14px',
  fontWeight: 500,
  height: '36px',
  minHeight: '36px',
  padding: '0 14px',
  position: 'relative',
  textTransform: 'none',
  transition: 'color 160ms, background-color 160ms',
  zIndex: 1,
  '&:hover:not(.Mui-selected)': {
    backgroundColor: alpha(theme.palette.text.primary, 0.05),
    color: theme.palette.text.primary,
  },
  '&.Mui-selected': {
    color: libraryAccent(theme),
  },
  '&.Mui-focusVisible': libraryFocusRing(theme, -2),
}));

const TabsContainer = styled(Box)({
  alignItems: 'center',
  display: 'flex',
  justifyContent: 'flex-start',
  minWidth: 0,
  padding: 0,
  width: '100%',
});

export const AppsTabs = ({
  currentTab,
  isSearchActive = false,
  onTabChange,
  idPrefix,
}: AppsTabsProps) => {
  const { t } = useTranslation(['core']);
  const theme = useTheme();
  const reduce = usePrefersReducedMotion();
  // A narrow strip scrolls; MUI glides it for `duration.standard`. With less
  // motion it moves in one frame instead (0 would read as NaN in MUI's step).
  const stillTheme = useMemo(
    () =>
      reduce
        ? {
            ...theme,
            transitions: {
              ...theme.transitions,
              duration: { ...theme.transitions.duration, standard: 1 },
            },
          }
        : null,
    [reduce, theme]
  );

  const handleChange = (_event: React.SyntheticEvent, newValue: string) => {
    onTabChange(newValue as AppsLibraryTabValue);
  };

  const linkProps = (value: AppsLibraryTabValue) =>
    idPrefix
      ? {
          'aria-controls': `${idPrefix}-panel-${value}`,
          id: `${idPrefix}-tab-${value}`,
        }
      : {};

  const tabs = (
    <StyledTabs
      allowScrollButtonsMobile
      aria-label={t('core:aria.apps_library_tabs', {
        postProcess: 'capitalizeFirstChar',
      })}
      onChange={handleChange}
      scrollButtons="auto"
      value={isSearchActive ? false : currentTab}
      variant="scrollable"
    >
      <StyledTab
        disableRipple
        {...linkProps('official')}
        value="official"
        label={t('core:tabs.official_apps', {
          postProcess: 'capitalizeFirstChar',
        })}
      />
      <StyledTab
        disableRipple
        {...linkProps('community')}
        value="community"
        label={t('core:tabs.community_apps', {
          postProcess: 'capitalizeFirstChar',
        })}
      />
      <StyledTab
        disableRipple
        {...linkProps('categories')}
        value="categories"
        label={t('core:tabs.categories', {
          postProcess: 'capitalizeFirstChar',
        })}
      />
      <StyledTab
        disableRipple
        {...linkProps('widgets')}
        value="widgets"
        label={t('core:tabs.widgets', {
          postProcess: 'capitalizeFirstChar',
        })}
      />
      <StyledTab
        disableRipple
        {...linkProps('my-apps')}
        value="my-apps"
        label={t('core:tabs.my_apps', {
          postProcess: 'capitalizeFirstChar',
        })}
      />
      <StyledTab
        disableRipple
        {...linkProps('private')}
        value="private"
        label={t('core:tabs.add_private', {
          postProcess: 'capitalizeFirstChar',
        })}
      />
    </StyledTabs>
  );

  return (
    <TabsContainer>
      {stillTheme ? (
        <ThemeProvider theme={stillTheme}>{tabs}</ThemeProvider>
      ) : (
        tabs
      )}
    </TabsContainer>
  );
};
