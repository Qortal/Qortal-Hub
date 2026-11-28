import {
  Box,
  Checkbox,
  Dialog,
  FormControlLabel,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
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
import { useAcceptDelay } from '../../hooks/useAcceptDelay';
import {
  DECLINE_GUARD_MS,
  permissionSecondsLeft,
  QORTAL_REQUEST_COUNTDOWN_SECONDS,
} from '../../qortal/permissionPromptQueue';
import type { RequestingApp } from '../../qortal/requestingApp';
import {
  QortalRequestDetails,
  QortalRequestDetailsData,
} from './QortalRequestDetails';
import { appLockedAtom } from '../../atoms/presence';
import type {
  ApprovalBudgetInfo,
  ApprovalBudgetNote,
  ApprovalBudgetTopUp,
} from '../../qortal/appBudgetApproval';
import {
  BudgetRefillSection,
  refillMinimum,
} from '../AppBudgets/BudgetRefillSection';
import { isDraftValid } from '../AppBudgets/BudgetChoices';
import {
  draftAnswer,
  newBudgetDraft,
  type BudgetDraft,
} from '../AppBudgets/budgetDraft';

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
  /** When the requester stops waiting for an answer (ms since the epoch). */
  expiresAt?: number;
  /** The app that asks, from the request's tab. Null when Hub can't tell. */
  requestingApp?: RequestingApp | null;
  /** Sent by one of Hub's own pages: no app is named. */
  fromHub?: boolean;
  /**
   * Why the app's budget doesn't pay for this request: used up or ended (the
   * window offers to refill it), at its limit, or a publish that would replace
   * something already published or that the app is publishing right now.
   */
  budget?: ApprovalBudgetInfo | ApprovalBudgetNote | null;
};

