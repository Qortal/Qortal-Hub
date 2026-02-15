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
