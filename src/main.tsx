import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import '../src/styles/index.css';
import './messaging/MessagesToBackground.tsx';
import { MessageQueueProvider } from './messaging/MessageQueueContext.tsx';
import { ThemeProvider } from './components/Theme/ThemeContext.tsx';
import { CssBaseline } from '@mui/material';
import './i18n/i18n.js';

createRoot(document.getElementById('root')!).render(
  <>
    <ThemeProvider>
      <CssBaseline />
      <MessageQueueProvider>
        <App />
      </MessageQueueProvider>
    </ThemeProvider>
  </>
);
