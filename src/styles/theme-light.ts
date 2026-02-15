import { createTheme, ThemeOptions } from '@mui/material/styles';
import { commonThemeOptions, getCommonGlobalStyles } from './theme-common';

export const lightThemeOptions: ThemeOptions = {
  ...commonThemeOptions,
  palette: {
    mode: 'light',
    primary: {
      main: 'rgb(41, 121, 218)',
      dark: 'rgb(80, 160, 180)',
      light: 'rgb(150, 180, 220)',
    },
    secondary: {
      main: 'rgb(55, 145, 215)',
    },
    background: {
      default: 'rgb(228, 230, 235)',
      surface: 'rgb(218, 220, 226)',
      paper: 'rgb(206, 209, 216)',
    },
    text: {
      primary: 'rgba(0, 0, 0, 0.8)',
      secondary: 'rgba(0, 0, 0, 0.55)',
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
          '--Mail-Background': 'rgb(228, 230, 235)',
          '--bg-primary': 'rgb(218, 220, 226)',
          '--bg-2': 'rgb(206, 209, 216)',
          '--primary-main': theme.palette.primary.main,
          '--text-primary': theme.palette.text.primary,
          '--text-secondary': theme.palette.text.secondary,
          '--background-default': theme.palette.background.default,
          '--background-paper': theme.palette.background.paper,
          '--background-surface': theme.palette.background.surface,
          '--videoplayer-bg': 'rgb(218, 220, 226)',
        },
        ...getCommonGlobalStyles(theme),
      }),
    },

    MuiIcon: {
      defaultProps: {
        style: {
          opacity: 0.5,
        },
      },
    },

    MuiPaper: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: theme.palette.background.paper,
          color: theme.palette.text.primary,
        }),
      },
    },
  },
};

const lightTheme = createTheme(lightThemeOptions);

export { lightTheme };
