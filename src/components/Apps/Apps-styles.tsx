import { Typography, Box, ButtonBase } from '@mui/material';
import { styled } from '@mui/system';

export const AppsParent = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  overflow: 'auto',
  width: '100%',
  // For WebKit-based browsers (Chrome, Safari, etc.)
  '::-webkit-scrollbar': {
    width: '0px', // Set the width to 0 to hide the scrollbar
    height: '0px', // Set the height to 0 for horizontal scrollbar
  },

  // For Firefox
  scrollbarWidth: 'none', // Hides the scrollbar in Firefox

  // Optional for better cross-browser consistency
  msOverflowStyle: 'none', // Hides scrollbar in IE and Edge

  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppsContainer = styled(Box)(({ theme }) => ({
  alignItems: 'flex-start',
  alignSelf: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  flexWrap: 'wrap',
  gap: '24px',
  justifyContent: 'space-evenly',
  width: '90%',
}));

export const AppsDesktopLibraryHeader = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  width: '100%',
}));

export const AppsDesktopLibraryBody = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  width: '100%',
}));

export const AppsLibraryContainer = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  width: '100%',
}));

export const AppsWidthLimiter = styled(Box)(({ theme }) => ({
  alignItems: 'flex-start',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  width: '90%',
}));

export const AppsSearchContainer = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  borderRadius: '8px',
  color: theme.palette.text.primary,
  display: 'flex',
  height: '36px',
  justifyContent: 'space-between',
  padding: '0px 10px',
  width: '90%',
}));

export const AppsSearchLeft = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  flexGrow: 1,
  flexShrink: 0,
  gap: '10px',
  justifyContent: 'flex-start',
  width: '90%',
}));

export const AppsSearchRight = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  flexShrink: 1,
  justifyContent: 'flex-end',
  width: '90%',
}));

export const AppCircleContainer = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  width: '100%',
}));

export const AppCircleLabel = styled(Typography)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: '-webkit-box',
  fontSize: '14px',
  fontWeight: 500,
  lineHeight: 1.2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: '2',
  width: '120%',
}));

export const AppLibrarySubTitle = styled(Typography)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  fontSize: '16px',
  fontWeight: 500,
  lineHeight: 1.2,
}));

export const AppCircle = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  borderColor:
    theme.palette.mode === 'dark'
      ? 'rgb(209, 209, 209)'
      : 'rgba(41, 41, 43, 1)',
  borderRadius: '50%',
  borderStyle: 'solid',
  borderWidth: '1px',
  color: theme.palette.text.primary,
  display: 'flex',
  flexDirection: 'column',
  height: '75px',
  justifyContent: 'center',
  width: '75px',
}));

export const AppInfoSnippetContainer = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  justifyContent: 'space-between',
  width: '100%',
}));

export const AppInfoSnippetLeft = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  gap: '12px',
  justifyContent: 'flex-start',
}));

export const AppInfoSnippetRight = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  justifyContent: 'flex-end',
}));

export const AppDownloadButton = styled(ButtonBase)(({ theme }) => ({
  alignItems: 'center',
  alignSelf: 'center',
  backgroundColor: theme.palette.background.default,
  borderRadius: '25px',
  color: theme.palette.text.primary,
  display: 'flex',
  height: '29px',
  justifyContent: 'center',
  width: '101px',
}));

export const AppDownloadButtonText = styled(Typography)({
  fontSize: '14px',
  fontWeight: 500,
  lineHeight: 1.2,
});

export const AppPublishTagsContainer = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  flexWrap: 'wrap',
  gap: '10px',
  justifyContent: 'flex-start',
  width: '100%',
}));

export const AppInfoSnippetMiddle = styled(Box)(({ theme }) => ({
  alignItems: 'flex-start',
  backgroundColor: theme.palette.background.default,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  color: theme.palette.text.primary,
}));

export const AppInfoAppName = styled(Typography)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  fontSize: '16px',
  fontWeight: 500,
  lineHeight: 1.2,
  textAlign: 'start',
}));

export const AppInfoUserName = styled(Typography)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  fontSize: '13px',
  fontWeight: 400,
  lineHeight: 1.2,
  textAlign: 'start',
}));

export const AppsNavBarParent = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  bottom: 0,
  color: theme.palette.text.primary,
  display: 'flex',
  height: '60px',
  justifyContent: 'space-between',
  padding: '0px 10px',
  position: 'fixed',
  width: '100%',
  zIndex: 1,
}));

export const AppsNavBarLeft = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  flexGrow: 1,
  justifyContent: 'flex-start',
}));

export const AppsNavBarRight = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  justifyContent: 'flex-end',
}));

export const TabParent = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  borderRadius: '50%',
  color: theme.palette.text.primary,
  display: 'flex',
  height: '36px',
  justifyContent: 'center',
  position: 'relative',
  width: '36px',
}));

export const PublishQAppCTAParent = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  justifyContent: 'space-between',
  width: '100%',
}));

export const PublishQAppCTALeft = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  justifyContent: 'flex-start',
}));

export const PublishQAppCTARight = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  justifyContent: 'flex-end',
}));

export const PublishQAppCTAButton = styled(ButtonBase)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.paper,
  borderColor: theme.palette.background.default,
  borderRadius: '25px',
  borderStyle: 'solid',
  borderWidth: '1px',
  color: theme.palette.text.primary,
  display: 'flex',
  height: '29px',
  justifyContent: 'center',
  width: '101px',
}));

export const PublishQAppDotsBG = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  height: '60px',
  justifyContent: 'center',
  width: '60px',
}));

export const PublishQAppInfo = styled(Typography)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  fontSize: '10px',
  fontStyle: 'italic',
  fontWeight: 400,
  lineHeight: 1.2,
}));

export const PublishQAppChoseFile = styled(ButtonBase)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  borderRadius: '5px',
  color: theme.palette.text.primary,
  display: 'flex',
  fontSize: '10px',
  fontWeight: 600,
  height: '30px',
  justifyContent: 'center',
  width: '101px',
}));

export const AppsCategoryInfo = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  width: '100%',
}));

export const AppsCategoryInfoSub = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  flexDirection: 'column',
}));

export const AppsCategoryInfoLabel = styled(Typography)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  fontSize: '12px',
  fontWeight: 700,
  lineHeight: 1.2,
}));

export const AppsCategoryInfoValue = styled(Typography)(({ theme }) => ({
  fontSize: '12px',
  fontWeight: 500,
  lineHeight: 1.2,
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppsInfoDescription = styled(Typography)(({ theme }) => ({
  fontSize: '13px',
  fontWeight: 300,
  lineHeight: 1.2,
  width: '90%',
  textAlign: 'start',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));
