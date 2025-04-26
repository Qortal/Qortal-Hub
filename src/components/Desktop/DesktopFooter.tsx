import { ButtonBase, Typography, useTheme } from '@mui/material';
import Box from '@mui/material/Box';
import { HubsIcon } from '../../assets/Icons/HubsIcon';
import { MessagingIcon } from '../../assets/Icons/MessagingIcon';
import AppIcon from '../../assets/svgs/AppIcon.svg';

import { HomeIcon } from '../../assets/Icons/HomeIcon';
import { Save } from '../Save/Save';
import { useRecoilState } from 'recoil';
import { enabledDevModeAtom } from '../../atoms/global';

export const IconWrapper = ({
  children,
  label,
  color,
  selected,
  disableWidth,
  customWidth,
}) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        alignItems: 'center',
        backgroundColor: selected
          ? theme.palette.action.selected
          : 'transparent',
        borderRadius: '50%',
        color: color ? color : theme.palette.text.primary,
        display: 'flex',
        flexDirection: 'column',
        gap: '5px',
        height: customWidth ? customWidth : disableWidth ? 'auto' : '89px',
        justifyContent: 'center',
        width: customWidth ? customWidth : disableWidth ? 'auto' : '89px',
      }}
    >
      {children}
      <Typography
        sx={{
          color: color || theme.palette.text.primary,
          fontFamily: 'Inter',
          fontSize: '12px',
          fontWeight: 500,
        }}
      >
        {label}
      </Typography>
    </Box>
  );
};

export const DesktopFooter = ({
  goToHome,
  hasUnreadGroups,
  hasUnreadDirects,
  isHome,
  isGroups,
  isDirects,
  setDesktopSideView,
  isApps,
  setDesktopViewMode,
  hide,
  setIsOpenSideViewDirects,
  setIsOpenSideViewGroups,
}) => {
  const [isEnabledDevMode, setIsEnabledDevMode] =
    useRecoilState(enabledDevModeAtom);

  const theme = useTheme();

  if (hide) return;
  return (
    <Box
      sx={{
        alignItems: 'center',
        bottom: 0,
        display: 'flex',
        height: '100px', // Footer height
        justifyContent: 'center',
        position: 'absolute',
        width: '100%',
        zIndex: 1,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          gap: '20px',
        }}
      >
        <ButtonBase
          onClick={() => {
            goToHome();
          }}
        >
          <IconWrapper label="Home" selected={isHome}>
            <HomeIcon height={30} />
          </IconWrapper>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            setDesktopViewMode('apps');
            setIsOpenSideViewDirects(false);
            setIsOpenSideViewGroups(false);
          }}
        >
          <IconWrapper label="Apps" selected={isApps}>
            <img src={AppIcon} />
          </IconWrapper>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            setDesktopSideView('groups');
          }}
        >
          <IconWrapper label="Groups" selected={isGroups}>
            <HubsIcon
              height={30}
              color={
                hasUnreadGroups
                  ? 'var(--danger)'
                  : isGroups
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            setDesktopSideView('directs');
          }}
        >
          <IconWrapper label="Messaging" selected={isDirects}>
            <MessagingIcon
              height={30}
              color={
                hasUnreadDirects
                  ? 'var(--danger)'
                  : isDirects
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        </ButtonBase>

        <Save isDesktop />
        {isEnabledDevMode && (
          <ButtonBase
            onClick={() => {
              setDesktopViewMode('dev');
              setIsOpenSideViewDirects(false);
              setIsOpenSideViewGroups(false);
            }}
          >
            <IconWrapper label="Dev Mode" selected={isApps}>
              <img src={AppIcon} />
            </IconWrapper>
          </ButtonBase>
        )}
      </Box>
    </Box>
  );
};
