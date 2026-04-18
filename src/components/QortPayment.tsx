import {
  alpha,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useEffect, useState } from 'react';
import { getFee } from '../background/background.ts';
import { useTranslation } from 'react-i18next';
import BoundedNumericTextField from '../common/BoundedNumericTextField.tsx';
import { ErrorText } from './ErrorText/ErrorText.tsx';
import { getBlueTier1ButtonSx } from '../styles/blueMaterial';

export const QortPayment = ({
  balance,
  show,
  onSuccess,
  defaultPaymentTo,
  compact = false,
}) => {
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const [paymentTo, setPaymentTo] = useState<string>(defaultPaymentTo);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentPassword, setPaymentPassword] = useState<string>('');
  const [sendPaymentError, setSendPaymentError] = useState<string>('');
  const [isLoadingSendCoin, setIsLoadingSendCoin] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState(false);
  const isDarkMode = theme.palette.mode === 'dark';
  const secondaryTextColor = alpha(
    theme.palette.text.secondary,
    isDarkMode ? 0.9 : 0.82
  );

  useEffect(() => {
    setPaymentTo(defaultPaymentTo || '');
  }, [defaultPaymentTo]);

  const fieldLabelSx = {
    color: secondaryTextColor,
    fontSize: compact ? '0.78rem' : '0.79rem',
    fontWeight: 400,
    letterSpacing: '0.012em',
    lineHeight: 1.2,
  } as const;

  const fieldShellSx = {
    background: isDarkMode
      ? 'linear-gradient(180deg, rgba(40,44,54,0.98) 0%, rgba(34,37,45,1) 100%)'
      : 'linear-gradient(180deg, rgba(248,243,234,0.96) 0%, rgba(242,235,225,1) 100%)',
    border: isDarkMode
      ? '1px solid rgba(255,255,255,0.075)'
      : '1px solid rgba(28,36,52,0.08)',
    borderRadius: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: compact ? '8px' : '10px',
    px: compact ? 1.5 : 1.75,
    py: compact ? 1.2 : 1.5,
  } as const;

  const textFieldSurfaceSx = {
    '& .MuiOutlinedInput-root': {
      backgroundColor: isDarkMode ? '#1C2027' : '#FFFDFC',
      borderRadius: '12px',
      color: theme.palette.text.primary,
      minHeight: compact ? '44px' : '48px',
      '& fieldset': {
        borderColor: isDarkMode
          ? 'rgba(255,255,255,0.075)'
          : 'rgba(28,36,52,0.08)',
      },
      '&:hover fieldset': {
        borderColor: theme.palette.border.main,
      },
      '&.Mui-focused fieldset': {
        borderColor: theme.palette.border.main,
      },
    },
    '& .MuiOutlinedInput-input': {
      fontSize: compact ? '0.94rem' : '0.95rem',
      fontWeight: 500,
      padding: compact ? '10px 14px' : '12px 14px',
    },
    '& .MuiOutlinedInput-input::placeholder': {
      color: alpha(theme.palette.text.secondary, isDarkMode ? 0.72 : 0.68),
      fontWeight: 400,
      opacity: 1,
    },
  } as const;

  const sendCoinFunc = async () => {
    try {
      setSendPaymentError('');
      if (!paymentTo) {
        setSendPaymentError(
          t('auth:action.enter_recipient', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        return;
      }
      if (!paymentAmount) {
        setSendPaymentError(
          t('auth:action.enter_amount', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        return;
      }
      if (!paymentPassword) {
        setSendPaymentError(
          t('auth:action.enter_wallet_password', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        return;
      }

      const fee = await getFee('PAYMENT');

      await show({
        message: t('core:message.question.transfer_qort', {
          amount: Number(paymentAmount),
          postProcess: 'capitalizeFirstChar',
        }),
        paymentFee: fee.fee + ' QORT',
      });

      setIsLoadingSendCoin(true);

      window
        .sendMessage('sendCoin', {
          amount: Number(paymentAmount),
          receiver: paymentTo.trim(),
          password: paymentPassword,
        })
        .then((response) => {
          if (response?.error) {
            setSendPaymentError(response.error);
          } else {
            onSuccess();
          }
          setIsLoadingSendCoin(false);
        })
        .catch((error) => {
          console.error('Failed to send coin:', error);
          setIsLoadingSendCoin(false);
        });
    } catch (error) {
      console.log(error);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? '12px' : '14px',
        px: compact ? 2 : 2.5,
        py: compact ? 1.75 : 2.25,
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          background: isDarkMode
            ? 'linear-gradient(180deg, rgba(40,44,54,0.98) 0%, rgba(34,37,45,1) 100%)'
            : 'linear-gradient(180deg, rgba(248,243,234,0.96) 0%, rgba(242,235,225,1) 100%)',
          border: isDarkMode
            ? '1px solid rgba(255,255,255,0.075)'
            : '1px solid rgba(28,36,52,0.08)',
          borderRadius: '14px',
          display: 'flex',
          px: compact ? 1.5 : 1.75,
          py: compact ? 1.1 : 1.35,
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <Typography
            sx={{
              color: secondaryTextColor,
              fontSize: '0.76rem',
              fontWeight: 400,
              letterSpacing: '0.014em',
            }}
          >
            {t('core:balance', { postProcess: 'capitalizeFirstChar' })}
          </Typography>
          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: '1.08rem',
              fontWeight: 650,
              letterSpacing: '0.012em',
            }}
          >
            {balance?.toFixed(2)} QORT
          </Typography>
        </Box>
      </Box>

      <Box sx={fieldShellSx}>
        <Typography
          component="label"
          htmlFor="payment-to"
          sx={fieldLabelSx}
        >
          {t('core:to', { postProcess: 'capitalizeFirstChar' })}
        </Typography>
        <TextField
          id="payment-to"
          value={paymentTo}
          onChange={(e) => setPaymentTo(e.target.value)}
          autoComplete="off"
          placeholder="Qortal address or registered name"
          fullWidth
          sx={textFieldSurfaceSx}
        />
      </Box>

      <Box sx={fieldShellSx}>
        <Typography
          component="label"
          htmlFor="payment-amount"
          sx={fieldLabelSx}
        >
          {t('core:amount', { postProcess: 'capitalizeFirstChar' })}
        </Typography>
        <BoundedNumericTextField
          value={paymentAmount}
          minValue={0}
          maxValue={+balance}
          allowDecimals={true}
          initialValue={'0'}
          allowNegatives={false}
          addIconButtons={false}
          afterChange={(e: string) => setPaymentAmount(+e)}
          sx={{
            width: '100%',
            '& .MuiOutlinedInput-root': {
              backgroundColor: isDarkMode ? '#1C2027' : '#FFFDFC',
              borderRadius: '12px',
              minHeight: '48px',
              '& fieldset': {
                borderColor: isDarkMode
                  ? 'rgba(255,255,255,0.075)'
                  : 'rgba(28,36,52,0.08)',
              },
              '&:hover fieldset': {
                borderColor: theme.palette.border.main,
              },
              '&.Mui-focused fieldset': {
                borderColor: theme.palette.border.main,
              },
            },
            '& input': {
              fontSize: '0.9rem',
              padding: compact ? '10px 14px' : '12px 14px',
            },
          }}
        />
      </Box>

      <Box sx={fieldShellSx}>
        <Typography
          component="label"
          htmlFor="payment-password"
          sx={fieldLabelSx}
        >
          {t('auth:wallet.password_confirmation', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
        <TextField
          id="payment-password"
          type={showPassword ? 'text' : 'password'}
          value={paymentPassword}
          onChange={(e) => setPaymentPassword(e.target.value)}
          autoComplete="off"
          fullWidth
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (isLoadingSendCoin) return;
              sendCoinFunc();
            }
          }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  onClick={() => setShowPassword((prev) => !prev)}
                  edge="end"
                  sx={{ color: theme.palette.text.secondary }}
                >
                  {showPassword ? (
                    <VisibilityOffIcon fontSize="small" />
                  ) : (
                    <VisibilityIcon fontSize="small" />
                  )}
                </IconButton>
              </InputAdornment>
            ),
          }}
          sx={textFieldSurfaceSx}
        />
      </Box>

      <ErrorText
        sx={{
          fontSize: '0.74rem',
          minHeight: sendPaymentError ? '20px' : compact ? '8px' : '12px',
          px: 0.5,
        }}
      >
        {sendPaymentError}
      </ErrorText>

      <Button
        variant="contained"
        fullWidth
        disabled={isLoadingSendCoin}
        onClick={() => {
          if (isLoadingSendCoin) return;
          sendCoinFunc();
        }}
        sx={{
          borderRadius: '14px',
          ...getBlueTier1ButtonSx(),
          fontSize: '0.86rem',
          fontWeight: 600,
          minHeight: compact ? 44 : 46,
          textTransform: 'none',
        }}
        startIcon={
          isLoadingSendCoin ? (
            <CircularProgress size={16} color="inherit" />
          ) : null
        }
      >
        {t('core:action.send', { postProcess: 'capitalizeFirstChar' })}
      </Button>
    </Box>
  );
};
