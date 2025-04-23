import { useThemeContext } from './ThemeContext';
import { IconButton, Tooltip } from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { useTranslation } from 'react-i18next';

const ThemeSelector = () => {
  const { t } = useTranslation(['core']);
  const { themeMode, toggleTheme } = useThemeContext();

  return (
    <div
      style={{
        bottom: '1%',
        display: 'flex',
        gap: '12px',
        left: '1.5vh',
        position: 'absolute',
      }}
    >
      <Tooltip
        title={
          themeMode === 'dark'
            ? t('core:theme.light', {
                postProcess: 'capitalize',
              })
            : t('core:theme.light', {
                postProcess: 'capitalize',
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
