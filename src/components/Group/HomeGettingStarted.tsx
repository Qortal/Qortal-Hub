import { CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
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

export const GETTING_STARTED_LS_KEY = 'getting_started_status';
const LS_KEY = GETTING_STARTED_LS_KEY;
const ONBOARDING_URL = 'https://qortal.dev/onboarding';
const SUPPORT_CHAT_URL = 'https://link.qortal.dev/support';
const AVATAR_SERVICE = 'THUMBNAIL';
const AVATAR_IDENTIFIER = 'qortal_avatar';
const MIN_BALANCE_FOR_QORTS = 6;

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
                inactive: {
                  scale: 1,
                  backgroundColor: isDarkMode
                    ? 'rgba(255,255,255,0.06)'
                    : 'rgba(27,29,36,0.08)',
                  borderColor: isDarkMode
                    ? 'rgba(255,255,255,0.16)'
                    : 'rgba(27,29,36,0.14)',
                  boxShadow: 'none',
                },
                active: {
                  scale: 1,
                  backgroundColor: '#6D9FEE',
                  borderColor: '#71A1EB',
                  boxShadow: isDarkMode
                    ? '0 0 0 1px rgba(109,159,238,0.3), 0 0 14px rgba(64,180,199,0.24)'
                    : '0 0 0 1px rgba(109,159,238,0.2), 0 0 10px rgba(64,180,199,0.14)',
                },
                complete: {
                  scale: 1,
                  backgroundColor: '#40B4C7',
                  borderColor: '#40B4C7',
                  boxShadow: 'none',
                },
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
                    background:
                      'linear-gradient(90deg, #6D9FEE 0%, #40B4C7 100%)',
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
  onGettingStartedComplete?: () => void;
  previewMode?: 'live' | 'off' | 'on';
};

