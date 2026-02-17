import { Box, IconButton } from '@mui/material';
import HubIcon from '@mui/icons-material/Hub';
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
  return (
    <Box
      sx={{
        alignItems: 'flex-start',
        bottom: '1%',
        display: 'flex',
        flexDirection: 'column',
        left: '3px',
        position: 'absolute',
        width: 'auto',
      }}
    >
      {showCoreSetup && (
        <Box sx={{ alignSelf: 'center' }}>
          <IconButton onClick={onOpenCoreSetup}>
            <HubIcon />
          </IconButton>
        </Box>
      )}
      <Box sx={{ alignSelf: 'left' }}>
        <LanguageSelector />
      </Box>
      <Box sx={{ alignSelf: 'center' }}>
        <ThemeSelector />
      </Box>
    </Box>
  );
}
