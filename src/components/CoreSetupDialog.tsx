import * as React from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Step,
  StepContent,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DownloadIcon from '@mui/icons-material/Download';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import { QORTAL_APP_CONTEXT } from '../App';
import { Trans, useTranslation } from 'react-i18next';
import { Spacer } from '../common/Spacer';

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
  isWindows: boolean;
}

const statusIcon = (status: StepStatus) => {
  switch (status) {
    case 'done':
      return <CheckCircleIcon fontSize="small" color="success" />;
    case 'error':
      return <ErrorOutlineIcon fontSize="small" color="error" />;
    case 'active':
      return <HourglassEmptyIcon fontSize="small" color="info" />;
    case 'idle':
    default:
      return <RadioButtonUncheckedIcon fontSize="small" color="disabled" />;
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
    isWindows,
  } = props;
  const { setOpenSnackGlobal, setInfoSnackCustom } =
    React.useContext(QORTAL_APP_CONTEXT);

  const { t } = useTranslation(['node', 'core']);
  const [mode, setMode] = React.useState(1);
  const statusText = React.useCallback(
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
  const stepDefs = React.useMemo(
    () => [
      {
        key: 'hasJava' as const,
        label: t('node:steps.java', {
          postProcess: 'capitalizeFirstChar',
        }),
        icon: <RocketLaunchIcon fontSize="inherit" />,
      },
      {
        key: 'downloadedCore' as const,
        label: t('node:steps.downloaded', {
          postProcess: 'capitalizeFirstChar',
        }),
        icon: <DownloadIcon fontSize="inherit" />,
      },
      {
        key: 'coreRunning' as const,
        label: t('node:steps.running', {
          postProcess: 'capitalizeFirstChar',
        }),
        icon: <PlayArrowIcon fontSize="inherit" />,
      },
    ],
    [t]
  );

  const stepStates = stepDefs
    .filter((step) => (isWindows ? step.key !== 'hasJava' : step))
    .map((def) => ({
      ...def,
      state: steps[def.key],
    }));

  // Determine active step (first not done). If all done, last index.
  let activeStep = stepStates.findIndex((s) => s.state.status !== 'done');
  if (activeStep === -1) activeStep = stepStates.length - 1;

  const downloaded = steps.downloadedCore.status === 'done';
  const running = steps.coreRunning.status === 'done';

  const computedActionLabel = React.useMemo(
    () =>
      running
        ? t('node:actions.finished', {
            postProcess: 'capitalizeFirstChar',
          })
        : downloaded
          ? t('node:actions.start', {
              postProcess: 'capitalizeFirstChar',
            })
          : t('node:actions.install', {
              postProcess: 'capitalizeFirstChar',
            }),
    [running, downloaded, t]
  );

  const actionLabel = actionLabelOverride ?? computedActionLabel;

  // Enable action if Java is installed and core is not already running
  const canAction = !actionLoading;

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

  React.useEffect(() => {
    if (downloaded) {
      setMode(2);
    }
  }, [downloaded]);

  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="sm"
      aria-labelledby="core-setup-title"
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
              {t('core:page.next', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </DialogActions>
        </>
      )}
      {mode === 2 && (
        <>
          <DialogTitle id="core-setup-title">
            {t('node:setup.title', {
              postProcess: 'capitalizeFirstChar',
            })}
          </DialogTitle>
          <DialogContent dividers>
            {!isWindows && (
              <Accordion>
                <AccordionSummary
                  expandIcon={<ArrowDropDownIcon />}
                  aria-controls="panel2-content"
                  id="panel2-header"
                >
                  <Typography component="span">
                    {t('node:setup.advancedOptions', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  {!customQortalPath ? (
                    <Button onClick={pickPath}>
                      {t('node:setup.pickPath', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Button>
                  ) : (
                    <Button onClick={removePath}>
                      {t('node:setup.removePath', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Button>
                  )}
                </AccordionDetails>
              </Accordion>
            )}

            <Stepper activeStep={activeStep} orientation="vertical">
              {stepStates.map(({ key, label, state }, idx) => {
                const prog = resolveProgress(state);
                const isIndeterminate =
                  prog === undefined &&
                  (state.status === 'active' || state.status === 'error');

                return (
                  <Step key={key} expanded>
                    <StepLabel
                      icon={statusIcon(state.status)}
                      optional={
                        <Typography variant="caption" color="text.secondary">
                          {statusText(state.status)}
                        </Typography>
                      }
                    >
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Typography
                          variant="subtitle1"
                          sx={{ fontWeight: 600 }}
                        >
                          {label}
                        </Typography>
                      </Stack>
                    </StepLabel>
                    <StepContent>
                      <Stack
                        spacing={1.25}
                        sx={{ pb: idx === stepStates.length - 1 ? 0 : 2 }}
                      >
                        <Box
                          sx={{ display: 'flex', alignItems: 'center', gap: 2 }}
                        >
                          <Box sx={{ flex: 1 }}>
                            <LinearProgress
                              variant={
                                prog !== undefined
                                  ? 'determinate'
                                  : 'indeterminate'
                              }
                              value={prog}
                              color={
                                state.status === 'error' ? 'error' : 'primary'
                              }
                              aria-label={`${label} progress`}
                              sx={{
                                height: 8,
                                borderRadius: 2,
                              }}
                            />
                          </Box>
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ minWidth: 48, textAlign: 'right' }}
                          >
                            {prog !== undefined
                              ? `${prog}%`
                              : isIndeterminate
                                ? '...'
                                : '0%'}
                          </Typography>
                        </Box>

                        {state.message ? (
                          <Typography variant="body2" color="text.secondary">
                            {t(`node:messages.${state.message}`, {
                              postProcess: 'capitalizeFirstChar',
                            })}
                          </Typography>
                        ) : null}
                      </Stack>
                    </StepContent>
                  </Step>
                );
              })}
            </Stepper>
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
              onClick={onAction}
              color="success"
              variant="contained"
              disabled={!canAction}
              loading={actionLoading as unknown as undefined} // if using @mui/lab LoadingButton, swap below
            >
              {actionLabel}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
