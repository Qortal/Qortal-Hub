import { Box } from '@mui/material';
import { Trans, useTranslation } from 'react-i18next';
import { Spacer } from '../../common/Spacer';
import { CustomButton, TextItalic, TextP, TextSpan } from '../../styles/App-styles.ts';
import { ErrorText } from '../index';

type PaymentRequestScreenProps = {
  hostname?: string;
  count?: number;
  description?: string;
  amount?: string | number;
  sendPaymentError: string;
  onAccept: () => void;
  onDecline: () => void;
};

export function PaymentRequestScreen({
  hostname,
  count = 0,
  description,
  amount,
  sendPaymentError,
  onAccept,
  onDecline,
}: PaymentRequestScreenProps) {
  const { t } = useTranslation(['core']);

  return (
    <>
      <Spacer height="100px" />
      <TextP sx={{ textAlign: 'center', lineHeight: '15px' }}>
        <Trans
          i18nKey="message.generic.payment_request"
          ns="core"
          components={{ br: <br />, italic: <TextItalic />, span: <TextSpan /> }}
          values={{ hostname, count }}
          tOptions={{ postProcess: ['capitalizeFirstChar'] }}
        />
      </TextP>
      <Spacer height="10px" />
      <TextP
        sx={{
          textAlign: 'center',
          lineHeight: '15px',
          fontSize: '10px',
        }}
      >
        {description}
      </TextP>
      <Spacer height="15px" />
      <TextP
        sx={{
          textAlign: 'center',
          lineHeight: '24px',
          fontSize: '20px',
          fontWeight: 700,
        }}
      >
        {amount} QORT
      </TextP>
      <Spacer height="29px" />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <CustomButton sx={{ minWidth: '102px' }} onClick={onAccept}>
          {t('core:action.accept', { postProcess: 'capitalizeFirstChar' })}
        </CustomButton>
        <CustomButton sx={{ minWidth: '102px' }} onClick={onDecline}>
          {t('core:action.decline', { postProcess: 'capitalizeFirstChar' })}
        </CustomButton>
      </Box>
      <ErrorText>{sendPaymentError}</ErrorText>
    </>
  );
}
