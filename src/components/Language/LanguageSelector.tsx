import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supportedLanguages } from '../../../i18n';
import { Tooltip, useTheme } from '@mui/material';

const LanguageSelector = () => {
  const { i18n, t } = useTranslation(['core']);
  const [showSelect, setShowSelect] = useState(false);
  const theme = useTheme();

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
      style={{
        bottom: '5%',
        display: 'flex',
        gap: '12px',
        left: '1.5vh',
        position: 'absolute',
      }}
    >
      <Tooltip
        title={t('core:action.change_language', {
          postProcess: 'capitalize',
        })}
      >
        {showSelect ? (
          <select
            style={{
              fontSize: '1rem',
              border: '2px',
              background: theme.palette.background.default,
              color: theme.palette.text.primary,
              cursor: 'pointer',
              position: 'relative',
              bottom: '7px',
            }}
            value={currentLang}
            onChange={handleChange}
            onBlur={() => setShowSelect(false)}
          >
            {Object.entries(supportedLanguages).map(([code, { name }]) => (
              <option key={code} value={code}>
                {code.toUpperCase()} - {name}
              </option>
            ))}
          </select>
        ) : (
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
            {showSelect ? undefined : flag}
          </button>
        )}
      </Tooltip>
    </div>
  );
};

export default LanguageSelector;
