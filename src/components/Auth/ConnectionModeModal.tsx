import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  ButtonBase,
  Dialog,
  IconButton,
  Link,
  Typography,
  useTheme,
} from '@mui/material';
import ComputerRoundedIcon from '@mui/icons-material/ComputerRounded';
import CloudRoundedIcon from '@mui/icons-material/CloudRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { AuthButton, AuthInput } from './AuthShell';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  isOpenDialogCoreRecommendationAtom,
  selectedNodeInfoAtom,
} from '../../atoms/global';
import {
  getDefaultLocalNodeUrl,
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
} from '../../constants/constants';
import { useAuth } from '../../hooks/useAuth';

type ConnectionModeModalProps = {
  open: boolean;
  onClose: () => void;
};

type ConnectionMode = 'local' | 'public';

function isManualNode(url?: string | null) {
  if (!url) return false;
  return !isLocalNodeUrl(url) && url !== HTTPS_EXT_NODE_QORTAL_LINK;
}

export function ConnectionModeModal({
  open,
  onClose,
}: ConnectionModeModalProps) {
  const theme = useTheme();
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const setOpenRecommendation = useSetAtom(isOpenDialogCoreRecommendationAtom);
  const { handleSaveNodeInfo } = useAuth();
  const [selectedMode, setSelectedMode] = useState<ConnectionMode>('local');
  const [showManual, setShowManual] = useState(false);
  const [localCoreStatus, setLocalCoreStatus] = useState<
    'checking' | 'running' | 'missing'
  >('checking');
  const [manualNodeUrl, setManualNodeUrl] = useState('');
  const [manualApiKey, setManualApiKey] = useState('');

  useEffect(() => {
    if (!open) return;
    if (selectedNode?.url === HTTPS_EXT_NODE_QORTAL_LINK) {
      setSelectedMode('public');
    } else {
      setSelectedMode('local');
    }
    if (isManualNode(selectedNode?.url)) {
      setManualNodeUrl(selectedNode?.url || '');
      setManualApiKey(selectedNode?.apikey || '');
    }
  }, [open, selectedNode]);

  useEffect(() => {
    if (!open) return;
    let canceled = false;

    const detectLocal = async () => {
      setLocalCoreStatus('checking');
      try {
        if (window?.coreSetup?.isCoreRunning) {
          const running = await window.coreSetup.isCoreRunning();
          if (!canceled) {
            setLocalCoreStatus(running ? 'running' : 'missing');
          }
          return;
        }

        const response = await fetch(`${getDefaultLocalNodeUrl()}/admin/status`);
        if (!canceled) {
          setLocalCoreStatus(response.ok ? 'running' : 'missing');
        }
      } catch (error) {
        if (!canceled) {
          setLocalCoreStatus('missing');
        }
      }
    };

    detectLocal();

    return () => {
      canceled = true;
    };
  }, [open]);

  const localStatusLabel = useMemo(() => {
    if (localCoreStatus === 'running') return 'Core running';
    if (localCoreStatus === 'missing') return 'Core not detected';
    return 'Checking local node';
  }, [localCoreStatus]);

  const localStatusColor = useMemo(() => {
    if (localCoreStatus === 'running') return theme.palette.other.positive;
    if (localCoreStatus === 'missing') return theme.palette.other.warning;
    return theme.palette.text.secondary;
  }, [localCoreStatus, theme.palette.other.positive, theme.palette.other.warning, theme.palette.text.secondary]);

  const saveMode = async () => {
    if (selectedMode === 'local') {
      if (localCoreStatus === 'missing') {
        onClose();
        setOpenRecommendation(true);
        return;
      }
      await handleSaveNodeInfo({
        url: getDefaultLocalNodeUrl(),
        apikey: '',
      });
    } else {
      await handleSaveNodeInfo({
        url: HTTPS_EXT_NODE_QORTAL_LINK,
        apikey: '',
      });
    }
    onClose();
  };

  const saveManualNode = async () => {
    const normalizedUrl = manualNodeUrl.trim().replace(/\/+$/, '');
    if (!normalizedUrl) return;
    const payload = {
      url: normalizedUrl,
      apikey: manualApiKey.trim(),
    };
    await handleSaveNodeInfo(payload);

    try {
      const existingNodes =
        (await window.sendMessage('getCustomNodesFromStorage')) || [];
      const filteredNodes = existingNodes.filter(
        (node) => node?.url !== normalizedUrl
      );
      filteredNodes.push(payload);
      await window.sendMessage('setCustomNodes', filteredNodes);
    } catch (error) {
      console.error(error);
    }

    setShowManual(false);
    onClose();
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              background: '#0d1117',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '10px',
              boxShadow: '0 24px 50px rgba(0,0,0,0.32)',
              maxWidth: '520px',
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
              fontSize: '1.12rem',
              fontWeight: 700,
              textAlign: 'center',
            }}
          >
            Connection Mode
          </Typography>
          <IconButton onClick={onClose} sx={{ color: theme.palette.text.secondary }}>
            <CloseRoundedIcon />
          </IconButton>
        </Box>

        <Box sx={{ px: 2.4, pb: 2.4 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <ButtonBase onClick={() => setSelectedMode('local')} sx={modeRowSx(selectedMode === 'local')}>
              <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.2 }}>
                <ComputerRoundedIcon sx={{ color: theme.palette.primary.main, fontSize: 22 }} />
                <Box sx={{ minWidth: 0, textAlign: 'left' }}>
                  <Typography sx={{ fontSize: '0.98rem', fontWeight: 700 }}>
                    Local Node
                  </Typography>
                  <Typography sx={modeCopySx}>
                    Recommended
                  </Typography>
                  <Typography sx={modeCopySx}>
                    Full decentralized access
                  </Typography>
                  <Typography sx={modeCopySx}>
                    Faster performance
                  </Typography>
                  <Typography sx={modeCopySx}>
                    Your data stays local
                  </Typography>
                </Box>
              </Box>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'inline-flex',
                  gap: 0.8,
                  ml: 1,
                }}
              >
                <Box
                  sx={{
                    backgroundColor: localStatusColor,
                    borderRadius: '999px',
                    height: 8,
                    width: 8,
                  }}
                />
                <Typography
                  sx={{
                    color: localStatusColor,
                    fontSize: '0.82rem',
                    fontWeight: 700,
                  }}
                >
                  {localStatusLabel}
                </Typography>
              </Box>
            </ButtonBase>

            <ButtonBase onClick={() => setSelectedMode('public')} sx={modeRowSx(selectedMode === 'public')}>
              <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.2 }}>
                <CloudRoundedIcon sx={{ color: '#9a7be8', fontSize: 22 }} />
                <Box sx={{ minWidth: 0, textAlign: 'left' }}>
                  <Typography sx={{ fontSize: '0.98rem', fontWeight: 700 }}>
                    Public Node
                  </Typography>
                  <Typography sx={modeCopySx}>
                    Quick access
                  </Typography>
                  <Typography sx={modeCopySx}>
                    Limited decentralization
                  </Typography>
                  <Typography sx={modeCopySx}>
                    Shared infrastructure
                  </Typography>
                </Box>
              </Box>
            </ButtonBase>
          </Box>

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              mt: 1.4,
            }}
          >
            <Link
              component="button"
              onClick={() => setShowManual(true)}
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.86rem',
                textDecoration: 'none',
                '&:hover': {
                  color: theme.palette.text.primary,
                },
              }}
            >
              Manual node setup
            </Link>
            <AuthButton onClick={saveMode} fullWidth={false}>
              Save settings
            </AuthButton>
          </Box>
        </Box>
      </Dialog>

      <Dialog
        open={showManual}
        onClose={() => setShowManual(false)}
        maxWidth="sm"
        fullWidth
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
          <IconButton
            onClick={() => setShowManual(false)}
            sx={{ color: theme.palette.text.secondary }}
          >
            <ArrowBackRoundedIcon />
          </IconButton>
          <Typography sx={{ flex: 1, fontSize: '1.06rem', fontWeight: 700, textAlign: 'center' }}>
            Manual node setup
          </Typography>
          <Box sx={{ width: 40 }} />
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.3, px: 2.4, pb: 2.4 }}>
          <Box>
            <Typography sx={fieldLabelSx}>Node URL</Typography>
            <AuthInput
              value={manualNodeUrl}
              onChange={(event) => setManualNodeUrl(event.target.value)}
              placeholder="https://127.0.0.1:12391"
            />
          </Box>
          <Box>
            <Typography sx={fieldLabelSx}>API key (optional)</Typography>
            <AuthInput
              value={manualApiKey}
              onChange={(event) => setManualApiKey(event.target.value)}
              placeholder="Enter API key"
            />
          </Box>

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              mt: 0.6,
            }}
          >
            <Link
              component="button"
              onClick={() => setShowManual(false)}
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '0.86rem',
                textDecoration: 'none',
              }}
            >
              Return
            </Link>
            <AuthButton
              disabled={!manualNodeUrl.trim()}
              onClick={saveManualNode}
              fullWidth={false}
            >
              Save
            </AuthButton>
          </Box>
        </Box>
      </Dialog>
    </>
  );
}

const modeRowSx = (active: boolean) => ({
  alignItems: 'center',
  backgroundColor: active ? 'rgba(255,255,255,0.03)' : 'transparent',
  borderLeft: active ? '2px solid rgba(92,145,255,0.9)' : '2px solid transparent',
  borderRadius: '8px',
  display: 'flex',
  justifyContent: 'space-between',
  minHeight: 98,
  padding: '14px 14px 14px 12px',
  textAlign: 'left',
  transition: 'background-color 160ms ease, border-color 160ms ease',
  width: '100%',
  '&:hover': {
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
});

const modeCopySx = {
  color: 'rgba(214,221,233,0.62)',
  fontSize: '0.82rem',
  lineHeight: 1.55,
};

const fieldLabelSx = {
  color: 'rgba(214,221,233,0.62)',
  fontSize: '0.74rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  mb: 0.75,
  textTransform: 'uppercase',
};
