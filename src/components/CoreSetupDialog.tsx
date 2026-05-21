import {
  Box,
  Button,
  ButtonBase,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  LinearProgress,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import ViewInArRoundedIcon from '@mui/icons-material/ViewInArRounded';
import { Trans, useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useModal } from '../hooks/useModal';
import { useSetAtom } from 'jotai';
import { infoSnackGlobalAtom, openSnackGlobalAtom } from '../atoms/global';
import {
  dialogActionsSx,
  dialogContentSx,
  dialogContentTextSx,
  dialogTitleSx,
  getDialogDangerButtonSx,
  getDialogPaperSx,
  getDialogPrimaryButtonSx,
} from './App/dialogSurface';

export type StepStatus = 'idle' | 'active' | 'done' | 'error';

export interface StepState {
  status: StepStatus;
  /** 0..100; if omitted, inferred from status (done=>100, idle=>0) */
  progress?: number;
  /** Optional small helper text under the progress bar */
  message?: string;
}

export interface Steps {
  hasJava: StepState;
  downloadedCore: StepState;
  coreRunning: StepState;
}

/** Theme-aware styles for the Core setup shell; dark branch preserves existing pixel-perfect values. */
export function getCoreSetupStyles(theme: Theme) {
  const isLight = theme.palette.mode === 'light';
  const { palette } = theme;

  const dividerSoft = isLight
    ? palette.divider
    : 'rgba(255,255,255,0.07)';
  const dividerStrong = isLight
    ? palette.divider
    : 'rgba(255,255,255,0.08)';
  const dividerRow = isLight
    ? palette.divider
    : 'rgba(255,255,255,0.06)';

  const dialogPaperSx = {
    background: isLight ? palette.background.paper : '#0d1117',
    border: isLight
      ? `1px solid ${palette.divider}`
      : '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    boxShadow: isLight
      ? `0 24px 50px ${alpha('#000000', 0.12)}`
      : '0 24px 50px rgba(0,0,0,0.36)',
    maxHeight: 'calc(100vh - 48px)',
    maxWidth: '740px',
  };

  const coreHeaderSx = {
    alignItems: 'center',
    borderBottom: isLight
      ? `1px solid ${palette.divider}`
      : '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    justifyContent: 'space-between',
    minHeight: 64,
    px: { xs: 2.5, sm: 3 },
  };

  const coreTitleSx = {
    borderBottom: 'none',
    color: isLight ? palette.text.primary : 'rgba(246,248,252,0.96)',
    fontSize: '1.04rem',
    fontWeight: 650,
    lineHeight: 1.3,
    px: 0,
    py: 0,
    textAlign: 'left' as const,
  };

  const closeButtonSx = {
    color: isLight
      ? alpha(palette.text.primary, 0.62)
      : 'rgba(214,221,233,0.68)',
    mr: -0.75,
    '&:hover': {
      backgroundColor: isLight
        ? alpha(palette.action.active, 0.06)
        : 'rgba(255,255,255,0.04)',
      color: isLight ? palette.text.primary : '#F6F8FC',
    },
  };

  const coreContentSx = {
    px: { xs: 2.5, sm: 3.4 },
    py: { xs: 2.4, sm: 3 },
  };

  const advancedCopySx = {
    color: isLight
      ? palette.text.secondary
      : 'rgba(214,221,233,0.64)',
    fontSize: '0.84rem',
    lineHeight: 1.55,
  };

  const introSx = {
    alignItems: 'center',
    display: 'flex',
    gap: 1.6,
    mb: 2.2,
    px: { xs: 0, sm: 0.8 },
  };

  const introIconSx = {
    alignItems: 'center',
    background: isLight
      ? `linear-gradient(135deg, ${alpha(palette.primary.main, 0.95)}, ${alpha(palette.primary.main, 0.22)})`
      : 'linear-gradient(135deg, rgba(51,107,222,0.92), rgba(91,132,201,0.3))',
    border: isLight
      ? `1px solid ${alpha(palette.primary.main, 0.35)}`
      : '1px solid rgba(118,165,255,0.42)',
    borderRadius: '999px',
    boxShadow: isLight
      ? `0 0 20px ${alpha(palette.primary.main, 0.2)}`
      : '0 0 24px rgba(74,132,255,0.24)',
    color: isLight ? palette.primary.contrastText : '#D5E4FF',
    display: 'flex',
    flexShrink: 0,
    height: 48,
    justifyContent: 'center',
    width: 48,
  };

  const introTitleSx = {
    color: isLight ? palette.text.primary : 'rgba(246,248,252,0.96)',
    fontSize: '0.96rem',
    fontWeight: 800,
    lineHeight: 1.25,
  };

  const publicNodeWarningSx = {
    alignItems: 'center',
    backgroundColor: isLight
      ? alpha(palette.warning.main, 0.08)
      : 'rgba(216,186,138,0.08)',
    border: isLight
      ? `1px solid ${alpha(palette.warning.main, 0.28)}`
      : '1px solid rgba(216,186,138,0.18)',
    borderRadius: '8px',
    display: 'flex',
    gap: 1.1,
    mb: 2.2,
    px: 1.35,
    py: 1.1,
  };

  const publicNodeWarningTextSx = {
    color: isLight
      ? alpha(palette.text.primary, 0.82)
      : 'rgba(239,228,202,0.9)',
    fontSize: '0.82rem',
    lineHeight: 1.5,
  };

  const stepsListSx = {
    borderBottom: `1px solid ${dividerSoft}`,
    display: 'grid',
  };

  const coreStepSx = (active: boolean) => ({
    borderTop: `1px solid ${dividerSoft}`,
    display: 'grid',
    gap: active ? 1.5 : 1.25,
    px: { xs: 0, sm: 2 },
    py: { xs: 2.2, sm: 2.35 },
  });

  const stepHeaderSx = {
    alignItems: 'flex-start',
    display: 'grid',
    gap: { xs: 1.35, sm: 1.6 },
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  };

  const stepIconSlotSx = {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'center',
    pt: 0.1,
    width: 32,
  };

  const stepTitleSx = {
    color: isLight ? palette.text.primary : 'rgba(246,248,252,0.96)',
    fontSize: '0.96rem',
    fontWeight: 800,
    lineHeight: 1.25,
  };

  const progressRowSx = {
    alignItems: 'center',
    display: 'flex',
    gap: 1.5,
    ml: { xs: 0, sm: 6 },
  };

  const stepMessageSx = {
    ...advancedCopySx,
    ml: { xs: 0, sm: 6 },
  };

  const activeStatusSx = {
    color: isLight ? palette.primary.main : '#83B3FF',
    fontSize: '0.84rem',
    fontWeight: 700,
    lineHeight: 1.55,
  };

  const nextPillSx = {
    alignSelf: 'flex-start',
    backgroundColor: isLight
      ? alpha(palette.primary.main, 0.12)
      : 'rgba(77,139,255,0.16)',
    borderRadius: '7px',
    color: isLight ? palette.primary.dark : '#9FC0FF',
    fontSize: '0.74rem',
    fontWeight: 700,
    lineHeight: 1,
    px: 1,
    py: 0.68,
  };

  const locationCardSx = {
    borderBottom: `1px solid ${dividerSoft}`,
    display: 'grid',
    gap: 1.5,
    px: { xs: 0, sm: 2 },
    py: { xs: 2.15, sm: 2.35 },
  };

  const locationHeaderSx = {
    alignItems: 'center',
    display: 'grid',
    gap: { xs: 1.35, sm: 1.6 },
    gridTemplateColumns: 'auto minmax(0,1fr) auto',
  };

  const pathStripSx = {
    alignItems: 'center',
    backgroundColor: isLight
      ? alpha(palette.text.primary, 0.04)
      : 'rgba(255,255,255,0.045)',
    borderRadius: '7px',
    display: 'flex',
    gap: 1,
    minHeight: 44,
    ml: { xs: 0, sm: 5.6 },
    px: 1.35,
  };

  const toolRowSx = {
    alignItems: 'center',
    borderBottom: `1px solid ${dividerRow}`,
    display: 'grid',
    gap: 1.5,
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    py: 1.35,
    '&:last-child': {
      borderBottom: 0,
    },
  };

  const toolTitleSx = {
    color: isLight ? palette.text.primary : 'rgba(246,248,252,0.96)',
    fontSize: '0.9rem',
    fontWeight: 800,
    lineHeight: 1.25,
  };

  const toolErrorSx = {
    color: isLight ? palette.warning.dark : '#D8BA8A',
    fontSize: '0.8rem',
    lineHeight: 1.45,
  };

  const pathValueSx = {
    color: isLight
      ? palette.text.secondary
      : 'rgba(214,221,233,0.78)',
    fontSize: '0.8rem',
    lineHeight: 1.45,
    overflowWrap: 'anywhere' as const,
  };

  const copyButtonSx = {
    alignItems: 'center',
    color: isLight
      ? alpha(palette.text.primary, 0.48)
      : 'rgba(214,221,233,0.56)',
    display: 'flex',
    flex: '0 0 auto',
    p: 0.35,
    '&:hover': {
      color: isLight ? palette.primary.main : '#D6E5FF',
    },
  };

  const toolButtonSx = {
    borderColor: isLight
      ? alpha(palette.primary.main, 0.4)
      : 'rgba(141,180,242,0.45)',
    color: isLight ? palette.text.primary : 'rgba(214,228,252,0.96)',
    fontSize: '0.8rem',
    fontWeight: 600,
    letterSpacing: 0,
    minHeight: 34,
    minWidth: 82,
    textTransform: 'none' as const,
    '&:hover': {
      borderColor: isLight
        ? palette.primary.main
        : 'rgba(170,202,255,0.7)',
      backgroundColor: isLight
        ? alpha(palette.primary.main, 0.06)
        : 'rgba(141,180,242,0.08)',
    },
  };

  const advancedCardSx = {
    display: 'grid',
  };

  const advancedToggleSx = {
    alignItems: 'center',
    display: 'grid',
    gap: { xs: 1.35, sm: 1.6 },
    gridTemplateColumns: 'auto minmax(0,1fr) auto',
    px: { xs: 0, sm: 2 },
    py: { xs: 2.15, sm: 2.35 },
    width: '100%',
    '&:hover': {
      backgroundColor: isLight
        ? alpha(palette.action.active, 0.04)
        : 'rgba(255,255,255,0.018)',
    },
  };

  const advancedToolsSx = {
    borderTop: `1px solid ${dividerSoft}`,
    display: 'grid',
    px: { xs: 0, sm: 2 },
  };

  const footerSx = {
    borderTop: `1px solid ${dividerStrong}`,
    justifyContent: 'flex-end',
    px: { xs: 2.5, sm: 3.4 },
    py: 2,
  };

  const footerInnerSx = {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 1.5,
    justifyContent: 'flex-end',
    width: '100%',
  };

  const secondaryActionSx = {
    color: isLight
      ? palette.text.secondary
      : 'rgba(214,221,233,0.72)',
    fontSize: '0.86rem',
    fontWeight: 600,
    letterSpacing: 0,
    minHeight: 38,
    px: 1.6,
    textTransform: 'none' as const,
    '&:hover': {
      backgroundColor: isLight
        ? alpha(palette.action.active, 0.06)
        : 'rgba(255,255,255,0.035)',
      color: isLight ? palette.text.primary : '#F6F8FC',
    },
  };

  const primaryActionSx = {
    fontSize: '0.86rem',
    fontWeight: 600,
    letterSpacing: 0,
    minHeight: 40,
    minWidth: 136,
    px: 2.4,
    textTransform: 'none' as const,
  };

  const progressPercentSx = {
    color: isLight
      ? palette.text.secondary
      : 'rgba(214,221,233,0.58)',
    fontSize: '0.82rem',
    minWidth: 38,
    textAlign: 'right' as const,
  };

  const mutedDecorIconSx = {
    color: isLight
      ? palette.text.secondary
      : 'rgba(214,221,233,0.72)',
    fontSize: 24,
  };

  const chevronIconSx = {
    color: isLight ? palette.text.secondary : 'rgba(214,221,233,0.65)',
    fontSize: 28,
  };

  return {
    activeStatusSx,
    advancedCardSx,
    advancedCopySx,
    advancedToggleSx,
    advancedToolsSx,
    chevronIconSx,
    closeButtonSx,
    coreContentSx,
    coreHeaderSx,
    coreStepSx,
    coreTitleSx,
    copyButtonSx,
    dialogPaperSx,
    footerInnerSx,
    footerSx,
    introIconSx,
    introSx,
    introTitleSx,
    locationCardSx,
    locationHeaderSx,
    mutedDecorIconSx,
    nextPillSx,
    pathStripSx,
    pathValueSx,
    primaryActionSx,
    progressPercentSx,
    progressRowSx,
    publicNodeWarningSx,
    publicNodeWarningTextSx,
    secondaryActionSx,
    stepHeaderSx,
    stepIconSlotSx,
    stepMessageSx,
    stepTitleSx,
    stepsListSx,
    toolButtonSx,
    toolErrorSx,
    toolRowSx,
    toolTitleSx,
  };
}

export interface CoreSetupDialogProps {
  open: boolean;
  onClose?: () => void;
  onAction?: () => void;
  /** Disable closing via UI while work is in progress */
  disableClose?: boolean;
  /** Show loading state on the action button */
  actionLoading?: boolean;

  steps: Steps;

  /** Optional override for the action label. If not provided, it’s computed. */
  actionLabelOverride?: string;
  /** If true, hides the action button entirely when core is already running */
  hideActionIfRunning?: boolean;
  customQortalPath: string;
  verifyCoreNotRunningFunc: () => void;
  startAtIntro?: boolean;
  isCoreSyncing?: boolean;
  coreSyncPercent?: number;
  publicNodeUnavailable?: boolean;
  contextualActionLabel?: string;
  contextualActionDisabled?: boolean;
  contextualActionLoading?: boolean;
  onContextualAction?: () => void;
}

function resolveProgress({ status, progress }: StepState) {
  if (typeof progress === 'number') return Math.min(100, Math.max(0, progress));
  if (status === 'done') return 100;
  if (status === 'idle') return 0;
  return undefined; // shows indeterminate bar for 'active'/'error' without explicit number
}

export function CoreSetupDialog(props: CoreSetupDialogProps) {
  const {
    open,
    onClose,
    onAction,
    disableClose,
    actionLoading = false,
    steps,
    actionLabelOverride,
    customQortalPath,
    verifyCoreNotRunningFunc,
    startAtIntro = false,
    isCoreSyncing = false,
    coreSyncPercent,
    publicNodeUnavailable = false,
    contextualActionLabel,
    contextualActionDisabled = false,
    contextualActionLoading = false,
    onContextualAction,
  } = props;
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const setInfoSnackCustom = useSetAtom(infoSnackGlobalAtom);
  const [isExtended, setIsExtended] = useState(false);
  const [errorStop, setErrorStop] = useState('');
  const [errorBootstrapChain, setErrorBootstrapChain] = useState('');
  const { t } = useTranslation(['node', 'core']);
  const [mode, setMode] = useState(startAtIntro ? 1 : 2);
  const [stopCoreLoading, setStopCoreLoading] = useState(false);
  const [bootstrapChainLoading, setBootstrapChainLoading] = useState(false);
  const [coreRunningOnSystem, setCoreRunningOnSystem] = useState(false);
  const [coreInstalledOnSystem, setCoreInstalledOnSystem] = useState(false);
  const isActiveRef = useRef(false);
  const startPause = useRef(false);
  const bootstrapChainLoadingRef = useRef(false);
  const stopCoreLoadingRef = useRef(false);
  const { isShow, onCancel, onOk, message, show } = useModal();

  const theme = useTheme();
  const s = useMemo(() => getCoreSetupStyles(theme), [theme]);
  const renderStepStatusIcon = useCallback(
    (status: StepStatus) => {
      const isLight = theme.palette.mode === 'light';
      const idleColor = isLight
        ? alpha(theme.palette.text.primary, 0.32)
        : 'rgba(214,221,233,0.32)';
      const activeColor = isLight
        ? theme.palette.primary.main
        : '#83B3FF';
      switch (status) {
        case 'done':
          return <CheckCircleIcon sx={{ color: '#62D26F', fontSize: 29 }} />;
        case 'error':
          return <ErrorOutlineIcon sx={{ color: '#FF7070', fontSize: 29 }} />;
        case 'active':
          return (
            <HourglassEmptyIcon sx={{ color: activeColor, fontSize: 29 }} />
          );
        case 'idle':
        default:
          return (
            <RadioButtonUncheckedIcon
              sx={{ color: idleColor, fontSize: 29 }}
            />
          );
      }
    },
    [theme]
  );
  const statusText = useCallback(
    (status: StepStatus) => {
      switch (status) {
        case 'done':
          return t('node:status.complete', {
            postProcess: 'capitalizeFirstChar',
          });
        case 'active':
          return t('node:status.inProgress', {
            postProcess: 'capitalizeFirstChar',
          });
        case 'error':
          return t('node:status.error', {
            postProcess: 'capitalizeFirstChar',
          });
        case 'idle':
        default:
          return t('node:status.pending', {
            postProcess: 'capitalizeFirstChar',
          });
      }
    },
    [t]
  );
  const stepDefs = useMemo(
    () => [
      {
        key: 'downloadedCore' as const,
        getLabel: (state: StepState) => {
          if (state.status === 'done')
            return t('node:coreSetupDialog.steps.downloadDone', {
              postProcess: 'capitalizeFirstChar',
            });
          if (state.status === 'active')
            return t('node:coreSetupDialog.steps.downloadActive', {
              postProcess: 'capitalizeFirstChar',
            });
          return t('node:coreSetupDialog.steps.downloadIdle', {
            postProcess: 'capitalizeFirstChar',
          });
        },
      },
      {
        key: 'coreRunning' as const,
        getLabel: (state: StepState) => {
          if (state.status === 'done')
            return t('node:coreSetupDialog.steps.runningDone', {
              postProcess: 'capitalizeFirstChar',
            });
          if (state.status === 'active')
            return t('node:coreSetupDialog.steps.runningActive', {
              postProcess: 'capitalizeFirstChar',
            });
          return t('node:coreSetupDialog.steps.runningIdle', {
            postProcess: 'capitalizeFirstChar',
          });
        },
      },
    ],
    [t]
  );

  const stepStates = stepDefs.map((def) => {
    const state =
      def.key === 'coreRunning' &&
      isCoreSyncing &&
      typeof coreSyncPercent === 'number'
        ? {
            ...steps[def.key],
            progress: Math.max(0, Math.min(100, coreSyncPercent)),
          }
        : steps[def.key];

    return {
      ...def,
      state,
      label: def.getLabel(state),
    };
  });

  const downloaded = steps.downloadedCore.status === 'done';
  const running = steps.coreRunning.status === 'done';
  const isActive = steps['coreRunning']?.status === 'active';

  useEffect(() => {
    isActiveRef.current = isActive;
    bootstrapChainLoadingRef.current = bootstrapChainLoading;
    stopCoreLoadingRef.current = stopCoreLoading;
  }, [isActive, stopCoreLoading, bootstrapChainLoading]);

  const computedActionLabel = useMemo(() => {
    if (running) {
      return t('node:coreSetupDialog.actionDone', {
        postProcess: 'capitalizeFirstChar',
      });
    }
    if (downloaded) {
      return t('node:coreSetupDialog.actionStart', {
        postProcess: 'capitalizeFirstChar',
      });
    }
    return t('node:coreSetupDialog.actionDownload', {
      postProcess: 'capitalizeFirstChar',
    });
  }, [running, downloaded, t]);

  const actionLabel = actionLabelOverride ?? computedActionLabel;
  const hasContextualAction =
    Boolean(contextualActionLabel) && Boolean(onContextualAction);

  // Enable action if Java is installed and core is not already running
  const canAction = !actionLoading;
  const nextStepKey = running
    ? undefined
    : downloaded
      ? 'coreRunning'
      : 'downloadedCore';
  const coreLocationDescription = useMemo(
    () =>
      customQortalPath
        ? t('node:coreSetupDialog.locationCustom', {
            postProcess: 'capitalizeFirstChar',
          })
        : t('node:coreSetupDialog.locationDefault', {
            postProcess: 'capitalizeFirstChar',
          }),
    [customQortalPath, t]
  );
  const coreLocationLabel = useMemo(
    () =>
      customQortalPath ||
      t('node:coreSetupDialog.locationPathDefault', {
        postProcess: 'capitalizeFirstChar',
      }),
    [customQortalPath, t]
  );
  const advancedCoreToolsDisabled = isActive || isCoreSyncing;

  const copyCoreLocation = async () => {
    if (!customQortalPath) return;
    try {
      await navigator.clipboard?.writeText(customQortalPath);
      setOpenSnackGlobal(true);
      setInfoSnackCustom({
        type: 'success',
        message: t('node:coreSetupDialog.folderCopied', {
          postProcess: 'capitalizeFirstChar',
        }),
      });
    } catch (error) {
      console.error(error);
    }
  };

  const pickPath = async () => {
    try {
      const res = await window.coreSetup?.pickQortalDirectory?.();

      if (res === false) {
        setOpenSnackGlobal(true);
        setInfoSnackCustom({
          type: 'error',
          message: t('node:error.noJar', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
      } else {
        verifyCoreNotRunningFunc();
      }
    } catch (error) {
      console.error(error);
    }
  };

  const removePath = async () => {
    try {
      await window.coreSetup?.removeCustomPath?.();
      verifyCoreNotRunningFunc();
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (downloaded) {
      setMode(2);
    }
  }, [downloaded]);

  useEffect(() => {
    if (open) {
      setMode(startAtIntro ? 1 : 2);
      verifyCoreNotRunningFunc();
      setErrorStop('');
      setErrorBootstrapChain('');
    }
  }, [open, startAtIntro, verifyCoreNotRunningFunc]);

  const getIsCoreRunningOnSystem = async () => {
    try {
      if (
        isActiveRef.current ||
        bootstrapChainLoadingRef.current ||
        stopCoreLoadingRef.current ||
        startPause.current
      )
        return;
      const response = await window?.coreSetup?.isCoreRunningOnSystem();
      if (
        isActiveRef.current ||
        bootstrapChainLoadingRef.current ||
        stopCoreLoadingRef.current
      )
        return;
      setCoreRunningOnSystem(response);
    } catch (error) {
      console.error(error);
    }
  };

  const getIsCoreInstalledOnSystem = async () => {
    try {
      const response = await window?.coreSetup?.isCoreInstalledOnSystem();
      if (
        isActiveRef.current ||
        bootstrapChainLoadingRef.current ||
        stopCoreLoadingRef.current
      )
        return;
      setCoreInstalledOnSystem(response);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (
      !open ||
      !window?.coreSetup ||
      isActive ||
      bootstrapChainLoading
    )
      return; // only start when modal is open
    if (window?.coreSetup?.isCoreRunningOnSystem) {
      getIsCoreRunningOnSystem();
      getIsCoreInstalledOnSystem();
    }
    const intervalId = setInterval(() => {
      window?.coreSetup?.verifySteps();
      if (window?.coreSetup?.isCoreRunningOnSystem) {
        getIsCoreRunningOnSystem();
        getIsCoreInstalledOnSystem();
      }
    }, 5000); // every 5s

    return () => clearInterval(intervalId); // cleanup on close/unmount
  }, [open, isActive, bootstrapChainLoading]);

  const stopCore = async () => {
    if (advancedCoreToolsDisabled) return;

    try {
      setErrorStop('');
      setStopCoreLoading(true);
      stopCoreLoadingRef.current = true;
      await show({
        message: t('node:confirmations.stop', {
          postProcess: 'capitalizeFirstChar',
        }),
      });

      const response = await window?.coreSetup?.stopCore();
      if (response === true) {
        verifyCoreNotRunningFunc();
      } else {
        setErrorStop(
          t('node:error.failed_stop', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
    } catch (error) {
      console.error(error);
    } finally {
      setStopCoreLoading(false);
      stopCoreLoadingRef.current = false;
    }
  };
  const bootstrapOrClearChainAndStart = async () => {
    if (advancedCoreToolsDisabled) return;

    try {
      setErrorBootstrapChain('');
      setBootstrapChainLoading(true);
      bootstrapChainLoadingRef.current = true;
      await show({
        message: t('node:confirmations.bootstrapOrClearChain', {
          postProcess: 'capitalizeFirstChar',
        }),
      });
      const response =
        (await window?.coreSetup?.bootstrapOrClearChainAndStart?.()) ??
        false;
      if (response !== true) {
        setErrorBootstrapChain(
          t('node:error.failed_bootstrap_or_clear', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
    } catch (error) {
      console.error(error);
    } finally {
      setBootstrapChainLoading(false);
      bootstrapChainLoadingRef.current = false;
    }
  };
  const handleDialogClose = (
    _event: object,
    _reason: 'backdropClick' | 'escapeKeyDown'
  ) => {
    if (disableClose) return;
    onClose?.();
  };

  return (
    <Dialog
      open={open}
      onClose={handleDialogClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="core-setup-title"
      slotProps={{
        paper: {
          sx: s.dialogPaperSx,
        },
      }}
    >
      {mode === 1 && (
        <>
          <DialogTitle id="core-setup-title">
            {' '}
            {t('core:welcome', {
              postProcess: 'capitalizeFirstChar',
            })}
          </DialogTitle>

          <DialogContent dividers>
            <Typography gutterBottom>
              <Trans
                i18nKey="node:introSetup.paragraph1"
                components={{ strong: <strong /> }}
              />
            </Typography>

            <Typography gutterBottom>
              <Trans
                i18nKey="node:introSetup.paragraph2"
                components={{ strong: <strong /> }}
              />
            </Typography>
            <Typography variant="subtitle1" gutterBottom>
              {t('node:recommendation.subTitle', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
            <ul>
              <li>
                {' '}
                {t('node:recommendation.point1', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </li>
              <li>
                {' '}
                {t('node:recommendation.point2', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </li>
              <li>
                {t('node:recommendation.point3', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </li>
            </ul>
            <Box
              sx={{
                alignItems: 'center',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                outlineStyle: 'solid',
                outlineWidth: '0.5px',
                padding: '20px 30px',
              }}
            >
              <Typography
                sx={{
                  textDecoration: 'underline',
                }}
              >
                {t('node:introSetup.note', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
              <Typography>
                {t('node:introSetup.advanced', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Box>
          </DialogContent>

          <DialogActions sx={{ p: 2 }}>
            {onClose && !running && (
              <Button onClick={onClose} disabled={disableClose} variant="text">
                {t('core:action.close', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Button>
            )}

            <Button
              onClick={() => setMode(2)}
              color="success"
              variant="contained"
            >
              {t('core:pagination.next', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </DialogActions>
        </>
      )}
      {mode === 2 && (
        <>
          <Box sx={s.coreHeaderSx}>
                <Typography id="core-setup-title" sx={s.coreTitleSx}>
                  {t('node:coreSetupDialog.title', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
            {onClose && (
              <IconButton
                onClick={onClose}
                disabled={disableClose}
                sx={s.closeButtonSx}
              >
                <CloseRoundedIcon />
              </IconButton>
            )}
          </Box>
          <DialogContent sx={s.coreContentSx}>
            <Box sx={s.introSx}>
              <Box sx={s.introIconSx}>
                <ViewInArRoundedIcon sx={{ fontSize: 20 }} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={s.introTitleSx}>
                  {t('node:coreSetupDialog.introTitle', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
                <Typography sx={s.advancedCopySx}>
                  {t('node:coreSetupDialog.introSubtitle', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Box>
            </Box>

            {publicNodeUnavailable && (
              <Box sx={s.publicNodeWarningSx}>
                <ErrorOutlineIcon
                  sx={{
                    color:
                      theme.palette.mode === 'light'
                        ? theme.palette.warning.main
                        : '#D8BA8A',
                    fontSize: 20,
                  }}
                />
                <Typography sx={s.publicNodeWarningTextSx}>
                  {t('node:coreSetupDialog.publicNodeUnavailable', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Box>
            )}

            <Box sx={s.stepsListSx}>
              {stepStates.map(({ key, label, state }) => {
                const prog = resolveProgress(state);
                const isIndeterminate =
                  prog === undefined &&
                  (state.status === 'active' || state.status === 'error');
                const isNextStep = key === nextStepKey;
                const statusLabel =
                  isNextStep && state.status === 'idle'
                    ? key === 'downloadedCore'
                      ? t('node:coreSetupDialog.readyToDownload', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : t('node:coreSetupDialog.readyToStart', {
                          postProcess: 'capitalizeFirstChar',
                        })
                    : key === 'coreRunning' &&
                        state.status === 'done' &&
                        isCoreSyncing
                      ? t('node:coreSetupDialog.syncing', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : statusText(state.status);
                const helperText =
                  key === 'downloadedCore'
                    ? state.status === 'done'
                      ? t('node:coreSetupDialog.helpers.downloadDone', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : state.status === 'active'
                        ? t('node:coreSetupDialog.helpers.downloadActive', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : t('node:coreSetupDialog.helpers.downloadIdle', {
                            postProcess: 'capitalizeFirstChar',
                          })
                    : state.status === 'done'
                      ? isCoreSyncing
                        ? t('node:coreSetupDialog.helpers.runningDoneSyncing', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : t('node:coreSetupDialog.helpers.runningDone', {
                            postProcess: 'capitalizeFirstChar',
                          })
                      : downloaded
                        ? t('node:coreSetupDialog.helpers.runningWaiting', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : t('node:coreSetupDialog.helpers.runningBlocked', {
                            postProcess: 'capitalizeFirstChar',
                          });

                return (
                  <Box key={key} sx={s.coreStepSx(isNextStep)}>
                    <Box sx={s.stepHeaderSx}>
                      <Box sx={s.stepIconSlotSx}>
                        {renderStepStatusIcon(state.status)}
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={s.stepTitleSx}>{label}</Typography>
                        <Typography
                          sx={
                            isNextStep ? s.activeStatusSx : s.advancedCopySx
                          }
                        >
                          {statusLabel}
                        </Typography>
                        {isNextStep && (
                          <Typography sx={{ ...s.advancedCopySx, mt: 1.2 }}>
                            {helperText}
                          </Typography>
                        )}
                      </Box>
                      {isNextStep && (
                        <Typography sx={s.nextPillSx}>
                          {t('node:coreSetupDialog.nextStepPill', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                      )}
                    </Box>
                    <Box sx={s.progressRowSx}>
                      <Box sx={{ flex: 1 }}>
                        <LinearProgress
                          variant={
                            prog !== undefined ? 'determinate' : 'indeterminate'
                          }
                          value={prog}
                          color={state.status === 'error' ? 'error' : 'primary'}
                          aria-label={t('node:coreSetupDialog.progressAriaLabel', {
                            label,
                          })}
                          sx={{
                            height: 7,
                            borderRadius: 2,
                          }}
                        />
                      </Box>
                      <Typography sx={s.progressPercentSx}>
                        {prog !== undefined
                          ? `${prog}%`
                          : isIndeterminate
                            ? '...'
                            : '0%'}
                      </Typography>
                    </Box>

                    {state.message && !isNextStep ? (
                      <Typography sx={s.stepMessageSx}>
                        {t(`node:messages.${state.message}`, {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
            <Box sx={s.locationCardSx}>
              <Box sx={s.locationHeaderSx}>
                <FolderOpenRoundedIcon sx={s.mutedDecorIconSx} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={s.toolTitleSx}>
                    {t('node:coreSetupDialog.locationTitle', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <Typography sx={s.advancedCopySx}>
                    {coreLocationDescription}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.8 }}>
                  <Button
                    onClick={pickPath}
                    size="small"
                    sx={s.toolButtonSx}
                    variant="outlined"
                  >
                    {customQortalPath
                      ? t('node:coreSetupDialog.change', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : t('node:coreSetupDialog.choose', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                  </Button>
                  {customQortalPath && (
                    <Button
                      onClick={removePath}
                      size="small"
                      sx={s.toolButtonSx}
                      variant="outlined"
                    >
                      {t('node:coreSetupDialog.clear', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Button>
                  )}
                </Box>
              </Box>
              <Box sx={s.pathStripSx}>
                <Typography sx={s.pathValueSx}>{coreLocationLabel}</Typography>
                {customQortalPath && (
                  <ButtonBase onClick={copyCoreLocation} sx={s.copyButtonSx}>
                    <ContentCopyIcon sx={{ fontSize: 17 }} />
                  </ButtonBase>
                )}
              </Box>
            </Box>

            <Box sx={s.advancedCardSx}>
              <ButtonBase
                onClick={() => setIsExtended((prev) => !prev)}
                sx={s.advancedToggleSx}
              >
                <SettingsRoundedIcon sx={s.mutedDecorIconSx} />
                <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <Typography sx={s.toolTitleSx}>
                    {t('node:coreSetupDialog.advancedTitle', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <Typography sx={s.advancedCopySx}>
                    {t('node:coreSetupDialog.advancedSubtitle', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </Box>
                {isExtended ? (
                  <KeyboardArrowUpRoundedIcon sx={s.chevronIconSx} />
                ) : (
                  <KeyboardArrowRightRoundedIcon sx={s.chevronIconSx} />
                )}
              </ButtonBase>
              <Collapse in={isExtended} timeout="auto" unmountOnExit>
                <Box sx={s.advancedToolsSx}>
                  {advancedCoreToolsDisabled && (
                    <Typography sx={{ ...s.advancedCopySx, py: 1.1 }}>
                      {t('node:coreSetupDialog.maintenanceUnavailable', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                  )}
                  <Box sx={s.toolRowSx}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={s.toolTitleSx}>
                        {t('node:coreSetupDialog.stopCoreTitle', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                      <Typography sx={s.advancedCopySx}>
                        {t('node:coreSetupDialog.stopCoreBody', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                      {errorStop && (
                        <Typography sx={s.toolErrorSx}>{errorStop}</Typography>
                      )}
                    </Box>
                    <Button
                      onClick={stopCore}
                      size="small"
                      variant="outlined"
                      disabled={
                        advancedCoreToolsDisabled ||
                        stopCoreLoading ||
                        !running ||
                        !coreRunningOnSystem ||
                        bootstrapChainLoading
                      }
                      loading={stopCoreLoading}
                      sx={s.toolButtonSx}
                    >
                      {t('node:coreSetupDialog.stopButton', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Button>
                  </Box>

                  <Box sx={s.toolRowSx}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={s.toolTitleSx}>
                        {t('node:bootstrapChainHelp.title', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                      <Typography sx={s.advancedCopySx}>
                        {t('node:bootstrapChainHelp.body', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                      {errorBootstrapChain && (
                        <Typography sx={s.toolErrorSx}>
                          {errorBootstrapChain}
                        </Typography>
                      )}
                    </Box>
                    <Button
                      onClick={bootstrapOrClearChainAndStart}
                      size="small"
                      variant="outlined"
                      disabled={
                        advancedCoreToolsDisabled ||
                        bootstrapChainLoading ||
                        !coreInstalledOnSystem ||
                        stopCoreLoading
                      }
                      loading={bootstrapChainLoading}
                      sx={s.toolButtonSx}
                    >
                      {t('node:bootstrapChainHelp.title', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Button>
                  </Box>
                </Box>
              </Collapse>
            </Box>
          </DialogContent>

          <DialogActions sx={s.footerSx}>
            <Box sx={s.footerInnerSx}>
              {onClose && (
                <Button
                  onClick={onClose}
                  disabled={
                    disableClose ||
                    stopCoreLoading ||
                    actionLoading ||
                    bootstrapChainLoading
                  }
                  sx={s.secondaryActionSx}
                  variant="text"
                >
                  {t('node:coreSetupDialog.cancel', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
              )}

              {hasContextualAction ? (
                <Button
                  onClick={onContextualAction}
                  color="success"
                  variant="contained"
                  disabled={
                    contextualActionDisabled ||
                    contextualActionLoading ||
                    stopCoreLoading ||
                    bootstrapChainLoading
                  }
                  loading={contextualActionLoading as unknown as undefined}
                  sx={s.primaryActionSx}
                >
                  {contextualActionLabel}
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    setErrorStop('');
                    setErrorBootstrapChain('');
                    if (onAction) {
                      startPause.current = true;
                      onAction();
                      setTimeout(() => {
                        startPause.current = false;
                      }, 7000);
                    }
                  }}
                  color="success"
                  variant="contained"
                  disabled={
                    !canAction || stopCoreLoading || bootstrapChainLoading
                  }
                  loading={actionLoading as unknown as undefined} // if using @mui/lab LoadingButton, swap below
                  sx={s.primaryActionSx}
                  startIcon={
                    !running ? (
                      <PlayArrowRoundedIcon sx={{ fontSize: 18 }} />
                    ) : null
                  }
                >
                  {actionLabel}
                </Button>
              )}
            </Box>
          </DialogActions>
        </>
      )}

      <Dialog
        open={isShow}
        onClose={onCancel}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
        PaperProps={{
          sx: getDialogPaperSx(theme, { maxWidth: 420 }),
        }}
      >
        <DialogTitle id="alert-dialog-title" sx={dialogTitleSx}>
          {t('node:coreSetupDialog.confirmTitle', {
            postProcess: 'capitalizeFirstChar',
          })}
        </DialogTitle>

        <DialogContent sx={dialogContentSx}>
          <DialogContentText
            id="alert-dialog-description"
            sx={dialogContentTextSx}
          >
            {message?.message}
          </DialogContentText>
        </DialogContent>

        <DialogActions sx={dialogActionsSx}>
          <Button
            variant="contained"
            onClick={onOk}
            autoFocus
            sx={getDialogPrimaryButtonSx(theme)}
          >
            {t('core:action.accept', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>

          <Button
            variant="contained"
            onClick={onCancel}
            sx={getDialogDangerButtonSx()}
          >
            {t('core:action.decline', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
