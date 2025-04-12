import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './messaging/messagesToBackground';
import { MessageQueueProvider } from './MessageQueueContext.tsx';
import { RecoilRoot } from 'recoil';
import { ThemeProvider } from './styles/ThemeContext.tsx';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <>
    <ThemeProvider>
      <MessageQueueProvider>
        <RecoilRoot>
          <App />
        </RecoilRoot>
      </MessageQueueProvider>
    </ThemeProvider>
  </>
);
