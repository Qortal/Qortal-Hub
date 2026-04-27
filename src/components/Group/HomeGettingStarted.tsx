import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ShoppingBagIcon from '@mui/icons-material/ShoppingBag';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import SchoolIcon from '@mui/icons-material/School';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import SpaOutlinedIcon from '@mui/icons-material/SpaOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import { useAtomValue } from 'jotai';
import {
  APP_BLUE_SURFACE_TEXT,
  getBlueTier1ButtonSx,
} from './groupActivityColorSystem';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { userInfoAtom, balanceAtom, txListAtom } from '../../atoms/global';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { getBaseApiReact, getArbitraryEndpointReact } from '../../App';
import {
  dashboardPanelSx,
  handleDashboardPanelPointerLeave,
  handleDashboardPanelPointerMove,
  useDashboardPanelMouseLight,
} from './dashboardPanelEffects';
import BorderGlow from '../common/BorderGlow';
import type { GettingStartedDebugOverrides } from './homeGettingStartedDebug';
import {
  GROUP_ACTIVITY_BLUE,
  getBlueTier3ProgressBackground,
  getBlueTier3StepperState,
} from './groupActivityColorSystem';

export const GETTING_STARTED_LS_KEY = 'getting_started_status';
const LS_KEY = GETTING_STARTED_LS_KEY;
const ONBOARDING_URL = 'https://qortal.dev/onboarding';
const SUPPORT_CHAT_URL = 'https://link.qortal.dev/support';
const AVATAR_SERVICE = 'THUMBNAIL';
const AVATAR_IDENTIFIER = 'qortal_avatar';
const MIN_BALANCE_FOR_QORTS = 6;
const GETTING_STARTED_PANEL_RADIUS_PX = 12;
const GETTING_STARTED_PANEL_RADIUS = `${GETTING_STARTED_PANEL_RADIUS_PX}px`;

type GettingStartedStepperProps = {
  currentStep: number;
  totalSteps: number;
  isDarkMode: boolean;
};

