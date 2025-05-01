import {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from 'react';
import {
  ThemeProvider as MuiThemeProvider,
  createTheme,
} from '@mui/material/styles';
import { lightThemeOptions } from '../../styles/theme-light';
import { darkThemeOptions } from '../../styles/theme-dark';

const defaultTheme = {
  id: 'default',
  name: 'Default Theme',
  light: lightThemeOptions.palette,
  dark: darkThemeOptions.palette,
};

const ThemeContext = createContext({
  themeMode: 'dark',
  toggleTheme: () => {},
  userThemes: [defaultTheme],
  addUserTheme: (themes) => {},
  setUserTheme: (theme) => {},
  currentThemeId: 'default',
});

export const ThemeProvider = ({ children }) => {
  const [themeMode, setThemeMode] = useState('dark');
  const [userThemes, setUserThemes] = useState([defaultTheme]);
  const [currentThemeId, setCurrentThemeId] = useState('default');

  const currentTheme =
    userThemes.find((theme) => theme.id === currentThemeId) || defaultTheme;

  const muiTheme = useMemo(() => {
    if (themeMode === 'light') {
      return createTheme({
        ...lightThemeOptions,
        palette: {
          ...currentTheme.light,
        },
      });
    } else {
      return createTheme({
        ...lightThemeOptions,
        palette: {
          ...currentTheme.dark,
        },
      });
    }
  }, [themeMode, currentTheme]);

  const saveSettings = (
    themes = userThemes,
    mode = themeMode,
    themeId = currentThemeId
  ) => {
    localStorage.setItem(
      'saved_ui_theme',
      JSON.stringify({
        mode,
        userThemes: themes,
        currentThemeId: themeId,
      })
    );
  };

  const toggleTheme = () => {
    setThemeMode((prev) => {
      const newMode = prev === 'light' ? 'dark' : 'light';
      saveSettings(userThemes, newMode, currentThemeId);
      return newMode;
    });
  };

  const addUserTheme = (themes) => {
    setUserThemes(themes);
    saveSettings(themes);
  };

  const setUserTheme = (theme) => {
    if (theme.id === 'default') {
      setCurrentThemeId('default');
      saveSettings(userThemes, themeMode, 'default');
    } else {
      setCurrentThemeId(theme.id);
      saveSettings(userThemes, themeMode, theme.id);
    }
  };

  const loadSettings = useCallback(() => {
    const saved = localStorage.getItem('saved_ui_theme');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.mode === 'light' || parsed.mode === 'dark')
          setThemeMode(parsed.mode);
        if (Array.isArray(parsed.userThemes)) {
          const filteredThemes = parsed.userThemes.filter(
            (theme) => theme.id !== 'default'
          );
          setUserThemes([defaultTheme, ...filteredThemes]);
        }
        if (parsed.currentThemeId) setCurrentThemeId(parsed.currentThemeId);
      } catch (error) {
        console.error('Failed to parse saved_ui_theme:', error);
      }
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return (
    <ThemeContext.Provider
      value={{
        themeMode,
        toggleTheme,
        userThemes,
        addUserTheme,
        setUserTheme,
        currentThemeId,
      }}
    >
      <MuiThemeProvider theme={muiTheme}>{children}</MuiThemeProvider>
    </ThemeContext.Provider>
  );
};

export const useThemeContext = () => useContext(ThemeContext);
