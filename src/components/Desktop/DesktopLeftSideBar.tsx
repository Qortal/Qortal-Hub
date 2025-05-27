import { Box, ButtonBase, useTheme } from '@mui/material';
import { HomeIcon } from '../../assets/Icons/HomeIcon';
import { Save } from '../Save/Save';
import { IconWrapper } from './DesktopFooter';
import { enabledDevModeAtom } from '../../atoms/global';
import { AppsIcon } from '../../assets/Icons/AppsIcon';
import ThemeSelector from '../Theme/ThemeSelector';
import { CoreSyncStatus } from '../CoreSyncStatus';
import LanguageSelector from '../Language/LanguageSelector';
import { MessagingIconFilled } from '../../assets/Icons/MessagingIconFilled';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

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
}) => {
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
        height: '100vh',
        width: '60px',
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
          setDesktopViewMode('apps');
        }}
      >
        <IconWrapper
          color={
            isApps ? theme.palette.text.primary : theme.palette.text.secondary
          }
          label={t('core:app_other', { postProcess: 'capitalizeFirstChar' })}
          selected={isApps}
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
            setDesktopViewMode('dev');
          }}
        >
          <IconWrapper
            color={
              desktopViewMode === 'dev'
                ? theme.palette.text.primary
                : theme.palette.text.secondary
            }
            label={t('core:dev', { postProcess: 'capitalizeFirstChar' })}
            disableWidth
          >
            <AppsIcon height={30} color={theme.palette.text.secondary} />
          </IconWrapper>
        </ButtonBase>
      )}

      <LanguageSelector />

      <ThemeSelector />
    </Box>
  );
};
