import { useThemeContext } from './ThemeContext';
import { IconButton, Tooltip } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';

const ThemeSelector = () => {
  const { themeMode, toggleTheme } = useThemeContext();

  return (
    <div
      style={{
        display: 'flex',
        gap: '12px',
        position: 'fixed',
        bottom: '1%',
      }}
    >
      <Tooltip title={themeMode === 'dark' ? 'Light mode' : 'Dark mode'}>
        <IconButton onClick={toggleTheme}>
          {themeMode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
        </IconButton>
      </Tooltip>
    </div>
  );
};

export default ThemeSelector;
