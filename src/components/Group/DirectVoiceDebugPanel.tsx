/**
 * On-screen log for DM Reticulum voice (opt-in via qortal:dmvoice-debug).
 */

import React, { useMemo, useSyncExternalStore } from 'react';
import { Box, Collapse, IconButton, Tooltip, Typography } from '@mui/material';
import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined';
import {
  getDirectVoiceUiLogsSnapshot,
  getDirectVoiceUiLogsVersion,
  isDirectVoiceUiLogEnabled,
  subscribeDirectVoiceUiLogs,
} from '../../lib/call/directVoiceUiLog';

function formatTime(t: number): string {
  const d = new Date(t);
  return d.toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function DirectVoiceDebugPanel() {
  const enabled = isDirectVoiceUiLogEnabled();
  const ver = useSyncExternalStore(
    subscribeDirectVoiceUiLogs,
    getDirectVoiceUiLogsVersion,
    getDirectVoiceUiLogsVersion
  );
  const lines = useMemo(() => getDirectVoiceUiLogsSnapshot(), [ver]);

  const [open, setOpen] = React.useState(true);

  if (!enabled) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        left: 8,
        bottom: 8,
        zIndex: 1500,
        maxWidth: 'min(420px, calc(100vw - 16px))',
        bgcolor: 'rgba(20, 22, 26, 0.94)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 1,
        boxShadow: 4,
        color: '#c9ccd1',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 10,
        lineHeight: 1.35,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.75,
          py: 0.25,
          borderBottom: open ? '1px solid rgba(255,255,255,0.08)' : 'none',
          bgcolor: 'rgba(0,0,0,0.25)',
        }}
      >
        <Tooltip title={open ? 'Hide log' : 'Show log'}>
          <IconButton
            size="small"
            onClick={() => setOpen((o) => !o)}
            sx={{ color: '#b5bac1', p: 0.25 }}
          >
            <BugReportOutlinedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <Typography component="span" sx={{ fontSize: 10, fontWeight: 700, color: '#949ba4' }}>
          DM voice debug
        </Typography>
        <Typography component="span" sx={{ fontSize: 9, color: '#6d7278', ml: 'auto' }}>
          qortal:dmvoice-debug
        </Typography>
      </Box>
      <Collapse in={open}>
        <Box
          sx={{
            maxHeight: 200,
            overflow: 'auto',
            px: 0.75,
            py: 0.5,
            '&::-webkit-scrollbar': { width: 6 },
            '&::-webkit-scrollbar-thumb': {
              bgcolor: 'rgba(255,255,255,0.15)',
              borderRadius: 1,
            },
          }}
        >
          {lines.length === 0 ? (
            <Typography sx={{ fontSize: 10, color: '#6d7278', fontStyle: 'italic' }}>
              Waiting for events…
            </Typography>
          ) : (
            lines.map((e, i) => (
              <div key={`${e.t}-${i}`}>
                <span style={{ color: '#6d7278' }}>{formatTime(e.t)}</span>{' '}
                <span
                  style={{
                    color: e.level === 'warn' ? '#faa61a' : '#99aab5',
                  }}
                >
                  {e.msg}
                  {e.detail && Object.keys(e.detail).length > 0
                    ? ` ${JSON.stringify(e.detail)}`
                    : ''}
                </span>
              </div>
            ))
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
