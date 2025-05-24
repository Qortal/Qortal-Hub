import { useState, useRef, useEffect } from 'react';
import {
  Box,
  Button,
  IconButton,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItemText,
  ListItemSecondaryAction,
  TextField,
  Tabs,
  Tab,
  ListItemButton,
} from '@mui/material';
import { Sketch } from '@uiw/react-color';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import { useThemeContext } from './ThemeContext';
import { darkThemeOptions } from '../../styles/theme-dark';
import { lightThemeOptions } from '../../styles/theme-light';
import ShortUniqueId from 'short-unique-id';
import { rgbStringToHsva, rgbaStringToHsva } from '@uiw/color-convert';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { saveFileToDiskGeneric } from '../../utils/generateWallet/generateWallet';
import { handleImportClick } from '../../utils/fileReading';
import { useTranslation } from 'react-i18next';

const uid = new ShortUniqueId({ length: 8 });

function detectColorFormat(color) {
  if (typeof color !== 'string') return null;
  if (color.startsWith('rgba')) return 'rgba';
  if (color.startsWith('rgb')) return 'rgb';
  return null;
}

const validateTheme = (theme) => {
  if (typeof theme !== 'object' || !theme) return false;
  if (typeof theme.name !== 'string') return false;
  if (!theme.light || typeof theme.light !== 'object') return false;
  if (!theme.dark || typeof theme.dark !== 'object') return false;

  // Optional: deeper checks on structure
  const requiredKeys = [
    'primary',
    'secondary',
    'background',
    'text',
    'border',
    'other',
  ];

  for (const mode of ['light', 'dark']) {
    const modeTheme = theme[mode];
    if (modeTheme.mode !== mode) return false;

    for (const key of requiredKeys) {
      if (!modeTheme[key] || typeof modeTheme[key] !== 'object') {
        return false;
      }
    }
  }

  return true;
};

