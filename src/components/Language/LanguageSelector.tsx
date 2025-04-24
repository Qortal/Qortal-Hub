import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supportedLanguages } from '../../../i18n';
import { Tooltip } from '@mui/material';

const LanguageSelector = () => {
  const { i18n } = useTranslation();
  const [showSelect, setShowSelect] = useState(false);

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
        title="Pollo"
        // {
        //   themeMode === 'dark'
        //     ? t('core:theme.light', {
        //         postProcess: 'capitalize',
        //       })
        //     : t('core:theme.light', {
        //         postProcess: 'capitalize',
        //       })
        // }
      >
        {showSelect ? (
          <select
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
            {flag}
          </button>
        )}
      </Tooltip>
    </div>
  );
};

export default LanguageSelector;
