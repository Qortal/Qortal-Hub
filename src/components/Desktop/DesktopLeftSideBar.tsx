import { Box, ButtonBase, useTheme } from '@mui/material';
import { HomeIcon } from '../../assets/Icons/HomeIcon';
import { Save } from '../Save/Save';
import { IconWrapper } from './DesktopFooter';
import {
  enabledDevModeAtom,
  hasUnreadGroupsAtom,
  isNewTabWindowAtom,
} from '../../atoms/global';
import { useAtom, useAtomValue } from 'jotai';
import { AppsIcon } from '../../assets/Icons/AppsIcon';
import ThemeSelector from '../Theme/ThemeSelector';
import { CoreSyncStatus } from '../CoreSyncStatus';
import LanguageSelector from '../Language/LanguageSelector';
import { MessagingIconFilled } from '../../assets/Icons/MessagingIconFilled';
import { useTranslation } from 'react-i18next';
import { AppsNavBarDesktop } from '../Apps/AppsNavBarDesktop';
import { AppsDevModeNavBar } from '../Apps/AppsDevModeNavBar';
import { executeEvent } from '../../utils/events';
import { appHeighOffsetPx } from './CustomTitleBar';

export const DesktopSideBar = ({
  goToHome,
  setDesktopSideView,
  toggleSideViewDirects,
  hasUnreadDirects,
  isDirects,
  toggleSideViewGroups,
  isGroups,
  isApps,
  setDesktopViewMode,
  desktopViewMode,
  lastQappViewMode,
  mode,
  setMode,
}) => {
  const [isNewTabWindow] = useAtom(isNewTabWindowAtom);
  const hasUnreadGroups = useAtomValue(hasUnreadGroupsAtom);
  const [isEnabledDevMode, setIsEnabledDevMode] = useAtom(enabledDevModeAtom);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  return (
    <Box
      sx={{
        alignItems: 'center',
        backgroundColor: theme.palette.background.default,
        borderRight: `1px solid ${theme.palette.border.subtle}`,
        display: 'flex',
        flexDirection: 'column',
        gap: '25px',
        height: `calc(100vh - ${appHeighOffsetPx})`,
        width: 'auto', // must adapt to the chosen language
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
          borderRadius: '8px',
          height: '60px',
          width: '60px',
          ...(desktopViewMode === 'home' && {
            backgroundColor: theme.palette.action.selected,
          }),
          '&:hover': {
            backgroundColor: theme.palette.action.hover,
          },
        }}
        onClick={() => {
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
        sx={{
          borderRadius: '8px',
          height: '60px',
          width: '60px',
          ...(isApps && {
            backgroundColor: theme.palette.action.selected,
          }),
          '&:hover': {
            backgroundColor: theme.palette.action.hover,
          },
        }}
        onClick={() => {
          isApps
            ? executeEvent('newTabWindow', {})
            : setDesktopViewMode('apps');
        }}
      >
        <IconWrapper
          label={t('core:app_other', { postProcess: 'capitalizeFirstChar' })}
          disableWidth
          noBackground
          selected={isApps}
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
        sx={{
          borderRadius: '8px',
          height: '60px',
          width: '60px',
          ...(desktopViewMode === 'chat' && {
            backgroundColor: theme.palette.action.selected,
          }),
          '&:hover': {
            backgroundColor: theme.palette.action.hover,
          },
        }}
        onClick={() => {
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
          noBackground
          selected={desktopViewMode === 'chat'}
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

      {isEnabledDevMode && (
        <ButtonBase
          sx={{
            borderRadius: '8px',
            height: '60px',
            width: '60px',
            ...(desktopViewMode === 'dev' && {
              backgroundColor: theme.palette.action.selected,
            }),
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
            },
          }}
          onClick={() => {
            desktopViewMode === 'dev'
              ? executeEvent('devModeNewTabWindow', {})
              : setDesktopViewMode('dev');
          }}
        >
          <IconWrapper
            label={t('core:dev', { postProcess: 'capitalizeFirstChar' })}
            disableWidth
            noBackground
            selected={desktopViewMode === 'dev'}
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
