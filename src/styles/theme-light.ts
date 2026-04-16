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
      default: 'rgb(244, 246, 249)',
      surface: 'rgb(232, 236, 241)',
      paper: 'rgb(223, 228, 235)',
      elevated: 'rgb(214, 220, 228)',
    },
    text: {
      primary: 'rgba(24, 29, 36, 0.92)',
      secondary: 'rgba(80, 88, 100, 0.82)',
    },
    divider: 'rgba(15, 23, 42, 0.08)',
    action: {
      hover: 'rgba(15, 23, 42, 0.05)',
      selected: 'rgba(41, 121, 218, 0.14)',
      focus: 'rgba(41, 121, 218, 0.18)',
      active: 'rgba(24, 29, 36, 0.86)',
    },
    border: {
      main: 'rgba(15, 23, 42, 0.12)',
      subtle: 'rgba(15, 23, 42, 0.08)',
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
            '0 10px 24px rgba(15, 23, 42, 0.06)',
          borderRadius: '8px',
          border: '1px solid rgba(15, 23, 42, 0.08)',
          transition:
            'background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease',
          '&:hover': {
            cursor: 'pointer',
            borderColor: 'rgba(15, 23, 42, 0.12)',
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.08)',
          },
        },
      },
    },

    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        ':root': {
          '--Mail-Background': 'rgb(244, 246, 249)',
          '--bg-primary': 'rgb(244, 246, 249)',
          '--bg-2': 'rgb(232, 236, 241)',
          '--primary-main': theme.palette.primary.main,
          '--text-primary': theme.palette.text.primary,
          '--text-secondary': theme.palette.text.secondary,
          '--background-default': theme.palette.background.default,
          '--background-paper': theme.palette.background.paper,
          '--background-surface': theme.palette.background.surface,
          '--background-elevated': theme.palette.background.elevated,
          '--videoplayer-bg': 'rgb(232, 236, 241)',
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
