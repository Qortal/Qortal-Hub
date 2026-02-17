import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import Logo1Dark from '../../assets/svgs/Logo1Dark.svg';
import { Spacer } from '../../common/Spacer';
import { CustomButton, TextItalic, TextP, TextSpan } from '../../styles/App-styles.ts';

type ConnectionRequestScreenProps = {
  hostname?: string;
  onAccept: () => void;
  onDecline: () => void;
};

export function ConnectionRequestScreen({
  hostname,
  onAccept,
  onDecline,
}: ConnectionRequestScreenProps) {
  const { t } = useTranslation(['core']);

  return (
    <>
      <Spacer height="48px" />
      <div
        className="image-container"
        style={{ width: '136px', height: '154px' }}
      >
        <img src={Logo1Dark} className="base-image" alt="Qortal" />
      </div>
      <Spacer height="38px" />
      <TextP sx={{ textAlign: 'center', lineHeight: '15px' }}>
        The Application <br />
        <TextItalic>{hostname}</TextItalic> <br />
        <TextSpan>is requestion a connection</TextSpan>
      </TextP>
      <Spacer height="38px" />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <CustomButton sx={{ minWidth: '102px' }} onClick={onAccept}>
          {t('core:action.accept', { postProcess: 'capitalizeFirstChar' })}
        </CustomButton>
        <CustomButton sx={{ minWidth: '102px' }} onClick={onDecline}>
          {t('core:action.decline', { postProcess: 'capitalizeFirstChar' })}
        </CustomButton>
      </Box>
    </>
  );
}
