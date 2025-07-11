import {
  ButtonBase,
  InputAdornment,
  TextField,
  TextFieldProps,
  styled,
} from '@mui/material';
import { forwardRef, useState } from 'react';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VisibilityIcon from '@mui/icons-material/Visibility';

export const CustomInput = styled(TextField)(({ theme }) => ({
  width: '183px',
  borderRadius: '8px',
  backgroundColor: theme.palette.background.paper,
  outline: 'none',
  input: {
    fontSize: 10,
    fontFamily: 'Inter',
    fontWeight: 400,
    color: theme.palette.text.primary,
    '&::placeholder': {
      fontSize: 16,
      color: theme.palette.text.disabled,
    },
    outline: 'none',
    padding: '10px',
  },
  '& .MuiOutlinedInput-root': {
    '& fieldset': {
      border: `0.5px solid ${theme.palette.divider}`,
    },
    '&:hover fieldset': {
      border: `0.5px solid ${theme.palette.divider}`,
    },
    '&.Mui-focused fieldset': {
      border: `0.5px solid ${theme.palette.divider}`,
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
  '&:hover': {
    backgroundColor: theme.palette.background.surface,
    'svg path': {
      fill: theme.palette.secondary,
    },
  },
}));

export const PasswordField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ ...props }, ref) => {
    const [canViewPassword, setCanViewPassword] = useState(false);

    return (
      <CustomInput
        type={canViewPassword ? 'text' : 'password'}
        InputProps={{
          endAdornment: (
            <InputAdornment
              position="end"
              data-testid="toggle-view-password-btn"
              onClick={() => {
                setCanViewPassword((prevState) => !prevState);
              }}
            >
              {canViewPassword ? (
                <ButtonBase
                  data-testid="plain-text-indicator"
                  sx={{ minWidth: 0, p: 0 }}
                >
                  <VisibilityOffIcon />
                </ButtonBase>
              ) : (
                <ButtonBase
                  data-testid="password-text-indicator"
                  sx={{ minWidth: 0, p: 0 }}
                >
                  <VisibilityIcon />
                </ButtonBase>
              )}
            </InputAdornment>
          ),
        }}
        inputRef={ref}
        {...props}
      />
    );
  }
);