type QortalRequestExtensionDialogProps = {
  open: boolean;
  /** The request on screen. A new object means a new request. */
  message: MessageQortalRequestExtension | null | Record<string, unknown>;
  sendPaymentError: string;
  confirmRequestRead: boolean;
  onConfirmRequestReadChange: (checked: boolean) => void;
  onCheckbox1Change: (checked: boolean) => void;
  onAccept: () => void;
  /** "Top up and approve": refill the app's budget, then accept. */
  onAcceptWithTopUp?: (topUp: ApprovalBudgetTopUp) => void;
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
  onAcceptWithTopUp,
  onCancel,
  onCountdownComplete,
}: QortalRequestExtensionDialogProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'question']);
  const isAppLocked = useAtomValue(appLockedAtom);
  // A request still on screen when Hub locks is declined: nothing waits to be
  // answered behind the lock screen.
  useEffect(() => {
    if (open && isAppLocked) onCancel();
  }, [open, isAppLocked, onCancel]);
  const requestMessage = (message || {}) as MessageQortalRequestExtension;
  const requestingApp = requestMessage.requestingApp ?? null;
  const fromHub = requestMessage.fromHub === true;
  // Each request on screen gets its own countdown, checkboxes and second
  // before Accept, also when one follows another without the dialog closing.
  // A request that waited behind others counts down only the time it has left.
  const [shownRequest, setShownRequest] = useState(() => ({
    message,
    key: 0,
    secondsLeft: permissionSecondsLeft(requestMessage.expiresAt, Date.now()),
  }));
  if (shownRequest.message !== message) {
    setShownRequest({
      message,
      key: shownRequest.key + 1,
      secondsLeft: permissionSecondsLeft(requestMessage.expiresAt, Date.now()),
    });
  }
  const acceptReady = useAcceptDelay(open, message);
  const declineReady = useAcceptDelay(open, message, DECLINE_GUARD_MS);
  const canAccept =
    acceptReady && (!requestMessage.confirmCheckbox || confirmRequestRead);
  const budgetInfo = requestMessage.budget ?? null;
  const refill =
    budgetInfo?.state === 'used_up' || budgetInfo?.state === 'ended'
      ? budgetInfo
      : null;
  // The refill choices start afresh for each request on screen.
  const [budgetDraftOf, setBudgetDraftOf] = useState<{
    key: number;
    draft: BudgetDraft;
  } | null>(null);
  const budgetDraft =
    budgetDraftOf?.key === shownRequest.key
      ? budgetDraftOf.draft
      : newBudgetDraft(refill?.limits);
  const setBudgetDraft = (draft: BudgetDraft) =>
    setBudgetDraftOf({ key: shownRequest.key, draft });
  const now = Date.now();
  const canTopUp =
    !!refill &&
    !!onAcceptWithTopUp &&
    canAccept &&
    isDraftValid(budgetDraft, now, { minAmount: refillMinimum(refill) });
  const appNameForBudget = requestingApp?.name ?? '';
  const bodyLines = [
    requestMessage.text2,
    requestMessage.text3,
    requestMessage.text4,
  ].filter(Boolean);
  const summaryText =
    requestMessage.highlightedText ||
    (requestMessage.text1?.toLowerCase().includes('authenticate')
      ? t('question:permission.session_only_summary')
      : requestMessage.text1);
  const wrappingTextSx = {
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  };

  // Why the app's budget doesn't pay for this request, in one line.
  const budgetNoteSx = {
    backgroundColor: alpha(theme.palette.warning.main, 0.08),
    border: `1px solid ${alpha(theme.palette.warning.main, 0.24)}`,
    borderRadius: '12px',
    color: theme.palette.text.primary,
    fontSize: '13.5px',
    lineHeight: 1.5,
    marginTop: '14px',
    padding: '10px 12px',
    ...wrappingTextSx,
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
        key={shownRequest.key}
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
              {fromHub ? null : (
                <Box
                  data-testid="qortal-request-app"
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
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
                      {t('core:approval_dialog.requested_by')}
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '2px 8px',
                      minWidth: 0,
                    }}
                  >
                    <Typography
                      data-testid="qortal-request-app-name"
                      sx={{
                        color: requestingApp
                          ? theme.palette.text.primary
                          : theme.palette.warning.main,
                        fontSize: '17px',
                        fontWeight: 700,
                        lineHeight: 1.3,
                        minWidth: 0,
                        overflowWrap: 'anywhere',
                        // A name never reorders the text around it.
                        unicodeBidi: 'isolate',
                      }}
                    >
                      {requestingApp
                        ? requestingApp.name
                        : t('core:approval_dialog.unknown_app')}
                    </Typography>
                    {requestingApp?.service ? (
                      <Typography
                        data-testid="qortal-request-app-service"
                        sx={{
                          border: `1px solid ${theme.palette.divider}`,
                          borderRadius: '6px',
                          color: theme.palette.text.secondary,
                          fontSize: '11px',
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          lineHeight: 1.2,
                          padding: '2px 6px',
                        }}
                      >
                        {requestingApp.service}
                      </Typography>
                    ) : null}
                  </Box>
                  {requestingApp ? null : (
                    <Typography
                      sx={{
                        color: theme.palette.warning.main,
                        fontSize: '13px',
                        lineHeight: 1.45,
                        ...wrappingTextSx,
                      }}
                    >
                      {t('core:approval_dialog.unknown_app_hint')}
                    </Typography>
                  )}
                </Box>
              )}
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
                duration={QORTAL_REQUEST_COUNTDOWN_SECONDS}
                initialRemainingTime={shownRequest.secondsLeft}
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

          {budgetInfo?.state === 'limit' && budgetInfo.limit ? (
            <Typography data-testid="budget-limit-note" sx={budgetNoteSx}>
              {t(
                budgetInfo.limit.per === 'day'
                  ? 'core:app_budgets.refill.limit_day'
                  : 'core:app_budgets.refill.limit_minute',
                {
                  name: appNameForBudget,
                  max: budgetInfo.limit.max,
                  postProcess: 'capitalizeFirstChar',
                }
              )}
            </Typography>
          ) : null}

          {(budgetInfo?.state === 'replaces' ||
            budgetInfo?.state === 'publishing') &&
          appNameForBudget ? (
            <Typography data-testid="budget-not-covered-note" sx={budgetNoteSx}>
              {t(
                budgetInfo.state === 'publishing'
                  ? 'core:app_budgets.not_covered.publishing'
                  : 'core:app_budgets.not_covered.replaces',
                {
                  name: appNameForBudget,
                  postProcess: 'capitalizeFirstChar',
                }
              )}
            </Typography>
          ) : null}

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

          {refill && (
            <>
              <Spacer height="16px" />
              <BudgetRefillSection
                appName={appNameForBudget}
                draft={budgetDraft}
                info={refill}
                now={now}
                onDraftChange={setBudgetDraft}
              />
            </>
          )}

          {refill && onAcceptWithTopUp ? (
            <>
              <Spacer height="22px" />
              <CustomButtonAccept
                aria-disabled={!canTopUp}
                customBgColor={theme.palette.primary.main}
                customColor={theme.palette.primary.contrastText}
                onClick={
                  canTopUp
                    ? () => onAcceptWithTopUp(draftAnswer(budgetDraft))
                    : undefined
                }
                sx={{
                  cursor: canTopUp ? 'pointer' : 'default',
                  filter: 'none',
                  opacity: canTopUp ? 1 : 0.35,
                  width: '100%',
                  '&:hover': {
                    backgroundColor: canTopUp
                      ? theme.palette.primary.dark
                      : theme.palette.primary.main,
                    color: theme.palette.primary.contrastText,
                    opacity: canTopUp ? 1 : 0.35,
                  },
                }}
              >
                {t('core:app_budgets.refill.top_up_and_approve', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </CustomButtonAccept>
            </>
          ) : null}

          <Spacer height={refill && onAcceptWithTopUp ? '12px' : '22px'} />

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
              onClick={declineReady ? onCancel : undefined}
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
              aria-disabled={!canAccept}
              onClick={canAccept ? onAccept : undefined}
            >
              {refill
                ? t('core:app_budgets.refill.approve_once', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('core:action.accept', {
                    postProcess: 'capitalizeFirstChar',
                  })}
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
