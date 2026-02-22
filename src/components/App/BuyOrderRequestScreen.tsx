import { Box } from '@mui/material';
import { Trans, useTranslation } from 'react-i18next';
import { Spacer } from '../../common/Spacer';
import { CustomButton, TextItalic, TextP, TextSpan } from '../../styles/App-styles.ts';
import { ErrorText } from '../index';

type CrosschainInfo = {
  qortAmount?: string;
  expectedForeignAmount?: number;
  foreignBlockchain?: string;
};

type BuyOrderRequestScreenProps = {
  hostname?: string;
  crosschainAtInfo?: CrosschainInfo[];
  sendPaymentError: string;
  roundUpToDecimals: (num: number, decimals?: number) => number;
  onAccept: () => void;
  onDecline: () => void;
};

export function BuyOrderRequestScreen({
  hostname,
  crosschainAtInfo = [],
  sendPaymentError,
  roundUpToDecimals,
  onAccept,
  onDecline,
}: BuyOrderRequestScreenProps) {
  const { t } = useTranslation(['core']);

  const totalQort = crosschainAtInfo.reduce(
    (sum, cur) => sum + +(cur?.qortAmount ?? 0),
    0
  );
  const totalForeign = crosschainAtInfo.reduce(
    (sum, cur) => sum + +(cur?.expectedForeignAmount ?? 0),
    0
  );
  const blockchain = crosschainAtInfo?.[0]?.foreignBlockchain ?? '';

  return (
    <>
      <Spacer height="100px" />
      <TextP sx={{ textAlign: 'center', lineHeight: '15px' }}>
        <Trans
          i18nKey="message.generic.buy_order_request"
          ns="core"
          components={{ br: <br />, italic: <TextItalic />, span: <TextSpan /> }}
          values={{ hostname, count: crosschainAtInfo.length }}
          tOptions={{ postProcess: ['capitalizeFirstChar'] }}
        />
      </TextP>
      <Spacer height="10px" />
      <TextP
        sx={{
          fontSize: '20px',
          fontWeight: 700,
          lineHeight: '24px',
          textAlign: 'center',
        }}
      >
        {totalQort} QORT
      </TextP>
      <Spacer height="15px" />
      <TextP
        sx={{
          textAlign: 'center',
          lineHeight: '15px',
          fontSize: '14px',
        }}
      >
        {t('core:for', { postProcess: 'capitalizeAll' })}
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
        {roundUpToDecimals(totalForeign)}
        {` ${blockchain}`}
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
