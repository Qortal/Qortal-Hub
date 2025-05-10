import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supportedLanguages } from '../../i18n/i18n';
import {
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
    <div
      ref={selectorRef}
      style={{
        bottom: '5%',
        display: 'flex',
        gap: '12px',
        left: '1.5vh',
        position: 'absolute',
      }}
    >
      {!showSelect && (
        <Tooltip
          key={currentLang}
          title={t('core:action.change_language', {
            postProcess: 'capitalize',
          })}
        >
          <button
            onClick={() => setShowSelect(true)}
            style={{
              fontSize: '1.5rem',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
            }}
            aria-label={`Current language: ${name}`}
          >
            {flag}
          </button>
        </Tooltip>
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
            open
            labelId="language-select-label"
            id="language-select"
            value={currentLang}
            onChange={handleChange}
            autoFocus
            onClose={() => setShowSelect(false)}
          >
            {Object.entries(supportedLanguages).map(([code, { name }]) => (
              <MenuItem key={code} value={code}>
                {code.toUpperCase()} – {name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}
    </div>
  );
};

export default LanguageSelector;
