import {
  Box,
  Checkbox,
  Dialog,
  FormControlLabel,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { JsonView, allExpanded, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { CountdownCircleTimer } from 'react-countdown-circle-timer';
import { Spacer } from '../../common/Spacer';
import { CustomButtonAccept, TextP } from '../../styles/App-styles.ts';
import { ErrorText } from '../index';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import {
  QortalRequestDetails,
  QortalRequestDetailsData,
} from './QortalRequestDetails';

const QORTAL_REQUEST_DIALOG_Z_INDEX = 11000;

export type MessageQortalRequestExtension = {
  text1?: string;
  text2?: string;
  text3?: string;
  text4?: string;
  details?: QortalRequestDetailsData;
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
  const requestMessage = (message || {}) as MessageQortalRequestExtension & {
    appName?: string;
    sourceKind?: string;
    sourceLabel?: string;
  };
  const canAccept = !requestMessage.confirmCheckbox || confirmRequestRead;
  const bodyLines = [
    requestMessage.text2,
    requestMessage.text3,
    requestMessage.text4,
  ].filter(Boolean);
  const sourceKind = requestMessage.sourceKind || 'Q-APP';
  const sourceLabel = requestMessage.sourceLabel || requestMessage.appName;
  const summaryText =
    requestMessage.highlightedText ||
    (requestMessage.text1?.toLowerCase().includes('authenticate')
      ? 'Grant permissions for this session only'
      : requestMessage.text1);
  const wrappingTextSx = {
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  };

  if (!open) return null;

  return (
    <Dialog
      open={open}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
      sx={{ zIndex: QORTAL_REQUEST_DIALOG_Z_INDEX }}
      PaperProps={{
        sx: {
          backgroundColor: 'transparent',
          backgroundImage: 'none',
          boxShadow: 'none',
          margin: '16px',
          maxWidth: 'none',
          overflow: 'visible',
        },
      }}
    >
      <Box
        sx={{
          backgroundColor:
            theme.palette.mode === 'dark'
              ? alpha('#0d1117', 0.985)
              : alpha('#ffffff', 0.985),
          backgroundImage: 'none',
          border: `1px solid ${alpha(
            theme.palette.common.white,
            theme.palette.mode === 'dark' ? 0.07 : 0.06
          )}`,
          borderRadius: '24px',
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0px 28px 72px rgba(0, 0, 0, 0.52)'
              : '0px 18px 52px rgba(16, 24, 40, 0.14)',
          color: theme.palette.text.primary,
          display: 'flex',
          flexDirection: 'column',
          maxWidth: '560px',
          overflow: 'hidden',
          width: 'min(560px, calc(100vw - 32px))',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '90vh',
            overflowX: 'hidden',
            overflowY: 'auto',
            padding: '26px',
          }}
        >
          <Box
            sx={{
              alignItems: 'flex-start',
              borderBottom: `1px solid ${alpha(
                theme.palette.common.white,
                theme.palette.mode === 'dark' ? 0.08 : 0.06
              )}`,
              display: 'flex',
              gap: '16px',
              justifyContent: 'space-between',
              paddingBottom: '18px',
              width: '100%',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                minWidth: 0,
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  color: alpha(theme.palette.text.secondary, 0.92),
                  display: 'flex',
                  gap: '8px',
                }}
              >
                <ShieldOutlinedIcon sx={{ fontSize: '18px' }} />
                <Typography
                  sx={{
                    fontSize: '12px',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    ...wrappingTextSx,
                  }}
                >
                  {sourceLabel
                    ? `${sourceKind}: ${sourceLabel}`
                    : `${sourceKind} request`}
                </Typography>
              </Box>
              <TextP
                sx={{
                  fontSize: { xs: '22px', sm: '24px' },
                  fontWeight: 700,
                  lineHeight: 1.18,
                  marginTop: '4px',
                  ...wrappingTextSx,
                }}
              >
                {requestMessage.text1}
              </TextP>
              {bodyLines.length ? (
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.92),
                    fontSize: '14px',
                    lineHeight: 1.5,
                    maxWidth: '440px',
                    whiteSpace: 'pre-line',
                    ...wrappingTextSx,
                  }}
                >
                  {bodyLines.join('\n')}
                </Typography>
              ) : null}
            </Box>
            <Box
              sx={{
                alignItems: 'center',
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? alpha('#0e141c', 0.95)
                    : alpha('#f2f5f8', 0.98),
                border: `1px solid ${alpha(
                  theme.palette.primary.main,
                  theme.palette.mode === 'dark' ? 0.22 : 0.14
                )}`,
                borderRadius: '999px',
                display: 'flex',
                justifyContent: 'center',
                minWidth: '74px',
                padding: '6px 10px',
              }}
            >
              <CountdownCircleTimer
                isPlaying
                duration={60}
                colors={['#2D7FF9', '#E8A13A', '#C45151', '#C45151']}
                colorsTime={[24, 12, 3, 0]}
                onComplete={onCountdownComplete}
                size={42}
                strokeWidth={4}
                trailColor={alpha(theme.palette.common.white, 0.12)}
              >
                {({ remainingTime }) => (
                  <TextP sx={{ fontSize: '13px', fontWeight: 700 }}>
                    {remainingTime}
                  </TextP>
                )}
              </CountdownCircleTimer>
            </Box>
          </Box>

          <Spacer height="22px" />

          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              width: '100%',
            }}
          >
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.82),
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              What you are approving
            </Typography>

            <Box
              sx={{
                alignItems: 'flex-start',
                display: 'flex',
                gap: '10px',
              }}
            >
              <RadioButtonUncheckedRoundedIcon
                sx={{
                  color: alpha(theme.palette.primary.main, 0.7),
                  fontSize: '12px',
                  marginTop: '5px',
                }}
              />
              <Typography
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: '15px',
                  fontWeight: 600,
                  lineHeight: 1.5,
                  minWidth: 0,
                  ...wrappingTextSx,
                }}
              >
                {summaryText}
              </Typography>
            </Box>
          </Box>

          {requestMessage.details && (
            <>
              <Spacer height="15px" />
              <Box
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: '14px',
                  lineHeight: 1.45,
                  width: '100%',
                  ...wrappingTextSx,
                  '& *': wrappingTextSx,
                }}
              >
                <QortalRequestDetails details={requestMessage.details} />
              </Box>
            </>
          )}

          {requestMessage.json && (
            <>
              <Spacer height="15px" />
              <Box sx={{ maxWidth: '100%', overflow: 'auto', width: '100%' }}>
                <JsonView
                  data={requestMessage.json}
                  shouldExpandNode={allExpanded}
                  style={darkStyles}
                />
              </Box>
            </>
          )}

          {(requestMessage.fee ||
            requestMessage.appFee ||
            requestMessage.foreignFee) && (
            <>
              <Spacer height="16px" />
              <Box
                sx={{
                  borderTop: `1px solid ${alpha(
                    theme.palette.common.white,
                    theme.palette.mode === 'dark' ? 0.08 : 0.06
                  )}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  paddingTop: '16px',
                  width: '100%',
                }}
              >
                {requestMessage.fee && (
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: '12px',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '13px',
                      }}
                    >
                      Fee
                    </Typography>
                    <TextP
                      sx={{
                        fontSize: '14px',
                        fontWeight: 700,
                        textAlign: 'right',
                        ...wrappingTextSx,
                      }}
                    >
                      {requestMessage.fee} QORT
                    </TextP>
                  </Box>
                )}
                {requestMessage.appFee && (
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: '12px',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '13px',
                      }}
                    >
                      App fee
                    </Typography>
                    <TextP
                      sx={{
                        fontSize: '14px',
                        fontWeight: 700,
                        textAlign: 'right',
                        ...wrappingTextSx,
                      }}
                    >
                      {requestMessage.appFee} QORT
                    </TextP>
                  </Box>
                )}
                {requestMessage.foreignFee && (
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: '12px',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '13px',
                      }}
                    >
                      Foreign fee
                    </Typography>
                    <TextP
                      sx={{
                        fontSize: '14px',
                        fontWeight: 700,
                        textAlign: 'right',
                        ...wrappingTextSx,
                      }}
                    >
                      {requestMessage.foreignFee}
                    </TextP>
                  </Box>
                )}
              </Box>
            </>
          )}

          {(requestMessage.checkbox1 || requestMessage.confirmCheckbox) && (
            <>
              <Spacer height="16px" />
              <Box
                sx={{
                  backgroundColor:
                    theme.palette.mode === 'dark'
                      ? alpha('#131922', 0.82)
                      : alpha('#f5f8fb', 0.92),
                  border: `1px solid ${alpha(
                    requestMessage.confirmCheckbox
                      ? theme.palette.warning.main
                      : theme.palette.common.white,
                    requestMessage.confirmCheckbox
                      ? 0.22
                      : theme.palette.mode === 'dark'
                        ? 0.06
                        : 0.05
                  )}`,
                  borderRadius: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '12px 14px',
                  width: '100%',
                }}
              >
                {requestMessage.checkbox1 && (
                  <FormControlLabel
                    control={
                      <Checkbox
                        onChange={(e) => onCheckbox1Change(e.target.checked)}
                        edge="start"
                        tabIndex={-1}
                        disableRipple
                        defaultChecked={requestMessage.checkbox1?.value}
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
                      <Typography
                        sx={{
                          color: theme.palette.text.primary,
                          fontSize: '14px',
                          ...wrappingTextSx,
                        }}
                      >
                        {requestMessage.checkbox1?.label}
                      </Typography>
                    }
                    sx={{ margin: 0 }}
                  />
                )}
                {requestMessage.confirmCheckbox && (
                  <FormControlLabel
                    control={
                      <Checkbox
                        onChange={(e) =>
                          onConfirmRequestReadChange(e.target.checked)
                        }
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
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <Typography
                          sx={{
                            color: theme.palette.text.primary,
                            fontSize: '14px',
                            lineHeight: 1.45,
                            ...wrappingTextSx,
                          }}
                        >
                          {requestMessage.confirmCheckboxLabel ||
                            t('core:message.success.request_read', {
                              postProcess: 'capitalizeFirstChar',
                            })}
                        </Typography>
                        <PriorityHighIcon
                          color="warning"
                          sx={{ fontSize: '18px' }}
                        />
                      </Box>
                    }
                    sx={{ margin: 0 }}
                  />
                )}
              </Box>
            </>
          )}

          <Spacer height="22px" />

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: '12px',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <CustomButtonAccept
              customColor={theme.palette.text.primary}
              customBgColor={
                theme.palette.mode === 'dark'
                  ? alpha('#171d27', 0.96)
                  : alpha('#eef3f8', 0.98)
              }
              sx={{
                border: `1px solid ${alpha(
                  theme.palette.common.white,
                  theme.palette.mode === 'dark' ? 0.08 : 0.06
                )}`,
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? '0px 10px 24px rgba(0,0,0,0.24)'
                    : '0px 8px 18px rgba(15,23,42,0.08)',
                filter: 'none',
                minWidth: '122px',
                opacity: 1,
                transition:
                  'background-color 180ms ease, border-color 180ms ease, box-shadow 200ms ease, transform 180ms ease',
                '&:hover': {
                  backgroundColor:
                    theme.palette.mode === 'dark'
                      ? alpha('#21171c', 0.98)
                      : alpha('#f8eef0', 0.98),
                  borderColor: alpha(theme.palette.error.main, 0.2),
                  boxShadow:
                    theme.palette.mode === 'dark'
                      ? '0px 14px 28px rgba(116, 34, 55, 0.2)'
                      : '0px 12px 22px rgba(185, 28, 28, 0.08)',
                  color: theme.palette.text.primary,
                  transform: 'translateY(-1px)',
                },
              }}
              onClick={onCancel}
            >
              {t('core:action.decline', { postProcess: 'capitalizeFirstChar' })}
            </CustomButtonAccept>
            <CustomButtonAccept
              customColor="#06111c"
              customBgColor={
                theme.palette.mode === 'dark' ? '#76aef4' : '#6da5eb'
              }
              sx={{
                border: `1px solid ${alpha('#b6d3ff', 0.26)}`,
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? '0px 10px 24px rgba(58, 112, 188, 0.26)'
                    : '0px 8px 18px rgba(67, 112, 181, 0.16)',
                cursor: canAccept ? 'pointer' : 'default',
                filter: 'none',
                minWidth: '122px',
                opacity: canAccept ? 1 : 0.35,
                transition:
                  'background-color 180ms ease, border-color 180ms ease, box-shadow 200ms ease, transform 180ms ease, opacity 180ms ease',
                '&:hover': {
                  backgroundColor:
                    theme.palette.mode === 'dark' ? '#86baf8' : '#78aff0',
                  borderColor: alpha('#d2e4ff', 0.36),
                  boxShadow:
                    theme.palette.mode === 'dark'
                      ? '0px 14px 30px rgba(76, 133, 214, 0.28)'
                      : '0px 12px 24px rgba(77, 124, 212, 0.18)',
                  color: '#06111c',
                  opacity: canAccept ? 1 : 0.35,
                  transform: canAccept ? 'translateY(-1px)' : 'none',
                },
              }}
              onClick={onAccept}
            >
              {t('core:action.accept', { postProcess: 'capitalizeFirstChar' })}
            </CustomButtonAccept>
          </Box>

          {sendPaymentError ? (
            <ErrorText sx={{ marginTop: '12px', width: '100%' }}>
              {sendPaymentError}
            </ErrorText>
          ) : null}
        </Box>
      </Box>
    </Dialog>
  );
}
