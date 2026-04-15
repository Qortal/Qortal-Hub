import { useThemeContext } from './ThemeContext';
import { Box, ButtonBase, IconButton, Typography, useTheme } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { useTranslation } from 'react-i18next';
import { useRef } from 'react';

type ThemeSelectorProps = {
  sidebar?: boolean;
};

const ThemeSelector = ({ sidebar = false }: ThemeSelectorProps) => {
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

  if (sidebar) {
    return (
      <Box ref={selectorRef}>
        <ButtonBase
          disableRipple
          onClick={toggleTheme}
          sx={{
            alignItems: 'center',
            borderRadius: '14px',
            color: theme.palette.text.secondary,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            justifyContent: 'flex-start',
            minHeight: 58,
            py: 1,
            transition: 'background-color 180ms ease, color 180ms ease',
            width: 56,
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
              color: theme.palette.text.primary,
            },
          }}
        >
          <Box
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
            {themeMode === 'dark' ? 'Light' : 'Dark'}
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
