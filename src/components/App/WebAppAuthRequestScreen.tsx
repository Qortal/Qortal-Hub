import { useTranslation } from 'react-i18next';
import Logo1Dark from '../../assets/svgs/Logo1Dark.svg';
import { Spacer } from '../../common/Spacer';
import { CustomButton, TextItalic, TextP, TextSpan } from '../../styles/App-styles.ts';

type WebAppAuthRequestScreenProps = {
  hostname?: string;
  getRootProps: () => any;
  getInputProps: () => any;
  onCreateAccount: () => void;
};

export function WebAppAuthRequestScreen({
  hostname,
  getRootProps,
  getInputProps,
  onCreateAccount,
}: WebAppAuthRequestScreenProps) {
  const { t } = useTranslation(['auth', 'core']);

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
        <TextSpan>requests authentication</TextSpan>
      </TextP>
      <Spacer height="38px" />
      <Spacer height="38px" />
      <CustomButton {...getRootProps()}>
        <input {...getInputProps()} />
        {t('auth:action.authenticate', {
          postProcess: 'capitalizeFirstChar',
        })}
      </CustomButton>
      <Spacer height="6px" />
      <CustomButton onClick={onCreateAccount}>
        {t('auth:action.create_account', {
          postProcess: 'capitalizeFirstChar',
        })}
      </CustomButton>
    </>
  );
}
