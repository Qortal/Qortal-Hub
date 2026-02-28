import {
  alpha,
  Box,
  Button,
  CircularProgress,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import { Spacer } from '../common/Spacer';
import { getFee } from '../background/background.ts';
import { useTranslation } from 'react-i18next';
import BoundedNumericTextField from '../common/BoundedNumericTextField.tsx';
import { PasswordField } from './PasswordField/PasswordField.tsx';
import { ErrorText } from './ErrorText/ErrorText.tsx';

export const QortPayment = ({ balance, show, onSuccess, defaultPaymentTo }) => {
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
  const [sendPaymentSuccess, setSendPaymentSuccess] = useState<string>('');
  const [isLoadingSendCoin, setIsLoadingSendCoin] = useState<boolean>(false);

  const sendCoinFunc = async () => {
    try {
      setSendPaymentError('');
      setSendPaymentSuccess('');
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
        flexGrow: 1,
        overflowY: 'auto',
        p: 2,
      }}
    >
      <Box sx={{ maxWidth: 480, mx: 'auto', py: 3, px: 1, width: '100%' }}>

        {/* Page title + balance */}
        <Box sx={{ mb: 3 }}>
          <Typography
            variant="h6"
            sx={{ fontWeight: 600, letterSpacing: '-0.02em' }}
          >
            {t('core:action.transfer_qort', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>

          <Spacer height="12px" />

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 2,
              py: 1.25,
              borderRadius: 2,
              border: 1,
              borderColor: alpha(theme.palette.divider, 0.4),
              bgcolor: alpha(theme.palette.background.default, 0.5),
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {t('core:balance', { postProcess: 'capitalizeFirstChar' })}
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontWeight: 700, ml: 'auto' }}
            >
              {balance?.toFixed(2)} QORT
            </Typography>
          </Box>
        </Box>

        {/* Recipient */}
        <Box
          sx={{
            borderRadius: 2,
            border: 1,
            borderColor: alpha(theme.palette.divider, 0.4),
            bgcolor: alpha(theme.palette.background.default, 0.5),
            mb: 2,
            px: 2,
            py: 1.5,
          }}
        >
          <Typography
            component="label"
            htmlFor="payment-to"
            variant="body2"
            color="text.secondary"
            sx={{ display: 'block', mb: 1 }}
          >
            {t('core:to', { postProcess: 'capitalizeFirstChar' })}
          </Typography>
          <TextField
            id="payment-to"
            value={paymentTo}
            onChange={(e) => setPaymentTo(e.target.value)}
            autoComplete="off"
            variant="outlined"
            size="small"
            fullWidth
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                bgcolor: theme.palette.background.default,
              },
            }}
          />
        </Box>

        {/* Amount */}
        <Box
          sx={{
            borderRadius: 2,
            border: 1,
            borderColor: alpha(theme.palette.divider, 0.4),
            bgcolor: alpha(theme.palette.background.default, 0.5),
            mb: 2,
            px: 2,
            py: 1.5,
          }}
        >
          <Typography
            component="label"
            htmlFor="payment-amount"
            variant="body2"
            color="text.secondary"
            sx={{ display: 'block', mb: 1 }}
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
            afterChange={(e: string) => setPaymentAmount(+e)}
          />
        </Box>

        {/* Password */}
        <Box
          sx={{
            borderRadius: 2,
            border: 1,
            borderColor: alpha(theme.palette.divider, 0.4),
            bgcolor: alpha(theme.palette.background.default, 0.5),
            mb: 2,
            px: 2,
            py: 1.5,
          }}
        >
          <Typography
            component="label"
            htmlFor="payment-password"
            variant="body2"
            color="text.secondary"
            sx={{ display: 'block', mb: 1 }}
          >
            {t('auth:wallet.password_confirmation', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
          <PasswordField
            id="payment-password"
            value={paymentPassword}
            onChange={(e) => setPaymentPassword(e.target.value)}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (isLoadingSendCoin) return;
                sendCoinFunc();
              }
            }}
          />
        </Box>

        <ErrorText>{sendPaymentError}</ErrorText>

        <Spacer height="16px" />

        <Button
          variant="contained"
          fullWidth
          disabled={isLoadingSendCoin}
          onClick={() => {
            if (isLoadingSendCoin) return;
            sendCoinFunc();
          }}
          sx={{ borderRadius: 2, py: 1.25 }}
          startIcon={
            isLoadingSendCoin ? (
              <CircularProgress size={16} color="inherit" />
            ) : null
          }
        >
          {t('core:action.send', { postProcess: 'capitalizeFirstChar' })}
        </Button>

      </Box>
    </Box>
  );
};
