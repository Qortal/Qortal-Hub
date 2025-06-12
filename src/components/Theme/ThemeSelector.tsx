import { useThemeContext } from './ThemeContext';
import { Box, IconButton, Tooltip, useTheme } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { useTranslation } from 'react-i18next';
import { useRef } from 'react';

const ThemeSelector = () => {
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

  return (
    <Box ref={selectorRef}>
      <IconButton
        onClick={toggleTheme}
        sx={{
          color: theme.palette.text.secondary,
        }}
      >
        {themeMode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
      </IconButton>
    </Box>
  );
};

export default ThemeSelector;
