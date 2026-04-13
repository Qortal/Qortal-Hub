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
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import type {
  MessageQortalRequestExtension,
  PermissionDetailSection,
} from './qortalPermissionPresentation';
import { buildPermissionPresentation } from './qortalPermissionPresentation';

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
  countdownSeconds?: number;
};

type PermissionCardProps = {
  message: MessageQortalRequestExtension;
  sendPaymentError?: string;
  confirmRequestRead: boolean;
  onConfirmRequestReadChange: (checked: boolean) => void;
  onCheckbox1Change: (checked: boolean) => void;
  onAccept: () => void;
  onCancel: () => void;
  onCountdownComplete: () => void;
  countdownSeconds?: number;
  showCountdown?: boolean;
  acceptLabel?: string;
  declineLabel?: string;
  hideDecline?: boolean;
};

const renderDetailSection = (
  section: PermissionDetailSection,
  index: number,
  theme: ReturnType<typeof useTheme>
) => {
  return (
    <Box key={`${section.title || 'section'}-${index}`} sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {section.title && (
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '12px',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          {section.title}
        </Typography>
      )}
      {section.rows?.length ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {section.rows.map((row, rowIndex) => (
            <Box
              key={`${row.label}-${rowIndex}`}
              sx={{
                alignItems: row.label ? 'baseline' : 'flex-start',
                display: 'flex',
                flexDirection: row.label ? 'row' : 'column',
                gap: '10px',
                justifyContent: 'space-between',
              }}
            >
              {row.label ? (
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: '13px',
                    minWidth: '120px',
                    textTransform: 'capitalize',
                  }}
                >
                  {row.label}
                </Typography>
              ) : null}
              <TextP
                sx={{
                  flex: 1,
                  fontSize: '14px',
                  fontWeight: 600,
                  lineHeight: 1.45,
                  textAlign: row.label ? 'right' : 'left',
                }}
              >
                {row.value}
              </TextP>
            </Box>
          ))}
        </Box>
      ) : null}
      {section.html ? (
        <Box
          sx={{
            '& *': {
              color: `${theme.palette.text.primary} !important`,
              fontFamily: 'Inter, sans-serif !important',
            },
            '& p, & li, & span, & div': {
              lineHeight: '1.45 !important',
            },
            '& ul, & ol': {
              margin: 0,
              paddingLeft: '18px',
            },
          }}
          dangerouslySetInnerHTML={{ __html: section.html }}
        />
      ) : null}
      {section.json ? (
        <Box
          sx={{
            backgroundColor:
              theme.palette.mode === 'dark'
                ? alpha('#0f141b', 0.72)
                : alpha('#f4f7fb', 0.92),
            border: `1px solid ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.045 : 0.04)}`,
            borderRadius: '12px',
            overflow: 'auto',
            padding: '10px',
            '& .json-view': {
              backgroundColor: 'transparent !important',
            },
            '& .string-value, & .number-value, & .boolean-value, & .null-value, & .other-value, & .punctuation, & .data-type-label, & .object-key': {
              color: `${alpha(theme.palette.text.secondary, theme.palette.mode === 'dark' ? 0.8 : 0.88)} !important`,
            },
          }}
        >
          <JsonView data={section.json} shouldExpandNode={allExpanded} style={darkStyles} />
        </Box>
      ) : null}
    </Box>
  );
};

