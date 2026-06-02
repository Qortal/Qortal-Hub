import { useThemeContext } from './ThemeContext';
import {
  Box,
  ButtonBase,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { useTranslation } from 'react-i18next';
import { useRef } from 'react';

type ThemeSelectorProps = {
  sidebar?: boolean;
  /** Compact icon for footers (e.g. login screen chrome next to language). */
  footer?: boolean;
};

const ThemeSelector = ({
  sidebar = false,
  footer = false,
}: ThemeSelectorProps) => {
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const { themeMode, toggleTheme } = useThemeContext();
  const selectorRef = useRef(null);
  const theme = useTheme();
  const switchThemeLabel = themeMode === 'dark' ? 'Light' : 'Dark';
  const sidebarButtonSx = {
    alignItems: 'center',
    borderRadius: '14px',
    color: theme.palette.text.secondary,
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    justifyContent: 'flex-start',
    minHeight: 58,
    py: 1,
    transition:
      'background-color 180ms ease, color 180ms ease, box-shadow 140ms ease',
    width: 56,
    '& .sidebarSelectorIconWrap': {
      transition: 'transform 150ms ease, color 180ms ease',
    },
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
      color: theme.palette.text.primary,
      boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.border.main, 0.18)}, inset 0 1px 0 ${alpha(
        theme.palette.common.white,
        theme.palette.mode === 'dark' ? 0.03 : 0.12
      )}`,
      '& .sidebarSelectorIconWrap': {
        transform: 'translateY(-1px)',
      },
    },
    '&:focus-visible': {
      backgroundColor: alpha(
        theme.palette.action.hover,
        theme.palette.mode === 'dark' ? 0.72 : 0.82
      ),
      boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.border.main, 0.22)}, inset 0 1px 0 ${alpha(
        theme.palette.common.white,
        theme.palette.mode === 'dark' ? 0.03 : 0.12
      )}`,
      color: theme.palette.text.primary,
      '& .sidebarSelectorIconWrap': {
        transform: 'translateY(-1px)',
      },
    },
  } as const;

  if (footer) {
    const ariaLabel =
      themeMode === 'dark'
        ? t('core:aria.switch_theme_light')
        : t('core:aria.switch_theme_dark');
    return (
      <Box ref={selectorRef}>
        <Tooltip title={ariaLabel}>
          <IconButton onClick={toggleTheme} aria-label={ariaLabel}>
            {themeMode === 'dark' ? (
              <LightModeIcon sx={{ fontSize: 18 }} />
            ) : (
              <DarkModeIcon sx={{ fontSize: 18 }} />
            )}
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  if (sidebar) {
    return (
      <Box ref={selectorRef}>
        <ButtonBase disableRipple onClick={toggleTheme} sx={sidebarButtonSx}>
          <Box
            className="sidebarSelectorIconWrap"
            sx={{
              alignItems: 'center',
              display: 'flex',
              height: '40px',
              justifyContent: 'center',
              width: '40px',
            }}
          >
            {themeMode === 'dark' ? (
              <LightModeIcon sx={{ fontSize: '1.45rem' }} />
            ) : (
              <DarkModeIcon sx={{ fontSize: '1.45rem' }} />
            )}
          </Box>
          <Typography
            sx={{
              color: 'inherit',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.01em',
              lineHeight: 1,
            }}
          >
            {switchThemeLabel}
          </Typography>
        </ButtonBase>
      </Box>
    );
  }

  return (
    <Box ref={selectorRef}>
      <IconButton
        onClick={toggleTheme}
        sx={{
          bgcolor: theme.palette.background.default,
          color: theme.palette.text.primary,
        }}
      >
        {themeMode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
      </IconButton>
    </Box>
  );
};

export default ThemeSelector;
