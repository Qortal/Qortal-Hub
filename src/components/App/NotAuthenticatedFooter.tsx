import { Box, IconButton, Tooltip } from '@mui/material';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import { useTranslation } from 'react-i18next';
import LanguageSelector from '../Language/LanguageSelector';
import ThemeSelector from '../Theme/ThemeSelector';

type NotAuthenticatedFooterProps = {
  showCoreSetup: boolean;
  onOpenCoreSetup: () => void;
};

export function NotAuthenticatedFooter({
  showCoreSetup,
  onOpenCoreSetup,
}: NotAuthenticatedFooterProps) {
  const { t } = useTranslation(['core']);
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: 0.35,
        justifyContent: 'flex-end',
        opacity: 0.62,
        pointerEvents: 'auto',
        position: 'absolute',
        right: '12px',
        bottom: '10px',
        width: 'auto',
        zIndex: 2000,
      }}
    >
      {showCoreSetup && (
        <Box>
          <Tooltip title={t('core:aria.core_controls')}>
            <IconButton onClick={onOpenCoreSetup}>
              <SettingsRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}
      <ThemeSelector footer />
      <Box>
        <LanguageSelector />
      </Box>
    </Box>
  );
}
