import { Box, ButtonBase, useTheme } from '@mui/material';
import { HomeIcon } from '../assets/Icons/HomeIcon';
import { Save } from './Save/Save';
import { IconWrapper } from './Desktop/DesktopFooter';
import { useRecoilState } from 'recoil';
import { enabledDevModeAtom } from '../atoms/global';
import { AppsIcon } from '../assets/Icons/AppsIcon';
import ThemeSelector from './Theme/ThemeSelector';
import { CoreSyncStatus } from './CoreSyncStatus';
import LanguageSelector from './Language/LanguageSelector';
import { MessagingIconFilled } from '../assets/Icons/MessagingIconFilled';

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
  const [isEnabledDevMode, setIsEnabledDevMode] =
    useRecoilState(enabledDevModeAtom);

  const theme = useTheme();

  console.log('test', desktopViewMode === 'home');

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: '25px',
        height: '100vh',
        width: '60px',
        backgroundColor: theme.palette.background.surface,
        borderRight: `1px solid ${theme.palette.border.subtle}`,
      }}
    >
      <ButtonBase
        sx={{
          width: '70px',
          height: '70px',
          paddingTop: '23px',
        }}
      >
        <CoreSyncStatus />
      </ButtonBase>

      <ButtonBase
        sx={{
          width: '60px',
          height: '60px',
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
          label="Apps"
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
          label="Chat"
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
            label="Dev"
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
