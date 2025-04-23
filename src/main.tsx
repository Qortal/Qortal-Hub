import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import '../src/styles/index.css';
import './messaging/messagesToBackground';
import { MessageQueueProvider } from './MessageQueueContext.tsx';
import { RecoilRoot } from 'recoil';
import { ThemeProvider } from './components/Theme/ThemeContext.tsx';
import { CssBaseline } from '@mui/material';
import '../i18n';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <>
    <ThemeProvider>
      <CssBaseline />
      <MessageQueueProvider>
        <RecoilRoot>
          <App />
        </RecoilRoot>
      </MessageQueueProvider>
    </ThemeProvider>
  </>
);
