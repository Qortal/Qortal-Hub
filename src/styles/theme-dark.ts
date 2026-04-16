import { createTheme, ThemeOptions } from '@mui/material/styles';
import { commonThemeOptions, getCommonGlobalStyles } from './theme-common';

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
      default: 'rgb(10, 12, 15)',
      surface: 'rgb(29, 32, 38)',
      paper: 'rgb(39, 43, 50)',
      elevated: 'rgb(48, 53, 61)',
    },
    text: {
      primary: 'rgb(244, 247, 251)',
      secondary: 'rgb(159, 166, 176)',
    },
    divider: 'rgba(255, 255, 255, 0.1)',
    border: {
      main: 'rgba(255, 255, 255, 0.18)',
      subtle: 'rgba(255, 255, 255, 0.1)',
    },
    action: {
      hover: 'rgba(255, 255, 255, 0.08)',
      selected: 'rgba(100, 155, 240, 0.18)',
      focus: 'rgba(100, 155, 240, 0.22)',
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
          '--Mail-Background': 'rgb(9, 11, 15)',
          '--bg-primary': 'rgb(9, 11, 15)',
          '--bg-2': 'rgb(27, 31, 39)',
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
