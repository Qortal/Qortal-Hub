import { Box, Typography, styled } from '@mui/material';

export const FileAttachmentContainer = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: 8,
  display: 'flex',
  gap: 10,
  justifyContent: 'center',
  padding: '10px 18px',
  width: '100%',
  backgroundColor:
    theme.palette.mode === 'dark'
      ? 'rgba(255, 255, 255, 0.05)'
      : 'rgba(0, 0, 0, 0.04)',
  transition: 'background-color 0.15s ease, border-color 0.15s ease',
}));

export const FileAttachmentFont = styled(Typography)(({ theme }) => ({
  fontSize: '14px',
  fontWeight: 500,
  letterSpacing: 0,
  userSelect: 'none',
  whiteSpace: 'nowrap',
}));
