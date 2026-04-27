import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { Box, ButtonBase, Typography, alpha, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
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
  const theme = useTheme();
  const message = t(`${messageNs}:${messageKey}`, {
    postProcess: 'capitalizeFirstChar',
  });
  const buttonLabel = t(`${buttonLabelNs}:${buttonLabelKey}`, {
    postProcess: 'capitalizeFirstChar',
  });

  if (fullPage) {
    return (
      <Box
        sx={{
          alignItems: 'center',
          background: theme.palette.background.default,
          display: 'flex',
          height: '100%',
          justifyContent: 'center',
          position: 'fixed',
          width: '100%',
          zIndex: 10000,
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            background: '#111820',
            border: `1px solid ${alpha('#A9BCD8', 0.18)}`,
            borderRadius: '18px',
            boxShadow: `0 24px 58px ${alpha('#000', 0.42)}`,
            display: 'flex',
            flexDirection: 'column',
            maxWidth: 380,
            px: 3,
            py: 3.2,
            textAlign: 'center',
            width: 'calc(100% - 40px)',
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              bgcolor: alpha(theme.palette.other.positive, 0.14),
              border: `1px solid ${alpha(theme.palette.other.positive, 0.34)}`,
              borderRadius: '50%',
              color: theme.palette.other.positive,
              display: 'flex',
              height: 58,
              justifyContent: 'center',
              mb: 2,
              width: 58,
            }}
          >
            <CheckRoundedIcon sx={{ fontSize: 34 }} />
          </Box>
          <Typography sx={{ fontSize: '1.28rem', fontWeight: 650, mb: 0.8 }}>
            {message}
          </Typography>
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.88),
              fontSize: '0.9rem',
              lineHeight: 1.45,
              mb: 2.4,
            }}
          >
            Your transfer was submitted successfully.
          </Typography>
          <ButtonBase autoFocus onClick={onAction} sx={{ width: '100%' }}>
            <CustomButton
              sx={{
                fontWeight: 600,
                minHeight: 44,
                width: '100%',
              }}
            >
              {buttonLabel}
            </CustomButton>
          </ButtonBase>
        </Box>
      </Box>
    );
  }

  const content = (
    <>
      <SuccessIcon />
      <TextP
        sx={{
          mt: 2,
          textAlign: 'center',
          lineHeight: '15px',
        }}
      >
        {message}
      </TextP>
      <ButtonBase autoFocus={fullPage} onClick={onAction}>
        <CustomButton sx={{ fontWeight: 600, mt: 3 }}>
          {buttonLabel}
        </CustomButton>
      </ButtonBase>
    </>
  );

  return <>{content}</>;
}
