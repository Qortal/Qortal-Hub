import { ReactNode } from 'react';
import {
  Box,
  ButtonBase,
  TextField,
  TextFieldProps,
  Typography,
  useTheme,
} from '@mui/material';

type AuthFrameProps = {
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number | string;
  align?: 'center' | 'start';
  disableInitialAnimation?: boolean;
};

type AuthButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  fullWidth?: boolean;
  type?: 'button' | 'submit';
  prominence?: 'normal' | 'subtle';
};

type AuthScreenProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  maxWidth?: number | string;
  footer?: ReactNode;
  align?: 'center' | 'start';
};

export function AuthFrame({
  children,
  footer,
  maxWidth = 560,
  align = 'center',
  disableInitialAnimation = false,
}: AuthFrameProps) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        background:
          'radial-gradient(circle at top center, rgba(48,68,104,0.1), transparent 36%), #06080d',
        color: theme.palette.text.primary,
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        minHeight: '100vh',
        position: 'relative',
        width: '100%',
      }}
    >
      <Box
        sx={{
          alignItems: align === 'center' ? 'center' : 'flex-start',
          display: 'flex',
          flex: 1,
          justifyContent: 'center',
          px: { xs: 2.5, md: 3.5 },
          py: { xs: 7, md: 8 },
          position: 'relative',
          zIndex: 1,
        }}
      >
        <Box
          sx={{
            animation: disableInitialAnimation
              ? 'none'
              : 'authScreenIn 240ms ease both',
            display: 'flex',
            flexDirection: 'column',
            maxWidth,
            width: '100%',
            '@keyframes authScreenIn': {
              from: {
                opacity: 0,
                transform: 'translateY(6px)',
              },
              to: {
                opacity: 1,
                transform: 'translateY(0)',
              },
            },
          }}
        >
          {children}
        </Box>
      </Box>

      {footer && (
        <Box
          sx={{
            bottom: 18,
            left: 24,
            position: 'absolute',
            right: 24,
            zIndex: 1,
          }}
        >
          {footer}
        </Box>
      )}
    </Box>
  );
}

export function AuthScreen({
  title,
  subtitle,
  children,
  maxWidth = 420,
  footer,
  align = 'center',
}: AuthScreenProps) {
  return (
    <AuthFrame maxWidth={maxWidth} footer={footer} align={align}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2.2,
          width: '100%',
        }}
      >
        {(title || subtitle) && (
          <Box
            sx={{
              textAlign: align === 'center' ? 'center' : 'left',
            }}
          >
            {title && (
              <Typography
                sx={{
                  fontSize: '1.8rem',
                  fontWeight: 700,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.08,
                }}
              >
                {title}
              </Typography>
            )}
            {subtitle && (
              <Typography
                sx={{
                  color: 'rgba(214,221,233,0.64)',
                  fontSize: '0.95rem',
                  lineHeight: 1.65,
                  mt: title ? 1 : 0,
                }}
              >
                {subtitle}
              </Typography>
            )}
          </Box>
        )}

        {children}
      </Box>
    </AuthFrame>
  );
}

