import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { subscribeToEvent, unsubscribeFromEvent } from '../utils/events';
import { Box, Button } from '@mui/material';
import { appHeighOffsetPx } from '../components/Desktop/CustomTitleBar';

export const PdfViewer = () => {
  const { t } = useTranslation('core');
  const [pdfUrl, setPdfUrl] = useState('');
  const currentUrl = useRef('');

  useEffect(() => {
    const openPdf = (event) => {
      try {
        if (!(event.detail?.blob instanceof Blob)) return;
        const url = URL.createObjectURL(event.detail.blob);
        // State updates may be batched. Revoke the previous reference here,
        // including URLs replaced before React ever rendered them.
        if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
        currentUrl.current = url;
        setPdfUrl(url);
      } catch (error) {
        console.error(error);
      }
    };
    subscribeToEvent('openPdf', openPdf);

    return () => {
      unsubscribeFromEvent('openPdf', openPdf);
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
      currentUrl.current = '';
    };
  }, []);

  if (!pdfUrl) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        height: `calc(100vh - ${appHeighOffsetPx})`,
        width: '100vw',
        backgroundColor: 'background.default',
        zIndex: 990000000,
      }}
    >
      <Box
        sx={{
          height: '50px',
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          justifyContent: 'flex-end',
          padding: '10px',
        }}
      >
        <Button
          onClick={() => {
            if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
            currentUrl.current = '';
            setPdfUrl('');
          }}
          variant="contained"
        >
          {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
        </Button>
      </Box>
      <iframe
        title={t('core:pdf_viewer')}
        src={`/pdfjs/web/viewer.html?file=${pdfUrl}`}
        style={{
          width: '100vw',
          height: `calc(100vh - ${appHeighOffsetPx} - 50px)`,
          display: 'block',
          left: 0,
        }}
      />
    </Box>
  );
};
