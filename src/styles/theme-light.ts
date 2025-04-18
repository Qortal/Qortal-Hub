import { createTheme } from '@mui/material/styles';
import { commonThemeOptions } from './theme-common';

const lightTheme = createTheme({
  ...commonThemeOptions,
  palette: {
    mode: 'light',
    primary: {
      main: 'rgba(244, 244, 251, 1)',
      dark: 'rgb(113, 198, 212)',
      light: 'rgb(162, 162, 221)',
    },
    secondary: {
      main: 'rgba(194, 222, 236, 1)',
    },
    background: {
      default: 'rgba(250, 250, 250, 1)',
      paper: 'rgb(228, 228, 228)',
    },
    text: {
      primary: 'rgba(0, 0, 0, 1)',
      secondary: 'rgba(82, 82, 82, 1)',
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
          color: 'rgba(0, 0, 0, 1)',
          opacity: 0.5,
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        ':root': {
          '--color-instance': 'rgba(30, 30, 32, 1)',
          '--color-instance-popover-bg': 'rgba(34, 34, 34, 1)',
          '--Mail-Background': 'rgba(49, 51, 56, 1)',
          '--new-message-text': 'rgba(0, 0, 0, 1)',
          '--bg-primary': 'rgba(31, 32, 35, 1)',
          '--bg-2': 'rgba(39, 40, 44, 1)',
          '--bg-3': 'rgba(0, 0, 0, 0.1)',
          '--unread': 'rgba(66, 151, 226, 1)',
          '--danger': 'rgba(177, 70, 70, 1)',
          '--apps-circle': 'rgba(31, 32, 35, 1)',
          '--green': 'rgba(94, 176, 73, 1)',
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
