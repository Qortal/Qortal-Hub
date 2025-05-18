import { Box, Typography, styled } from '@mui/material';

export const FileAttachmentContainer = styled(Box)(({ theme }) => ({
  alignItems: 'center',
  border: `1px solid ${theme.palette.text.primary}`,
  display: 'flex',
  gap: '20px',
  padding: '5px 10px',
  width: '100%',
}));

export const FileAttachmentFont = styled(Typography)(({ theme }) => ({
  fontSize: '20px',
  fontWeight: 400,
  letterSpacing: 0,
  userSelect: 'none',
  whiteSpace: 'nowrap',
}));
