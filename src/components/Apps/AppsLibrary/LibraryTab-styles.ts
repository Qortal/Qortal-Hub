import { Box, Button, Divider, Typography, styled } from '@mui/material';

export const SectionContainer = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  width: '100%',
});

export const SectionTitle = styled(Typography)(({ theme }) => ({
  fontSize: '18px',
  fontWeight: 600,
  color: theme.palette.text.primary,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
}));

export const EmptyStateBox = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '40px',
  borderRadius: '12px',
  backgroundColor: theme.palette.background.paper,
  border: `1px dashed ${theme.palette.divider}`,
  textAlign: 'center',
  width: '320px',
  minHeight: '220px',
}));

export const PublishNewContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  gap: '16px',
  flexWrap: 'wrap',
}));

export const PublishButton = styled(Button)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px 32px',
  borderRadius: '12px',
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  textTransform: 'none',
  minWidth: '160px',
  gap: '8px',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
    borderColor: theme.palette.primary.main,
  },
}));

export const StyledDivider = styled(Divider)(({ theme }) => ({
  margin: '16px 0',
}));
