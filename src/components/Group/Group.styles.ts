import { Box, Typography } from '@mui/material';
import { styled } from '@mui/system';
import { AuthenticatedContainerInnerRight } from '../../styles/App-styles';

/**
 * Group layout styled components using MUI's styled API.
 * Keeps style definitions out of Group.tsx and avoids new object references per render.
 */

export const RootBox = styled(Box)({
  alignItems: 'flex-start',
  display: 'flex',
  flexDirection: 'row',
  height: '100%',
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
  position: 'relative',
});

export const AdminRowBox = styled(Box)({
  display: 'flex',
  gap: '20px',
  padding: '15px',
  alignItems: 'center',
});

export const ChatContentBox = styled(Box)({
  display: 'flex',
  flexGrow: 1,
  height: 'calc(100vh - 70px)',
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
  height: 'calc(100vh - 70px)',
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
  display: isVisible ? 'block' : 'none',
  opacity: !isVisible ? 0 : 1,
  position: isVisible ? 'absolute' : 'relative',
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
