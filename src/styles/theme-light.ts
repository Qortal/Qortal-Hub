import { createTheme } from '@mui/material/styles';
import { commonThemeOptions } from './theme-common';

const lightTheme = createTheme({
  ...commonThemeOptions,
  palette: {
    mode: 'light',
    primary: {
      main: '#f4f4fb',
      dark: '#eaecf4',
      light: '#f9f9fd',
    },
    secondary: {
      main: '#c2deec',
    },
    background: {
      default: '#fafafa',
      paper: '#f0f0f0',
    },
    text: {
      primary: '#000000',
      secondary: '#525252',
    },
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow:
            'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(230, 200, 200, 0.06) 0px 1px 2px 0px;',
          borderRadius: '8px',
          transition: 'all 0.3s ease-in-out',
          '&:hover': {
            cursor: 'pointer',
            boxShadow:
              'rgba(0, 0, 0, 0.1) 0px 4px 6px -1px, rgba(0, 0, 0, 0.06) 0px 2px 4px -1px;',
          },
        },
      },
    },
    MuiIcon: {
      defaultProps: {
        style: {
          color: '#000000',
          opacity: 0.5,
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        ':root': {
          '--color-instance': '#1e1e20',
          '--color-instance-popover-bg': '#222222',
          '--Mail-Background': 'rgba(49, 51, 56, 1)',
          '--new-message-text': 'black',
          '--bg-primary': 'rgba(31, 32, 35, 1)',
          '--bg-2': '#27282c',
          '--bg-3': 'rgba(0, 0, 0, 0.1)',
          '--unread': '#4297e2',
          '--danger': '#b14646',
          '--apps-circle': '#1f2023',
          '--green': '#5eb049',
          '--pollo': 'pollo',
        },
        '*, *::before, *::after': {
          boxSizing: 'border-box',
        },
        html: {
          padding: 0,
          margin: 0,
        },
        body: {
          padding: 0,
          margin: 0,
          wordBreak: 'break-word',
          backgroundColor: 'var(--bg-primary)',
          color: 'var(--new-message-text)',
        },
      },
    },
  },
});

export { lightTheme };
