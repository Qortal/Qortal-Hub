import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';

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

type DetailRow = {
  label?: string;
  value: string;
};

const parseDetailRow = (value?: string): DetailRow | null => {
  if (!value?.trim()) return null;

  const trimmed = value.trim();
  const separatorIndex = trimmed.indexOf(':');

  if (separatorIndex > 0) {
    return {
      label: trimmed.slice(0, separatorIndex).trim(),
      value: trimmed.slice(separatorIndex + 1).trim() || '-',
    };
  }

  return { value: trimmed };
};

const formatRequestTitle = (value?: string) => {
  if (!value) return 'Permission request';
  return value.replace(/^Do you give this application permission to\s*/i, '');
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
  const typedMessage = (message || {}) as MessageQortalRequestExtension;
  const baseDetailRows = [typedMessage.text2, typedMessage.text3, typedMessage.text4]
    .map(parseDetailRow)
    .filter(Boolean) as DetailRow[];
  const summaryDetailRows = typedMessage.highlightedText
    ? baseDetailRows.slice(0, 1)
    : baseDetailRows.slice(0, 2);
  const accordionDetailRows = baseDetailRows.slice(summaryDetailRows.length);
  const feeRows = [
    typedMessage.fee
      ? { label: 'Network fee', value: `${typedMessage.fee} QORT` }
      : null,
    typedMessage.appFee
      ? {
          label: t('core:message.generic.fee_qort', {
            fee: typedMessage.appFee,
            postProcess: 'capitalizeFirstChar',
          }).split(':')[0],
          value: `${typedMessage.appFee} QORT`,
        }
      : null,
    typedMessage.foreignFee
      ? {
          label: t('core:message.generic.foreign_fee', {
            fee: typedMessage.foreignFee,
            postProcess: 'capitalizeFirstChar',
          }).split(':')[0],
          value: typedMessage.foreignFee,
        }
      : null,
  ].filter(Boolean) as DetailRow[];
  const showHtmlInSummary =
    !!typedMessage.html &&
    !typedMessage.highlightedText &&
    summaryDetailRows.length === 0;
  const hasDetailsAccordion =
    accordionDetailRows.length > 0 ||
    (!!typedMessage.html && !showHtmlInSummary) ||
    !!typedMessage.json;
  const canAccept = !typedMessage.confirmCheckbox || confirmRequestRead;

  if (!open) return null;

  return (
    <Dialog
      open={open}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
      PaperProps={{
        sx: {
          backgroundColor: alpha(theme.palette.background.paper, 0.98),
          backgroundImage: 'none',
          border: `1px solid ${alpha(theme.palette.common.white, 0.08)}`,
          borderRadius: '22px',
          boxShadow: '0px 22px 64px rgba(0, 0, 0, 0.42)',
          color: theme.palette.text.primary,
          maxWidth: '560px',
          overflow: 'hidden',
          width: 'min(560px, calc(100vw - 32px))',
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: '26px',
        }}
      >
        <Box
          sx={{
            alignItems: 'flex-start',
            display: 'flex',
            gap: '16px',
            justifyContent: 'space-between',
            width: '100%',
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
            <Box
              sx={{
                alignItems: 'center',
                color: theme.palette.text.secondary,
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
                }}
              >
                Permission request
              </Typography>
            </Box>
            <TextP
              sx={{
                fontSize: '29px',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                lineHeight: 1.12,
              }}
            >
              {formatRequestTitle(typedMessage.text1)}
            </TextP>
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '14px',
                lineHeight: 1.5,
                maxWidth: '440px',
              }}
            >
              Review what this application is asking for before you accept. Important
              decision details stay visible here, and extra request metadata is kept in
              the details section when available.
            </Typography>
          </Box>
          <Box
            sx={{
              alignItems: 'center',
              backgroundColor: alpha(theme.palette.background.default, 0.8),
              border: `1px solid ${alpha(theme.palette.common.white, 0.1)}`,
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
              colorsTime={[25, 12, 5, 0]}
              onComplete={onCountdownComplete}
              size={42}
              strokeWidth={4}
              trailColor={alpha(theme.palette.common.white, 0.12)}
            >
              {({ remainingTime }) => (
                <TextP sx={{ fontSize: '13px', fontWeight: 700 }}>{remainingTime}</TextP>
              )}
            </CountdownCircleTimer>
          </Box>
        </Box>
        <Spacer height="22px" />
        <Box
          sx={{
            backgroundColor: alpha(theme.palette.background.default, 0.56),
            border: `1px solid ${alpha(theme.palette.common.white, 0.08)}`,
            borderRadius: '18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            padding: '18px',
            width: '100%',
          }}
        >
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            What you are approving
          </Typography>
          {typedMessage.highlightedText && (
            <Box
              sx={{
                backgroundColor: alpha(theme.palette.primary.main, 0.1),
                border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                borderRadius: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                padding: '14px',
              }}
            >
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '12px',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                Requested value
              </Typography>
              <TextP sx={{ fontSize: '16px', fontWeight: 700, lineHeight: 1.35 }}>
                {typedMessage.highlightedText}
              </TextP>
            </Box>
          )}
          {summaryDetailRows.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {summaryDetailRows.map((row, index) => (
                <Box
                  key={`${row.label || row.value}-${index}`}
                  sx={{
                    alignItems: row.label ? 'baseline' : 'flex-start',
                    display: 'flex',
                    flexDirection: row.label ? 'row' : 'column',
                    gap: '8px',
                    justifyContent: 'space-between',
                  }}
                >
                  {row.label ? (
                    <>
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: '13px',
                          minWidth: '110px',
                          textTransform: 'capitalize',
                        }}
                      >
                        {row.label}
                      </Typography>
                      <TextP
                        sx={{
                          flex: 1,
                          fontSize: '15px',
                          fontWeight: 600,
                          lineHeight: 1.35,
                          textAlign: 'right',
                        }}
                      >
                        {row.value}
                      </TextP>
                    </>
                  ) : (
                    <TextP
                      sx={{
                        fontSize: '15px',
                        fontWeight: 600,
                        lineHeight: 1.45,
                      }}
                    >
                      {row.value}
                    </TextP>
                  )}
                </Box>
              ))}
            </Box>
          )}
          {showHtmlInSummary && (
            <Box
              sx={{
                '& *': {
                  color: `${theme.palette.text.primary} !important`,
                  fontFamily: 'Inter, sans-serif !important',
                },
                '& p, & li, & span': {
                  color: `${theme.palette.text.secondary} !important`,
                  lineHeight: '1.45 !important',
                },
                '& ul, & ol': {
                  margin: 0,
                  paddingLeft: '18px',
                },
              }}
              dangerouslySetInnerHTML={{ __html: typedMessage.html as string }}
            />
          )}
          {feeRows.length > 0 && (
            <Box
              sx={{
                borderTop: `1px solid ${alpha(theme.palette.common.white, 0.08)}`,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                paddingTop: '16px',
              }}
            >
              {feeRows.map((row, index) => (
                <Box
                  key={`${row.label}-${index}`}
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <Typography sx={{ color: theme.palette.text.secondary, fontSize: '13px' }}>
                    {row.label}
                  </Typography>
                  <TextP sx={{ fontSize: '14px', fontWeight: 700 }}>{row.value}</TextP>
                </Box>
              ))}
            </Box>
          )}
        </Box>
        {(typedMessage.checkbox1 || typedMessage.confirmCheckbox) && (
          <>
            <Spacer height="16px" />
            <Box
              sx={{
                backgroundColor: alpha(theme.palette.background.default, 0.38),
                border: `1px solid ${alpha(theme.palette.common.white, 0.08)}`,
                borderRadius: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                padding: '10px 14px',
                width: '100%',
              }}
            >
              {typedMessage.checkbox1 && (
                <FormControlLabel
                  control={
                    <Checkbox
                      onChange={(e) => onCheckbox1Change(e.target.checked)}
                      edge="start"
                      tabIndex={-1}
                      disableRipple
                      defaultChecked={typedMessage.checkbox1?.value}
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
                    <Typography sx={{ color: theme.palette.text.primary, fontSize: '14px' }}>
                      {typedMessage.checkbox1?.label}
                    </Typography>
                  }
                  sx={{ margin: 0 }}
                />
              )}
              {typedMessage.confirmCheckbox && (
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
                    <Box sx={{ alignItems: 'center', display: 'flex', gap: '8px' }}>
                      <Typography sx={{ color: theme.palette.text.primary, fontSize: '14px' }}>
                        {typedMessage.confirmCheckboxLabel ||
                          t('core:message.success.request_read', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                      </Typography>
                      <PriorityHighIcon color="warning" sx={{ fontSize: '18px' }} />
                    </Box>
                  }
                  sx={{ margin: 0 }}
                />
              )}
            </Box>
          </>
        )}
        {hasDetailsAccordion && (
          <>
            <Spacer height="16px" />
            <Accordion
              sx={{
                backgroundColor: alpha(theme.palette.background.default, 0.28),
                backgroundImage: 'none',
                border: `1px solid ${alpha(theme.palette.common.white, 0.08)}`,
                borderRadius: '16px !important',
                boxShadow: 'none',
                color: theme.palette.text.primary,
                width: '100%',
                '&:before': {
                  display: 'none',
                },
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreRoundedIcon sx={{ color: theme.palette.text.secondary }} />}
                sx={{
                  minHeight: '56px',
                  padding: '0 18px',
                  '& .MuiAccordionSummary-content': {
                    margin: '14px 0',
                  },
                }}
              >
                <Typography
                  sx={{
                    color: theme.palette.text.primary,
                    fontSize: '15px',
                    fontWeight: 700,
                  }}
                >
                  Technical details
                </Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ padding: '0 18px 18px' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {accordionDetailRows.map((row, index) => (
                    <Box
                      key={`${row.label || row.value}-${index}`}
                      sx={{
                        borderBottom:
                          index !== accordionDetailRows.length - 1 ||
                          typedMessage.html ||
                          typedMessage.json
                            ? `1px solid ${alpha(theme.palette.common.white, 0.08)}`
                            : 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        paddingBottom: '12px',
                      }}
                    >
                      {row.label && (
                        <Typography
                          sx={{
                            color: theme.palette.text.secondary,
                            fontSize: '12px',
                            fontWeight: 700,
                            letterSpacing: '0.05em',
                            textTransform: 'uppercase',
                          }}
                        >
                          {row.label}
                        </Typography>
                      )}
                      <TextP sx={{ fontSize: '14px', fontWeight: 600, lineHeight: 1.45 }}>
                        {row.value}
                      </TextP>
                    </Box>
                  ))}
                  {!!typedMessage.html && !showHtmlInSummary && (
                    <Box
                      sx={{
                        '& *': {
                          color: `${theme.palette.text.primary} !important`,
                          fontFamily: 'Inter, sans-serif !important',
                        },
                        '& p, & li, & span': {
                          color: `${theme.palette.text.secondary} !important`,
                          lineHeight: '1.45 !important',
                        },
                        '& ul, & ol': {
                          margin: 0,
                          paddingLeft: '18px',
                        },
                      }}
                      dangerouslySetInnerHTML={{ __html: typedMessage.html as string }}
                    />
                  )}
                  {typedMessage.json && (
                    <Box
                      sx={{
                        border: `1px solid ${alpha(theme.palette.common.white, 0.08)}`,
                        borderRadius: '12px',
                        overflow: 'auto',
                        padding: '10px',
                      }}
                    >
                      <JsonView
                        data={typedMessage.json}
                        shouldExpandNode={allExpanded}
                        style={darkStyles}
                      />
                    </Box>
                  )}
                </Box>
              </AccordionDetails>
            </Accordion>
          </>
        )}
        <Spacer height="22px" />
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end',
            width: '100%',
          }}
        >
          <CustomButtonAccept
            customColor="black"
            customBgColor={alpha(theme.palette.other.danger, 0.9)}
            sx={{
              minWidth: '118px',
              opacity: 0.92,
            }}
            onClick={onCancel}
          >
            {t('core:action.decline', { postProcess: 'capitalizeFirstChar' })}
          </CustomButtonAccept>
          <CustomButtonAccept
            customColor="black"
            customBgColor={theme.palette.other.positive}
            sx={{
              minWidth: '118px',
              opacity: canAccept ? 1 : 0.35,
              cursor: canAccept ? 'pointer' : 'default',
              '&:hover': {
                opacity: canAccept ? 1 : 0.35,
              },
            }}
            onClick={onAccept}
          >
            {t('core:action.accept', { postProcess: 'capitalizeFirstChar' })}
          </CustomButtonAccept>
        </Box>
        <ErrorText sx={{ marginTop: '12px', width: '100%' }}>{sendPaymentError}</ErrorText>
      </Box>
    </Dialog>
  );
}
