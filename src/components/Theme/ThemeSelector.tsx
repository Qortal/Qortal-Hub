import { useThemeContext } from './ThemeContext';
import { IconButton, Tooltip } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { useTranslation } from 'react-i18next';

const ThemeSelector = () => {
  const { t } = useTranslation(['auth', 'core', 'group']);
  const { themeMode, toggleTheme } = useThemeContext();

  return (
    <div
      style={{
        bottom: '1%',
        display: 'flex',
        gap: '12px',
        left: '1.2vh',
        position: 'absolute',
      }}
    >
      <Tooltip
        title={
          themeMode === 'dark'
            ? t('core:theme.light_mode', {
                postProcess: 'capitalizeFirstChar',
              })
            : t('core:theme.dark_mode', {
                postProcess: 'capitalizeFirstChar',
              })
        }
      >
        <IconButton onClick={toggleTheme}>
          {themeMode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
        </IconButton>
      </Tooltip>
    </div>
  );
};

export default ThemeSelector;
