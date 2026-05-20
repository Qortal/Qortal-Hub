import { Box, Typography } from '@mui/material';
import { styled } from '@mui/system';
import { AuthenticatedContainerInnerRight } from '../../styles/App-styles';
import { appChromeOffset } from '../Desktop/CustomTitleBar';

/**
 * Group layout styled components using MUI's styled API.
 * Keeps style definitions out of Group.tsx and avoids new object references per render.
 */

export const RootBox = styled(Box)({
  alignItems: 'flex-start',
  display: 'flex',
  flexDirection: 'row',
  height: '100%',
  position: 'relative',
  width: '100%',
});

export const MainContentBox = styled(Box)({
  width: '100%',
  height: '100%',
  position: 'relative',
});

export const CenterBox = styled(Box)({
  alignItems: 'center',
  display: 'flex',
  height: '100%',
  justifyContent: 'center',
  width: '100%',
});

export const FloatingButtonContainerBox = styled(Box)({
  bottom: '25px',
  display: 'flex',
  position: 'absolute',
  right: '25px',
  zIndex: 100,
});

export const InnerChatBox = styled(Box)({
  display: 'flex',
  flexGrow: 1,
  height: '100%',
  minHeight: 0,
  position: 'relative',
});

export const AdminRowBox = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  borderRadius: theme.shape.borderRadius,
  display: 'flex',
  gap: theme.spacing(2),
  justifyContent: 'space-between',
  padding: theme.spacing(1.5, 2),
  transition: 'background-color 0.2s ease',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
}));

export const ChatContentBox = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',
  position: 'relative',
});

export const EncryptionKeyMessageDiv = styled('div')({
  alignItems: 'flex-start',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  padding: '20px',
  width: '100%',
});

export const NotPartGroupDiv = styled('div')({
  alignItems: 'flex-start',
  display: 'flex',
  flexDirection: 'column',
  height: `calc(100vh - ${70 + appChromeOffset}px)`,
  overflow: 'auto',
  padding: '20px',
  width: '100%',
});

export const NoSelectionTypography = styled(Typography)(({ theme }) => ({
  fontSize: '14px',
  fontWeight: 400,
  color: theme.palette.text.primary,
}));

interface ChatOverlayProps {
  isChatMode?: boolean;
}

export const NewChatOverlay = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isChatMode',
})<ChatOverlayProps>(({ theme, isChatMode }) => ({
  background: theme.palette.background.surface,
  bottom: !isChatMode ? 'unset' : '0px',
  left: !isChatMode ? '-100000px' : '0px',
  opacity: !isChatMode ? 0 : 1,
  position: 'absolute',
  right: !isChatMode ? 'unset' : '0px',
  top: !isChatMode ? 'unset' : '0px',
  zIndex: 5,
}));

export const SelectedDirectOverlay = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isChatMode',
})<ChatOverlayProps>(({ theme, isChatMode }) => ({
  background: theme.palette.background.default,
  bottom: !isChatMode ? 'unset' : '0px',
  left: !isChatMode ? '-100000px' : '0px',
  opacity: !isChatMode ? 0 : 1,
  position: 'absolute',
  right: !isChatMode ? 'unset' : '0px',
  top: !isChatMode ? 'unset' : '0px',
  zIndex: 5,
}));

interface SelectedGroupWrapperProps {
  isVisible?: boolean;
}

export const SelectedGroupWrapper = styled('div', {
  shouldForwardProp: (prop) => prop !== 'isVisible',
})<SelectedGroupWrapperProps>(({ isVisible }) => ({
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  opacity: !isVisible ? 0 : 1,
  position: isVisible ? 'absolute' : 'fixed',
  left: !isVisible ? '-100000px' : '0px',
}));

interface GroupRightSidebarProps {
  hide?: boolean;
}

export const GroupRightSidebar = styled(AuthenticatedContainerInnerRight, {
  shouldForwardProp: (prop) => prop !== 'hide',
})<GroupRightSidebarProps>(({ hide }) => ({
  marginLeft: 'auto',
  width: '31px',
  padding: '5px',
  display: hide ? 'none' : 'flex',
}));



export const NotPartAdminListBox = styled(Box)(({ theme }) => ({
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius * 2,
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(0.5),
  maxHeight: 'min(420px, calc(100vh - 340px))',
  maxWidth: 420,
  minHeight: 0,
  overflowX: 'hidden',
  overflowY: 'auto',
  width: '100%',
}));
