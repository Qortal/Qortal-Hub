import { Typography, Box, ButtonBase, Chip } from '@mui/material';
import { styled } from '@mui/system';

export const AppsParent = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  msOverflowStyle: 'none', // Hides scrollbar in IE and Edge
  overflow: 'auto',
  scrollbarWidth: 'none', // Hides the scrollbar in Firefox
  width: '100%',
  // For WebKit-based browsers (Chrome, Safari, etc.)
  '::-webkit-scrollbar': {
    width: '0px', // Set the width to 0 to hide the scrollbar
    height: '0px', // Set the height to 0 for horizontal scrollbar
  },
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

export const AppsBackContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  width: '90%',
  maxWidth: '1200px',
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
  backgroundColor: theme.palette.background.paper,
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
  backgroundColor: theme.palette.background.paper,
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
  backgroundColor: theme.palette.background.paper,
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
  backgroundColor: theme.palette.background.surface,
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
  backgroundColor: theme.palette.background.paper,
  color: theme.palette.text.primary,
  display: 'flex',
  justifyContent: 'space-between',
  width: '100%',
}));

export const PublishQAppCTALeft = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.paper,
  color: theme.palette.text.primary,
  display: 'flex',
  justifyContent: 'flex-start',
}));

export const PublishQAppCTARight = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.paper,
  color: theme.palette.text.primary,
  display: 'flex',
  justifyContent: 'flex-end',
}));

export const PublishQAppCTAButton = styled(ButtonBase)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  borderColor: theme.palette.text.primary,
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
  backgroundColor: theme.palette.background.paper,
  color: theme.palette.text.primary,
  display: 'flex',
  height: '80px',
  justifyContent: 'center',
  width: '60px',
}));

export const PublishQAppInfo = styled(Typography)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  fontSize: '16px',
  fontStyle: 'italic',
  fontWeight: 400,
  lineHeight: 1.2,
}));

export const PublishQAppChoseFile = styled(ButtonBase)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.paper,
  borderRadius: '8px',
  color: theme.palette.text.primary,
  display: 'flex',
  fontSize: '16px',
  fontWeight: 600,
  height: '40px',
  justifyContent: 'center',
  width: '120px',
  '&:hover': {
    backgroundColor: 'action.hover',
  },
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

// Enhanced App Card Styles
export const AppCardEnhancedContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  padding: '16px',
  borderRadius: '12px',
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
  cursor: 'pointer',
  width: '100%',
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: theme.shadows[4],
  },
}));

export const AppCardHeader = styled(Box)({
  display: 'flex',
  gap: '12px',
  marginBottom: '12px',
  alignItems: 'flex-start',
});

export const AppCardHeaderInfo = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  flex: 1,
  minWidth: 0,
});

export const AppCardTitle = styled(Typography)(({ theme }) => ({
  fontSize: '16px',
  fontWeight: 600,
  color: theme.palette.text.primary,
  lineHeight: 1.3,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}));

export const AppCardDeveloper = styled(Typography)(({ theme }) => ({
  fontSize: '13px',
  fontWeight: 400,
  color: theme.palette.text.secondary,
  lineHeight: 1.2,
}));

export const AppCardRatingRow = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
});

export const AppCardRatingText = styled(Typography)(({ theme }) => ({
  fontSize: '12px',
  fontWeight: 500,
  color: theme.palette.text.secondary,
}));

export const AppCardDescription = styled(Typography)(({ theme }) => ({
  fontSize: '13px',
  fontWeight: 400,
  color: theme.palette.text.secondary,
  lineHeight: 1.4,
  marginBottom: '12px',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}));

export const AppCardTagsContainer = styled(Box)({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
  marginBottom: '12px',
});

export const AppCardActions = styled(Box)({
  display: 'flex',
  gap: '8px',
  marginTop: 'auto',
  justifyContent: 'flex-end',
});

export const CategoryChip = styled(Chip)(({ theme }) => ({
  height: '24px',
  fontSize: '0.75rem',
  fontWeight: 500,
  backgroundColor: theme.palette.primary.main,
  color: theme.palette.primary.contrastText,
  '& .MuiChip-label': {
    padding: '0 8px',
  },
}));

export const TagChip = styled(Chip)(({ theme }) => ({
  height: '20px',
  fontSize: '0.7rem',
  fontWeight: 400,
  backgroundColor: theme.palette.action.hover,
  color: theme.palette.text.secondary,
  '& .MuiChip-label': {
    padding: '0 6px',
  },
}));

export const StatusBadge = styled(Box)<{ isReady?: boolean }>(
  ({ theme, isReady }) => ({
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 500,
    backgroundColor: isReady
      ? theme.palette.success.light
      : theme.palette.warning.light,
    color: isReady
      ? theme.palette.success.contrastText
      : theme.palette.warning.contrastText,
  })
);

export const AppCardsGrid = styled(Box)({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: '16px',
  width: '100%',
});
