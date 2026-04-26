import { useState, type ReactNode } from 'react';
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
import CloudRoundedIcon from '@mui/icons-material/CloudRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { useAtom, useAtomValue } from 'jotai';
import {
  extStateAtom,
  isPublicNodeUnavailableAtom,
} from '../atoms/global';
import { HTTPS_EXT_NODE_QORTAL_LINK } from '../constants/constants';
import { useAuth } from '../hooks/useAuth';

interface CoreSetupRecommendationDialogProps {
  open: boolean;
  onClose: () => void;
  openLocalSetup: () => void;
}

const isElectron = !!window?.coreSetup;

export function CoreSetupRecommendationDialog({
  open,
  onClose,
  openLocalSetup,
}: CoreSetupRecommendationDialogProps) {
  const theme = useTheme();
  const { handleSaveNodeInfo, authenticate } = useAuth();
  const extState = useAtomValue(extStateAtom);
  const [publicUnavailable, setPublicUnavailable] = useAtom(
    isPublicNodeUnavailableAtom
  );
  const [showWhyLocal, setShowWhyLocal] = useState(false);

  const isPublicNodeReachable = async () => {
    try {
      const response = await fetch(`${HTTPS_EXT_NODE_QORTAL_LINK}/admin/status`);
      return response.ok;
    } catch (error) {
      return false;
    }
  };

  const proceedWithPublic = async () => {
    if (!(await isPublicNodeReachable())) {
      setPublicUnavailable(true);
      return;
    }

    try {
      setPublicUnavailable(false);
      await handleSaveNodeInfo({
        url: HTTPS_EXT_NODE_QORTAL_LINK,
        apikey: '',
      });

      if (extState !== 'authenticated') {
        await authenticate(true);
      }
    } catch (error) {
      console.error(error);
    } finally {
      onClose();
    }
  };

  const setUpCore = () => {
    if (isElectron) {
      setPublicUnavailable(false);
      openLocalSetup();
    } else {
      window.open('https://qortal.dev/downloads', '_system');
    }
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
            maxWidth: '460px',
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
            flex: 1,
            fontSize: '1.16rem',
            fontWeight: 800,
            textAlign: 'center',
          }}
        >
          Use Qortal with Core
        </Typography>
        <IconButton onClick={onClose} sx={{ color: theme.palette.text.secondary }}>
          <CloseRoundedIcon />
        </IconButton>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, px: 2.4, pb: 2.4 }}>
        <Typography
          sx={{
            color: 'rgba(214,221,233,0.64)',
            fontSize: '0.92rem',
            lineHeight: 1.65,
            textAlign: 'center',
          }}
        >
          Qortal works best with your local Core. You can enter Hub now through
          a temporary public node while Core installs, starts, and syncs in the
          background.
        </Typography>

        {publicUnavailable && (
          <Box
            sx={{
              alignItems: 'flex-start',
              backgroundColor: 'rgba(216,186,138,0.08)',
              border: '1px solid rgba(216,186,138,0.18)',
              borderRadius: '8px',
              display: 'flex',
              gap: 1,
              p: 1.15,
            }}
          >
            <WarningAmberRoundedIcon sx={{ color: '#D8BA8A', fontSize: 20, mt: 0.15 }} />
            <Typography sx={{ color: 'rgba(239,228,202,0.9)', fontSize: '0.82rem', lineHeight: 1.55 }}>
              The public Qortal node is currently unavailable. Set up or start
              your local Core and wait here until it is ready.
            </Typography>
          </Box>
        )}

        <ActionRow
          body="Use public node while Core catches up"
          icon={<CloudRoundedIcon sx={{ fontSize: 22 }} />}
          onClick={proceedWithPublic}
          primary
          theme={theme}
          title="Enter Hub"
        />
        <ActionRow
          body="Install, start, or repair local Core"
          icon={<RocketLaunchRoundedIcon sx={{ fontSize: 22 }} />}
          onClick={setUpCore}
          theme={theme}
          title="Set Up Core"
        />
        <ButtonBase
          onClick={onClose}
          sx={{
            color: 'rgba(214,221,233,0.54)',
            fontSize: '0.84rem',
            fontWeight: 700,
            minHeight: 30,
            '&:hover': { color: theme.palette.text.primary },
          }}
        >
          Stay here
        </ButtonBase>

        <Box
          sx={{
            borderTop: '1px solid rgba(255,255,255,0.06)',
            mt: 0.6,
            pt: 1.1,
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
            <Box sx={{ display: 'grid', gap: 0.75, mt: 1 }}>
              <Typography sx={reasonPointSx}>Full decentralized access</Typography>
              <Typography sx={reasonPointSx}>Better connectivity and downloads</Typography>
              <Typography sx={reasonPointSx}>Your data stays under your control</Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}

type ActionRowProps = {
  body: string;
  icon: ReactNode;
  onClick: () => void;
  primary?: boolean;
  theme: ReturnType<typeof useTheme>;
  title: string;
};

const ActionRow = ({
  icon,
  title,
  body,
  onClick,
  primary = false,
  theme,
}: ActionRowProps) => (
  <ButtonBase
    onClick={onClick}
    sx={{
      alignItems: 'center',
      backgroundColor: primary
        ? 'rgba(91,132,201,0.22)'
        : 'rgba(255,255,255,0.02)',
      border: `1px solid ${
        primary ? 'rgba(118,165,255,0.3)' : 'rgba(255,255,255,0.08)'
      }`,
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
        backgroundColor: primary
          ? 'rgba(91,132,201,0.3)'
          : 'rgba(255,255,255,0.035)',
        borderColor: primary
          ? 'rgba(150,184,230,0.42)'
          : 'rgba(255,255,255,0.12)',
      },
    }}
  >
    <Box sx={{ color: primary ? '#9fc0ff' : theme.palette.text.secondary }}>
      {icon}
    </Box>
    <Box>
      <Typography sx={{ fontSize: '0.96rem', fontWeight: 800 }}>
        {title}
      </Typography>
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
