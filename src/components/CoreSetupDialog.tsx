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
}

const statusIcon = (status: StepStatus) => {
  switch (status) {
    case 'done':
      return <CheckCircleIcon sx={{ color: '#62D26F', fontSize: 29 }} />;
    case 'error':
      return <ErrorOutlineIcon sx={{ color: '#FF7070', fontSize: 29 }} />;
    case 'active':
      return <HourglassEmptyIcon sx={{ color: '#83B3FF', fontSize: 29 }} />;
    case 'idle':
    default:
      return (
        <RadioButtonUncheckedIcon
          sx={{ color: 'rgba(214,221,233,0.32)', fontSize: 29 }}
        />
      );
  }
};

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
  } = props;
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const setInfoSnackCustom = useSetAtom(infoSnackGlobalAtom);
  const [isExtended, setIsExtended] = useState(false);
  const [errorStop, setErrorStop] = useState('');
  const [errorDeleteDB, setErrorDeleteDB] = useState('');
  const [errorBootstrap, setErrorBootstrap] = useState('');
  const { t } = useTranslation(['node', 'core']);
  const [mode, setMode] = useState(startAtIntro ? 1 : 2);
  const [stopCoreLoading, setStopCoreLoading] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [dbExists, setDbExists] = useState(false);
  const [deleteDBLoading, setDeleteDBLoading] = useState(false);
  const [coreRunningOnSystem, setCoreRunningOnSystem] = useState(false);
  const [coreInstalledOnSystem, setCoreInstalledOnSystem] = useState(false);
  const isActiveRef = useRef(false);
  const startPause = useRef(false);
  const bootstrapLoadingRef = useRef(false);
  const deleteDBLoadingRef = useRef(false);
  const stopCoreLoadingRef = useRef(false);
  const { isShow, onCancel, onOk, message, show } = useModal();

  const theme = useTheme();
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
          if (state.status === 'done') return 'Downloaded Core';
          if (state.status === 'active') return 'Downloading Core';
          return 'Download Core';
        },
      },
      {
        key: 'coreRunning' as const,
        getLabel: (state: StepState) => {
          if (state.status === 'done') return 'Core running';
          if (state.status === 'active') return 'Starting Core';
          return 'Start Core';
        },
      },
    ],
    []
  );

  const stepStates = stepDefs.map((def) => ({
    ...def,
    state: steps[def.key],
    label: def.getLabel(steps[def.key]),
  }));

  const downloaded = steps.downloadedCore.status === 'done';
  const running = steps.coreRunning.status === 'done';
  const isActive = steps['coreRunning']?.status === 'active';

  useEffect(() => {
    isActiveRef.current = isActive;
    bootstrapLoadingRef.current = bootstrapLoading;
    deleteDBLoadingRef.current = deleteDBLoading;
    stopCoreLoadingRef.current = stopCoreLoading;
  }, [isActive, deleteDBLoading, stopCoreLoading, bootstrapLoading]);

  const computedActionLabel = useMemo(
    () => (running ? 'Done' : downloaded ? 'Start Core' : 'Download Core'),
    [running, downloaded]
  );

  const actionLabel = actionLabelOverride ?? computedActionLabel;

  // Enable action if Java is installed and core is not already running
  const canAction = !actionLoading;
  const nextStepKey = running
    ? undefined
    : downloaded
      ? 'coreRunning'
      : 'downloadedCore';
  const coreLocationLabel = customQortalPath || 'Default Qortal Core location';
  const coreLocationDescription = customQortalPath
    ? 'Qortal Core will run from this folder.'
    : 'Qortal Core will use the default folder for this system.';
  const advancedCoreToolsDisabled = true;

  const copyCoreLocation = async () => {
    if (!customQortalPath) return;
    try {
      await navigator.clipboard?.writeText(customQortalPath);
      setOpenSnackGlobal(true);
      setInfoSnackCustom({
        type: 'success',
        message: 'Core folder copied',
      });
    } catch (error) {
      console.error(error);
    }
  };

  const pickPath = async () => {
    try {
      const res = await window.coreSetup.pickQortalDirectory();

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
      await window.coreSetup.removeCustomPath();
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
      setErrorDeleteDB('');
      setErrorBootstrap('');
    }
  }, [open, startAtIntro, verifyCoreNotRunningFunc]);

  const getIsCoreRunningOnSystem = async () => {
    try {
      if (
        isActiveRef.current ||
        bootstrapLoadingRef.current ||
        deleteDBLoadingRef.current ||
        stopCoreLoadingRef.current ||
        startPause.current
      )
        return;
      const response = await window?.coreSetup?.isCoreRunningOnSystem();
      if (
        isActiveRef.current ||
        bootstrapLoadingRef.current ||
        deleteDBLoadingRef.current ||
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
        bootstrapLoadingRef.current ||
        deleteDBLoadingRef.current
      )
        return;
      setCoreInstalledOnSystem(response);
    } catch (error) {
      console.error(error);
    }
  };

  const getDbExists = async () => {
    try {
      if (
        isActiveRef.current ||
        bootstrapLoadingRef.current ||
        deleteDBLoadingRef.current ||
        stopCoreLoadingRef.current ||
        startPause.current
      )
        return;
      const response = await window?.coreSetup?.dbExists();

      setDbExists(response);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (
      !open ||
      !window?.coreSetup ||
      isActive ||
      bootstrapLoading ||
      deleteDBLoading
    )
      return; // only start when modal is open
    if (window?.coreSetup?.isCoreRunningOnSystem) {
      getIsCoreRunningOnSystem();
      getIsCoreInstalledOnSystem();
      getDbExists();
    }
    const intervalId = setInterval(() => {
      window?.coreSetup?.verifySteps();
      if (window?.coreSetup?.isCoreRunningOnSystem) {
        getIsCoreRunningOnSystem();
        getIsCoreInstalledOnSystem();
        getDbExists();
      }
    }, 5000); // every 5s

    return () => clearInterval(intervalId); // cleanup on close/unmount
  }, [open, isActive, bootstrapLoading, deleteDBLoading]);

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
    }
  };
  const bootstrap = async () => {
    if (advancedCoreToolsDisabled) return;

    try {
      setErrorBootstrap('');
      setBootstrapLoading(true);
      await show({
        message: t('node:confirmations.bootstrap', {
          postProcess: 'capitalizeFirstChar',
        }),
      });
      const response = await window?.coreSetup?.bootstrap();
      if (response !== true) {
        setErrorBootstrap(
          t('node:error.failed_bootstrap', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
    } catch (error) {
      console.error(error);
    } finally {
      setBootstrapLoading(false);
    }
  };

  const deleteDB = async () => {
    if (advancedCoreToolsDisabled) return;

    try {
      setErrorDeleteDB('');
      setDeleteDBLoading(true);
      await show({
        message: t('node:confirmations.delete', {
          postProcess: 'capitalizeFirstChar',
        }),
      });
      const response = await window?.coreSetup?.deleteDB();
      if (response !== true) {
        setErrorDeleteDB(
          t('node:error.failed_delete', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
    } catch (error) {
      console.error(error);
    } finally {
      setDeleteDBLoading(false);
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
          sx: {
            background: '#0d1117',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '10px',
            boxShadow: '0 24px 50px rgba(0,0,0,0.36)',
            maxHeight: 'calc(100vh - 48px)',
            maxWidth: '740px',
          },
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
          <Box sx={coreHeaderSx}>
            <Typography id="core-setup-title" sx={dialogTitleSx}>
              Set up Qortal Core
            </Typography>
            {onClose && (
              <IconButton
                onClick={onClose}
                disabled={disableClose}
                sx={closeButtonSx}
              >
                <CloseRoundedIcon />
              </IconButton>
            )}
          </Box>
          <DialogContent sx={coreContentSx}>
            <Box sx={introSx}>
              <Box sx={introIconSx}>
                <ViewInArRoundedIcon sx={{ fontSize: 20 }} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={introTitleSx}>
                  Run your own node locally.
                </Typography>
                <Typography sx={advancedCopySx}>
                  You can use a public node while Core starts and syncs.
                </Typography>
              </Box>
            </Box>

            <Box sx={stepsListSx}>
              {stepStates.map(({ key, label, state }) => {
                const prog = resolveProgress(state);
                const isIndeterminate =
                  prog === undefined &&
                  (state.status === 'active' || state.status === 'error');
                const isNextStep = key === nextStepKey;
                const statusLabel =
                  isNextStep && state.status === 'idle'
                    ? key === 'downloadedCore'
                      ? 'Ready to download'
                      : 'Ready to start'
                    : key === 'coreRunning' &&
                        state.status === 'done' &&
                        isCoreSyncing
                      ? 'Syncing'
                      : statusText(state.status);
                const helperText =
                  key === 'downloadedCore'
                    ? state.status === 'done'
                      ? 'Core files are installed and ready.'
                      : state.status === 'active'
                        ? 'Downloading and preparing Qortal Core.'
                        : 'Download Qortal Core to run your own node.'
                    : state.status === 'done'
                      ? isCoreSyncing
                        ? 'Core is running and syncing blockchain data.'
                        : 'Core is running locally.'
                      : downloaded
                        ? 'Core will start and begin syncing in the background.'
                        : 'Available after Core is downloaded.';

                return (
                  <Box key={key} sx={coreStepSx(isNextStep)}>
                    <Box sx={stepHeaderSx}>
                      <Box sx={stepIconSlotSx}>{statusIcon(state.status)}</Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={stepTitleSx}>{label}</Typography>
                        <Typography
                          sx={isNextStep ? activeStatusSx : advancedCopySx}
                        >
                          {statusLabel}
                        </Typography>
                        {isNextStep && (
                          <Typography sx={{ ...advancedCopySx, mt: 1.2 }}>
                            {helperText}
                          </Typography>
                        )}
                      </Box>
                      {isNextStep && (
                        <Typography sx={nextPillSx}>Next step</Typography>
                      )}
                    </Box>
                    <Box sx={progressRowSx}>
                      <Box sx={{ flex: 1 }}>
                        <LinearProgress
                          variant={
                            prog !== undefined ? 'determinate' : 'indeterminate'
                          }
                          value={prog}
                          color={state.status === 'error' ? 'error' : 'primary'}
                          aria-label={`${label} progress`}
                          sx={{
                            height: 7,
                            borderRadius: 2,
                          }}
                        />
                      </Box>
                      <Typography
                        sx={{
                          color: 'rgba(214,221,233,0.58)',
                          fontSize: '0.82rem',
                          minWidth: 38,
                          textAlign: 'right',
                        }}
                      >
                        {prog !== undefined
                          ? `${prog}%`
                          : isIndeterminate
                            ? '...'
                            : '0%'}
                      </Typography>
                    </Box>

                    {state.message && !isNextStep ? (
                      <Typography sx={stepMessageSx}>
                        {t(`node:messages.${state.message}`, {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
            <Box sx={locationCardSx}>
              <Box sx={locationHeaderSx}>
                <FolderOpenRoundedIcon
                  sx={{ color: 'rgba(214,221,233,0.72)', fontSize: 24 }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={toolTitleSx}>Core location</Typography>
                  <Typography sx={advancedCopySx}>
                    {coreLocationDescription}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.8 }}>
                  <Button
                    onClick={pickPath}
                    size="small"
                    sx={toolButtonSx}
                    variant="outlined"
                  >
                    {customQortalPath ? 'Change' : 'Choose'}
                  </Button>
                  {customQortalPath && (
                    <Button
                      onClick={removePath}
                      size="small"
                      sx={toolButtonSx}
                      variant="outlined"
                    >
                      Clear
                    </Button>
                  )}
                </Box>
              </Box>
              <Box sx={pathStripSx}>
                <Typography sx={pathValueSx}>{coreLocationLabel}</Typography>
                {customQortalPath && (
                  <ButtonBase onClick={copyCoreLocation} sx={copyButtonSx}>
                    <ContentCopyIcon sx={{ fontSize: 17 }} />
                  </ButtonBase>
                )}
              </Box>
            </Box>

            <Box sx={advancedCardSx}>
              <ButtonBase
                onClick={() => setIsExtended((prev) => !prev)}
                sx={advancedToggleSx}
              >
                <SettingsRoundedIcon
                  sx={{ color: 'rgba(214,221,233,0.7)', fontSize: 24 }}
                />
                <Box sx={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <Typography sx={toolTitleSx}>Advanced</Typography>
                  <Typography sx={advancedCopySx}>
                    Advanced tools and options for Core.
                  </Typography>
                </Box>
                {isExtended ? (
                  <KeyboardArrowUpRoundedIcon />
                ) : (
                  <KeyboardArrowRightRoundedIcon />
                )}
              </ButtonBase>
              <Collapse in={isExtended} timeout="auto" unmountOnExit>
                <Box sx={advancedToolsSx}>
                  <Typography sx={{ ...advancedCopySx, py: 1.1 }}>
                    Core maintenance tools are unavailable while Core is
                    starting or syncing.
                  </Typography>
                  <Box sx={toolRowSx}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={toolTitleSx}>Stop Core</Typography>
                      <Typography sx={advancedCopySx}>
                        Stops the local Core process.
                      </Typography>
                      {errorStop && (
                        <Typography sx={toolErrorSx}>{errorStop}</Typography>
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
                        deleteDBLoading ||
                        bootstrapLoading
                      }
                      loading={stopCoreLoading}
                      sx={toolButtonSx}
                    >
                      Stop
                    </Button>
                  </Box>

                  <Box sx={toolRowSx}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={toolTitleSx}>Bootstrap</Typography>
                      <Typography sx={advancedCopySx}>
                        Downloads and applies the latest public blockchain
                        snapshot.
                      </Typography>
                      {errorBootstrap && (
                        <Typography sx={toolErrorSx}>
                          {errorBootstrap}
                        </Typography>
                      )}
                    </Box>
                    <Button
                      onClick={bootstrap}
                      size="small"
                      variant="outlined"
                      disabled={
                        advancedCoreToolsDisabled ||
                        bootstrapLoading ||
                        !coreInstalledOnSystem ||
                        isActive ||
                        !coreRunningOnSystem ||
                        stopCoreLoading ||
                        deleteDBLoading
                      }
                      loading={bootstrapLoading}
                      sx={toolButtonSx}
                    >
                      Bootstrap
                    </Button>
                  </Box>

                  <Box sx={toolRowSx}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={toolTitleSx}>Reset Chain Data</Typography>
                      <Typography sx={advancedCopySx}>
                        Removes local blockchain data so Core can rebuild it.
                        Your wallet is not deleted.
                      </Typography>
                      {errorDeleteDB && (
                        <Typography sx={toolErrorSx}>
                          {errorDeleteDB}
                        </Typography>
                      )}
                    </Box>
                    <Button
                      onClick={deleteDB}
                      size="small"
                      variant="outlined"
                      disabled={
                        advancedCoreToolsDisabled ||
                        !dbExists ||
                        deleteDBLoading ||
                        !coreInstalledOnSystem ||
                        isActive ||
                        stopCoreLoading ||
                        bootstrapLoading
                      }
                      loading={deleteDBLoading}
                      sx={toolButtonSx}
                    >
                      Reset
                    </Button>
                  </Box>
                </Box>
              </Collapse>
            </Box>
          </DialogContent>

          <DialogActions sx={footerSx}>
            <Box sx={footerInnerSx}>
              {onClose && (
                <Button
                  onClick={onClose}
                  disabled={
                    disableClose ||
                    stopCoreLoading ||
                    actionLoading ||
                    bootstrapLoading
                  }
                  sx={secondaryActionSx}
                  variant="text"
                >
                  Cancel
                </Button>
              )}

              <Button
                onClick={() => {
                  setErrorStop('');
                  setErrorBootstrap('');
                  setErrorDeleteDB('');
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
                disabled={!canAction || stopCoreLoading || bootstrapLoading}
                loading={actionLoading as unknown as undefined} // if using @mui/lab LoadingButton, swap below
                sx={primaryActionSx}
                startIcon={
                  !running ? (
                    <PlayArrowRoundedIcon sx={{ fontSize: 18 }} />
                  ) : null
                }
              >
                {actionLabel}
              </Button>
            </Box>
          </DialogActions>
        </>
      )}

      <Dialog
        open={isShow}
        onClose={onCancel}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle
          id="alert-dialog-title"
          sx={{
            textAlign: 'center',
            color: theme.palette.text.primary,
            fontWeight: 'bold',
            opacity: 1,
          }}
        ></DialogTitle>

        <DialogContent>
          <DialogContentText id="alert-dialog-description">
            {message?.message}
          </DialogContentText>
        </DialogContent>

        <DialogActions>
          <Button
            sx={{
              backgroundColor: theme.palette.other.positive,
              color: theme.palette.text.primary,
              fontWeight: 'bold',
              opacity: 0.7,
              '&:hover': {
                backgroundColor: theme.palette.other.positive,
                color: 'black',
                opacity: 1,
              },
            }}
            variant="contained"
            onClick={onOk}
            autoFocus
          >
            {t('core:action.accept', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>

          <Button
            sx={{
              backgroundColor: theme.palette.other.danger,
              color: 'black',
              fontWeight: 'bold',
              opacity: 0.7,
              '&:hover': {
                backgroundColor: theme.palette.other.danger,
                color: 'black',
                opacity: 1,
              },
            }}
            variant="contained"
            onClick={onCancel}
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

const coreHeaderSx = {
  alignItems: 'center',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  display: 'flex',
  justifyContent: 'space-between',
  minHeight: 64,
  px: { xs: 2.5, sm: 3 },
};

const dialogTitleSx = {
  color: 'rgba(246,248,252,0.96)',
  fontSize: '1.12rem',
  fontWeight: 800,
  letterSpacing: '-0.01em',
  lineHeight: 1.2,
};

const closeButtonSx = {
  color: 'rgba(214,221,233,0.68)',
  mr: -0.75,
  '&:hover': {
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: '#F6F8FC',
  },
};

const coreContentSx = {
  px: { xs: 2.5, sm: 3.4 },
  py: { xs: 2.4, sm: 3 },
};

const advancedCopySx = {
  color: 'rgba(214,221,233,0.64)',
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
  background:
    'linear-gradient(135deg, rgba(51,107,222,0.92), rgba(91,132,201,0.3))',
  border: '1px solid rgba(118,165,255,0.42)',
  borderRadius: '999px',
  boxShadow: '0 0 24px rgba(74,132,255,0.24)',
  color: '#D5E4FF',
  display: 'flex',
  flexShrink: 0,
  height: 48,
  justifyContent: 'center',
  width: 48,
};

const introTitleSx = {
  color: 'rgba(246,248,252,0.96)',
  fontSize: '0.96rem',
  fontWeight: 800,
  lineHeight: 1.25,
};

const stepsListSx = {
  borderBottom: '1px solid rgba(255,255,255,0.07)',
  display: 'grid',
};

const coreStepSx = (active: boolean) => ({
  borderTop: '1px solid rgba(255,255,255,0.07)',
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
  color: 'rgba(246,248,252,0.96)',
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
  color: '#83B3FF',
  fontSize: '0.84rem',
  fontWeight: 700,
  lineHeight: 1.55,
};

const nextPillSx = {
  alignSelf: 'flex-start',
  backgroundColor: 'rgba(77,139,255,0.16)',
  borderRadius: '7px',
  color: '#9FC0FF',
  fontSize: '0.74rem',
  fontWeight: 700,
  lineHeight: 1,
  px: 1,
  py: 0.68,
};

const locationCardSx = {
  borderBottom: '1px solid rgba(255,255,255,0.07)',
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
  backgroundColor: 'rgba(255,255,255,0.045)',
  borderRadius: '7px',
  display: 'flex',
  gap: 1,
  minHeight: 44,
  ml: { xs: 0, sm: 5.6 },
  px: 1.35,
};

const toolRowSx = {
  alignItems: 'center',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  display: 'grid',
  gap: 1.5,
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  py: 1.35,
  '&:last-child': {
    borderBottom: 0,
  },
};

const toolTitleSx = {
  color: 'rgba(246,248,252,0.96)',
  fontSize: '0.9rem',
  fontWeight: 800,
  lineHeight: 1.25,
};

const toolErrorSx = {
  color: '#D8BA8A',
  fontSize: '0.8rem',
  lineHeight: 1.45,
};

const pathValueSx = {
  color: 'rgba(214,221,233,0.78)',
  fontSize: '0.8rem',
  lineHeight: 1.45,
  overflowWrap: 'anywhere',
};

const copyButtonSx = {
  alignItems: 'center',
  color: 'rgba(214,221,233,0.56)',
  display: 'flex',
  flex: '0 0 auto',
  p: 0.35,
  '&:hover': {
    color: '#D6E5FF',
  },
};

const toolButtonSx = {
  borderColor: 'rgba(141,180,242,0.45)',
  color: 'rgba(214,228,252,0.96)',
  fontSize: '0.8rem',
  fontWeight: 600,
  letterSpacing: 0,
  minHeight: 34,
  minWidth: 82,
  textTransform: 'none',
  '&:hover': {
    borderColor: 'rgba(170,202,255,0.7)',
    backgroundColor: 'rgba(141,180,242,0.08)',
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
    backgroundColor: 'rgba(255,255,255,0.018)',
  },
};

const advancedToolsSx = {
  borderTop: '1px solid rgba(255,255,255,0.07)',
  display: 'grid',
  px: { xs: 0, sm: 2 },
};

const footerSx = {
  borderTop: '1px solid rgba(255,255,255,0.08)',
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
  color: 'rgba(214,221,233,0.72)',
  fontSize: '0.86rem',
  fontWeight: 600,
  letterSpacing: 0,
  minHeight: 38,
  px: 1.6,
  textTransform: 'none',
  '&:hover': {
    backgroundColor: 'rgba(255,255,255,0.035)',
    color: '#F6F8FC',
  },
};

const primaryActionSx = {
  fontSize: '0.86rem',
  fontWeight: 600,
  letterSpacing: 0,
  minHeight: 40,
  minWidth: 136,
  px: 2.4,
  textTransform: 'none',
};
