import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import  "./messaging/messagesToBackground";
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import { MessageQueueProvider } from './MessageQueueContext.tsx';
import { RecoilRoot } from 'recoil';
const theme = createTheme({
  palette: {
    primary: {
      main: '#232428', // Primary color (e.g., used for buttons, headers, etc.)
    },
    secondary: {
      main: '#232428', // Secondary color
    },
    background: {
      default: '#27282c', // Default background color
      paper: '#1d1d1d',    // Paper component background (for dropdowns, dialogs, etc.)
    },
    text: {
      primary: '#ffffff',  // White as the primary text color
      secondary: '#b0b0b0',  // Light gray for secondary text
      disabled: '#808080',  // Gray for disabled text
    },
    action: {
      // disabledBackground: 'set color of background here',
      disabled: 'rgb(255 255 255 / 70%)'
    }
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif', // Font family
    h1: {
      color: '#ffffff',  // White color for h1 elements
    },
    h2: {
      color: '#ffffff',  // White color for h2 elements
    },
    body1: {
      color: '#ffffff',  // Default body text color
    },
    body2: {
      color: '#b0b0b0',  // Lighter text for body2, often used for secondary text
    },
  },
  components: {
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          ".MuiOutlinedInput-notchedOutline": {
            borderColor: "white", // ⚪ Default outline color
          },
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        icon: {
          color: "white", // ✅ Caret (dropdown arrow) color
        },
      },
    },
  },
});

export default theme;


ReactDOM.createRoot(document.getElementById('root')!).render(
  <>
      <ThemeProvider theme={theme}>
      <CssBaseline />
  <MessageQueueProvider>
  <RecoilRoot>
    <App />
    </RecoilRoot>
    </MessageQueueProvider>
    </ThemeProvider>
  </>,
)