export const HomeGettingStarted = ({
  onGettingStartedComplete,
  previewMode = 'live',
}: HomeGettingStartedProps = {}) => {
  const { t } = useTranslation(['tutorial']);
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const txList = useAtomValue(txListAtom);

  const [hasAvatar, setHasAvatar] = useState(false);
  const [checkingAvatar, setCheckingAvatar] = useState(false);
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

  // When we have an address, sync dismissed from per-account localStorage. null = unknown (behaves like dismissed).
  useEffect(() => {
    if (userAddress == null) {
      setDismissed(null);
      return;
    }
    setDismissed(
      localStorage.getItem(`${LS_KEY}_${userAddress}`) === 'completed'
    );
  }, [userAddress]);

  // Step completion flags: balance >= 6 OR (fallback) cumulative payments to user's address >= 6
  const hasQorts =
    (balance != null && Number(balance) >= MIN_BALANCE_FOR_QORTS) ||
    (paymentsFallbackTotal != null &&
      paymentsFallbackTotal >= MIN_BALANCE_FOR_QORTS);
  const hasName = Boolean(name);

  // Pending register-name tx (same as TaskManager): show "Confirming transaction" on step 2
  const hasPendingRegisterName =
    (txList?.some((tx) => tx?.type === 'register-name' && !tx?.done) ??
      false) &&
    !hasName;

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

  // When avatar is published, mark step done right away (re-check via API in background)
  useEffect(() => {
    const onUploaded = () => {
      setHasAvatar(true);
      checkAvatar();
    };
    subscribeToEvent('avatarUploaded', onUploaded);
    return () => unsubscribeFromEvent('avatarUploaded', onUploaded);
  }, [checkAvatar]);

  // Once all steps are complete, persist and hide the section (per-account)
  useEffect(() => {
    if (
      !checkingAvatar &&
      hasQorts &&
      hasName &&
      hasAvatar &&
      dismissed === false &&
      userAddress
    ) {
      localStorage.setItem(`${LS_KEY}_${userAddress}`, 'completed');
      setDismissed(true);
      onGettingStartedComplete?.();
    }
  }, [
    checkingAvatar,
    hasQorts,
    hasName,
    hasAvatar,
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
          ? t('tutorial:home.confirming_transaction')
          : t('tutorial:home.register_name'),
        done: hasName,
        loading: hasPendingRegisterName,
        onAction: () => executeEvent('openRegisterName', {}),
      },
      {
        key: 'load_avatar',
        label: t('tutorial:home.load_avatar'),
        done: hasAvatar,
        loading: checkingAvatar,
        onAction: () => executeEvent('openAvatarUpload', {}),
      },
    ],
    [t, hasQorts, hasName, hasAvatar, checkingAvatar, hasPendingRegisterName]
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
        key: 'user-lookup',
        label: 'Lookup User',
        icon: <PersonSearchIcon sx={{ fontSize: '1.5rem' }} />,
        onAction: () => executeEvent('openUserLookupDrawer', {}),
      },
      {
        key: 'wallets',
        label: 'Open Wallets',
        icon: <AccountBalanceWalletIcon sx={{ fontSize: '1.62rem' }} />,
        emphasis: 'primary',
        onAction: () => executeEvent('openWalletsApp', {}),
      },
      {
        key: 'minting-status',
        label: 'Check Minting',
        icon: <SpaOutlinedIcon sx={{ fontSize: '1.5rem' }} />,
        onAction: () => executeEvent('openMintingPanel', {}),
      },
      {
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

  const cardContent = (
    <>
      <Box
        className="dashboard-panel-decoration"
        aria-hidden="true"
        sx={{
          borderRadius: 'inherit',
          inset: 0,
          overflow: 'visible',
          pointerEvents: 'none',
          position: 'absolute',
          zIndex: 0,
        }}
      >
        <Box
          sx={{
            left: 0,
            top: 0,
            width: '1px',
            height: '100%',
            position: 'absolute',
            background:
              theme.palette.mode === 'dark'
                ? 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.12) 10%, rgba(255,255,255,0.16) 18%, rgba(255,255,255,0.12) 28%, rgba(255,255,255,0.08) 44%, rgba(255,255,255,0.08) 56%, rgba(255,255,255,0.12) 72%, rgba(255,255,255,0.16) 82%, rgba(255,255,255,0.12) 90%, transparent 100%)'
                : 'linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.13) 10%, rgba(255,255,255,0.18) 18%, rgba(255,255,255,0.13) 28%, rgba(255,255,255,0.09) 44%, rgba(255,255,255,0.09) 56%, rgba(255,255,255,0.13) 72%, rgba(255,255,255,0.18) 82%, rgba(255,255,255,0.13) 90%, transparent 100%)',
            filter: 'blur(0.08px)',
          }}
        />
      </Box>
        {showTools ? (
          <>
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                justifyContent: 'space-between',
                gap: '14px',
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
                Tools
              </Typography>
            </Box>
            <Box
              sx={{
                display: 'grid',
                gap: '16px',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              }}
            >
              {tools.map((tool) => (
                <ButtonBase
                  key={tool.key}
                  onClick={tool.onAction}
                  sx={{
                    alignItems: 'center',
                    background: isDarkMode
                      ? tool.emphasis === 'primary'
                        ? 'linear-gradient(180deg, rgba(38,41,49,0.18) 0%, rgba(38,41,49,0.08) 100%)'
                        : 'linear-gradient(180deg, rgba(38,41,49,0.12) 0%, rgba(38,41,49,0.04) 100%)'
                      : tool.emphasis === 'primary'
                        ? 'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.06) 100%)'
                        : 'linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.03) 100%)',
                    border: '1px solid transparent',
                    borderRadius: '12px',
                    color: theme.palette.text.primary,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '11px',
                    justifyContent: 'center',
                    minHeight: tool.emphasis === 'primary' ? '102px' : '98px',
                    px: 1.75,
                    py: 1.7,
                    position: 'relative',
                    textAlign: 'center',
                    transition:
                      'background 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 120ms ease, opacity 140ms ease',
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      inset: 0,
                      borderRadius: 'inherit',
                      pointerEvents: 'none',
                      opacity: 0,
                      transition: 'opacity 160ms ease',
                      background: isDarkMode
                        ? 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(109,159,238,0.028) 42%, rgba(64,180,199,0.016) 100%)'
                        : 'linear-gradient(180deg, rgba(255,255,255,0.46) 0%, rgba(109,159,238,0.06) 42%, rgba(64,180,199,0.03) 100%)',
                      boxShadow: isDarkMode
                        ? 'inset 0 1px 0 rgba(255,255,255,0.045), 0 0 0 1px rgba(109,159,238,0.08)'
                        : 'inset 0 1px 0 rgba(255,255,255,0.52), 0 0 0 1px rgba(109,159,238,0.07)',
                    },
                    '&:hover': {
                      background: isDarkMode
                        ? tool.emphasis === 'primary'
                          ? 'linear-gradient(180deg, rgba(38,41,49,0.4) 0%, rgba(38,41,49,0.22) 100%)'
                          : 'linear-gradient(180deg, rgba(38,41,49,0.28) 0%, rgba(38,41,49,0.14) 100%)'
                        : tool.emphasis === 'primary'
                          ? 'linear-gradient(180deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.12) 100%)'
                          : 'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.08) 100%)',
                      borderColor: 'transparent',
                      boxShadow: isDarkMode
                        ? tool.emphasis === 'primary'
                          ? '0 10px 20px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.06)'
                          : '0 8px 16px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.035)'
                        : tool.emphasis === 'primary'
                          ? '0 10px 18px rgba(28,36,52,0.085), inset 0 1px 0 rgba(255,255,255,0.52)'
                          : '0 8px 14px rgba(28,36,52,0.06), inset 0 1px 0 rgba(255,255,255,0.42)',
                      transform: 'translateY(-2px)',
                      '&::before': {
                        opacity: 1,
                      },
                      '& .tool-icon': {
                        color: isDarkMode
                          ? (tool.emphasis === 'primary'
                              ? 'rgba(142, 190, 246, 0.96)'
                              : 'rgba(132, 178, 236, 0.86)')
                          : (tool.emphasis === 'primary'
                              ? 'rgba(75, 120, 215, 0.92)'
                              : 'rgba(82, 130, 224, 0.78)'),
                        transform: 'translateY(-1px) scale(1.04)',
                      },
                      '& .tool-label': {
                        opacity: 1,
                      },
                    },
                    '&:active': {
                      boxShadow: 'none',
                      transform: 'translateY(0)',
                    },
                    '&:focus-visible': {
                      borderColor: theme.palette.primary.main,
                      boxShadow: `inset 0 0 0 1px ${theme.palette.primary.main}`,
                    },
                  }}
                >
                  <Box
                    className="tool-icon"
                    sx={{
                      alignItems: 'center',
                      color: isDarkMode
                        ? tool.emphasis === 'primary'
                          ? 'rgba(223,228,238,0.9)'
                          : 'rgba(223,228,238,0.7)'
                        : tool.emphasis === 'primary'
                          ? 'rgba(24,29,36,0.78)'
                          : 'rgba(24,29,36,0.58)',
                      display: 'inline-flex',
                      justifyContent: 'center',
                      transition: 'color 160ms ease, transform 140ms ease',
                    }}
                  >
                    {tool.icon}
                  </Box>
                  <Typography
                    className="tool-label"
                    sx={{
                      color: theme.palette.text.primary,
                      fontSize: tool.emphasis === 'primary' ? '0.87rem' : '0.84rem',
                      fontWeight: tool.emphasis === 'primary' ? 650 : 600,
                      letterSpacing: '0.01em',
                      lineHeight: 1.3,
                      opacity: tool.emphasis === 'primary' ? 1 : 0.96,
                      transition: 'opacity 140ms ease',
                    }}
                  >
                    {tool.label}
                  </Typography>
                </ButtonBase>
              ))}
            </Box>
          </>
        ) : (
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
                      borderColor: theme.palette.border.main,
                      flexShrink: 0,
                      fontSize: '0.78rem',
                      minWidth: '60px',
                      opacity: step.done ? 0.5 : 1,
                      borderRadius: '9px',
                      fontWeight: 600,
                      '&:focus-visible': {
                        borderColor: theme.palette.primary.main,
                        boxShadow: `inset 0 0 0 1px ${theme.palette.primary.main}`,
                      },
                      ...(step.done
                        ? {}
                        : {
                            backgroundColor: isDarkMode
                              ? theme.palette.background.elevated
                              : theme.palette.background.paper,
                            color: theme.palette.text.primary,
                            '&:hover': {
                              backgroundColor: isDarkMode
                                ? theme.palette.background.elevated
                                : theme.palette.background.elevated,
                              borderColor: theme.palette.primary.light,
                              color: theme.palette.text.primary,
                              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                              transform: 'translateY(-1px)',
                            },
                            '&:active': {
                              boxShadow: 'none',
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
        )}
    </>
  );

  return (
    <>
      {showTools ? (
        <Box
          ref={panelRef}
          sx={{
            ...dashboardPanelSx(theme),
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            gap: '8px',
            justifyContent: 'flex-start',
            position: 'relative',
            padding: '16px 20px',
            transition: 'border-color 180ms ease, background-color 180ms ease',
            width: '100%',
          }}
          onMouseMove={handleDashboardPanelPointerMove}
          onMouseLeave={handleDashboardPanelPointerLeave}
        >
          {cardContent}
        </Box>
      ) : (
        <BorderGlow
          animated={startBorderGlowIntro}
          interactive={false}
          edgeSensitivity={20}
          glowColor={isDarkMode ? '192 100 69' : '210 78 56'}
          backgroundColor={isDarkMode ? '#1D1F27' : '#f5f7fb'}
          borderRadius={22}
          glowRadius={77}
          glowIntensity={isDarkMode ? 0.3 : 0.42}
          coneSpread={25}
          colors={
            isDarkMode
              ? ['#6D9FEE', '#71A1EB', '#40B4C7']
              : ['#4D7FE4', '#5B8DE6', '#2F9EB4']
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
              borderRadius: '22px',
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
      )}

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
