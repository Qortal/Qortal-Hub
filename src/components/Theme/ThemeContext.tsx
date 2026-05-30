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
import i18n from '../../i18n/i18n';

export const ENABLE_CUSTOM_THEMES = false;
const SAVED_UI_THEME_KEY = 'saved_ui_theme';
const DEFAULT_THEME_ID = 'default';

const defaultTheme = {
  id: 'default',
  name: i18n.t('core:theme.default', {
    postProcess: 'capitalizeFirstChar',
  }),
  light: lightThemeOptions.palette,
  dark: darkThemeOptions.palette,
};

const ThemeContext = createContext({
  themeMode: 'dark',
  toggleTheme: () => {},
  userThemes: [defaultTheme],
  addUserTheme: (themes) => {},
  setUserTheme: (theme, themes) => {},
  currentThemeId: DEFAULT_THEME_ID,
});

export const ThemeProvider = ({ children }) => {
  const [themeMode, setThemeMode] = useState('dark');
  const [userThemes, setUserThemes] = useState([defaultTheme]);
  const [currentThemeId, setCurrentThemeId] = useState(DEFAULT_THEME_ID);

  const currentTheme =
    userThemes.find((theme) => theme.id === currentThemeId) || defaultTheme;

  const muiTheme = useMemo(() => {
    const baseThemeOptions =
      themeMode === 'light' ? lightThemeOptions : darkThemeOptions;

    const activeTheme = ENABLE_CUSTOM_THEMES ? currentTheme : defaultTheme;
    const palette =
      themeMode === 'light' ? activeTheme.light : activeTheme.dark;

    return createTheme({
      ...baseThemeOptions,
      palette,
    });
  }, [themeMode, currentTheme]);

  const saveSettings = (
    themes = userThemes,
    mode = themeMode,
    themeId = currentThemeId
  ) => {
    if (!ENABLE_CUSTOM_THEMES) {
      localStorage.setItem(
        SAVED_UI_THEME_KEY,
        JSON.stringify({
          mode,
          currentThemeId: DEFAULT_THEME_ID,
        })
      );

      return;
    }

    localStorage.setItem(
      SAVED_UI_THEME_KEY,
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
    if (!ENABLE_CUSTOM_THEMES) return;
    setUserThemes(themes);
    saveSettings(themes);
  };

  const setUserTheme = (theme, themes) => {
    if (!ENABLE_CUSTOM_THEMES) return;
    if (theme.id === 'default') {
      setCurrentThemeId('default');
      saveSettings(themes || userThemes, themeMode, 'default');
    } else {
      setCurrentThemeId(theme.id);
      saveSettings(themes || userThemes, themeMode, theme.id);
    }
  };

  const loadSettings = useCallback(() => {
    const saved = localStorage.getItem(SAVED_UI_THEME_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.mode === 'light' || parsed.mode === 'dark')
          setThemeMode(parsed.mode);
        if (!ENABLE_CUSTOM_THEMES) {
          setUserThemes([defaultTheme]);
          setCurrentThemeId(DEFAULT_THEME_ID);
          localStorage.setItem(
            SAVED_UI_THEME_KEY,
            JSON.stringify({
              mode:
                parsed.mode === 'light' || parsed.mode === 'dark'
                  ? parsed.mode
                  : themeMode,
              currentThemeId: DEFAULT_THEME_ID,
            })
          );
          return;
        }
        if (Array.isArray(parsed.userThemes)) {
          const filteredThemes = parsed.userThemes.filter(
            (theme) => theme.id !== 'default'
          );
          setUserThemes([defaultTheme, ...filteredThemes]);
        }
        if (parsed.currentThemeId) setCurrentThemeId(parsed.currentThemeId);
      } catch (error) {
        console.error('Failed to parse saved_ui_theme:', error);
        if (!ENABLE_CUSTOM_THEMES) {
          setUserThemes([defaultTheme]);
          setCurrentThemeId(DEFAULT_THEME_ID);
          localStorage.setItem(
            SAVED_UI_THEME_KEY,
            JSON.stringify({
              mode: themeMode,
              currentThemeId: DEFAULT_THEME_ID,
            })
          );
        }
      }
    } else if (!ENABLE_CUSTOM_THEMES) {
      setUserThemes([defaultTheme]);
      setCurrentThemeId(DEFAULT_THEME_ID);
    }
  }, [themeMode]);

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
