import { createTheme } from '@mui/material/styles';
import { commonThemeOptions } from './theme-common';

const darkTheme = createTheme({
  ...commonThemeOptions,
  palette: {
    mode: 'dark',
    primary: {
      main: '#2e3d60',
      dark: '#1a2744',
      light: '#3f4b66',
    },
    secondary: {
      main: '#45adff',
    },
    background: {
      default: '#313338',
      paper: '#1e1e20',
    },
    text: {
      primary: '#ffffff',
      secondary: '#b3b3b3',
    },
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: 'none',
          borderRadius: '8px',
          transition: 'all 0.3s ease-in-out',
          '&:hover': {
            cursor: 'pointer',
            boxShadow:
              ' 0px 3px 4px 0px hsla(0,0%,0%,0.14), 0px 3px 3px -2px hsla(0,0%,0%,0.12), 0px 1px 8px 0px hsla(0,0%,0%,0.2);',
          },
        },
      },
    },
    MuiIcon: {
      defaultProps: {
        style: {
          color: '#ffffff',
          opacity: 0.5,
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        ':root': {
          '--color-instance': '#1e1e20',
          '--color-instance-popover-bg': '#222222',
          '--Mail-Background': 'rgb(101, 248, 174)',
          '--new-message-text': 'black',
          '--bg-primary': 'rgba(31, 32, 35, 1)',
          '--bg-2': '#27282c',
          '--bg-3': 'rgba(0, 0, 0, 0.1)',
          '--unread': '#4297e2',
          '--danger': '#b14646',
          '--apps-circle': '#1f2023',
          '--green': '#5eb049',
          '--gallo': 'gallo',
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

export { darkTheme };
