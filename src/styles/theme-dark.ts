import { createTheme, ThemeOptions } from '@mui/material/styles';
import { commonThemeOptions } from './theme-common';

export const darkThemeOptions: ThemeOptions = {
  ...commonThemeOptions,
  palette: {
    mode: 'dark',
    primary: {
      main: 'rgb(100, 155, 240)',
      dark: 'rgb(45, 92, 201)',
      light: 'rgb(130, 185, 255)',
    },
    secondary: {
      main: 'rgb(69, 173, 255)',
    },
    background: {
      default: 'rgb(49, 51, 56)',
      surface: 'rgb(58, 60, 65)',
      paper: 'rgb(77, 80, 85)',
    },
    text: {
      primary: 'rgb(255, 255, 255)',
      secondary: 'rgb(179, 179, 179)',
    },
    border: {
      main: 'rgba(255, 255, 255, 0.12)',
      subtle: 'rgba(255, 255, 255, 0.08)',
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

    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        ':root': {
          '--Mail-Background': 'rgba(6, 10, 30, 1)',
          '--bg-primary': 'rgba(6, 10, 30, 1)',
          '--bg-2': 'rgb(39, 40, 44)',
          '--primary-main': theme.palette.primary.main,
          '--text-primary': theme.palette.text.primary,
          '--text-secondary': theme.palette.text.secondary,
          '--background-default': theme.palette.background.default,
          '--background-paper': theme.palette.background.paper,
          '--background-surface': theme.palette.background.surface,
          '--videoplayer-bg': 'rgba(31, 32, 35, 1)',
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
          color: 'rgb(255, 255, 255)',
          opacity: 0.5,
        },
      },
    },

    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgb(77, 80, 85)',
          color: 'rgb(255, 255, 255)',
        },
      },
    },
  },
};

const darkTheme = createTheme(darkThemeOptions);

export { darkTheme };
