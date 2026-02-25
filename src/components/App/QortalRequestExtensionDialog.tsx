import { Box, Checkbox, Dialog, FormControlLabel, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { JsonView, allExpanded, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { CountdownCircleTimer } from 'react-countdown-circle-timer';
import { Spacer } from '../../common/Spacer';
import { CustomButtonAccept, TextP } from '../../styles/App-styles.ts';
import { ErrorText } from '../index';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';

export type MessageQortalRequestExtension = {
  text1?: string;
  text2?: string;
  text3?: string;
  text4?: string;
  html?: string;
  highlightedText?: string;
  json?: any;
  fee?: string;
  appFee?: string;
  foreignFee?: string;
  checkbox1?: { label?: string; value?: boolean };
  confirmCheckbox?: boolean;
  confirmCheckboxLabel?: string;
};

type QortalRequestExtensionDialogProps = {
  open: boolean;
  message: MessageQortalRequestExtension | null | Record<string, unknown>;
  sendPaymentError: string;
  confirmRequestRead: boolean;
  onConfirmRequestReadChange: (checked: boolean) => void;
  onCheckbox1Change: (checked: boolean) => void;
  onAccept: () => void;
  onCancel: () => void;
  onCountdownComplete: () => void;
};

export function QortalRequestExtensionDialog({
  open,
  message,
  sendPaymentError,
  confirmRequestRead,
  onConfirmRequestReadChange,
  onCheckbox1Change,
  onAccept,
  onCancel,
  onCountdownComplete,
}: QortalRequestExtensionDialogProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
    >
      <CountdownCircleTimer
        isPlaying
        duration={60}
        colors={['#004777', '#F7B801', '#A30000', '#A30000']}
        colorsTime={[7, 5, 2, 0]}
        onComplete={onCountdownComplete}
        size={50}
        strokeWidth={5}
      >
        {({ remainingTime }) => <TextP>{remainingTime}</TextP>}
      </CountdownCircleTimer>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: '20px',
        }}
      >
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
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'flex-start',
                width: '90%',
              }}
            >
              <TextP
                sx={{
                  lineHeight: 1.2,
                  fontSize: '16px',
                  fontWeight: 'normal',
                }}
              >
                {message.text2}
              </TextP>
            </Box>
            <Spacer height="15px" />
          </>
        )}
        {message?.text3 && (
          <>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'flex-start',
                width: '90%',
              }}
            >
              <TextP
                sx={{
                  lineHeight: 1.2,
                  fontSize: '16px',
                  fontWeight: 'normal',
                }}
              >
                {message.text3}
              </TextP>
            </Box>
            <Spacer height="15px" />
          </>
        )}
        {message?.text4 && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'flex-start',
              width: '90%',
            }}
          >
            <TextP
              sx={{
                lineHeight: 1.2,
                fontSize: '16px',
                fontWeight: 'normal',
              }}
            >
              {message.text4}
            </TextP>
          </Box>
        )}
        {message?.html && (
          <>
            <Spacer height="15px" />
            <div dangerouslySetInnerHTML={{ __html: message.html }} />
          </>
        )}
        <Spacer height="15px" />
        <TextP
          sx={{
            textAlign: 'center',
            lineHeight: 1.2,
            fontSize: '16px',
            fontWeight: 700,
            maxWidth: '90%',
          }}
        >
          {message?.highlightedText}
        </TextP>
        {message?.json && (
          <>
            <Spacer height="15px" />
            <JsonView
              data={message.json}
              shouldExpandNode={allExpanded}
              style={darkStyles}
            />
            <Spacer height="15px" />
          </>
        )}
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
              {'Fee: '}
              {message.fee}
              {' QORT'}
            </TextP>
            <Spacer height="15px" />
          </>
        )}
        {message?.appFee && (
          <>
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
                fee: message.appFee,
                postProcess: 'capitalizeFirstChar',
              })}
            </TextP>
            <Spacer height="15px" />
          </>
        )}
        {message?.foreignFee && (
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
              {t('core:message.generic.foreign_fee', {
                fee: message.foreignFee,
                postProcess: 'capitalizeFirstChar',
              })}
            </TextP>
            <Spacer height="15px" />
          </>
        )}
        {message?.checkbox1 && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '90%',
              marginTop: '20px',
            }}
          >
            <Checkbox
              onChange={(e) => onCheckbox1Change(e.target.checked)}
              edge="start"
              tabIndex={-1}
              disableRipple
              defaultChecked={message.checkbox1?.value}
              sx={{
                '&.Mui-checked': {
                  color: theme.palette.text.secondary,
                },
                '& .MuiSvgIcon-root': {
                  color: theme.palette.text.secondary,
                },
              }}
            />
            <Typography sx={{ fontSize: '14px' }}>
              {message.checkbox1?.label}
            </Typography>
          </Box>
        )}
        {message?.confirmCheckbox && (
          <FormControlLabel
            control={
              <Checkbox
                onChange={(e) => onConfirmRequestReadChange(e.target.checked)}
                checked={confirmRequestRead}
                edge="start"
                tabIndex={-1}
                disableRipple
                sx={{
                  '&.Mui-checked': {
                    color: theme.palette.text.secondary,
                  },
                  '& .MuiSvgIcon-root': {
                    color: theme.palette.text.secondary,
                  },
                }}
              />
            }
            label={
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography sx={{ fontSize: '14px' }}>
                  {message.confirmCheckboxLabel ||
                    t('core:message.success.request_read', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                </Typography>
                <PriorityHighIcon color="warning" />
              </Box>
            }
          />
        )}
        <Spacer height="29px" />
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '14px',
          }}
        >
          <CustomButtonAccept
            customColor="black"
            customBgColor={theme.palette.other.positive}
            sx={{
              minWidth: '102px',
              opacity:
                message?.confirmCheckbox && !confirmRequestRead ? 0.1 : 0.7,
              cursor:
                message?.confirmCheckbox && !confirmRequestRead
                  ? 'default'
                  : 'pointer',
              '&:hover': {
                opacity:
                  message?.confirmCheckbox && !confirmRequestRead ? 0.1 : 1,
              },
            }}
            onClick={onAccept}
          >
            {t('core:action.accept', { postProcess: 'capitalizeFirstChar' })}
          </CustomButtonAccept>
          <CustomButtonAccept
            customColor="black"
            customBgColor={theme.palette.other.danger}
            sx={{ minWidth: '102px' }}
            onClick={onCancel}
          >
            {t('core:action.decline', { postProcess: 'capitalizeFirstChar' })}
          </CustomButtonAccept>
        </Box>
        <ErrorText>{sendPaymentError}</ErrorText>
      </Box>
    </Dialog>
  );
}
