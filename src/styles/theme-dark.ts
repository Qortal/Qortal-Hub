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
      paper: 'rgb(62, 64, 68)',
      surface: 'rgb(58, 60, 65)',
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
          '--Mail-Background': 'rgb(43, 43, 43)',
          '--bg-primary': 'rgba(31, 32, 35, 1)',
          '--bg-2': 'rgb(39, 40, 44)',
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
          color: 'rgb(255, 255, 255)',
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

const darkTheme = createTheme(darkThemeOptions);

export { darkTheme };
