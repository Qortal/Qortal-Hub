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
      default: '#DDD6CA',
      surface: '#EEE7DC',
      paper: '#F6F2EA',
      elevated: '#E2D9CB',
    },
    text: {
      primary: 'rgba(21, 26, 35, 0.94)',
      secondary: 'rgba(88, 96, 110, 0.86)',
    },
    divider: 'rgba(28, 36, 52, 0.12)',
    action: {
      hover: 'rgba(28, 36, 52, 0.06)',
      selected: 'rgba(41, 121, 218, 0.12)',
      focus: 'rgba(41, 121, 218, 0.14)',
      active: 'rgba(24, 29, 36, 0.86)',
    },
    border: {
      main: 'rgba(28, 36, 52, 0.16)',
      subtle: 'rgba(28, 36, 52, 0.11)',
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
            '0 12px 28px rgba(44, 38, 28, 0.07)',
          borderRadius: '8px',
          border: '1px solid rgba(15, 23, 42, 0.1)',
          transition:
            'background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease',
          '&:hover': {
            cursor: 'pointer',
            borderColor: 'rgba(15, 23, 42, 0.14)',
            boxShadow: '0 14px 30px rgba(44, 38, 28, 0.09)',
          },
        },
      },
    },

    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        ':root': {
          '--Mail-Background': '#DDD6CA',
          '--bg-primary': '#DDD6CA',
          '--bg-2': '#EEE7DC',
          '--primary-main': theme.palette.primary.main,
          '--text-primary': theme.palette.text.primary,
          '--text-secondary': theme.palette.text.secondary,
          '--background-default': theme.palette.background.default,
          '--background-paper': theme.palette.background.paper,
          '--background-surface': theme.palette.background.surface,
          '--background-elevated': theme.palette.background.elevated,
          '--videoplayer-bg': 'rgb(226, 217, 203)',
        },
        ...getCommonGlobalStyles(theme),
        html: {
          backgroundColor: '#DDD6CA',
          backgroundImage: 'linear-gradient(180deg, #EEE7DC 0%, #DDD6CA 100%)',
          backgroundRepeat: 'no-repeat',
        },
        body: {
          backgroundColor: '#DDD6CA',
          backgroundImage: 'linear-gradient(180deg, #EEE7DC 0%, #DDD6CA 100%)',
          backgroundRepeat: 'no-repeat',
        },
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
