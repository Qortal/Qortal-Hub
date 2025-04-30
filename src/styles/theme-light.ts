import { createTheme, ThemeOptions } from '@mui/material/styles';
import { commonThemeOptions } from './theme-common';

export const lightThemeOptions: ThemeOptions = {
  ...commonThemeOptions,
  palette: {
    mode: 'light',
    primary: {
      main: 'rgb(162, 162, 221)',
      dark: 'rgb(113, 198, 212)',
      light: 'rgb(180, 200, 235)',
    },
    secondary: {
      main: 'rgba(194, 222, 236, 1)',
    },
    background: {
      default: 'rgba(250, 250, 250, 1)',
      paper: 'rgb(220, 220, 220)', // darker card background
      surface: 'rgb(240, 240, 240)', // optional middle gray for replies, side panels
    },
    text: {
      primary: 'rgba(0, 0, 0, 0.87)', // 87% black (slightly softened)
      secondary: 'rgba(0, 0, 0, 0.6)', // 60% black
    },
    border: {
      main: 'rgba(0, 0, 0, 0.12)',
      subtle: 'rgba(0, 0, 0, 0.08)',
    },
    other: {
      positive: 'rgb(94, 176, 73)',
      danger: 'rgb(177, 70, 70)',
      unread: 'rgb(66, 151, 226)',
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
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        ':root': {
          '--Mail-Background': 'rgba(49, 51, 56, 1)',
          '--bg-primary': 'rgba(31, 32, 35, 1)',
          '--bg-2': 'rgba(39, 40, 44, 1)',
          '--primary-main': theme.palette.primary.main,
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
        },

        '::-webkit-scrollbar-track': {
          backgroundColor: 'transparent',
        },

        '::-webkit-scrollbar-track:hover': {
          backgroundColor: 'transparent',
        },

        '::-webkit-scrollbar': {
          width: '16px',
          height: '10px',
        },

        '::-webkit-scrollbar-thumb': {
          backgroundColor: theme.palette.primary.main,
          borderRadius: '8px',
          backgroundClip: 'content-box',
          border: '4px solid transparent',
          transition: '0.3s background-color',
        },

        '::-webkit-scrollbar-thumb:hover': {
          backgroundColor: theme.palette.primary.light,
        },
      }),
    },

    MuiIcon: {
      defaultProps: {
        style: {
          color: 'rgba(0, 0, 0, 1)',
          opacity: 0.5,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundImage: 'none',
        },
      },
    },
    MuiPopover: {
      styleOverrides: {
        paper: {
          backgroundImage: 'none',
        },
      },
    },
  },
};

const lightTheme = createTheme(lightThemeOptions);

export { lightTheme };
