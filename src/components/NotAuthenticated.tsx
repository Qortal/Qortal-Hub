import { Box, ButtonBase, Typography, useTheme } from '@mui/material';
import SettingsEthernetRoundedIcon from '@mui/icons-material/SettingsEthernetRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import Logo1Dark from '../assets/svgs/Logo1Dark.svg';
import { useAtomValue } from 'jotai';
import { selectedNodeInfoAtom } from '../atoms/global';
import { isLocalNodeUrl } from '../constants/constants';
import { Wallets } from './Wallets';
import { AuthButton, AuthFrame } from './Auth/AuthShell';
import { ConnectionModeModal } from './Auth/ConnectionModeModal';
import { useState } from 'react';

export const manifestData = {
  version: '1.0.0',
};

export const NotAuthenticated = ({
  setExtstate,
  setRawWallet,
  rawWallet,
}) => {
  const theme = useTheme();
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const [isConnectionModeOpen, setIsConnectionModeOpen] = useState(false);
  const usingLocalNode = isLocalNodeUrl(selectedNode?.url);
  const hasAccountsText = (
    <Wallets
      mode="entry"
      setExtState={setExtstate}
      setRawWallet={setRawWallet}
      rawWallet={rawWallet}
    />
  );

  return (
    <>
      <AuthFrame
        maxWidth={560}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            textAlign: 'center',
          }}
        >
          <Box
            component="img"
            alt="Qortal"
            src={Logo1Dark}
            sx={{
              display: 'block',
              filter: 'brightness(1.08) contrast(1.02)',
              height: { xs: 98, md: 110 },
              mb: 2.7,
              mt: { xs: -2, md: -4 },
              width: { xs: 98, md: 110 },
            }}
          />

          <Typography
            sx={{
              fontSize: { xs: '2rem', md: '2.3rem' },
              fontWeight: 700,
              letterSpacing: '-0.04em',
              lineHeight: 1.02,
            }}
          >
            Enter Qortal
          </Typography>

          <Typography
            sx={{
              color: 'rgba(214,221,233,0.58)',
              fontSize: '0.96rem',
              lineHeight: 1.65,
              mt: 1,
            }}
          >
            Access or create your account.
          </Typography>

          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1.2,
              mt: 5.4,
              textAlign: 'left',
              width: '100%',
            }}
          >
            {hasAccountsText}
          </Box>

          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.8,
              mt: 3.7,
              pt: 1.1,
              width: '100%',
            }}
          >
            <AuthButton onClick={() => setExtstate('create-wallet')}>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'inline-flex',
                  gap: 0.8,
                }}
              >
                <AddRoundedIcon sx={{ fontSize: 18 }} />
                <span>Create account</span>
              </Box>
            </AuthButton>

            <ButtonBase
              onClick={() => setExtstate('wallets')}
              sx={{
                alignItems: 'center',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '8px',
                color: theme.palette.text.primary,
                display: 'inline-flex',
                gap: 0.8,
                height: 42,
                justifyContent: 'center',
                transition: 'background-color 160ms ease, border-color 160ms ease',
                width: '100%',
                '&:hover': {
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  borderColor: 'rgba(255,255,255,0.12)',
                },
              }}
            >
              <DownloadRoundedIcon sx={{ fontSize: 18 }} />
              <Typography sx={{ fontSize: '0.92rem', fontWeight: 700 }}>
                Import account
              </Typography>
            </ButtonBase>
          </Box>

          <Box
            sx={{
              alignItems: 'center',
              color: 'rgba(214,221,233,0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 0.45,
              justifyContent: 'center',
              mt: 1.6,
            }}
          >
            <Box sx={{ alignItems: 'center', display: 'inline-flex', gap: 0.7 }}>
              <Box
                sx={{
                  backgroundColor: usingLocalNode
                    ? theme.palette.other.positive
                    : theme.palette.primary.main,
                  borderRadius: '999px',
                  height: 7,
                  width: 7,
                }}
              />
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 600 }}>
                {usingLocalNode ? 'Using local node' : 'Using public node'}
              </Typography>
            </Box>
            <ButtonBase
              onClick={() => setIsConnectionModeOpen(true)}
              sx={{
                alignItems: 'center',
                color: 'rgba(214,221,233,0.42)',
                display: 'inline-flex',
                gap: 0.4,
                minWidth: 0,
                p: 0,
                '&:hover': {
                  color: 'rgba(214,221,233,0.66)',
                },
              }}
            >
              <SettingsEthernetRoundedIcon sx={{ fontSize: 14 }} />
              <Typography sx={{ fontSize: '0.74rem', fontWeight: 600 }}>
                Connection Mode
              </Typography>
            </ButtonBase>
          </Box>
        </Box>
      </AuthFrame>

      <ConnectionModeModal
        open={isConnectionModeOpen}
        onClose={() => setIsConnectionModeOpen(false)}
      />
    </>
  );
};
