import {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from 'react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../styles/theme-dark';
import { lightTheme } from '../../styles/theme-light';

const ThemeContext = createContext({
  themeMode: 'light',
  toggleTheme: () => {},
});

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [themeMode, setThemeMode] = useState('light');

  const theme = useMemo(
    () => (themeMode === 'light' ? lightTheme : darkTheme),
    [themeMode]
  );

  const toggleTheme = () => {
    setThemeMode((prevMode) => {
      const newMode = prevMode === 'light' ? 'dark' : 'light';

      const themeProperties = {
        mode: newMode,
      };

      localStorage.setItem('saved_ui_theme', JSON.stringify(themeProperties));

      return newMode;
    });
  };

  const getSavedTheme = useCallback(async () => {
    try {
      const themeProperties = JSON.parse(
        localStorage.getItem(`saved_ui_theme`) || '{}'
      );

      const theme = themeProperties?.mode || 'light';
      setThemeMode(theme);
    } catch (error) {
      console.log('error', error);
    }
  }, []);

  useEffect(() => {
    getSavedTheme();
  }, [getSavedTheme]);

  return (
    <ThemeContext.Provider value={{ themeMode, toggleTheme }}>
      <MuiThemeProvider theme={theme}>{children}</MuiThemeProvider>
    </ThemeContext.Provider>
  );
};

export const useThemeContext = () => useContext(ThemeContext);
