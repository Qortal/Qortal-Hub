import {
  ButtonBase,
  InputAdornment,
  TextField,
  TextFieldProps,
  styled,
  useTheme,
} from '@mui/material';
import { forwardRef, useState } from 'react';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VisibilityIcon from '@mui/icons-material/Visibility';

export const CustomInput = styled(TextField)(({ theme }) => ({
  width: '183px',
  borderRadius: '5px',
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
}));

export const PasswordField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ ...props }, ref) => {
    const [canViewPassword, setCanViewPassword] = useState(false);
    const theme = useTheme();

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
