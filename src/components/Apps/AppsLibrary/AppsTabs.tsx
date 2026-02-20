import { Box, Tab, Tabs, styled } from '@mui/material';
import { useTranslation } from 'react-i18next';

export type AppsLibraryTabValue =
  | 'official'
  | 'community'
  | 'categories'
  | 'my-apps'
  | 'private';

interface AppsTabsProps {
  currentTab: AppsLibraryTabValue;
  onTabChange: (tab: AppsLibraryTabValue) => void;
}

const StyledTabs = styled(Tabs)(({ theme }) => ({
  backgroundColor: theme.palette.background.paper,
  borderRadius: '8px',
  minHeight: '42px',
  padding: '4px',
  '& .MuiTabs-indicator': {
    display: 'none',
  },
  '& .MuiTabs-flexContainer': {
    gap: '4px',
  },
}));

const StyledTab = styled(Tab)(({ theme }) => ({
  borderRadius: '6px',
  color: theme.palette.text.secondary,
  fontSize: '14px',
  fontWeight: 500,
  minHeight: '34px',
  padding: '8px 16px',
  textTransform: 'none',
  transition: 'all 0.2s ease',
  '&.Mui-selected': {
    backgroundColor: theme.palette.background.default,
    color: theme.palette.text.primary,
  },
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
}));

const TabsContainer = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  display: 'flex',
  justifyContent: 'center',
  padding: '16px 0',
  width: '100%',
}));

export const AppsTabs = ({ currentTab, onTabChange }: AppsTabsProps) => {
  const { t } = useTranslation(['core']);

  const handleChange = (_event: React.SyntheticEvent, newValue: string) => {
    onTabChange(newValue as AppsLibraryTabValue);
  };

  return (
    <TabsContainer>
      <StyledTabs
        value={currentTab}
        onChange={handleChange}
        aria-label={t('core:aria.apps_library_tabs', {
          defaultValue: 'Apps library navigation tabs',
        })}
      >
        <StyledTab
          value="official"
          label={t('core:tabs.official_apps', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
        <StyledTab
          value="community"
          label={t('core:tabs.community_apps', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
        <StyledTab
          value="categories"
          label={t('core:tabs.categories', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
        <StyledTab
          value="my-apps"
          label={t('core:tabs.my_apps', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
        <StyledTab
          value="private"
          label={t('core:tabs.add_private', {
            postProcess: 'capitalizeFirstChar',
          })}
        />
      </StyledTabs>
    </TabsContainer>
  );
};