export default function ThemeManager() {
  const { userThemes, addUserTheme, setUserTheme, currentThemeId } =
    useThemeContext();
  const [openEditor, setOpenEditor] = useState(false);
  const [themeDraft, setThemeDraft] = useState({
    id: '',
    name: '',
    light: {},
    dark: {},
  });
  const [currentTab, setCurrentTab] = useState('light');
  const nameInputRef = useRef(null);
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  useEffect(() => {
    if (openEditor && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [openEditor]);

  const handleAddTheme = () => {
    setThemeDraft({
      id: '',
      name: '',
      light: structuredClone(lightThemeOptions.palette),
      dark: structuredClone(darkThemeOptions.palette),
    });
    setOpenEditor(true);
  };

  const handleEditTheme = (themeId) => {
    const themeToEdit = userThemes.find((theme) => theme.id === themeId);
    if (themeToEdit) {
      setThemeDraft({ ...themeToEdit });
      setOpenEditor(true);
    }
  };

  const handleSaveTheme = () => {
    if (themeDraft.id) {
      const updatedThemes = [...userThemes];
      const index = updatedThemes.findIndex(
        (theme) => theme.id === themeDraft.id
      );
      if (index !== -1) {
        updatedThemes[index] = themeDraft;
        addUserTheme(updatedThemes);
      }
    } else {
      const newTheme = { ...themeDraft, id: uid.rnd() };
      const updatedThemes = [...userThemes, newTheme];
      addUserTheme(updatedThemes);
      setUserTheme(newTheme, updatedThemes);
    }
    setOpenEditor(false);
  };

  const handleDeleteTheme = (id) => {
    const updatedThemes = userThemes.filter((theme) => theme.id !== id);
    addUserTheme(updatedThemes);

    if (id === currentThemeId) {
      // Find the default theme object in the list
      const defaultTheme = updatedThemes.find(
        (theme) => theme.id === 'default'
      );

      if (defaultTheme) {
        setUserTheme(defaultTheme, updatedThemes);
      } else {
        // Emergency fallback
        setUserTheme(
          {
            light: lightThemeOptions,
            dark: darkThemeOptions,
          },
          updatedThemes
        );
      }
    }
  };

  const handleApplyTheme = (theme) => {
    setUserTheme(theme, null);
  };

  const handleColorChange = (mode, fieldPath, color) => {
    setThemeDraft((prev) => {
      const updated = { ...prev };
      const paths = fieldPath.split('.');
      updated[mode][paths[0]][paths[1]] = color.hex;
      return updated;
    });
  };

  const renderColorPicker = (mode, label, fieldPath, currentValue) => {
    let color = currentValue || '#ffffff';
    const format = detectColorFormat(currentValue);
    if (format === 'rgba') {
      color = rgbaStringToHsva(currentValue);
    } else if (format === 'rgb') {
      color = rgbStringToHsva(currentValue);
    }
    return (
      <Box
        mb={2}
        {...{ 'data-color-mode': mode === 'dark' ? 'dark' : 'light' }}
      >
        <Typography variant="body2" mb={1}>
          {label}
        </Typography>
        <Sketch
          key={`${mode}-${fieldPath}`}
          color={color}
          onChange={(color) => handleColorChange(mode, fieldPath, color)}
        />
      </Box>
    );
  };

  const exportTheme = async (theme) => {
    try {
      const copyTheme = structuredClone(theme);
      delete copyTheme.id;
      const fileName = `ui_theme_${theme.name}.json`;

      const blob = new Blob([JSON.stringify(copyTheme, null, 2)], {
        type: 'application/json',
      });

      await saveFileToDiskGeneric(blob, fileName);
    } catch (error) {
      console.error(error);
    }
  };

  const importTheme = async (theme) => {
    try {
      const fileContent = await handleImportClick('.json');
      const importedTheme = JSON.parse(fileContent);
      if (!validateTheme(importedTheme)) {
        throw new Error(
          t('core:message.generic.invalid_theme_format', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      const newTheme = { ...importedTheme, id: uid.rnd() };
      const updatedThemes = [...userThemes, newTheme];
      addUserTheme(updatedThemes);

      setUserTheme(newTheme, updatedThemes);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <Box p={2}>
      <Typography variant="h5" gutterBottom>
        {t('core:theme.manager', { postProcess: 'capitalizeFirstChar' })}
      </Typography>

      <Button
        variant="contained"
        startIcon={<AddIcon />}
        onClick={handleAddTheme}
      >
        {t('core:action.add_theme', { postProcess: 'capitalizeFirstChar' })}
      </Button>

      <Button
        sx={{
          marginLeft: '20px',
        }}
        variant="contained"
        startIcon={<AddIcon />}
        onClick={importTheme}
      >
        {t('core:action.import_theme', { postProcess: 'capitalizeFirstChar' })}
      </Button>

      <List>
        {userThemes?.map((theme, index) => (
          <ListItemButton
            key={theme?.id || index}
            selected={theme?.id === currentThemeId}
          >
            <ListItemText
              primary={`${theme?.name || `Theme ${index + 1}`} ${theme?.id === currentThemeId ? '(Current)' : ''}`}
            />
            <ListItemSecondaryAction>
              {theme.id !== 'default' && (
                <>
                  <IconButton onClick={() => exportTheme(theme)}>
                    <FileDownloadIcon />
                  </IconButton>
                  <IconButton onClick={() => handleEditTheme(theme.id)}>
                    <EditIcon />
                  </IconButton>
                  <IconButton onClick={() => handleDeleteTheme(theme.id)}>
                    <DeleteIcon />
                  </IconButton>
                </>
              )}
              <IconButton onClick={() => handleApplyTheme(theme)}>
                <CheckIcon />
              </IconButton>
            </ListItemSecondaryAction>
          </ListItemButton>
        ))}
      </List>

      <Dialog
        open={openEditor}
        onClose={() => setOpenEditor(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>
          {themeDraft.id
            ? t('core:action.edit_theme', {
                postProcess: 'capitalizeFirstChar',
              })
            : t('core:action.new.theme', {
                postProcess: 'capitalizeFirstChar',
              })}
        </DialogTitle>

        <DialogContent>
          <TextField
            inputRef={nameInputRef}
            margin="dense"
            label={t('core:theme.name', { postProcess: 'capitalizeFirstChar' })}
            fullWidth
            value={themeDraft.name}
            onChange={(e) =>
              setThemeDraft((prev) => ({ ...prev, name: e.target.value }))
            }
          />

          <Tabs
            value={currentTab}
            onChange={(e, newValue) => setCurrentTab(newValue)}
            sx={{ mt: 2, mb: 2 }}
          >
            <Tab
              label={t('core:theme.light', {
                postProcess: 'capitalizeFirstChar',
              })}
              value="light"
            />
            <Tab
              label={t('core:theme.dark', {
                postProcess: 'capitalizeFirstChar',
              })}
              value="dark"
            />
          </Tabs>

          <Box>
            {renderColorPicker(
              currentTab,
              'Primary Main',
              'primary.main',
              themeDraft[currentTab]?.primary?.main
            )}
            {renderColorPicker(
              currentTab,
              'Primary Dark',
              'primary.dark',
              themeDraft[currentTab]?.primary?.dark
            )}
            {renderColorPicker(
              currentTab,
              'Primary Light',
              'primary.light',
              themeDraft[currentTab]?.primary?.light
            )}
            {renderColorPicker(
              currentTab,
              'Secondary Main',
              'secondary.main',
              themeDraft[currentTab]?.secondary?.main
            )}
            {renderColorPicker(
              currentTab,
              'Background Default',
              'background.default',
              themeDraft[currentTab]?.background?.default
            )}
            {renderColorPicker(
              currentTab,
              'Background Paper',
              'background.paper',
              themeDraft[currentTab]?.background?.paper
            )}
            {renderColorPicker(
              currentTab,
              'Background Surface',
              'background.surface',
              themeDraft[currentTab]?.background?.surface
            )}
            {renderColorPicker(
              currentTab,
              'Text Primary',
              'text.primary',
              themeDraft[currentTab]?.text?.primary
            )}
            {renderColorPicker(
              currentTab,
              'Text Secondary',
              'text.secondary',
              themeDraft[currentTab]?.text?.secondary
            )}
            {renderColorPicker(
              currentTab,
              'Border Main',
              'border.main',
              themeDraft[currentTab]?.border?.main
            )}
            {renderColorPicker(
              currentTab,
              'Border Subtle',
              'border.subtle',
              themeDraft[currentTab]?.border?.subtle
            )}
            {renderColorPicker(
              currentTab,
              'Positive',
              'other.positive',
              themeDraft[currentTab]?.other?.positive
            )}
            {renderColorPicker(
              currentTab,
              'Danger',
              'other.danger',
              themeDraft[currentTab]?.other?.danger
            )}
            {renderColorPicker(
              currentTab,
              'Unread',
              'other.unread',
              themeDraft[currentTab]?.other?.unread
            )}
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setOpenEditor(false)}>
            {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
          </Button>

          <Button
            disabled={!themeDraft.name}
            onClick={handleSaveTheme}
            variant="contained"
          >
            {t('core:action.save', { postProcess: 'capitalizeFirstChar' })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
