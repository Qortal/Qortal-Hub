import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supportedLanguages } from '../../i18n/i18n';
import {
  ButtonBase,
  Menu,
  MenuItem,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import LanguageIcon from '@mui/icons-material/Language';

type LanguageSelectorProps = {
  sidebar?: boolean;
};

const LanguageSelector = ({ sidebar = false }: LanguageSelectorProps) => {
  const { i18n, t } = useTranslation(['core']);
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const sidebarButtonSx = {
    alignItems: 'center',
    borderRadius: '14px',
    color: theme.palette.text.secondary,
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    justifyContent: 'flex-start',
    minHeight: 58,
    py: 1,
    transition: 'background-color 180ms ease, color 180ms ease, box-shadow 140ms ease',
    width: 56,
    '& .sidebarSelectorIconWrap': {
      transition: 'transform 150ms ease, color 180ms ease',
    },
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
      color: theme.palette.text.primary,
      boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.border.main, 0.18)}, inset 0 1px 0 ${alpha(
        theme.palette.common.white,
        theme.palette.mode === 'dark' ? 0.03 : 0.12
      )}`,
      '& .sidebarSelectorIconWrap': {
        transform: 'translateY(-1px)',
      },
    },
    '&:focus-visible': {
      backgroundColor: alpha(
        theme.palette.action.hover,
        theme.palette.mode === 'dark' ? 0.72 : 0.82
      ),
      boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.border.main, 0.22)}, inset 0 1px 0 ${alpha(
        theme.palette.common.white,
        theme.palette.mode === 'dark' ? 0.03 : 0.12
      )}`,
      color: theme.palette.text.primary,
      '& .sidebarSelectorIconWrap': {
        transform: 'translateY(-1px)',
      },
    },
  } as const;

  const handleChange = (newLang: string) => {
    i18n.changeLanguage(newLang);
    setAnchorEl(null);
  };

  const currentLang = i18n.language;
  const { name } =
    supportedLanguages[currentLang] || supportedLanguages['en'];
  const currentLangCode = currentLang.startsWith('en')
    ? 'US'
    : currentLang.slice(0, 2).toUpperCase();

  return (
    <>
      <ButtonBase
        disableRipple
        onClick={(event) => setAnchorEl(event.currentTarget)}
        aria-label={t('core:current_language', {
          language: name,
          postProcess: 'capitalizeFirstChar',
        })}
        sx={
          sidebar
            ? sidebarButtonSx
            : {
                alignItems: 'center',
                borderRadius: '12px',
                color: theme.palette.text.secondary,
                display: 'flex',
                flexDirection: 'column',
                gap: 0.2,
                justifyContent: 'center',
                minHeight: 60,
                px: 1,
                py: 1,
                transition: 'background-color 180ms ease, color 180ms ease',
                width: 62,
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                  color: theme.palette.text.primary,
                },
              }
        }
      >
        {sidebar ? (
          <>
            <Typography
              className="sidebarSelectorIconWrap"
              sx={{
                alignItems: 'center',
                display: 'flex',
                height: '40px',
                justifyContent: 'center',
                width: '40px',
              }}
            >
              <LanguageIcon sx={{ fontSize: '1.45rem' }} />
            </Typography>
            <Typography
              sx={{
                color: 'inherit',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.01em',
                lineHeight: 1,
              }}
            >
              {currentLangCode}
            </Typography>
          </>
        ) : (
          <Typography
            sx={{
              color: 'inherit',
              fontSize: '13px',
              fontWeight: 700,
              letterSpacing: '0.03em',
              lineHeight: 1,
            }}
          >
            {currentLangCode}
          </Typography>
        )}
      </ButtonBase>

      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'center', horizontal: 'right' }}
        transformOrigin={{ vertical: 'center', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              backgroundColor: theme.palette.background.paper,
              border: `1px solid ${theme.palette.border.subtle}`,
              boxShadow:
                theme.palette.mode === 'dark'
                  ? '0 12px 28px rgba(0,0,0,0.35)'
                  : '0 10px 24px rgba(0,0,0,0.14)',
              minWidth: 170,
              ml: 1,
            },
          },
        }}
      >
        {Object.entries(supportedLanguages).map(([code, langData]) => (
          <MenuItem
            key={code}
            selected={code === currentLang}
            onClick={() => handleChange(code)}
          >
            {langData.flag} {code.toUpperCase()} - {langData.name}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

export default LanguageSelector;