const GettingStartedStepper = ({
  currentStep,
  totalSteps,
  isDarkMode,
}: GettingStartedStepperProps) => {
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flexShrink: 0,
        minWidth: 0,
      }}
    >
      {Array.from({ length: totalSteps }, (_, index) => {
        const stepNumber = index + 1;
        const status =
          currentStep === stepNumber
            ? 'active'
            : currentStep < stepNumber
              ? 'inactive'
              : 'complete';
        const isNotLastStep = index < totalSteps - 1;

        return (
          <Box
            key={stepNumber}
            sx={{
              alignItems: 'center',
              display: 'flex',
              minWidth: 0,
            }}
          >
            <motion.div
              initial={false}
              animate={status}
              variants={{
                inactive: getBlueTier3StepperState(isDarkMode, 'inactive'),
                active: getBlueTier3StepperState(isDarkMode, 'active'),
                complete: getBlueTier3StepperState(isDarkMode, 'complete'),
              }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
              style={{
                alignItems: 'center',
                borderRadius: 999,
                borderStyle: 'solid',
                borderWidth: 1,
                display: 'flex',
                height: '18px',
                justifyContent: 'center',
                width: '18px',
              }}
            >
              {status === 'active' ? (
                <Box
                  sx={{
                    bgcolor: '#ffffff',
                    borderRadius: '50%',
                    height: '6px',
                    width: '6px',
                  }}
                />
              ) : status === 'complete' ? (
                <Box
                  sx={{
                    borderBottom: '1.5px solid #ffffff',
                    borderRight: '1.5px solid #ffffff',
                    height: '6px',
                    mt: '-1px',
                    transform: 'rotate(45deg)',
                    width: '3px',
                  }}
                />
              ) : (
                <Box
                  sx={{
                    bgcolor: isDarkMode
                      ? 'rgba(255,255,255,0.38)'
                      : 'rgba(27,29,36,0.34)',
                    borderRadius: '50%',
                    height: '4px',
                    width: '4px',
                  }}
                />
              )}
            </motion.div>

            {isNotLastStep ? (
              <Box
                sx={{
                  backgroundColor: isDarkMode
                    ? 'rgba(255,255,255,0.10)'
                    : 'rgba(27,29,36,0.10)',
                  borderRadius: 999,
                  height: '2px',
                  mx: '7px',
                  overflow: 'hidden',
                  position: 'relative',
                  width: '18px',
                }}
              >
                <motion.div
                  initial={false}
                  animate={currentStep > stepNumber ? 'complete' : 'incomplete'}
                  variants={{
                    incomplete: { width: 0, opacity: 0 },
                    complete: { width: '100%', opacity: 1 },
                  }}
                  transition={{ duration: 0.32, ease: 'easeOut' }}
                  style={{
                    background: getBlueTier3ProgressBackground(),
                    borderRadius: 999,
                    height: '100%',
                    left: 0,
                    position: 'absolute',
                    top: 0,
                  }}
                />
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
};

/** Fallback: payments to this address (to user) count toward "6 QORT" step when balance < 6 and not in localStorage completed */

export type HomeGettingStartedProps = {
  debugCompletionOverrides?: Partial<GettingStartedDebugOverrides>;
  debugReplayToken?: number;
  debugUseOverridesOnly?: boolean;
  hideToolsContent?: boolean;
  onGettingStartedComplete?: () => void;
  previewMode?: 'live' | 'off' | 'on';
};

export const HomeGettingStarted = ({
  debugCompletionOverrides,
  debugReplayToken = 0,
  debugUseOverridesOnly = false,
  hideToolsContent = false,
  onGettingStartedComplete,
  previewMode = 'live',
}: HomeGettingStartedProps = {}) => {
  const { t } = useTranslation(['tutorial']);
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const blueStrongHover = getBlueTier1ButtonSx()['&:hover'];
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const txList = useAtomValue(txListAtom);

  const [hasAvatar, setHasAvatar] = useState(false);
  const [avatarStepCompleted, setAvatarStepCompleted] = useState(false);
  const [checkingAvatar, setCheckingAvatar] = useState(false);
  const avatarCompletionAfterPanelCloseRef = useRef(false);
  const [openQortsDialog, setOpenQortsDialog] = useState(false);
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [startBorderGlowIntro, setStartBorderGlowIntro] = useState(false);
  /** Fallback: cumulative QORT from payments endpoint when balance < 6 and not completed in localStorage */
  const [paymentsFallbackTotal, setPaymentsFallbackTotal] = useState<
    number | null
  >(null);
  const panelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const name = userInfo?.name;
  const userAddress = userInfo?.address;

  useEffect(() => {
    if (userAddress == null) {
      setDismissed(null);
      setAvatarStepCompleted(false);
      avatarCompletionAfterPanelCloseRef.current = false;
      return;
    }
    setDismissed(
      localStorage.getItem(`${LS_KEY}_${userAddress}`) === 'completed'
    );
    setAvatarStepCompleted(false);
    avatarCompletionAfterPanelCloseRef.current = false;
  }, [userAddress, debugReplayToken]);

  // Step completion flags: balance >= 6 OR (fallback) cumulative payments to user's address >= 6
  const realHasQorts =
    (balance != null && Number(balance) >= MIN_BALANCE_FOR_QORTS) ||
    (paymentsFallbackTotal != null &&
      paymentsFallbackTotal >= MIN_BALANCE_FOR_QORTS);
  const realHasName = Boolean(name);
  const hasQortsDebugOverride =
    debugCompletionOverrides?.get_six_qorts === true;
  const hasNameDebugOverride =
    debugCompletionOverrides?.register_name === true;
  const hasAvatarDebugOverride =
    debugCompletionOverrides?.load_avatar === true;
  const hasQorts = debugUseOverridesOnly
    ? hasQortsDebugOverride
    : hasQortsDebugOverride || realHasQorts;
  const hasName = debugUseOverridesOnly
    ? hasNameDebugOverride
    : hasNameDebugOverride || realHasName;

  // Pending register-name tx (same as TaskManager): show "Confirming" so the step does not look stuck.
  const hasPendingRegisterName =
    (txList?.some((tx) => tx?.type === 'register-name' && !tx?.done) ??
      false) &&
    !realHasName;

  // Fallback for "6 QORT" step: when balance < 6 and not completed in localStorage, check payments to user's address
  useEffect(() => {
    if (dismissed !== false || !userAddress) return;
    const balanceNum = balance != null ? Number(balance) : null;
    if (balanceNum != null && balanceNum >= MIN_BALANCE_FOR_QORTS) return;

    const url = `${getBaseApiReact()}/transactions/payments/between?recipientAddress=${encodeURIComponent(userAddress)}&confirmationStatus=CONFIRMED&limit=20`;
    let cancelled = false;
    fetch(url)
      .then((res) => res.json())
      .then((data: Array<{ amount?: string }>) => {
        if (cancelled || !Array.isArray(data)) return;
        const total = data.reduce(
          (sum, tx) => sum + (parseFloat(tx?.amount ?? '0') || 0),
          0
        );
        if (!cancelled) setPaymentsFallbackTotal(total);
      })
      .catch(() => {
        if (!cancelled) setPaymentsFallbackTotal(0);
      });
    return () => {
      cancelled = true;
    };
  }, [balance, dismissed, userAddress]);

  // Check avatar existence via API (same approach as MainAvatar)
  const checkAvatar = useCallback(async () => {
    if (!name) return;
    try {
      setCheckingAvatar(true);
      const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=${AVATAR_SERVICE}&identifier=${AVATAR_IDENTIFIER}&limit=1&name=${name}&includemetadata=false&prefix=true`;
      const res = await fetch(url);
      const data = await res.json();
      setHasAvatar(Array.isArray(data) && data.length > 0);
    } catch {
      // leave hasAvatar as false
    } finally {
      setCheckingAvatar(false);
    }
  }, [name]);

  useEffect(() => {
    checkAvatar();
  }, [checkAvatar]);

  // Avatar upload runs in a floating panel; complete the step only after
  // that panel closes so the celebration does not happen behind the modal.
  useEffect(() => {
    const onUploaded = () => {
      avatarCompletionAfterPanelCloseRef.current = true;
    };
    const onClosed = () => {
      if (!avatarCompletionAfterPanelCloseRef.current) return;
      avatarCompletionAfterPanelCloseRef.current = false;
      setAvatarStepCompleted(true);
      setHasAvatar(true);
      checkAvatar();
    };
    subscribeToEvent('avatarUploaded', onUploaded);
    subscribeToEvent('avatarUploadClosed', onClosed);
    return () => {
      unsubscribeFromEvent('avatarUploaded', onUploaded);
      unsubscribeFromEvent('avatarUploadClosed', onClosed);
    };
  }, [checkAvatar]);

  const resolvedHasAvatar = debugUseOverridesOnly
    ? hasAvatarDebugOverride
    : hasAvatarDebugOverride || hasAvatar || avatarStepCompleted;
  const hasCompletionChecksPending = debugUseOverridesOnly ? false : checkingAvatar;

  // Once all steps are complete, persist and hide the section (per-account)
  useEffect(() => {
    if (
      !hasCompletionChecksPending &&
      hasQorts &&
      hasName &&
      resolvedHasAvatar &&
      dismissed === false &&
      userAddress
    ) {
      localStorage.setItem(`${LS_KEY}_${userAddress}`, 'completed');
      setDismissed(true);
      onGettingStartedComplete?.();
    }
  }, [
    hasCompletionChecksPending,
    hasQorts,
    hasName,
    resolvedHasAvatar,
    dismissed,
    userAddress,
    onGettingStartedComplete,
  ]);

  const steps = useMemo(
    () => [
      {
        key: 'get_six_qorts',
        label: t('tutorial:home.get_six_qorts'),
        done: hasQorts,
        onAction: () => setOpenQortsDialog(true),
      },
      {
        key: 'register_name',
        label: hasPendingRegisterName
          ? t('tutorial:home.confirming', 'Confirming')
          : t('tutorial:home.register_name'),
        done: hasName,
        loading:
          !debugUseOverridesOnly &&
          !hasNameDebugOverride &&
          hasPendingRegisterName,
        onAction: () => executeEvent('openRegisterName', {}),
      },
      {
        key: 'load_avatar',
        label: t('tutorial:home.load_avatar'),
        done: resolvedHasAvatar,
        loading:
          !debugUseOverridesOnly &&
          !hasAvatarDebugOverride &&
          checkingAvatar,
        onAction: () => {
          executeEvent('openAvatarUpload', {});
        },
      },
    ],
    [
      t,
      hasQorts,
      hasName,
      resolvedHasAvatar,
      debugUseOverridesOnly,
      checkingAvatar,
      hasPendingRegisterName,
    ]
  );

  const completedCount = useMemo(
    () => steps.filter((s) => s.done).length,
    [steps]
  );
  const currentProgressStep = useMemo(
    () => Math.min(completedCount + 1, steps.length),
    [completedCount, steps.length]
  );

  const tools = useMemo(
    () => [
      {
        accent: '#6D9FEE',
        key: 'user-lookup',
      label: 'User Search',
        icon: <PersonSearchIcon sx={{ fontSize: '1.5rem' }} />,
        onAction: () => executeEvent('openUserLookupDrawer', {}),
      },
      {
        accent: '#79A8FF',
        key: 'wallets',
        label: 'Open Wallets',
        icon: <AccountBalanceWalletIcon sx={{ fontSize: '1.62rem' }} />,
        onAction: () => executeEvent('openWalletsApp', {}),
      },
      {
        accent: '#9BCB8B',
        key: 'minting-status',
        label: 'Check Minting',
        icon: <SpaOutlinedIcon sx={{ fontSize: '1.5rem' }} />,
        onAction: () => executeEvent('openMintingPanel', {}),
      },
      {
        accent: '#A97CFF',
        key: 'backup-wallet',
        label: 'Backup Wallet',
        icon: <DownloadIcon sx={{ fontSize: '1.5rem' }} />,
        onAction: () => executeEvent('openBackupWallet', {}),
      },
    ],
    []
  );

  const previewPanel =
    previewMode === 'on'
      ? 'getting-started'
      : previewMode === 'off'
        ? 'tools'
        : null;
  const showTools =
    previewPanel != null ? previewPanel === 'tools' : dismissed === true;

  if (dismissed == null && previewPanel == null) {
    return null;
  }

  useEffect(() => {
    if (showTools) {
      setStartBorderGlowIntro(false);
      return;
    }

    setStartBorderGlowIntro(false);
    const timer = window.setTimeout(() => {
      setStartBorderGlowIntro(true);
    }, 2000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [showTools]);

  if (showTools) {
    return (
      <Box
        ref={panelRef}
        sx={{
          ...dashboardPanelSx(theme, 'base'),
          borderRadius: GETTING_STARTED_PANEL_RADIUS,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          gap: '8px',
          justifyContent: 'flex-start',
          position: 'relative',
          padding: '16px 20px',
          width: '100%',
        }}
        onMouseMove={handleDashboardPanelPointerMove}
        onMouseLeave={handleDashboardPanelPointerLeave}
      >
        {hideToolsContent ? null : (
          <Box
            sx={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              gap: '16px',
              minHeight: 0,
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                minWidth: 0,
                textAlign: 'center',
              }}
            >
              <Typography
                sx={{
                  color: alpha(theme.palette.text.primary, 0.96),
                  fontSize: '1.08rem',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                }}
              >
                Tools
              </Typography>
              <Typography
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.86),
                  fontSize: '0.82rem',
                  letterSpacing: '-0.01em',
                  lineHeight: 1.35,
                  maxWidth: '24ch',
                  textAlign: 'center',
                }}
              >
                Quick actions for your account, wallet, and node.
              </Typography>
            </Box>
            <Box
              sx={{
                display: 'grid',
                flex: 1,
                gap: '10px',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
                minHeight: 0,
              }}
            >
              {tools.map((tool) => (
                <ButtonBase
                  key={tool.key}
                  onClick={tool.onAction}
                  sx={{
                    alignItems: 'center',
                    background: isDarkMode
                      ? 'linear-gradient(180deg, rgba(39,43,53,0.92) 0%, rgba(29,33,41,0.96) 100%)'
                      : 'linear-gradient(180deg, rgba(255,255,255,0.62) 0%, rgba(244,238,229,0.82) 100%)',
                    border: `1px solid ${
                      isDarkMode
                        ? 'rgba(255,255,255,0.065)'
                        : alpha(theme.palette.text.primary, 0.08)
                    }`,
                    borderRadius: '13px',
                    boxShadow: isDarkMode
                      ? '0 12px 26px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255,255,255,0.032)'
                      : '0 10px 22px rgba(24,32,44,0.08), inset 0 1px 0 rgba(255,255,255,0.34)',
                    color: theme.palette.text.primary,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    justifyContent: 'center',
                    minHeight: '80px',
                    overflow: 'hidden',
                    px: 1.5,
                    py: 1.55,
                    position: 'relative',
                    textAlign: 'center',
                    transition:
                      'background 180ms ease, border-color 180ms ease, box-shadow 180ms ease, transform 140ms ease',
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      inset: '1px',
                      borderRadius: 'inherit',
                      pointerEvents: 'none',
                      opacity: isDarkMode ? 1 : 0.76,
                      background: isDarkMode
                        ? 'linear-gradient(180deg, rgba(255,255,255,0.022) 0%, rgba(255,255,255,0) 72%)'
                        : 'linear-gradient(180deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0) 72%)',
                    },
                    '&::after': {
                      content: '""',
                      position: 'absolute',
                      left: '50%',
                      bottom: '-12px',
                      width: '48%',
                      height: '22px',
                      transform: 'translateX(-50%)',
                      borderRadius: '999px',
                      pointerEvents: 'none',
                      opacity: isDarkMode ? 0.44 : 0.34,
                      background: `radial-gradient(circle at center, ${alpha(
                        tool.accent,
                        isDarkMode ? 0.7 : 0.42
                      )} 0%, ${alpha(tool.accent, 0.16)} 42%, transparent 76%)`,
                      transition: 'opacity 180ms ease, transform 180ms ease',
                    },
                    '&:hover': {
                      background: isDarkMode
                        ? 'linear-gradient(180deg, rgba(45,50,61,0.96) 0%, rgba(33,36,45,0.98) 100%)'
                        : 'linear-gradient(180deg, rgba(255,255,255,0.74) 0%, rgba(247,241,233,0.88) 100%)',
                      borderColor: alpha(tool.accent, isDarkMode ? 0.18 : 0.16),
                      boxShadow: isDarkMode
                        ? '0 14px 28px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.05)'
                        : '0 12px 24px rgba(24,32,44,0.11), inset 0 1px 0 rgba(255,255,255,0.36)',
                      transform: 'translateY(-1px)',
                      '& .tool-icon': {
                        color: alpha(tool.accent, isDarkMode ? 0.98 : 0.92),
                        transform: 'translateY(-1px)',
                      },
                      '&::after': {
                        opacity: isDarkMode ? 0.62 : 0.48,
                        transform: 'translateX(-50%) scale(1.04)',
                      },
                    },
                    '&:active': {
                      boxShadow: 'none',
                      transform: 'translateY(0)',
                    },
                    '&:focus-visible': {
                      borderColor: alpha(tool.accent, 0.58),
                      boxShadow: `inset 0 0 0 1px ${alpha(tool.accent, 0.45)}`,
                    },
                  }}
                >
                  <Box
                    className="tool-icon"
                    sx={{
                      alignItems: 'center',
                      color: alpha(tool.accent, isDarkMode ? 0.96 : 0.84),
                      display: 'inline-flex',
                      justifyContent: 'center',
                      lineHeight: 1,
                      transition: 'color 180ms ease, transform 160ms ease',
                    }}
                  >
                    {tool.icon}
                  </Box>
                  <Typography
                    className="tool-label"
                    sx={{
                      color: alpha(theme.palette.text.primary, 0.96),
                      fontSize: '0.92rem',
                      fontWeight: 650,
                      letterSpacing: '-0.01em',
                      lineHeight: 1.22,
                      maxWidth: '11ch',
                    }}
                  >
                    {tool.label}
                  </Typography>
                </ButtonBase>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    );
  }

  const cardContent = (
    <>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          mb: '8px',
        }}
      >
        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontSize: '1rem',
            fontWeight: 600,
          }}
        >
          {t('tutorial:home.getting_started')}
        </Typography>
        <GettingStartedStepper
          currentStep={currentProgressStep}
          totalSteps={steps.length}
          isDarkMode={isDarkMode}
        />
      </Box>

      {steps.map((step, index) => (
        <Box
          key={step.key}
          sx={{
            alignItems: 'center',
            bgcolor: isDarkMode ? '#181a20' : theme.palette.background.surface,
            border: `1px solid ${theme.palette.border.subtle}`,
            borderRadius: '8px',
            display: 'flex',
            gap: '12px',
            justifyContent: 'space-between',
            padding: '10px 14px',
            transition:
              'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 120ms ease',
            '&:hover': {
              backgroundColor: isDarkMode
                ? theme.palette.background.elevated
                : theme.palette.background.paper,
              borderColor: theme.palette.border.main,
              boxShadow: `inset 0 1px 0 ${theme.palette.border.subtle}, 0 2px 10px rgba(0,0,0,0.06)`,
              transform: 'translateY(-1px)',
            },
            '&:active': {
              transform: 'translateY(0)',
              boxShadow: `inset 0 1px 0 ${theme.palette.border.subtle}`,
            },
            '&:focus-within': {
              borderColor: theme.palette.border.main,
              boxShadow: `inset 0 0 0 1px ${theme.palette.border.main}`,
            },
            '& button': {
              transition:
                'background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
            },
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              color: step.done
                ? theme.palette.success.main
                : theme.palette.text.secondary,
              display: 'flex',
              flexShrink: 0,
            }}
          >
            {step.done ? (
              <CheckCircleIcon sx={{ fontSize: '1.2rem' }} />
            ) : (
              <Typography
                sx={{
                  border: `1px solid ${theme.palette.text.secondary}`,
                  borderRadius: '50%',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  height: '20px',
                  lineHeight: '20px',
                  textAlign: 'center',
                  width: '20px',
                }}
              >
                {index + 1}
              </Typography>
            )}
          </Box>

          <Typography
            sx={{
              color: step.done
                ? theme.palette.text.secondary
                : theme.palette.text.primary,
              flex: 1,
              fontSize: '0.9rem',
              opacity: step.done ? 0.7 : 1,
            }}
          >
            {step.label}
          </Typography>

          {step.loading ? (
            <CircularProgress size={20} />
          ) : (
            <Button
              disabled={step.done}
              onClick={step.onAction}
              size="small"
              variant={step.done ? 'text' : 'outlined'}
              sx={{
                alignItems: 'center',
                bgcolor:
                  !step.done
                    ? isDarkMode
                      ? '#262931'
                      : theme.palette.background.surface
                    : undefined,
                borderColor: step.done
                  ? theme.palette.border.main
                  : theme.palette.border.subtle,
                flexShrink: 0,
                fontSize: '0.78rem',
                height: '36px',
                minWidth: '76px',
                opacity: step.done ? 0.5 : 1,
                borderRadius: '10px',
                fontWeight: 600,
                px: 1.5,
                transition:
                  'background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, color 140ms ease, transform 120ms ease, filter 140ms ease',
                '&:focus-visible': {
                  borderColor: theme.palette.primary.main,
                  boxShadow: `inset 0 0 0 1px ${theme.palette.primary.main}`,
                },
                ...(step.done
                  ? {}
                  : {
                      color: theme.palette.text.primary,
                      '&:hover': {
                        ...blueStrongHover,
                        borderColor: 'rgba(143, 184, 243, 0.22)',
                        color: APP_BLUE_SURFACE_TEXT,
                        transform: 'translateY(-1px)',
                      },
                      '&:active': {
                        transform: 'translateY(0)',
                      },
                    }),
              }}
            >
              {step.done ? t('tutorial:home.done') : t('tutorial:home.open')}
            </Button>
          )}
        </Box>
      ))}
    </>
  );

  return (
    <>
      <BorderGlow
        animated={startBorderGlowIntro}
        interactive={false}
        edgeSensitivity={20}
        glowColor={isDarkMode ? '218 79 73' : '218 72 70'}
        backgroundColor={isDarkMode ? '#1D1F27' : '#f5f7fb'}
        borderRadius={GETTING_STARTED_PANEL_RADIUS_PX}
        glowRadius={77}
        glowIntensity={isDarkMode ? 0.3 : 0.42}
        coneSpread={25}
        colors={
          [
            GROUP_ACTIVITY_BLUE.gradientTop,
            GROUP_ACTIVITY_BLUE.primary,
            GROUP_ACTIVITY_BLUE.hover,
          ]
        }
        className="getting-started-border-glow"
        style={{
          '--card-border': theme.palette.border.subtle,
          '--card-shadow':
            theme.palette.mode === 'dark'
              ? '0 12px 28px rgba(0, 0, 0, 0.16)'
              : '0 10px 24px rgba(28, 36, 52, 0.07)',
          width: '100%',
          height: '100%',
        } as CSSProperties}
      >
        <Box
          sx={{
            backgroundImage:
              theme.palette.mode === 'dark'
                ? 'linear-gradient(180deg, #1D1F27 0%, #1B1D24 100%)'
                : 'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.38) 18%, rgba(255,255,255,0) 42%)',
            borderRadius: GETTING_STARTED_PANEL_RADIUS,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            height: '100%',
            justifyContent: 'flex-start',
            padding: '16px 20px',
            position: 'relative',
            width: '100%',
          }}
        >
          {cardContent}
        </Box>
      </BorderGlow>

      {/* Get QORT dialog */}
      <Dialog
        open={openQortsDialog}
        onClose={() => setOpenQortsDialog(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: theme.shadows[12],
              border: `1px solid ${theme.palette.border?.subtle ?? 'rgba(255,255,255,0.08)'}`,
            },
          },
        }}
      >
        <DialogTitle
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            px: 2.5,
            py: 2,
            borderBottom: `1px solid ${theme.palette.divider}`,
            bgcolor: theme.palette.background?.default ?? undefined,
          }}
        >
          <Typography
            variant="h6"
            fontWeight={700}
            sx={{ textTransform: 'none' }}
          >
            {t('tutorial:home.get_six_qorts')}
          </Typography>
          <IconButton
            onClick={() => setOpenQortsDialog(false)}
            size="small"
            aria-label="Close"
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: 2.5, py: 2.5 }}>
          <Typography
            variant="body1"
            sx={{ mb: 2.5, lineHeight: 1.5, fontWeight: 500, mt: 2.5 }}
          >
            {t('tutorial:home.get_six_qorts_intro')}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {/* Option 1: Onboarding */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1.5,
                p: 1.5,
                borderRadius: '12px',
                bgcolor:
                  theme.palette.background?.surface ?? 'rgba(255,255,255,0.04)',
                border: `1px solid ${theme.palette.border?.subtle ?? 'rgba(255,255,255,0.08)'}`,
              }}
            >
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '10px',
                  bgcolor: theme.palette.primary.main,
                  color: theme.palette.primary.contrastText,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <SchoolIcon sx={{ fontSize: 22 }} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  1. {t('tutorial:home.get_six_qorts_way1')}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  endIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
                  onClick={() => {
                    if (window?.electronAPI?.openExternal) {
                      window.electronAPI.openExternal(ONBOARDING_URL);
                    } else {
                      window.open(ONBOARDING_URL, '_blank');
                    }
                  }}
                  sx={{
                    mt: 0.75,
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: '9px',
                    transition:
                      'background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                    '&:hover': {
                      transform: 'translateY(-1px)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                    },
                    '&:active': {
                      transform: 'translateY(0)',
                      boxShadow: 'none',
                    },
                  }}
                >
                  {t('tutorial:home.get_six_qorts_way1_action')}
                </Button>
              </Box>
            </Box>
            {/* Option 2: Nextcloud support chat */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1.5,
                p: 1.5,
                borderRadius: '12px',
                bgcolor:
                  theme.palette.background?.surface ?? 'rgba(255,255,255,0.04)',
                border: `1px solid ${theme.palette.border?.subtle ?? 'rgba(255,255,255,0.08)'}`,
              }}
            >
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '10px',
                  bgcolor:
                    theme.palette.secondary?.main ?? theme.palette.info.main,
                  color:
                    theme.palette.secondary?.contrastText ??
                    theme.palette.info.contrastText,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <SupportAgentIcon sx={{ fontSize: 22 }} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  2. {t('tutorial:home.get_six_qorts_way2')}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  endIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
                  onClick={() => {
                    if (window?.electronAPI?.openExternal) {
                      window.electronAPI.openExternal(SUPPORT_CHAT_URL);
                    } else {
                      window.open(SUPPORT_CHAT_URL, '_blank');
                    }
                  }}
                  sx={{
                    mt: 0.75,
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: '9px',
                    transition:
                      'background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                    '&:hover': {
                      transform: 'translateY(-1px)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                    },
                    '&:active': {
                      transform: 'translateY(0)',
                      boxShadow: 'none',
                    },
                  }}
                >
                  {t('tutorial:home.get_six_qorts_way2_action')}
                </Button>
              </Box>
            </Box>
            {/* Option 3: Q-Trade */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1.5,
                p: 1.5,
                borderRadius: '12px',
                bgcolor:
                  theme.palette.background?.surface ?? 'rgba(255,255,255,0.04)',
                border: `1px solid ${theme.palette.border?.subtle ?? 'rgba(255,255,255,0.08)'}`,
              }}
            >
              <Box
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '10px',
                  bgcolor:
                    theme.palette.success?.main ?? 'rgba(76, 175, 80, 0.9)',
                  color: theme.palette.success?.contrastText ?? '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <ShoppingBagIcon sx={{ fontSize: 22 }} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  3. {t('tutorial:home.get_six_qorts_way3')}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    executeEvent('addTab', {
                      data: { service: 'APP', name: 'q-trade' },
                    });
                    executeEvent('open-apps-mode', {});
                    setOpenQortsDialog(false);
                  }}
                  sx={{
                    mt: 0.75,
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: '9px',
                    transition:
                      'background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                    '&:hover': {
                      transform: 'translateY(-1px)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                    },
                    '&:active': {
                      transform: 'translateY(0)',
                      boxShadow: 'none',
                    },
                  }}
                >
                  {t('tutorial:home.get_six_qorts_way3_action')}
                </Button>
              </Box>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
};
