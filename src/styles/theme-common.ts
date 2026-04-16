import { Theme } from '@mui/material/styles';

/**
 * Returns the common MuiCssBaseline global styles shared by both themes.
 * Each theme should merge its own `:root` CSS variables with this result.
 */
export const getCommonGlobalStyles = (theme: Theme) => ({
  '*, *::before, *::after': {
    boxSizing: 'border-box',
  },

  html: {
    backgroundColor: theme.palette.background.default,
    padding: 0,
    margin: 0,
  },

  body: {
    backgroundColor: theme.palette.background.default,
    color: theme.palette.text.primary,
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
    width: '8px',
    height: '8px',
  },

  '::-webkit-scrollbar-thumb': {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? 'rgba(255, 255, 255, 0.12)'
        : 'rgba(0, 0, 0, 0.14)',
    borderRadius: '999px',
    border: '2px solid transparent',
    backgroundClip: 'content-box',
    transition: 'background-color 0.2s ease',
  },

  '::-webkit-scrollbar-thumb:hover': {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? 'rgba(255, 255, 255, 0.18)'
        : 'rgba(0, 0, 0, 0.2)',
  },

  '::-webkit-scrollbar-thumb:active': {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? 'rgba(255, 255, 255, 0.24)'
        : 'rgba(0, 0, 0, 0.26)',
  },
});

// Extend the Theme interface
const commonThemeOptions = {
  typography: {
    fontFamily: ['Inter'].join(','),
    h1: {
      fontSize: '2rem',
      fontWeight: 600,
    },
    h2: {
      fontSize: '1.75rem',
      fontWeight: 500,
    },
    h3: {
      fontSize: '1.5rem',
      fontWeight: 500,
    },
    h4: {
      fontSize: '1.25rem',
      fontWeight: 500,
    },
    h5: {
      fontSize: '1rem',
      fontWeight: 500,
    },
    h6: {
      fontSize: '0.875rem',
      fontWeight: 500,
    },
    body: {
      margin: '0px',
      overflow: 'hidden',
    },
    body1: {
      fontSize: '16px',
      fontWeight: 400,
      lineHeight: 1.5,
      letterSpacing: 'normal',
    },
    body2: {
      fontSize: '18px',
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: '0.2px',
    },
  },
  spacing: 8,
  shape: {
    borderRadius: 4,
  },
  breakpoints: {
    values: {
      xs: 0,
      sm: 600,
      md: 900,
      lg: 1200,
      xl: 1536,
    },
  },

  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          transition: 'filter 0.3s ease-in-out',
          '&:hover': {
            filter: 'brightness(1.1)',
          },
        },
      },
      defaultProps: {
        disableElevation: true,
        disableRipple: true,
      },
    },

    MuiDialog: {
      styleOverrides: {
        paper: ({ theme }: { theme: Theme }) => ({
          backgroundColor: theme.palette.background.paper,
          color: theme.palette.text.primary,
        }),
      },
    },

    MuiDialogTitle: {
      styleOverrides: {
        root: {
          backgroundColor: 'inherit',
          color: 'inherit',
        },
      },
    },

    MuiDialogContent: {
      styleOverrides: {
        root: {
          backgroundColor: 'inherit',
        },
      },
    },

    MuiModal: {
      styleOverrides: {
        root: {
          zIndex: 50000,
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

export { commonThemeOptions };
