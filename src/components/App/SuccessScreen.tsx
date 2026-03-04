import { useTranslation } from 'react-i18next';
import { Spacer } from '../../common/Spacer';
import { CustomButton, TextP } from '../../styles/App-styles.ts';
import { SuccessIcon } from '../../assets/Icons/SuccessIcon.tsx';

type SuccessScreenProps = {
  messageKey: string;
  messageNs?: string;
  buttonLabelKey: string;
  buttonLabelNs?: string;
  onAction: () => void;
};

export function SuccessScreen({
  messageKey,
  messageNs = 'core',
  buttonLabelKey,
  buttonLabelNs = 'core',
  onAction,
}: SuccessScreenProps) {
  const { t } = useTranslation([messageNs, buttonLabelNs]);

  return (
    <>
      <Spacer height="48px" />
      <SuccessIcon />
      <Spacer height="45px" />
      <TextP
        sx={{
          textAlign: 'center',
          lineHeight: '15px',
        }}
      >
        {t(`${messageNs}:${messageKey}`, {
          postProcess: 'capitalizeFirstChar',
        })}
      </TextP>
      <Spacer height="100px" />
      <CustomButton onClick={onAction}>
        {t(`${buttonLabelNs}:${buttonLabelKey}`, {
          postProcess: 'capitalizeFirstChar',
        })}
      </CustomButton>
    </>
  );
}
