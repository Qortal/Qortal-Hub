import { Box, Button, Divider, Typography, styled } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  isDark,
  libraryAccent,
  libraryFocusRing,
  libraryHairline,
  libraryHoverBorder,
} from './libraryStyles';

export const SectionContainer = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  width: '100%',
});

export const SectionTitle = styled(Typography)(({ theme }) => ({
  fontSize: '18px',
  fontWeight: 600,
  color: theme.palette.text.primary,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
}));

export const EmptyStateBox = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '40px',
  borderRadius: '12px',
  backgroundColor: theme.palette.background.paper,
  border: `1px dashed ${theme.palette.divider}`,
  textAlign: 'center',
  width: '320px',
  minHeight: '220px',
}));

export const PublishNewContainer = styled(Box)({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '12px',
  width: '100%',
});

/** A wide tile with an icon in a tinted circle, for "publish new" actions. */
export const PublishButton = styled(Button)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${libraryHairline(theme, 0.1)}`,
  borderRadius: '16px',
  color: theme.palette.text.primary,
  display: 'flex',
  flex: '1 1 240px',
  flexDirection: 'row',
  gap: '12px',
  justifyContent: 'flex-start',
  maxWidth: '360px',
  minHeight: '64px',
  minWidth: '220px',
  padding: '12px 16px',
  textAlign: 'left',
  textTransform: 'none',
  transition: 'border-color 160ms, box-shadow 160ms, background-image 160ms',
  '& .MuiSvgIcon-root': {
    backgroundColor: alpha(
      theme.palette.primary.main,
      isDark(theme) ? 0.16 : 0.14
    ),
    borderRadius: '50%',
    boxSizing: 'content-box',
    color: libraryAccent(theme),
    flexShrink: 0,
    fontSize: '22px',
    padding: '9px',
  },
  '& .MuiTypography-root': {
    fontSize: '14.5px',
    fontWeight: 600,
  },
  '&:hover': {
    backgroundColor: theme.palette.background.paper,
    backgroundImage: `linear-gradient(${alpha(theme.palette.primary.main, 0.06)}, ${alpha(theme.palette.primary.main, 0.06)})`,
    borderColor: libraryHoverBorder(theme),
    boxShadow: `0 8px 22px ${alpha(theme.palette.common.black, isDark(theme) ? 0.4 : 0.1)}`,
  },
  '&.Mui-focusVisible': libraryFocusRing(theme, 2),
}));

export const StyledDivider = styled(Divider)(({ theme }) => ({
  margin: '16px 0',
}));
