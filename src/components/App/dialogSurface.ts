import { alpha, type Theme } from '@mui/material/styles';

export const getDialogPaperSx = (
  theme: Theme,
  options?: {
    maxWidth?: number;
    radius?: number;
  }
) => ({
  background: 'linear-gradient(180deg, #121821 0%, #0C1118 100%)',
  backgroundImage: 'none',
  border: `1px solid ${alpha('#A9BCD8', 0.18)}`,
  borderRadius: `${options?.radius ?? 18}px`,
  boxShadow: '0 26px 56px rgba(0,0,0,0.44)',
  color: theme.palette.text.primary,
  maxWidth: options?.maxWidth,
  overflow: 'hidden',
  width: 'calc(100% - 40px)',
});

export const dialogTitleSx = {
  borderBottom: '1px solid rgba(169,188,216,0.1)',
  color: 'rgba(246,248,252,0.96)',
  fontSize: '1.04rem',
  fontWeight: 650,
  lineHeight: 1.3,
  px: 3,
  py: 2,
  textAlign: 'left',
};

export const dialogContentSx = {
  px: 3,
  pb: 2.65,
  '&&': {
    pt: 2.75,
  },
};

export const dialogContentTextSx = {
  color: 'rgba(214,221,233,0.78)',
  fontSize: '0.92rem',
  lineHeight: 1.6,
  m: 0,
  textAlign: 'left',
};

export const dialogActionsSx = {
  borderTop: '1px solid rgba(169,188,216,0.1)',
  gap: 1.2,
  justifyContent: 'flex-end',
  px: 3,
  py: 1.8,
};

export const getDialogSecondaryButtonSx = (theme: Theme) => ({
  backgroundColor: '#1A212C',
  border: '1px solid rgba(169,188,216,0.16)',
  borderRadius: '11px',
  color: theme.palette.text.primary,
  fontSize: '0.9rem',
  fontWeight: 600,
  minHeight: 42,
  minWidth: 112,
  px: 2.2,
  textTransform: 'none',
  '&:hover': {
    backgroundColor: '#1D2633',
    borderColor: 'rgba(169,188,216,0.24)',
  },
});

export const getDialogPrimaryButtonSx = (theme: Theme) => ({
  backgroundColor: theme.palette.primary.main,
  borderRadius: '11px',
  color: '#FFFFFF',
  fontSize: '0.9rem',
  fontWeight: 600,
  minHeight: 42,
  minWidth: 112,
  px: 2.2,
  textTransform: 'none',
  '&:hover': {
    backgroundColor: theme.palette.primary.main,
    filter: 'brightness(1.05)',
  },
});

export const getDialogDangerButtonSx = () => ({
  backgroundColor: '#2A1B20',
  border: '1px solid rgba(214, 112, 112, 0.18)',
  borderRadius: '11px',
  color: '#F2C1C1',
  fontSize: '0.9rem',
  fontWeight: 600,
  minHeight: 42,
  minWidth: 112,
  px: 2.2,
  textTransform: 'none',
  '&:hover': {
    backgroundColor: '#312026',
    borderColor: 'rgba(214, 112, 112, 0.26)',
  },
});

export const dialogInfoCardSx = {
  backgroundColor: '#1A212C',
  border: '1px solid rgba(169,188,216,0.13)',
  borderRadius: '12px',
  display: 'grid',
  gap: 0.55,
  px: 1.45,
  py: 1.2,
};
