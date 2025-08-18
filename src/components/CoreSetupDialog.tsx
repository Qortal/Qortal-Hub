import * as React from 'react';
import {
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
  Tooltip,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DownloadIcon from '@mui/icons-material/Download';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';

export type StepStatus = 'idle' | 'active' | 'done' | 'error';

export interface StepState {
  status: StepStatus;
  /** 0..100; if omitted, inferred from status (done=>100, idle=>0) */
  progress?: number;
  /** Optional small helper text under the progress bar */
  message?: string;
}

export interface CoreSetupDialogProps {
  open: boolean;
  onClose?: () => void;
  onAction?: () => void;
  /** Disable closing via UI while work is in progress */
  disableClose?: boolean;
  /** Show loading state on the action button */
  actionLoading?: boolean;

  steps: {
    hasJava: StepState;
    downloadedCore: StepState;
    coreRunning: StepState;
  };

  /** Optional override for the action label. If not provided, it’s computed. */
  actionLabelOverride?: string;
  /** If true, hides the action button entirely when core is already running */
  hideActionIfRunning?: boolean;
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

function statusText(status: StepStatus) {
  switch (status) {
    case 'done':
      return 'Complete';
    case 'active':
      return 'In progress';
    case 'error':
      return 'Error';
    case 'idle':
    default:
      return 'Pending';
  }
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
    hideActionIfRunning = false,
  } = props;

  const stepDefs = [
    {
      key: 'hasJava' as const,
      label: 'Has Java installed',
      icon: <RocketLaunchIcon fontSize="inherit" />,
    },
    {
      key: 'downloadedCore' as const,
      label: 'Downloaded Core',
      icon: <DownloadIcon fontSize="inherit" />,
    },
    {
      key: 'coreRunning' as const,
      label: 'Core running',
      icon: <PlayArrowIcon fontSize="inherit" />,
    },
  ];

  const stepStates = stepDefs.map((def) => ({
    ...def,
    state: steps[def.key],
  }));

  // Determine active step (first not done). If all done, last index.
  let activeStep = stepStates.findIndex((s) => s.state.status !== 'done');
  if (activeStep === -1) activeStep = stepStates.length - 1;

  const downloaded = steps.downloadedCore.status === 'done';
  const running = steps.coreRunning.status === 'done';

  const computedActionLabel = running
    ? 'Finished'
    : downloaded
      ? 'Start Qortal Core'
      : 'Install and Start Qortal Core';

  const actionLabel = actionLabelOverride ?? computedActionLabel;

  // Enable action if Java is installed and core is not already running
  const canAction = !actionLoading;

  return (
    <Dialog
      open={open}
      fullWidth
      maxWidth="sm"
      aria-labelledby="core-setup-title"
    >
      <DialogTitle id="core-setup-title">Qortal Core Setup</DialogTitle>
      <DialogContent dividers>
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
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      {label}
                    </Typography>
                  </Stack>
                </StepLabel>
                <StepContent>
                  <Stack
                    spacing={1.25}
                    sx={{ pb: idx === stepStates.length - 1 ? 0 : 2 }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Box sx={{ flex: 1 }}>
                        <LinearProgress
                          variant={
                            prog !== undefined ? 'determinate' : 'indeterminate'
                          }
                          value={prog}
                          color={state.status === 'error' ? 'error' : 'primary'}
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
                        {state.message}
                      </Typography>
                    ) : null}
                  </Stack>
                </StepContent>
              </Step>
            );
          })}
        </Stepper>

        {/* Optional guidance if Java isn't installed */}
        {steps.hasJava.status !== 'done' && (
          <Box sx={{ mt: 2 }}>
            <Tooltip title="Install Java 17+ and retry.">
              <Typography variant="caption" color="text.secondary">
                Java not detected — please install Java 17+ to continue.
              </Typography>
            </Tooltip>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        {onClose && !running && (
          <Button onClick={onClose} disabled={disableClose} variant="text">
            Close
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
    </Dialog>
  );
}
