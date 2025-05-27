import { Typography, Box, TextField, InputLabel } from '@mui/material';
import { styled } from '@mui/system';

export const AppContainer = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  overflow: 'hidden',
  radius: '15px',
  width: '100vw',
}));

export const AuthenticatedContainer = styled(Box)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  height: '100%',
  justifyContent: 'space-between',
  width: '100%',
}));

export const AuthenticatedContainerInnerLeft = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
}));

export const AuthenticatedContainerInnerRight = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '60px',
}));

export const AuthenticatedContainerInnerTop = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  display: 'flex',
  height: '60px',
  justifyContent: 'flex-start',
  padding: '20px',
  width: '100%px',
}));

export const TextP = styled(Typography)(({ theme }) => ({
  color: theme.palette.text.primary,
  fontFamily: 'Inter',
  fontSize: '13px',
  fontWeight: 600,
}));

export const TextItalic = styled('span')(({ theme }) => ({
  color: theme.palette.text.primary,
  fontFamily: 'Inter',
  fontSize: '13px',
  fontStyle: 'italic',
  fontWeight: 600,
}));

export const TextSpan = styled('span')(({ theme }) => ({
  color: theme.palette.text.primary,
  fontFamily: 'Inter',
  fontSize: '13px',
  fontWeight: 800,
}));

export const AddressBox = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.default,
  borderColor: theme.palette.background.paper,
  borderRadius: '100px',
  borderStyle: 'solid',
  borderWidth: '1px',
  color: theme.palette.text.primary,
  cursor: 'pointer',
  display: 'flex',
  fontFamily: 'Inter',
  fontSize: '12px',
  fontWeight: 600,
  gap: '5px',
  height: '25px',
  justifyContent: 'space-between',
  lineHeight: '14.52px',
  padding: '5px 15px',
  textAlign: 'left',
  transition: 'all 0.2s',
  width: 'auto',
  '&:hover': {
    backgroundColor: theme.palette.background.paper,
    color: theme.palette.text.secondary,
    'svg path': {
      fill: theme.palette.mode === 'dark' ? '#fff' : '#000',
    },
  },
}));

export const CustomButton = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  backgroundColor: theme.palette.background.paper,
  borderColor: theme.palette.background.paper,
  borderRadius: '8px',
  borderStyle: 'solid',
  borderWidth: '0.5px',
  boxSizing: 'border-box',
  color: theme.palette.text.primary,
  cursor: 'pointer',
  display: 'inline-flex',
  fontFamily: 'Inter',
  fontWeight: 600,
  gap: '10px',
  justifyContent: 'center',
  minWidth: '160px',
  padding: '15px 20px',
  textAlign: 'center',
  transition: 'all 0.3s',
  width: 'fit-content',
  '&:hover': {
    backgroundColor: theme.palette.background.surface,
    'svg path': {
      fill: theme.palette.secondary,
    },
  },
}));

interface CustomButtonProps {
  bgColor?: string;
  color?: string;
}

export const CustomButtonAccept = styled(Box)<CustomButtonProps>(
  ({ bgColor, color, theme }) => ({
    alignItems: 'center',
    backgroundColor: bgColor || theme.palette.background.default,
    borderColor: theme.palette.background.paper,
    borderRadius: 5,
    borderStyle: 'solid',
    borderWidth: '0.5px',
    boxSizing: 'border-box',
    color: color || theme.palette.background.default,
    cursor: 'pointer',
    display: 'inline-flex',
    filter: 'drop-shadow(1px 4px 10.5px rgba(0,0,0,0.3))',
    fontFamily: 'Inter',
    fontWeight: 600,
    gap: '10px',
    justifyContent: 'center',
    minWidth: 160,
    opacity: 0.7,
    padding: '15px 20px',
    textAlign: 'center',
    transition: 'all 0.2s',
    width: 'fit-content',
    '&:hover': {
      opacity: 1,
      backgroundColor: bgColor || theme.palette.background.default,
      color: color || '#fff',
      svg: {
        path: {
          fill: color || '#fff',
        },
      },
    },
  })
);

export const CustomInput = styled(TextField)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
  borderColor: theme.palette.background.paper,
  borderRadius: '8px',
  color: theme.palette.text.primary,
  outline: 'none',
  width: '183px', // Adjust the width as needed
  input: {
    fontSize: '12px',
    fontFamily: 'Inter',
    fontWeight: 400,
    color: theme.palette.text.primary,
    '&::placeholder': {
      fontSize: 16,
      color: theme.palette.text.secondary,
    },
    outline: 'none',
    padding: '10px',
  },
  '& .MuiOutlinedInput-root': {
    '& fieldset': {
      borderColor: theme.palette.background.paper,
      borderRadius: '0.5px',
      borderStyle: 'solid',
    },
    '&:hover fieldset': {
      borderColor: theme.palette.background.paper,
      borderRadius: '0.5px',
      borderStyle: 'solid',
    },
    '&.Mui-focused fieldset': {
      borderColor: theme.palette.background.paper,
      borderRadius: '0.5px',
      borderStyle: 'solid',
    },
  },
  '& .MuiInput-underline:before': {
    borderBottom: 'none',
  },
  '& .MuiInput-underline:hover:not(.Mui-disabled):before': {
    borderBottom: 'none',
  },
  '& .MuiInput-underline:after': {
    borderBottom: 'none',
  },
}));

export const CustomLabel = styled(InputLabel)(({ theme }) => ({
  backgroundColor: theme.palette.background.default,
  color: theme.palette.text.primary,
  fontFamily: 'Inter',
  fontSize: '15px',
  fontWeight: 400,
  lineHeight: '24px',
}));