export function AuthButton({
  children,
  onClick,
  disabled = false,
  primary = true,
  fullWidth = true,
  type = 'button',
  prominence = 'normal',
}: AuthButtonProps) {
  const isSubtlePrimary = primary && prominence === 'subtle';

  return (
    <ButtonBase
      type={type}
      disabled={disabled}
      onClick={onClick}
      sx={{
        alignItems: 'center',
        background: primary
          ? isSubtlePrimary
            ? 'linear-gradient(180deg, rgba(55,94,185,0.88) 0%, rgba(36,72,156,0.88) 100%)'
            : 'linear-gradient(180deg, rgba(62,107,214,0.96) 0%, rgba(39,83,184,0.96) 100%)'
          : 'rgba(255,255,255,0.02)',
        border: `1px solid ${
          primary
            ? isSubtlePrimary
              ? 'rgba(88,133,226,0.18)'
              : 'rgba(92,145,255,0.22)'
            : 'rgba(255,255,255,0.08)'
        }`,
        borderRadius: '8px',
        color: primary
          ? isSubtlePrimary
            ? 'rgba(240,244,252,0.94)'
            : '#f6f8fc'
          : 'rgba(230,236,247,0.88)',
        display: 'inline-flex',
        fontSize: isSubtlePrimary ? '0.88rem' : '0.92rem',
        fontWeight: 700,
        height: isSubtlePrimary ? 38 : 42,
        justifyContent: 'center',
        opacity: disabled ? 0.45 : 1,
        px: isSubtlePrimary ? 1.6 : 2,
        transition: 'background-color 160ms ease, border-color 160ms ease, opacity 160ms ease, transform 160ms ease',
        width: fullWidth ? '100%' : 'auto',
        '&:hover': disabled
          ? undefined
          : {
              background: primary
                ? isSubtlePrimary
                  ? 'linear-gradient(180deg, rgba(61,101,194,0.9) 0%, rgba(40,79,167,0.9) 100%)'
                  : 'linear-gradient(180deg, rgba(69,115,224,0.98) 0%, rgba(44,90,193,0.98) 100%)'
                : 'rgba(255,255,255,0.04)',
              borderColor: primary
                ? isSubtlePrimary
                  ? 'rgba(104,151,241,0.22)'
                  : 'rgba(118,165,255,0.28)'
                : 'rgba(255,255,255,0.12)',
              transform: isSubtlePrimary ? 'none' : 'translateY(-1px)',
            },
      }}
    >
      {children}
    </ButtonBase>
  );
}

export function AuthInput(props: TextFieldProps) {
  const theme = useTheme();
  return (
    <TextField
      {...props}
      fullWidth
      variant="outlined"
      sx={{
        '& .MuiOutlinedInput-root': {
          backgroundColor: 'rgba(255,255,255,0.03)',
          borderRadius: '8px',
          color: theme.palette.text.primary,
          minHeight: 44,
          transition: 'background-color 160ms ease, border-color 160ms ease',
          '& fieldset': {
            borderColor: 'rgba(255,255,255,0.08)',
          },
          '&:hover fieldset': {
            borderColor: 'rgba(255,255,255,0.12)',
          },
          '&.Mui-focused': {
            backgroundColor: 'rgba(255,255,255,0.04)',
          },
          '&.Mui-focused fieldset': {
            borderColor: 'rgba(90,136,243,0.42)',
          },
        },
        '& .MuiInputBase-input': {
          fontSize: '0.95rem',
          padding: '11px 13px',
        },
        '& .MuiInputBase-input::placeholder': {
          color: 'rgba(214,221,233,0.42)',
          opacity: 1,
        },
        ...props.sx,
      }}
    />
  );
}

export function AuthSectionLabel({ children }: { children: ReactNode }) {
  return (
    <Typography
      sx={{
        color: 'rgba(214,221,233,0.62)',
        fontSize: '0.74rem',
        fontWeight: 700,
        letterSpacing: '0.08em',
        mb: 0.75,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </Typography>
  );
}

export function AuthStepDots({
  count,
  current,
}: {
  count: number;
  current: number;
}) {
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'inline-flex',
        gap: 0.8,
        justifyContent: 'center',
      }}
    >
      {Array.from({ length: count }).map((_, index) => {
        const step = index + 1;
        const active = step === current;
        const complete = step < current;
        return (
          <Box
            key={step}
            sx={{
              alignItems: 'center',
              border: `1px solid ${
                active
                  ? 'rgba(92,145,255,0.28)'
                  : complete
                    ? 'rgba(101,186,124,0.26)'
                    : 'rgba(255,255,255,0.12)'
              }`,
              borderRadius: '999px',
              color: complete ? 'rgba(174,235,191,0.82)' : 'rgba(230,236,247,0.82)',
              display: 'inline-flex',
              fontSize: '0.74rem',
              fontWeight: 700,
              height: 22,
              justifyContent: 'center',
              width: 22,
              backgroundColor: active
                ? 'rgba(57,105,212,0.9)'
                : complete
                  ? 'rgba(58,110,73,0.68)'
                  : 'rgba(255,255,255,0.04)',
            }}
          >
            {step}
          </Box>
        );
      })}
    </Box>
  );
}
