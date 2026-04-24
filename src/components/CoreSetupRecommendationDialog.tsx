import { useState } from 'react';
import {
  Box,
  ButtonBase,
  Dialog,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import RocketLaunchRoundedIcon from '@mui/icons-material/RocketLaunchRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import CloudRoundedIcon from '@mui/icons-material/CloudRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded';
import { useAuth } from '../hooks/useAuth';

interface CoreSetupRecommendationDialogProps {
  open: boolean;
  onClose: () => void;
  openLocalSetup: () => void;
  setOpenCoreHandler: (val: boolean) => void;
}

const isElectron = !!window?.coreSetup;

export function CoreSetupRecommendationDialog({
  open,
  onClose,
  setOpenCoreHandler,
}: CoreSetupRecommendationDialogProps) {
  const theme = useTheme();
  const { handleSaveNodeInfo, authenticate } = useAuth();
  const [showWhyLocal, setShowWhyLocal] = useState(false);

  const proceedWithPublic = async () => {
    try {
      await handleSaveNodeInfo(null);
      await authenticate(true);
    } catch (error) {
      console.error(error);
    } finally {
      onClose();
    }
  };

  const startCore = () => {
    if (isElectron) {
      setOpenCoreHandler(true);
    } else {
      window.open('https://qortal.dev/downloads', '_system');
    }
    onClose();
  };

  const downloadCore = () => {
    window.open('https://qortal.dev/downloads', '_system');
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{
        paper: {
          sx: {
            background: '#0d1117',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '10px',
            boxShadow: '0 24px 50px rgba(0,0,0,0.32)',
            maxWidth: '430px',
          },
        },
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          px: 2.4,
          py: 1.8,
        }}
      >
        <Box sx={{ width: 32 }} />
        <Typography
          sx={{
            color: '#F5A45A',
            flex: 1,
            fontSize: '1.16rem',
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          Local node not detected
        </Typography>
        <IconButton onClick={onClose} sx={{ color: theme.palette.text.secondary }}>
          <CloseRoundedIcon />
        </IconButton>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, px: 2.4, pb: 2.4 }}>
        <Typography
          sx={{
            color: 'rgba(214,221,233,0.62)',
            fontSize: '0.92rem',
            lineHeight: 1.65,
            textAlign: 'center',
          }}
        >
          Qortal Core is not running. Start it, install it, or continue using a
          public node.
        </Typography>

        <ActionRow
          body="Use this if Core is already installed"
          icon={<RocketLaunchRoundedIcon sx={{ fontSize: 22 }} />}
          onClick={startCore}
          theme={theme}
          title="Start Core"
        />
        <ActionRow
          body="Install Qortal Core from qortal.dev"
          icon={<DownloadRoundedIcon sx={{ fontSize: 22 }} />}
          onClick={downloadCore}
          theme={theme}
          title="Download Core"
        />
        <ActionRow
          body="Continue with limited decentralization"
          icon={<CloudRoundedIcon sx={{ fontSize: 22 }} />}
          onClick={proceedWithPublic}
          theme={theme}
          title="Use Public Node"
        />

        <Box
          sx={{
            borderTop: '1px solid rgba(255,255,255,0.06)',
            mt: 0.8,
            pt: 1.2,
          }}
        >
          <ButtonBase
            onClick={() => setShowWhyLocal((prev) => !prev)}
            sx={{
              alignItems: 'center',
              color: 'rgba(214,221,233,0.62)',
              display: 'flex',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <Typography sx={{ fontSize: '0.86rem', fontWeight: 700 }}>
              Why use a local node?
            </Typography>
            {showWhyLocal ? <ExpandLessRoundedIcon /> : <ExpandMoreRoundedIcon />}
          </ButtonBase>

          {showWhyLocal && (
            <Box sx={{ display: 'grid', gap: 0.8, mt: 1.1 }}>
              <Typography sx={reasonPointSx}>
                Full decentralized access
              </Typography>
              <Typography sx={reasonPointSx}>Faster downloads</Typography>
              <Typography sx={reasonPointSx}>User-controlled data</Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}

const ActionRow = ({ icon, title, body, onClick, theme }) => (
  <ButtonBase
    onClick={onClick}
    sx={{
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '8px',
      display: 'grid',
      gap: 1.1,
      gridTemplateColumns: '26px minmax(0,1fr)',
      minHeight: 72,
      px: 1.3,
      py: 1.1,
      textAlign: 'left',
      transition: 'background-color 160ms ease, border-color 160ms ease',
      '&:hover': {
        backgroundColor: 'rgba(255,255,255,0.035)',
        borderColor: 'rgba(255,255,255,0.12)',
      },
    }}
  >
    <Box sx={{ color: theme.palette.text.secondary }}>{icon}</Box>
    <Box>
      <Typography sx={{ fontSize: '0.96rem', fontWeight: 700 }}>{title}</Typography>
      <Typography
        sx={{
          color: 'rgba(214,221,233,0.56)',
          fontSize: '0.82rem',
          lineHeight: 1.5,
          mt: 0.2,
        }}
      >
        {body}
      </Typography>
    </Box>
  </ButtonBase>
);

const reasonPointSx = {
  color: 'rgba(214,221,233,0.62)',
  fontSize: '0.84rem',
  lineHeight: 1.55,
};
