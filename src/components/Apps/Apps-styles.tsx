import { Typography, Box, ButtonBase } from '@mui/material';
import { styled } from '@mui/system';

export const AppsParent = styled(Box)(({ theme }) => ({
  display: 'flex',
  width: '100%',
  flexDirection: 'column',
  height: '100%',
  alignItems: 'center',
  overflow: 'auto',
  // For WebKit-based browsers (Chrome, Safari, etc.)
  '::-webkit-scrollbar': {
    width: '0px', // Set the width to 0 to hide the scrollbar
    height: '0px', // Set the height to 0 for horizontal scrollbar
  },

  // For Firefox
  scrollbarWidth: 'none', // Hides the scrollbar in Firefox

  // Optional for better cross-browser consistency
  '-msOverflowStyle': 'none', // Hides scrollbar in IE and Edge

  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppsContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  width: '90%',
  justifyContent: 'space-evenly',
  gap: '24px',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  alignSelf: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppsLibraryContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  width: '100%',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  alignItems: 'center',
  backgroundColor: theme.palette.background.paper,
}));

export const AppsWidthLimiter = styled(Box)(({ theme }) => ({
  display: 'flex',
  width: '90%',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  alignItems: 'flex-start',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppsSearchContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  width: '90%',
  justifyContent: 'space-between',
  alignItems: 'center',
  borderRadius: '8px',
  padding: '0px 10px',
  height: '36px',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppsSearchLeft = styled(Box)(({ theme }) => ({
  display: 'flex',
  width: '90%',
  justifyContent: 'flex-start',
  alignItems: 'center',
  gap: '10px',
  flexGrow: 1,
  flexShrink: 0,
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppsSearchRight = styled(Box)(({ theme }) => ({
  display: 'flex',
  width: '90%',
  justifyContent: 'flex-end',
  alignItems: 'center',
  flexShrink: 1,
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppCircleContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  alignItems: 'center',
  width: '100%',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const Add = styled(Typography)(({ theme }) => ({
  fontSize: '36px',
  fontWeight: 500,
  lineHeight: '43.57px',
  textAlign: 'left',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppCircleLabel = styled(Typography)(({ theme }) => ({
  '-webkit-box-orient': 'vertical',
  '-webkit-line-clamp': '2',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: '-webkit-box',
  fontSize: '14px',
  fontWeight: 500,
  lineHeight: 1.2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  width: '120%',
}));

export const AppLibrarySubTitle = styled(Typography)(({ theme }) => ({
  fontSize: '16px',
  fontWeight: 500,
  lineHeight: 1.2,
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppCircle = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  borderColor:
    theme.palette.mode === 'dark'
      ? 'rgb(209, 209, 209)'
      : 'rgba(41, 41, 43, 1)',
  borderWidth: '1px',
  borderRadius: '50%',
  borderStyle: 'solid',
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
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppDownloadButton = styled(ButtonBase)(({ theme }) => ({
  backgroundColor: '#247C0E',
  color: theme.palette.text.primary,
  width: '101px',
  height: '29px',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  borderRadius: '25px',
  alignSelf: 'center',
}));

export const AppDownloadButtonText = styled(Typography)(({ theme }) => ({
  fontSize: '14px',
  fontWeight: 500,
  lineHeight: 1.2,
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppPublishTagsContainer = styled(Box)(({ theme }) => ({
  gap: '10px',
  flexWrap: 'wrap',
  justifyContent: 'flex-start',
  width: '100%',
  display: 'flex',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppInfoSnippetMiddle = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'flex-start',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppInfoAppName = styled(Typography)(({ theme }) => ({
  fontSize: '16px',
  fontWeight: 500,
  lineHeight: 1.2,
  textAlign: 'start',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppInfoUserName = styled(Typography)(({ theme }) => ({
  fontSize: '13px',
  fontWeight: 400,
  lineHeight: 1.2,
  textAlign: 'start',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppsNavBarParent = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
  height: '60px',
  padding: '0px 10px',
  position: 'fixed',
  bottom: 0,
  zIndex: 1,
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppsNavBarLeft = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'flex-start',
  alignItems: 'center',
  flexGrow: 1,
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppsNavBarRight = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const TabParent = styled(Box)(({ theme }) => ({
  height: '36px',
  width: '36px',
  position: 'relative',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const PublishQAppCTAParent = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const PublishQAppCTALeft = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'flex-start',
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const PublishQAppCTARight = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const PublishQAppCTAButton = styled(ButtonBase)(({ theme }) => ({
  width: '101px',
  height: '29px',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  borderRadius: '25px',
  border: '1px solid #FFFFFF',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const PublishQAppDotsBG = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  width: '60px',
  height: '60px',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const PublishQAppInfo = styled(Typography)(({ theme }) => ({
  fontSize: '10px',
  fontWeight: 400,
  lineHeight: 1.2,
  fontStyle: 'italic',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const PublishQAppChoseFile = styled(ButtonBase)(({ theme }) => ({
  width: '101px',
  height: '30px',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  borderRadius: '5px',
  fontWeight: 600,
  fontSize: '10px',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppsCategoryInfo = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppsCategoryInfoSub = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
}));

export const AppsCategoryInfoLabel = styled(Typography)(({ theme }) => ({
  fontSize: '12px',
  fontWeight: 700,
  lineHeight: 1.2,
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
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
