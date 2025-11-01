import { Box, ButtonBase, useTheme } from '@mui/material';
import { HomeIcon } from '../../assets/Icons/HomeIcon';
import { Save } from '../Save/Save';
import { IconWrapper } from './DesktopFooter';
import { enabledDevModeAtom, isNewTabWindowAtom } from '../../atoms/global';
import { AppsIcon } from '../../assets/Icons/AppsIcon';
import ThemeSelector from '../Theme/ThemeSelector';
import { CoreSyncStatus } from '../CoreSyncStatus';
import LanguageSelector from '../Language/LanguageSelector';
import { MessagingIconFilled } from '../../assets/Icons/MessagingIconFilled';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { AppsNavBarDesktop } from '../Apps/AppsNavBarDesktop';
import { AppsDevModeNavBar } from '../Apps/AppsDevModeNavBar';
import { executeEvent } from '../../utils/events';

export const DesktopSideBar = ({
  goToHome,
  setDesktopSideView,
  toggleSideViewDirects,
  hasUnreadDirects,
  isDirects,
  toggleSideViewGroups,
  hasUnreadGroups,
  isGroups,
  isApps,
  setDesktopViewMode,
  desktopViewMode,
  myName,
  lastQappViewMode,
  mode,
}) => {
  const [isNewTabWindow] = useAtom(isNewTabWindowAtom);

  const [isEnabledDevMode, setIsEnabledDevMode] = useAtom(enabledDevModeAtom);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const setAppsSectionToNewWindow = () => {
    executeEvent('devModeNewTabWindow', {});
    executeEvent('newTabWindow', {});
  };

  return (
    <Box
      sx={{
        alignItems: 'center',
        backgroundColor: theme.palette.background.default,
        borderRight: `1px solid ${theme.palette.border.subtle}`,
        display: 'flex',
        flexDirection: 'column',
        gap: '25px',
        height: '100vh',
        width: 'auto', // must adapt to the choosen language
      }}
    >
      <ButtonBase
        sx={{
          height: '70px',
          paddingTop: '23px',
          width: '70px',
        }}
      >
        <CoreSyncStatus />
      </ButtonBase>

      <ButtonBase
        sx={{
          height: '60px',
          width: '60px',
        }}
        onClick={() => {
          setAppsSectionToNewWindow();
          goToHome();
        }}
      >
        <HomeIcon
          height={34}
          color={
            desktopViewMode === 'home'
              ? theme.palette.text.primary
              : theme.palette.text.secondary
          }
        />
      </ButtonBase>

      <ButtonBase
        onClick={() => {
          setAppsSectionToNewWindow();
          setDesktopViewMode('apps');
        }}
      >
        <IconWrapper
          label={t('core:app_other', { postProcess: 'capitalizeFirstChar' })}
          disableWidth
        >
          <AppsIcon
            color={
              isApps ? theme.palette.text.primary : theme.palette.text.secondary
            }
            height={30}
          />
        </IconWrapper>
      </ButtonBase>

      <ButtonBase
        onClick={() => {
          setAppsSectionToNewWindow();
          setDesktopViewMode('chat');
        }}
      >
        <IconWrapper
          color={
            hasUnreadDirects || hasUnreadGroups
              ? theme.palette.other.unread
              : desktopViewMode === 'chat'
                ? theme.palette.text.primary
                : theme.palette.text.secondary
          }
          label={t('core:chat', { postProcess: 'capitalizeFirstChar' })}
          disableWidth
        >
          <MessagingIconFilled
            height={30}
            color={
              hasUnreadDirects || hasUnreadGroups
                ? theme.palette.other.unread
                : desktopViewMode === 'chat'
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary
            }
          />
        </IconWrapper>
      </ButtonBase>

      <Save isDesktop disableWidth myName={myName} />

      {isEnabledDevMode && (
        <ButtonBase
          onClick={() => {
            setAppsSectionToNewWindow();
            setDesktopViewMode('dev');
          }}
        >
          <IconWrapper
            label={t('core:dev', { postProcess: 'capitalizeFirstChar' })}
            disableWidth
          >
            <AppsIcon
              height={30}
              color={
                desktopViewMode === 'dev'
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        </ButtonBase>
      )}

      {lastQappViewMode === 'dev' ? (
        <AppsDevModeNavBar
          disableBack={desktopViewMode !== 'dev'}
          isDev={desktopViewMode === 'dev'}
        />
      ) : (
        <AppsNavBarDesktop
          disableBack={!isApps || isNewTabWindow}
          isApps={isApps}
        />
      )}

      <Box
        sx={{
          alignItems: 'flex-start',
          bottom: '1%',
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          width: 'auto',
        }}
      >
        <Box sx={{ alignSelf: 'left' }}>
          <LanguageSelector />
        </Box>

        <Box sx={{ alignSelf: 'center' }}>
          <ThemeSelector />
        </Box>
      </Box>
    </Box>
  );
};
