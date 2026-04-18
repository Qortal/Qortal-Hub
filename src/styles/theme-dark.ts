import { createTheme, ThemeOptions } from '@mui/material/styles';
import { commonThemeOptions, getCommonGlobalStyles } from './theme-common';
import { APP_BLUE } from './blueMaterial';

export const darkThemeOptions: ThemeOptions = {
  ...commonThemeOptions,
  palette: {
    mode: 'dark',
    primary: {
      main: APP_BLUE.primary,
      dark: APP_BLUE.pressed,
      light: APP_BLUE.gradientTop,
    },
    secondary: {
      main: APP_BLUE.hover,
    },
    background: {
      default: '#0E0F14',
      surface: '#1B1D24',
      paper: '#1D1F27',
      elevated: '#23262F',
    },
    text: {
      primary: 'rgb(244, 247, 251)',
      secondary: '#989BA7',
    },
    divider: '#23262F',
    border: {
      main: '#23262F',
      subtle: '#23262F',
    },
    action: {
      hover: '#23262F',
      selected: '#262931',
      focus: '#262931',
      active: 'rgba(236, 243, 255, 0.86)',
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
          boxShadow: '0 8px 18px rgba(0, 0, 0, 0.12)',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          transition:
            'background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease',
          '&:hover': {
            cursor: 'pointer',
            borderColor: 'rgba(255, 255, 255, 0.2)',
            boxShadow: '0 10px 20px rgba(0, 0, 0, 0.14)',
          },
        },
      },
    },

    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        ':root': {
          '--Mail-Background': '#0E0F14',
          '--bg-primary': '#0E0F14',
          '--bg-2': '#0E0F14',
          '--primary-main': theme.palette.primary.main,
          '--text-primary': theme.palette.text.primary,
          '--text-secondary': theme.palette.text.secondary,
          '--background-default': theme.palette.background.default,
          '--background-paper': theme.palette.background.paper,
          '--background-surface': theme.palette.background.surface,
          '--background-elevated': theme.palette.background.elevated,
          '--videoplayer-bg': 'rgb(18, 21, 27)',
        },
        ...getCommonGlobalStyles(theme),
        html: {
          backgroundColor: '#0E0F14',
          backgroundImage: 'linear-gradient(180deg, #0E0F14 0%, #0E0F14 100%)',
          backgroundRepeat: 'no-repeat',
        },
        body: {
          backgroundColor: '#0E0F14',
          backgroundImage: 'linear-gradient(180deg, #0E0F14 0%, #0E0F14 100%)',
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

const darkTheme = createTheme(darkThemeOptions);

export { darkTheme };
