import { Box, Checkbox, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import { Spacer } from '../../common/Spacer';
import { CustomButton, TextP } from '../../styles/App-styles.ts';
import { ErrorText } from '../index';

type MessageQortalRequest = {
  text1?: string;
  text2?: string;
  text3?: string;
  text4?: string;
  html?: string;
  highlightedText?: string;
  fee?: string;
  checkbox1?: { label?: string; value?: boolean };
};

type QortalRequestScreenProps = {
  message: MessageQortalRequest | null | Record<string, unknown>;
  sendPaymentError: string;
  onAccept: () => void;
  onDecline: () => void;
  onCheckboxChange?: (checked: boolean) => void;
  checkboxDefaultChecked?: boolean;
};

export function QortalRequestScreen({
  message,
  sendPaymentError,
  onAccept,
  onDecline,
  onCheckboxChange,
  checkboxDefaultChecked,
}: QortalRequestScreenProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  return (
    <>
      <Spacer height="120px" />
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          width: '100%',
        }}
      >
        <TextP
          sx={{
            lineHeight: 1.2,
            maxWidth: '90%',
            textAlign: 'center',
            fontSize: '16px',
            marginBottom: '10px',
          }}
        >
          {message?.text1}
        </TextP>
      </Box>
      {message?.text2 && (
        <>
          <Spacer height="10px" />
          <Box sx={{ display: 'flex', justifyContent: 'flex-start', width: '90%' }}>
            <TextP sx={{ lineHeight: 1.2, fontSize: '16px', fontWeight: 'normal' }}>
              {message.text2}
            </TextP>
          </Box>
          <Spacer height="15px" />
        </>
      )}
      {message?.text3 && (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'flex-start', width: '90%' }}>
            <TextP sx={{ lineHeight: 1.2, fontSize: '16px', fontWeight: 'normal' }}>
              {message.text3}
            </TextP>
          </Box>
          <Spacer height="15px" />
        </>
      )}
      {message?.text4 && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-start', width: '90%' }}>
          <TextP sx={{ lineHeight: 1.2, fontSize: '16px', fontWeight: 'normal' }}>
            {message.text4}
          </TextP>
        </Box>
      )}
      {message?.html && (
        <div dangerouslySetInnerHTML={{ __html: message.html }} />
      )}
      <Spacer height="15px" />
      <TextP
        sx={{
          fontSize: '16px',
          fontWeight: 700,
          lineHeight: 1.2,
          maxWidth: '90%',
          textAlign: 'center',
        }}
      >
        {message?.highlightedText}
      </TextP>
      {message?.fee && (
        <>
          <Spacer height="15px" />
          <TextP
            sx={{
              textAlign: 'center',
              lineHeight: 1.2,
              fontSize: '16px',
              fontWeight: 'normal',
              maxWidth: '90%',
            }}
          >
            {t('core:message.generic.fee_qort', {
              fee: message.fee,
              postProcess: 'capitalizeFirstChar',
            })}
          </TextP>
          <Spacer height="15px" />
        </>
      )}
      {message?.checkbox1 && (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '10px',
            justifyContent: 'center',
            marginTop: '20px',
            width: '90%',
          }}
        >
          <Checkbox
            onChange={(e) => onCheckboxChange?.(e.target.checked)}
            edge="start"
            tabIndex={-1}
            disableRipple
            defaultChecked={checkboxDefaultChecked ?? message.checkbox1?.value}
            sx={{
              '&.Mui-checked': { color: theme.palette.text.secondary },
              '& .MuiSvgIcon-root': { color: theme.palette.text.secondary },
            }}
          />
          <Typography sx={{ fontSize: '14px' }}>
            {message.checkbox1?.label}
          </Typography>
        </Box>
      )}
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
