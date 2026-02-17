import { Box, ButtonBase } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Spacer } from '../../common/Spacer';
import { CustomButton, TextP } from '../../styles/App-styles.ts';
import { SuccessIcon } from '../../assets/Icons/SuccessIcon.tsx';

type SuccessOverlayProps = {
  messageKey: string;
  messageNs?: string;
  buttonLabelKey: string;
  buttonLabelNs?: string;
  onAction: () => void;
  fullPage?: boolean;
};

export function SuccessOverlay({
  messageKey,
  messageNs = 'core',
  buttonLabelKey,
  buttonLabelNs = 'core',
  onAction,
  fullPage = true,
}: SuccessOverlayProps) {
  const { t } = useTranslation([messageNs, buttonLabelNs]);

  const content = (
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
      <ButtonBase autoFocus={fullPage} onClick={onAction}>
        <CustomButton>
          {t(`${buttonLabelNs}:${buttonLabelKey}`, {
            postProcess: 'capitalizeFirstChar',
          })}
        </CustomButton>
      </ButtonBase>
    </>
  );

  if (fullPage) {
    return (
      <Box
        sx={{
          alignItems: 'center',
          background: (theme) => theme.palette.background.default,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          position: 'fixed',
          width: '100%',
          zIndex: 10000,
        }}
      >
        {content}
      </Box>
    );
  }

  return <>{content}</>;
}
