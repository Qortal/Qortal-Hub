import {
  ButtonBase,
  InputAdornment,
  TextField,
  TextFieldProps,
  styled,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { forwardRef, useState } from 'react';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VisibilityIcon from '@mui/icons-material/Visibility';

type PasswordFieldProps = TextFieldProps & {
  suppressAutofill?: boolean;
};

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
  '& .MuiInputAdornment-root .MuiButtonBase-root': {
    borderRadius: 6,
    color:
      theme.palette.mode === 'dark'
        ? 'rgba(214,221,233,0.42)'
        : alpha(theme.palette.text.secondary, 0.82),
    minWidth: 0,
    opacity: 0.88,
    padding: 4,
    transition: 'color 160ms ease, opacity 160ms ease, background-color 160ms ease',
  },
  '& .MuiInputAdornment-root .MuiButtonBase-root:hover': {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? 'rgba(255,255,255,0.035)'
        : alpha(theme.palette.common.black, 0.06),
    color: theme.palette.text.primary,
    opacity: 1,
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
  '& input:-webkit-autofill, & input:-webkit-autofill:hover, & input:-webkit-autofill:focus':
    {
      WebkitBoxShadow:
        theme.palette.mode === 'dark'
          ? '0 0 0 100px rgb(38, 42, 50) inset'
          : '0 0 0 100px rgb(248, 250, 253) inset',
      WebkitTextFillColor: theme.palette.text.primary,
      caretColor: theme.palette.text.primary,
      transition: 'background-color 9999s ease-out 0s',
    },
}));

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  (
    {
      InputProps,
      inputProps,
      onBlur,
      onFocus,
      onMouseDown,
      suppressAutofill = false,
      value,
      ...props
    },
    ref
  ) => {
    const [canViewPassword, setCanViewPassword] = useState(false);
    const [isEditable, setIsEditable] = useState(!suppressAutofill);
    const hasValue = typeof value === 'string' ? value.length > 0 : Boolean(value);

    return (
      <CustomInput
        type={canViewPassword ? 'text' : 'password'}
        value={value}
        onFocus={(event) => {
          if (suppressAutofill) {
            setIsEditable(true);
          }
          onFocus?.(event);
        }}
        onMouseDown={(event) => {
          if (suppressAutofill) {
            setIsEditable(true);
          }
          onMouseDown?.(event);
        }}
        onBlur={(event) => {
          if (suppressAutofill && !hasValue) {
            setIsEditable(false);
          }
          onBlur?.(event);
        }}
        InputProps={{
          ...InputProps,
          readOnly:
            Boolean(InputProps?.readOnly) ||
            (suppressAutofill ? !isEditable && !hasValue : false),
          endAdornment: (
            <>
              {InputProps?.endAdornment}
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
            </>
          ),
        }}
        inputProps={{
          ...inputProps,
          ...(suppressAutofill
            ? {
                autoComplete: 'new-password',
                'data-1p-ignore': 'true',
                'data-lpignore': 'true',
                spellCheck: 'false',
              }
            : {}),
        }}
        inputRef={ref}
        {...props}
      />
    );
  }
);