export function QortalPermissionCard({
  message,
  sendPaymentError = '',
  confirmRequestRead,
  onConfirmRequestReadChange,
  onCheckbox1Change,
  onAccept,
  onCancel,
  onCountdownComplete,
  countdownSeconds,
  showCountdown = true,
  acceptLabel,
  declineLabel,
  hideDecline = false,
}: PermissionCardProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const presentation = buildPermissionPresentation(message, t);
  const canAccept = !message.confirmCheckbox || confirmRequestRead;
  const duration = countdownSeconds ?? message.countdownDuration ?? 60;
  const hasDetailsAccordion = presentation.detailsSections.length > 0;
  const requiresAcknowledgement = !!message.confirmCheckbox;
  const acknowledgementMessage = requiresAcknowledgement
    ? 'Please confirm before continuing.'
    : '';

  return (
    <Box
      sx={{
        backgroundColor:
          theme.palette.mode === 'dark'
            ? alpha('#0d1117', 0.985)
            : alpha('#ffffff', 0.985),
        backgroundImage: 'none',
        border: `1px solid ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.07 : 0.06)}`,
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
            paddingBottom: '18px',
            borderBottom: `1px solid ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.08 : 0.06)}`,
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
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
                }}
              >
                {presentation.sourceLabel
                  ? `${presentation.sourceKind}: ${presentation.sourceLabel}`
                  : `${presentation.sourceKind} request`}
              </Typography>
            </Box>
            <TextP
              sx={{
                fontSize: '29px',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                lineHeight: 1.12,
                marginTop: '4px',
              }}
            >
              {presentation.title}
            </TextP>
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.92),
                fontSize: '14px',
                lineHeight: 1.5,
                maxWidth: '440px',
                whiteSpace: 'pre-line',
              }}
            >
              {presentation.body}
            </Typography>
          </Box>
          {showCountdown ? (
            <Box
              sx={{
                alignItems: 'center',
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? alpha('#0e141c', 0.95)
                    : alpha('#f2f5f8', 0.98),
                border: `1px solid ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.14)}`,
                borderRadius: '999px',
                display: 'flex',
                justifyContent: 'center',
                minWidth: '74px',
                padding: '6px 10px',
              }}
            >
              <CountdownCircleTimer
                isPlaying
                duration={duration}
                colors={['#2D7FF9', '#E8A13A', '#C45151', '#C45151']}
                colorsTime={[Math.max(duration * 0.4, 10), Math.max(duration * 0.2, 5), 3, 0]}
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
          ) : null}
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

          {presentation.summaryItems.length ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {presentation.summaryItems.map((row, index) => (
                row.label ? (
                  <Box
                    key={`${row.label}-${index}`}
                    sx={{
                      alignItems: 'baseline',
                      display: 'flex',
                      gap: '10px',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Typography
                      sx={{
                        color: alpha(theme.palette.text.secondary, 0.92),
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
                        lineHeight: 1.42,
                        textAlign: 'right',
                      }}
                    >
                      {row.value}
                    </TextP>
                  </Box>
                ) : (
                  <Box
                    key={`bullet-${index}`}
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
                        fontWeight: 500,
                        lineHeight: 1.5,
                      }}
                    >
                      {row.value}
                    </Typography>
                  </Box>
                )
              ))}
            </Box>
          ) : null}

          {presentation.feeItems.length ? (
            <Box
              sx={{
                borderTop: `1px solid ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.08 : 0.06)}`,
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                paddingTop: '16px',
              }}
            >
              {presentation.feeItems.map((row, index) => (
                <Box
                  key={`${row.label}-${index}`}
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: '12px',
                    justifyContent: 'space-between',
                  }}
                >
                  <Typography sx={{ color: theme.palette.text.secondary, fontSize: '13px' }}>
                    {row.label}
                  </Typography>
                  <TextP sx={{ fontSize: '14px', fontWeight: 700 }}>{row.value}</TextP>
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>

        {(message.checkbox1 || message.confirmCheckbox) ? (
          <>
            <Spacer height="16px" />
            <Box
              sx={{
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? alpha('#131922', 0.82)
                    : alpha('#f5f8fb', 0.92),
                border: `1px solid ${alpha(
                  requiresAcknowledgement ? theme.palette.warning.main : theme.palette.common.white,
                  requiresAcknowledgement ? 0.22 : theme.palette.mode === 'dark' ? 0.06 : 0.05
                )}`,
                borderRadius: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                padding: '12px 14px',
                width: '100%',
              }}
            >
              {message.checkbox1 ? (
                <FormControlLabel
                  control={
                    <Checkbox
                      onChange={(event) => onCheckbox1Change(event.target.checked)}
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
                  }
                  label={
                    <Typography sx={{ color: theme.palette.text.primary, fontSize: '14px' }}>
                      {message.checkbox1?.label}
                    </Typography>
                  }
                  sx={{ margin: 0 }}
                />
              ) : null}

              {message.confirmCheckbox ? (
                <FormControlLabel
                  control={
                    <Checkbox
                      onChange={(event) => onConfirmRequestReadChange(event.target.checked)}
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
                    <Box sx={{ alignItems: 'center', display: 'flex', gap: '8px', paddingRight: '8px' }}>
                      <Typography sx={{ color: theme.palette.text.primary, fontSize: '14px', lineHeight: 1.45 }}>
                        {message.confirmCheckboxLabel ||
                          t('core:message.success.request_read', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                      </Typography>
                      <PriorityHighIcon color="warning" sx={{ fontSize: '18px' }} />
                    </Box>
                  }
                  sx={{ margin: 0 }}
                />
              ) : null}
            </Box>
            {requiresAcknowledgement && !canAccept ? (
              <Typography
                sx={{
                  color: alpha(theme.palette.warning.light, 0.92),
                  fontSize: '13px',
                  lineHeight: 1.45,
                  marginTop: '8px',
                }}
              >
                {acknowledgementMessage}
              </Typography>
            ) : null}
          </>
        ) : null}

        {hasDetailsAccordion ? (
          <>
            <Spacer height="16px" />
            <Accordion
              sx={{
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? alpha('#121821', 0.72)
                    : alpha('#f4f7fb', 0.96),
                backgroundImage: 'none',
                border: `1px solid ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.06 : 0.05)}`,
                borderRadius: '18px !important',
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
                  More details
                </Typography>
              </AccordionSummary>
              <AccordionDetails sx={{ padding: '0 18px 18px' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                  {presentation.detailsSections.map((section, index) =>
                    renderDetailSection(section, index, theme)
                  )}
                </Box>
              </AccordionDetails>
            </Accordion>
          </>
        ) : null}

        <Spacer height="22px" />

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '12px',
            justifyContent: hideDecline ? 'flex-end' : 'space-between',
            width: '100%',
          }}
        >
          {!hideDecline ? (
            <CustomButtonAccept
              customColor={theme.palette.text.primary}
              customBgColor={
                theme.palette.mode === 'dark'
                  ? alpha('#171d27', 0.96)
                  : alpha('#eef3f8', 0.98)
              }
              sx={{
                minWidth: '122px',
                border: `1px solid ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.08 : 0.06)}`,
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? '0px 10px 24px rgba(0,0,0,0.24)'
                    : '0px 8px 18px rgba(15,23,42,0.08)',
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
                  transform: 'translateY(-1px)',
                },
              }}
              onClick={onCancel}
            >
              {declineLabel || t('core:action.decline', { postProcess: 'capitalizeFirstChar' })}
            </CustomButtonAccept>
          ) : null}
          <CustomButtonAccept
            customColor="#06111c"
            customBgColor={
              theme.palette.mode === 'dark'
                ? '#76aef4'
                : '#6da5eb'
            }
            sx={{
              minWidth: '122px',
              opacity: canAccept ? 1 : 0.35,
              cursor: canAccept ? 'pointer' : 'default',
              border: `1px solid ${alpha('#b6d3ff', 0.26)}`,
              boxShadow:
                theme.palette.mode === 'dark'
                  ? '0px 10px 24px rgba(58, 112, 188, 0.26)'
                  : '0px 8px 18px rgba(67, 112, 181, 0.16)',
              transition:
                'background-color 180ms ease, border-color 180ms ease, box-shadow 200ms ease, transform 180ms ease, opacity 180ms ease',
              '&:hover': {
                opacity: canAccept ? 1 : 0.35,
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? '#86baf8'
                    : '#78aff0',
                borderColor: alpha('#d2e4ff', 0.36),
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? '0px 14px 30px rgba(76, 133, 214, 0.28)'
                    : '0px 12px 24px rgba(77, 124, 212, 0.18)',
                transform: canAccept ? 'translateY(-1px)' : 'none',
              },
            }}
            onClick={onAccept}
          >
            {acceptLabel || t('core:action.accept', { postProcess: 'capitalizeFirstChar' })}
          </CustomButtonAccept>
        </Box>

        {sendPaymentError ? (
          <ErrorText sx={{ marginTop: '12px', width: '100%' }}>{sendPaymentError}</ErrorText>
        ) : null}
      </Box>
    </Box>
  );
}

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
  countdownSeconds,
}: QortalRequestExtensionDialogProps) {
  if (!open) return null;

  return (
    <Dialog
      open={open}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
      PaperProps={{
        sx: {
          backgroundColor: 'transparent',
          backgroundImage: 'none',
          boxShadow: 'none',
          overflow: 'visible',
        },
      }}
    >
      <QortalPermissionCard
        message={(message || {}) as MessageQortalRequestExtension}
        sendPaymentError={sendPaymentError}
        confirmRequestRead={confirmRequestRead}
        onConfirmRequestReadChange={onConfirmRequestReadChange}
        onCheckbox1Change={onCheckbox1Change}
        onAccept={onAccept}
        onCancel={onCancel}
        onCountdownComplete={onCountdownComplete}
        countdownSeconds={countdownSeconds}
      />
    </Dialog>
  );
}

export type { MessageQortalRequestExtension } from './qortalPermissionPresentation';
