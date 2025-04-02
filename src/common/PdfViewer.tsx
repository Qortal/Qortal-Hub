import { useEffect, useState } from "react";
import { subscribeToEvent, unsubscribeFromEvent } from "../utils/events";
import { Box, Button } from "@mui/material";

export const PdfViewer = () => {
  const [pdfUrl, setPdfUrl] = useState("");

  const openPdf = (e) => {
    try {
      const blob = e.detail?.blob;
      if (blob) {
        // Create Object URL
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);
      }
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  useEffect(() => {
    subscribeToEvent("openPdf", openPdf);

    return () => {
      unsubscribeFromEvent("openPdf", openPdf);
    };
  }, []);

  if (!pdfUrl) return null;

  return (
    <Box
      sx={{
        position: "fixed",
        height: "100vh",
        width: "100vw",
        backgroundColor: 'var(--Mail-Background)',
        zIndex: 990000000
      }}
    >
      <Box
        sx={{
          height: "50px",
          display: "flex",
          width: "100%",
          alignItems: "center",
          justifyContent: "flex-end",
          padding: '10px'
        }}
      >
        <Button
          onClick={() => {
            setPdfUrl("");
          }}
          variant="contained"
        >
          Exit
        </Button>
      </Box>
      <iframe
        title="PDFViewer"
        src={`/pdfjs/web/viewer.html?file=${pdfUrl}`}
        style={{
          width: "100vw",
          height: "calc(100vh - 50px)",
          display: "fixed",
          left: 0,
        }}
      />
    </Box>
  );
};
