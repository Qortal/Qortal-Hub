import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supportedLanguages } from '../../i18n/i18n';
import {
  Box,
  Button,
  FormControl,
  MenuItem,
  Select,
  Tooltip,
  useTheme,
} from '@mui/material';

const LanguageSelector = () => {
  const { i18n, t } = useTranslation(['core']);
  const [showSelect, setShowSelect] = useState(false);
  const theme = useTheme();
  const selectorRef = useRef(null);

  const handleChange = (e) => {
    const newLang = e.target.value;
    i18n.changeLanguage(newLang);
    setShowSelect(false);
  };

  const currentLang = i18n.language;
  const { name, flag } =
    supportedLanguages[currentLang] || supportedLanguages['en'];

  return (
    <Box ref={selectorRef}>
      {!showSelect && (
        <Button
          onClick={() => setShowSelect(true)}
          style={{
            fontSize: '1.3rem',
          }}
          aria-label={t('core:current_language', {
            language: name,
            postProcess: 'capitalizeFirstChar',
          })}
        >
          {flag}
        </Button>
      )}

      {showSelect && (
        <FormControl
          size="small"
          sx={{
            minWidth: 120,
            backgroundColor: theme.palette.background.paper,
          }}
        >
          <Select
            autoFocus
            id="language-select"
            labelId="language-select-label"
            onChange={handleChange}
            onClose={() => setShowSelect(false)}
            open
            value={currentLang}
          >
            {Object.entries(supportedLanguages).map(([code, { name }]) => (
              <MenuItem key={code} value={code}>
                {code.toUpperCase()} – {name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
    </Box>
  );
};

export default LanguageSelector;
