import React from 'react';
import { Alert, CircularProgress, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { GroupCallStartupStatus } from '../../lib/group-call/audioEngineTypes';

type Props = {
  status: GroupCallStartupStatus;
};

export function GroupCallStartupBanner({ status }: Props) {
  if (!status.headline) return null;
  if (status.stage === 'connected' || status.stage === 'idle') return null;

  const isWarning = status.tone === 'warning' || status.stage === 'degraded';

  return (
    <Alert
      severity={isWarning ? 'warning' : 'info'}
      variant="outlined"
      icon={
        status.showProgress ? (
          <CircularProgress
            size={16}
            thickness={5}
            color="inherit"
          />
        ) : undefined
      }
      sx={{
        mx: 2,
        mt: 1,
        mb: 0,
        py: 0.75,
        alignItems: 'flex-start',
        bgcolor: isWarning ? alpha('#f59e0b', 0.08) : alpha('#38bdf8', 0.08),
        borderColor: isWarning ? alpha('#f59e0b', 0.45) : alpha('#38bdf8', 0.45),
        color: alpha('#fff', 0.92),
        '& .MuiAlert-icon': {
          color: isWarning ? '#fbbf24' : '#7dd3fc',
          alignItems: 'center',
          mt: '2px',
        },
      }}
    >
      <Typography variant="caption" component="div" sx={{ fontWeight: 700, display: 'block' }}>
        {status.headline}
      </Typography>
      {status.detail ? (
        <Typography variant="caption" component="div" sx={{ opacity: 0.88, mt: 0.35 }}>
          {status.detail}
        </Typography>
      ) : null}
    </Alert>
  );
}
