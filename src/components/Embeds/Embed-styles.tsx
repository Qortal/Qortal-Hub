import { Box, Typography, styled } from "@mui/material";

export const FileAttachmentContainer = styled(Box)(({ theme }) => ({
    display: "flex",
    alignItems: "center",
    padding: "5px 10px",
    border: `1px solid ${theme.palette.text.primary}`,
    width: "100%",
    gap: '20px'
  }));
  
  export const FileAttachmentFont = styled(Typography)(({ theme }) => ({
    fontSize: "20px",
    letterSpacing: 0,
    fontWeight: 400,
    userSelect: "none",
    whiteSpace: "nowrap",
  }));