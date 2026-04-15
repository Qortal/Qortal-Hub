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
      default: 'rgb(9, 11, 15)',
      surface: 'rgb(27, 31, 39)',
      paper: 'rgb(34, 39, 48)',
      elevated: 'rgb(44, 50, 61)',
    },
    text: {
      primary: 'rgb(244, 247, 251)',
      secondary: 'rgb(153, 160, 172)',
    },
    divider: 'rgba(255, 255, 255, 0.11)',
    border: {
      main: 'rgba(255, 255, 255, 0.16)',
      subtle: 'rgba(255, 255, 255, 0.09)',
    },
    action: {
      hover: 'rgba(255, 255, 255, 0.1)',
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
          boxShadow: 'none',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.09)',
          transition: 'background-color 0.2s ease, border-color 0.2s ease',
          '&:hover': {
            cursor: 'pointer',
            borderColor: 'rgba(255, 255, 255, 0.18)',
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
