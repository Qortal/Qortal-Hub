import { useTranslation } from 'react-i18next';
import { supportedLanguages } from '../../i18n/i18n';
import {
  ButtonBase,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import LanguageIcon from '@mui/icons-material/Language';

type LanguageSelectorProps = {
  sidebar?: boolean;
};

const LanguageSelector = ({ sidebar = false }: LanguageSelectorProps) => {
  const { t } = useTranslation(['core']);
  const theme = useTheme();
  const englishLanguage = supportedLanguages.en;
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

  const currentLang = 'en';
  const { name } = englishLanguage;
  const currentLangCode = 'US';

  return (
    <>
      <ButtonBase
        disableRipple
        onClick={() => undefined}
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

    </>
  );
};

export default LanguageSelector;
