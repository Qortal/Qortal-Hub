import React from 'react';
import { Alert, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { GroupCallLocalConnectionHint } from '../../lib/group-call/groupCallLocalConnectionHint';

type Props = { hint: GroupCallLocalConnectionHint | null };

/**
 * Non-technical local-only banner for group voice when transport/playout looks unhealthy.
 */
export function GroupCallConnectionBanner({ hint }: Props) {
  if (!hint) return null;

  const isSevere = hint.level === 'severe';

  return (
    <Alert
      severity={isSevere ? 'error' : 'warning'}
      variant="outlined"
      sx={{
        mx: 2,
        mt: 1,
        mb: 0,
        py: 0.75,
        alignItems: 'flex-start',
        bgcolor: isSevere ? alpha('#ef4444', 0.08) : alpha('#f59e0b', 0.08),
        borderColor: isSevere ? alpha('#ef4444', 0.45) : alpha('#f59e0b', 0.45),
        color: alpha('#fff', 0.92),
        '& .MuiAlert-icon': {
          color: isSevere ? '#f87171' : '#fbbf24',
        },
      }}
    >
      <Typography variant="caption" component="div" sx={{ fontWeight: 700, display: 'block' }}>
        {hint.headline}
      </Typography>
      <Typography variant="caption" component="div" sx={{ opacity: 0.88, mt: 0.35 }}>
        {hint.detail}
      </Typography>
    </Alert>
  );
}
