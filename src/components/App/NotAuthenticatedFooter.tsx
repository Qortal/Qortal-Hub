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
        alignItems: 'center',
        display: 'flex',
        gap: 0.35,
        justifyContent: 'flex-end',
        opacity: 0.62,
        position: 'absolute',
        right: '12px',
        bottom: '10px',
        width: 'auto',
      }}
    >
      {showCoreSetup && (
        <Box>
          <IconButton onClick={onOpenCoreSetup}>
            <HubIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      )}
      <Box>
        <LanguageSelector />
      </Box>
      <Box>
        <ThemeSelector />
      </Box>
    </Box>
  );
}
