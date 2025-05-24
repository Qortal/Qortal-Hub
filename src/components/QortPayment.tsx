import { Box, useTheme } from '@mui/material';
import { useState } from 'react';
import { TextP } from '../styles/App-styles';
import { Spacer } from '../common/Spacer';
import { getFee } from '../background/background.ts';
import { useTranslation } from 'react-i18next';

export const QortPayment = ({ balance, show, onSuccess, defaultPaymentTo }) => {
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group']);
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
    <>
      <Box
        sx={{
          alignItems: 'flex-start',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <TextP
          sx={{
            fontSize: '20px',
            fontWeight: 600,
            lineHeight: '24px',
            textAlign: 'start',
          }}
        >
          {t('core:action.transfer_qort', {
            postProcess: 'capitalizeFirstChar',
          })}
        </TextP>

        <Spacer height="35px" />

        <TextP
          sx={{
            color: theme.palette.text.primary,
            fontSize: '20px',
            fontWeight: 600,
            lineHeight: '16px',
            textAlign: 'start',
          }}
        >
          {t('core:balance', {
            postProcess: 'capitalizeFirstChar',
          })}
        </TextP>

        <TextP
          sx={{
            fontSize: '20px',
            fontWeight: 700,
            lineHeight: '24px',
            textAlign: 'start',
          }}
        >
          {balance?.toFixed(2)} QORT
        </TextP>
      </Box>

      <Spacer height="35px" />

      <Box>
        <CustomLabel htmlFor="standard-adornment-name">
          {t('core:to', {
            postProcess: 'capitalizeFirstChar',
          })}
        </CustomLabel>

        <Spacer height="5px" />

        <CustomInput
          id="standard-adornment-name"
          value={paymentTo}
          onChange={(e) => setPaymentTo(e.target.value)}
          autoComplete="off"
        />

        <Spacer height="6px" />

        <CustomLabel htmlFor="standard-adornment-amount">
          {t('core:amount', {
            postProcess: 'capitalizeFirstChar',
          })}
        </CustomLabel>

        <Spacer height="5px" />

        <BoundedNumericTextField
          value={paymentAmount}
          minValue={0}
          maxValue={+balance}
          allowDecimals={true}
          initialValue={'0'}
          allowNegatives={false}
          afterChange={(e: string) => setPaymentAmount(+e)}
        />

        <Spacer height="6px" />

        <CustomLabel htmlFor="standard-adornment-password">
          {t('auth:wallet.password_confirmation', {
            postProcess: 'capitalizeFirstChar',
          })}
        </CustomLabel>

        <Spacer height="5px" />

        <PasswordField
          id="standard-adornment-password"
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

      <Spacer height="10px" />

      <ErrorText>{sendPaymentError}</ErrorText>

      <Spacer height="25px" />

      <CustomButton
        sx={{
          cursor: isLoadingSendCoin ? 'default' : 'pointer',
        }}
        onClick={() => {
          if (isLoadingSendCoin) return;
          sendCoinFunc();
        }}
      >
        {isLoadingSendCoin && (
          <CircularProgress
            size={16}
            sx={{
              color: theme.palette.text.primary,
            }}
          />
        )}
        {t('core:action.send', { postProcess: 'capitalizeFirstChar' })}
      </CustomButton>
    </>
  );
};
