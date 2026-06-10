import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  alpha,
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Select,
  Stack,
  styled,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  useTheme,
} from '@mui/material';
import AppBar from '@mui/material/AppBar';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useAtom } from 'jotai';
import { ChangeEvent, Fragment, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import {
  enabledDevModeAtom,
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
} from '../../atoms/global';
import { walletVersion } from '../../background/background.ts';
import { TransitionUp } from '../../common/Transitions.tsx';
import Base58 from '../../encryption/Base58.ts';
import { decryptStoredWallet } from '../../utils/decryptWallet';
import { executeEvent } from '../../utils/events';
import PhraseWallet from '../../utils/generateWallet/phrase-wallet';
import ThemeManager from '../Theme/ThemeManager';
import { isDisabledLegacy } from '../../constants/featureFlags';

export const LocalNodeSwitch = styled(Switch)(({ theme }) => ({
  padding: 8,
  '& .MuiSwitch-track': {
    borderRadius: 22 / 2,
    '&::before, &::after': {
      content: '""',
      position: 'absolute',
      top: '50%',
      transform: 'translateY(-50%)',
      width: 16,
      height: 16,
    },
    '&::before': {
      backgroundImage: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24"><path fill="${encodeURIComponent(
        theme.palette.getContrastText(theme.palette.primary.main)
      )}" d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/></svg>')`,
      left: 12,
    },
    '&::after': {
      backgroundImage: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" height="16" width="16" viewBox="0 0 24 24"><path fill="${encodeURIComponent(
        theme.palette.getContrastText(theme.palette.primary.main)
      )}" d="M19,13H5V11H19V13Z" /></svg>')`,
      right: 12,
    },
  },
  '& .MuiSwitch-thumb': {
    boxShadow: 'none',
    width: 16,
    height: 16,
    margin: 2,
  },
}));

type CloseAction = 'ask' | 'minimizeToTray' | 'quit';
type ReticulumStatus = {
  running: boolean;
  pid?: number;
  mode: 'frozen' | 'venv' | 'system' | null;
  configDir: string;
  reason?: string;
  bridgeState?: 'stopped' | 'starting' | 'ready' | 'degraded';
  reachability: 'unknown' | 'lan-only' | 'hub-connected' | 'disconnected';
  transportEnabled?: boolean;
  configuredHubInterfaces?: number;
  onlineHubInterfaces?: number;
  configuredRemoteHubInterfaces?: number;
  onlineRemoteHubInterfaces?: number;
  hubSummary?: string;
  overlayLinksConnected?: number;
  p2pOutboundOverlayPeers?: number;
  p2pInboundOverlayPeers?: number;
};

type ReticulumOverlayPeerStatus = {
  linkId: string;
  peerPresenceHash: string;
  incoming?: boolean;
  address?: string;
  connectedAt: number;
};

type ReticulumMeshSettingsStatus = {
  enabled: boolean;
  listenPort: number;
  meshListenEnabled: boolean;
  upnpMapped: boolean;
  reachableSelf: boolean;
  meshDiscoveryClient: boolean;
  meshPrivateGateway: boolean;
  networkIdentityPath: string;
  discoveryReachableHost?: string;
  meshReachableOnHost?: string;
  meshReachableOnEffective: string | null;
};

function formatReticulumReachability(status: ReticulumStatus | null): string {
  switch (status?.reachability) {
    case 'hub-connected':
      return 'Hub connected';
    case 'lan-only':
      return 'LAN only';
    case 'disconnected':
      return 'Hub disconnected';
    default:
      if (status?.bridgeState === 'ready') return 'Bridge ready';
      return 'Detecting reachability';
  }
}

function formatReticulumMode(status: ReticulumStatus | null): string {
  if (status?.mode === 'frozen') return 'Bundled binary';
  if (status?.mode === 'venv') return 'Bundled Python venv';
  if (status?.mode === 'system') return 'System Python (dev)';
  return 'Unavailable';
}

function formatElapsedDuration(connectedAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - connectedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

export const Settings = ({ open, setOpen, rawWallet }) => {
  const [checked, setChecked] = useState(false);
  const [isEnabledDevMode, setIsEnabledDevMode] = useAtom(enabledDevModeAtom);
  const [closeAction, setCloseAction] = useState<CloseAction>('ask');
  const [reticulumManagedConfigEnabled, setReticulumManagedConfigEnabled] =
    useState(true);
  const [platform, setPlatform] = useState<string>('');
  const [reticulumStatus, setReticulumStatus] =
    useState<ReticulumStatus | null>(null);
  const [reticulumLocalDestinationHash, setReticulumLocalDestinationHash] =
    useState<string | null>(null);
  const [reticulumOverlayPeers, setReticulumOverlayPeers] = useState<
    ReticulumOverlayPeerStatus[]
  >([]);
  const [reticulumMeshStatus, setReticulumMeshStatus] =
    useState<ReticulumMeshSettingsStatus | null>(null);
  const [overlayDurationNow, setOverlayDurationNow] = useState(() =>
    Date.now()
  );
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const setInfoSnackCustom = useSetAtom(infoSnackGlobalAtom);
  const [meshIdentityBusy, setMeshIdentityBusy] = useState(false);
  const [isPrivateKeyPasswordEditable, setIsPrivateKeyPasswordEditable] =
    useState(false);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setChecked(event.target.checked);
    window
      .sendMessage('addUserSettings', {
        keyValue: {
          key: 'disable-push-notifications',
          value: event.target.checked,
        },
      })
      .then((response) => {
        if (response?.error) {
          console.error('Error adding user settings:', response.error);
        }
      })
      .catch((error) => {
        console.error(
          'Failed to add user settings:',
          error.message || 'An error occurred'
        );
      });
  };

  const handleClose = () => {
    setOpen(false);
  };

  const getUserSettings = useCallback(async () => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getUserSettings', {
            key: 'disable-push-notifications',
          })
          .then((response) => {
            if (!response?.error) {
              setChecked(response || false);
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
    } catch (error) {
      console.log('error', error);
    }
  }, [setChecked]);

  useEffect(() => {
    getUserSettings();
  }, [getUserSettings]);

  const loadAppSettings = useCallback(async () => {
    if (typeof window.electronAPI?.getAppSettings !== 'function') return;
    const settings = await window.electronAPI.getAppSettings();
    if (settings?.closeAction) setCloseAction(settings.closeAction);
    setReticulumManagedConfigEnabled(
      settings?.reticulumManagedConfigEnabled === false ? false : true
    );
    if (typeof window.electronAPI?.getPlatform === 'function') {
      const p = await window.electronAPI.getPlatform();
      setPlatform(p || '');
    }
  }, []);

  useEffect(() => {
    if (window?.electronAPI) loadAppSettings();
  }, [loadAppSettings]);

  const loadReticulumStatus = useCallback(async () => {
    if (typeof window.electronAPI?.reticulumGetStatus === 'function') {
      try {
        const status = await window.electronAPI.reticulumGetStatus();
        setReticulumStatus(status);
      } catch (error) {
        setReticulumStatus({
          running: false,
          mode: null,
          configDir: '',
          reachability: 'unknown',
          reason:
            error instanceof Error ? error.message : 'Unable to read status',
        });
      }
    }
    if (typeof window.electronAPI?.reticulumGetOverlayPeers === 'function') {
      try {
        const peers = await window.electronAPI.reticulumGetOverlayPeers();
        setReticulumOverlayPeers(peers);
      } catch {
        setReticulumOverlayPeers([]);
      }
    }
    if (typeof window.electronAPI?.reticulumGetMeshStatus === 'function') {
      try {
        const mesh = await window.electronAPI.reticulumGetMeshStatus();
        setReticulumMeshStatus(mesh);
      } catch {
        setReticulumMeshStatus(null);
      }
    }
    if (
      typeof window.electronAPI?.reticulumGetLocalDestinationHash === 'function'
    ) {
      try {
        const result =
          await window.electronAPI.reticulumGetLocalDestinationHash();
        setReticulumLocalDestinationHash(result?.destinationHash ?? null);
      } catch {
        setReticulumLocalDestinationHash(null);
      }
    }
  }, []);

  const handleEnsureMeshNetworkIdentity = useCallback(async () => {
    if (
      typeof window.electronAPI?.reticulumEnsureMeshNetworkIdentity !==
      'function'
    ) {
      return;
    }
    setMeshIdentityBusy(true);
    try {
      const r = await window.electronAPI.reticulumEnsureMeshNetworkIdentity();
      if (r.ok) {
        setInfoSnackCustom({
          type: 'success',
          message: r.created
            ? 'Community mesh identity installed from the app bundle. Reticulum will restart if needed.'
            : 'Community mesh identity already installed.',
        });
        setOpenSnackGlobal(true);
        void loadReticulumStatus();
      } else {
        setInfoSnackCustom({
          type: 'error',
          message: r.error ?? 'Could not install community mesh identity.',
        });
        setOpenSnackGlobal(true);
      }
    } catch (e) {
      setInfoSnackCustom({
        type: 'error',
        message:
          e instanceof Error ? e.message : 'Mesh network identity failed.',
      });
      setOpenSnackGlobal(true);
    } finally {
      setMeshIdentityBusy(false);
    }
  }, [loadReticulumStatus, setInfoSnackCustom, setOpenSnackGlobal]);

  useEffect(() => {
    if (!open) return;
    if (
      typeof window.electronAPI?.reticulumGetStatus !== 'function' &&
      typeof window.electronAPI?.reticulumGetMeshStatus !== 'function'
    ) {
      return;
    }
    void loadReticulumStatus();
    const timer = window.setInterval(() => {
      void loadReticulumStatus();
    }, 3000);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadReticulumStatus, open]);

  useEffect(() => {
    if (!open || reticulumOverlayPeers.length === 0) return;
    setOverlayDurationNow(Date.now());
    const timer = window.setInterval(() => {
      setOverlayDurationNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [open, reticulumOverlayPeers.length]);

  const handleCloseActionChange = useCallback(async (value: CloseAction) => {
    setCloseAction(value);
    if (typeof window.electronAPI?.setAppSettings === 'function') {
      await window.electronAPI.setAppSettings({ closeAction: value });
    }
  }, []);

  const handleReticulumManagedConfigChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const enabled = event.target.checked;
      const previous = reticulumManagedConfigEnabled;
      setReticulumManagedConfigEnabled(enabled);
      try {
        if (typeof window.electronAPI?.setAppSettings === 'function') {
          await window.electronAPI.setAppSettings({
            reticulumManagedConfigEnabled: enabled,
          });
        }
      } catch {
        setReticulumManagedConfigEnabled(previous);
        setInfoSnackCustom({
          type: 'error',
          message: 'Could not update Reticulum config setting.',
        });
        setOpenSnackGlobal(true);
      }
    },
    [
      reticulumManagedConfigEnabled,
      setInfoSnackCustom,
      setOpenSnackGlobal,
    ]
  );

  return (
    <Fragment>
      <Dialog
        fullScreen
        open={open}
        onClose={handleClose}
        slots={{
          transition: TransitionUp,
        }}
      >
        <AppBar sx={{ position: 'relative' }}>
          <Toolbar>
            <Typography sx={{ ml: 2, flex: 1 }} variant="h4" component="div">
              {t('core:general_settings', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>

            <IconButton
              color="inherit"
              edge="start"
              onClick={handleClose}
              aria-label={t('core:action.close', {
                postProcess: 'capitalizeFirstChar',
              })}
              sx={{
                bgcolor: theme.palette.background.default,
                color: theme.palette.text.primary,
              }}
            >
              <CloseIcon />
            </IconButton>
          </Toolbar>
        </AppBar>

        <Box
          sx={{
            bgcolor: theme.palette.background.default,
            color: theme.palette.text.primary,
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            overflowY: 'auto',
            p: 2,
          }}
        >
          <Box sx={{ maxWidth: 760, mx: 'auto', py: 3, px: 1, width: '100%' }}>
            {/* Notifications */}
            <Box
              sx={{
                borderRadius: 2,
                overflow: 'hidden',
                border: 1,
                borderColor: alpha(theme.palette.divider, 0.4),
                bgcolor: alpha(theme.palette.background.default, 0.5),
                mb: 3,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  px: 2,
                  py: 1.25,
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  {t('group:action.disable_push_notifications', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
                <LocalNodeSwitch checked={checked} onChange={handleChange} />
              </Box>
            </Box>

            {/* Electron-only app settings */}
            {window?.electronAPI && (
              <Box
                sx={{
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: 1,
                  borderColor: alpha(theme.palette.divider, 0.4),
                  bgcolor: alpha(theme.palette.background.default, 0.5),
                  mb: 3,
                }}
              >
                <Box
                  sx={{
                    px: 2,
                    py: 1,
                    borderBottom: 1,
                    borderColor: 'divider',
                    bgcolor: alpha(theme.palette.background.paper, 0.25),
                  }}
                >
                  <Typography
                    variant="overline"
                    color="text.secondary"
                    sx={{ letterSpacing: 0, fontWeight: 700 }}
                  >
                    System
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    px: 2,
                    py: 1.25,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {t('core:action.enable_dev_mode', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <LocalNodeSwitch
                    checked={isEnabledDevMode}
                    onChange={(e) => {
                      setIsEnabledDevMode(e.target.checked);
                      localStorage.setItem(
                        'isEnabledDevMode',
                        JSON.stringify(e.target.checked)
                      );
                    }}
                  />
                </Box>
                {!isDisabledLegacy && (
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      px: 2,
                      py: 1.25,
                      borderBottom: 1,
                      borderColor: 'divider',
                    }}
                  >
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        Enable Hub P2P networking
                      </Typography>
                      <Typography variant="caption" color="text.disabled">
                        Allows presence, peer discovery and direct messaging.
                      </Typography>
                    </Box>
                  </Box>
                )}
                <Box
                  sx={{
                    px: 2,
                    py: 1,
                    borderBottom: 1,
                    borderColor: 'divider',
                    bgcolor: alpha(theme.palette.background.paper, 0.18),
                  }}
                >
                  <Typography
                    variant="overline"
                    color="text.secondary"
                    sx={{ letterSpacing: 0, fontWeight: 700 }}
                  >
                    Reticulum
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 2,
                    px: 2,
                    py: 1.25,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Box>
                    <Typography variant="body2" color="text.secondary">
                      Managed Reticulum config
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                      Allow Qortal Hub to write its managed rnsd config on
                      startup.
                    </Typography>
                  </Box>
                  <LocalNodeSwitch
                    checked={reticulumManagedConfigEnabled}
                    onChange={handleReticulumManagedConfigChange}
                  />
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: 1,
                    px: 2,
                    py: 1.25,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 2,
                      width: '100%',
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      Reticulum daemon
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        flexShrink: 0,
                        color:
                          reticulumStatus?.reachability === 'hub-connected'
                            ? theme.palette.success.main
                            : reticulumStatus?.running
                              ? theme.palette.warning.main
                              : theme.palette.warning.main,
                        fontWeight: 600,
                        textAlign: 'right',
                      }}
                    >
                      {formatReticulumReachability(reticulumStatus)}
                    </Typography>
                  </Box>
                  <Typography
                    variant="caption"
                    component="div"
                    color="text.disabled"
                    sx={{
                      wordBreak: 'break-word',
                      overflowWrap: 'anywhere',
                      lineHeight: 1.5,
                    }}
                  >
                    {reticulumStatus?.running
                      ? `Config: ${reticulumStatus.configDir}`
                      : reticulumStatus?.reason || 'Not started'}
                  </Typography>
                  {reticulumStatus?.hubSummary ? (
                    <Typography
                      variant="caption"
                      component="div"
                      color="text.disabled"
                      sx={{
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
                        lineHeight: 1.5,
                      }}
                    >
                      {reticulumStatus.hubSummary}
                    </Typography>
                  ) : null}
                  <Typography
                    variant="caption"
                    component="div"
                    color="text.disabled"
                    sx={{ lineHeight: 1.6 }}
                  >
                    {reticulumStatus?.running ? 'Running' : 'Not running'}
                    {reticulumStatus?.bridgeState
                      ? ` · Bridge ${reticulumStatus.bridgeState}`
                      : ''}
                    {' · '}
                    {formatReticulumMode(reticulumStatus)}
                    {typeof reticulumStatus?.onlineHubInterfaces === 'number' &&
                    typeof reticulumStatus?.configuredHubInterfaces === 'number'
                      ? ` · Hubs ${reticulumStatus.onlineHubInterfaces}/${reticulumStatus.configuredHubInterfaces}`
                      : ''}
                    {typeof reticulumStatus?.onlineRemoteHubInterfaces ===
                      'number' &&
                    typeof reticulumStatus?.configuredRemoteHubInterfaces ===
                      'number'
                      ? ` · Remote hubs ${reticulumStatus.onlineRemoteHubInterfaces}/${reticulumStatus.configuredRemoteHubInterfaces}`
                      : ''}
                    {typeof reticulumStatus?.transportEnabled === 'boolean'
                      ? ` · Transport ${reticulumStatus.transportEnabled ? 'on' : 'off'}`
                      : ''}
                    {typeof reticulumStatus?.overlayLinksConnected === 'number'
                      ? ` · Overlay links ${reticulumStatus.overlayLinksConnected}`
                      : ''}
                    {typeof reticulumStatus?.p2pOutboundOverlayPeers ===
                      'number' ||
                    typeof reticulumStatus?.p2pInboundOverlayPeers === 'number'
                      ? ` · Overlay out/in ${reticulumStatus.p2pOutboundOverlayPeers ?? 0}/${reticulumStatus.p2pInboundOverlayPeers ?? 0}`
                      : ''}
                    {reticulumStatus?.pid
                      ? ` · PID ${reticulumStatus.pid}`
                      : ''}
                  </Typography>
                  <Typography
                    variant="caption"
                    component="div"
                    color="text.disabled"
                    sx={{
                      mt: 0.5,
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                    }}
                  >
                    Destination hash:{' '}
                    {reticulumLocalDestinationHash ?? 'Unavailable'}
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    <Typography
                      variant="caption"
                      component="div"
                      color="text.disabled"
                    >
                      Overlay peers
                    </Typography>
                    {reticulumOverlayPeers.length === 0 ? (
                      <Typography
                        variant="caption"
                        component="div"
                        color="text.disabled"
                        sx={{ mt: 0.5 }}
                      >
                        No active overlay peers connected.
                      </Typography>
                    ) : (
                      <TableContainer
                        sx={{
                          mt: 0.75,
                          border: 1,
                          borderColor: alpha(theme.palette.divider, 0.4),
                          borderRadius: 1.5,
                          overflowX: 'auto',
                        }}
                      >
                        <Table size="small" aria-label="overlay peers table">
                          <TableHead>
                            <TableRow>
                              <TableCell>Peer hash</TableCell>
                              <TableCell>Address</TableCell>
                              <TableCell>Initiated by</TableCell>
                              <TableCell align="right">Connected</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {reticulumOverlayPeers.map((peer) => (
                              <TableRow key={peer.linkId}>
                                <TableCell
                                  sx={{
                                    fontFamily: 'monospace',
                                    fontSize: '0.75rem',
                                    wordBreak: 'break-all',
                                  }}
                                >
                                  {peer.peerPresenceHash}
                                </TableCell>
                                <TableCell
                                  sx={{
                                    fontFamily: peer.address
                                      ? 'inherit'
                                      : 'monospace',
                                    fontSize: '0.75rem',
                                    wordBreak: 'break-all',
                                  }}
                                >
                                  {peer.address || 'Unknown'}
                                </TableCell>
                                <TableCell sx={{ fontSize: '0.75rem' }}>
                                  {peer.incoming === true
                                    ? 'Remote'
                                    : peer.incoming === false
                                      ? 'Local'
                                      : '—'}
                                </TableCell>
                                <TableCell
                                  align="right"
                                  sx={{
                                    whiteSpace: 'nowrap',
                                    fontSize: '0.75rem',
                                  }}
                                >
                                  {formatElapsedDuration(
                                    peer.connectedAt,
                                    overlayDurationNow
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </Box>
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'stretch',
                    gap: 1,
                    px: 2,
                    py: 1.25,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    Reticulum hub mesh (direct TCP)
                  </Typography>
                  {reticulumMeshStatus == null ? (
                    <Typography variant="caption" color="text.disabled">
                      Mesh status unavailable.
                    </Typography>
                  ) : !reticulumMeshStatus.enabled ? (
                    <Typography variant="caption" color="text.disabled">
                      Not available on secondary app instances.
                    </Typography>
                  ) : (
                    <>
                      <Typography
                        variant="caption"
                        component="div"
                        color="text.disabled"
                        sx={{ lineHeight: 1.6 }}
                      >
                        Listen port {reticulumMeshStatus.listenPort}
                        {reticulumMeshStatus.meshListenEnabled
                          ? ' · listen enabled'
                          : ' · listen disabled'}
                        {reticulumMeshStatus.upnpMapped ? ' · UPnP mapped' : ''}
                        {reticulumMeshStatus.meshDiscoveryClient
                          ? ' · RNS interface discovery + autoconnect (LXMF included with the Hub Reticulum runtime; see Reticulum manual)'
                          : ''}
                        {reticulumMeshStatus.meshPrivateGateway
                          ? ' · encrypted private gateway on mesh listen'
                          : ''}
                      </Typography>
                      {reticulumMeshStatus.meshPrivateGateway &&
                        reticulumMeshStatus.meshReachableOnEffective != null &&
                        reticulumMeshStatus.meshReachableOnEffective !== '' && (
                          <Typography
                            variant="caption"
                            component="div"
                            color="text.disabled"
                            sx={{ lineHeight: 1.5, mt: 0.25 }}
                          >
                            Discovery reachable_on:{' '}
                            {reticulumMeshStatus.meshReachableOnEffective}
                            {reticulumMeshStatus.meshReachableOnHost?.trim()
                              ? ' (manual)'
                              : reticulumMeshStatus.discoveryReachableHost
                                ? ' (UPnP)'
                                : ''}
                          </Typography>
                        )}
                      <Typography
                        variant="caption"
                        component="div"
                        color="text.disabled"
                        sx={{ lineHeight: 1.5, mt: 0.5 }}
                      >
                        Bootstrap hubs use the managed TCP client entries in
                        Reticulum config. Community mesh peers are reached via
                        RNS discovery (not app-level gossip). The mesh network
                        identity used for encrypted discovery/private gateways
                        is installed automatically; file path:{' '}
                        <Box component="span" sx={{ wordBreak: 'break-all' }}>
                          {reticulumMeshStatus.networkIdentityPath}
                        </Box>
                      </Typography>
                      {reticulumMeshStatus.meshListenEnabled &&
                        !reticulumMeshStatus.meshPrivateGateway &&
                        typeof window.electronAPI
                          ?.reticulumEnsureMeshNetworkIdentity ===
                          'function' && (
                          <Box sx={{ mt: 1 }}>
                            <Button
                              size="small"
                              variant="outlined"
                              disabled={meshIdentityBusy}
                              onClick={() =>
                                void handleEnsureMeshNetworkIdentity()
                              }
                            >
                              {meshIdentityBusy
                                ? 'Installing…'
                                : 'Install community mesh identity'}
                            </Button>
                          </Box>
                        )}
                    </>
                  )}
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    px: 2,
                    py: 1.5,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {t('core:close_window_behavior', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <Select
                    size="small"
                    value={closeAction}
                    onChange={(e) =>
                      handleCloseActionChange(e.target.value as CloseAction)
                    }
                    sx={{ minWidth: 180, borderRadius: 2 }}
                  >
                    <MenuItem value="ask">
                      {t('core:close_always_ask', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </MenuItem>
                    <MenuItem value="minimizeToTray">
                      {platform === 'darwin'
                        ? t('core:close_minimize_to_dock', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : t('core:close_minimize_to_tray', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                    </MenuItem>
                    <MenuItem value="quit">
                      {t('core:close_quit_completely', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </MenuItem>
                  </Select>
                </Box>
              </Box>
            )}

            {/* Security — Export private key (dev mode only) */}
            {isEnabledDevMode && (
              <Box
                sx={{
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: 1,
                  borderColor: alpha(theme.palette.divider, 0.4),
                  bgcolor: alpha(theme.palette.background.default, 0.5),
                  mb: 3,
                  px: 2,
                  py: 1.5,
                }}
              >
                <ExportPrivateKey rawWallet={rawWallet} />
              </Box>
            )}

            {/* Appearance — Theme Manager */}
            <Box
              sx={{
                borderRadius: 2,
                border: 1,
                borderColor: alpha(theme.palette.divider, 0.4),
                bgcolor: alpha(theme.palette.background.default, 0.5),
                overflow: 'hidden',
              }}
            >
              <ThemeManager />
            </Box>
          </Box>
        </Box>
      </Dialog>
    </Fragment>
  );
};

const ExportPrivateKey = ({ rawWallet }) => {
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const setInfoSnackCustom = useSetAtom(infoSnackGlobalAtom);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const exportPrivateKeyFunc = async () => {
    try {
      setInfoSnackCustom({
        type: 'info',
        message: t('group:message.generic.descrypt_wallet', {
          postProcess: 'capitalizeFirstChar',
        }),
      });

      setOpenSnackGlobal(true);
      const wallet = structuredClone(rawWallet);

      const res = await decryptStoredWallet(password, wallet);
      const wallet2 = new PhraseWallet(res, wallet?.version || walletVersion);

      const keyPair = Base58.encode(wallet2._addresses[0].keyPair.privateKey);
      setPrivateKey(keyPair);
      setInfoSnackCustom({
        type: '',
        message: '',
      });

      setOpenSnackGlobal(false);
    } catch (error) {
      setInfoSnackCustom({
        type: 'error',
        message: error?.message
          ? t('group:message.error.decrypt_wallet', {
              message: error?.message,
              postProcess: 'capitalizeFirstChar',
            })
          : t('group:message.error.descrypt_wallet', {
              postProcess: 'capitalizeFirstChar',
            }),
      });

      setOpenSnackGlobal(true);
    }
  };

  return (
    <>
      <Button variant="contained" size="small" onClick={() => setIsOpen(true)}>
        {t('group:action.export_private_key', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Button>

      <Dialog
        open={isOpen}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle
          id="alert-dialog-title"
          sx={{
            color: theme.palette.text.primary,
            fontWeight: 700,
          }}
        >
          {t('group:action.export_password', {
            postProcess: 'capitalizeFirstChar',
          })}
        </DialogTitle>

        <DialogContent
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minWidth: 320,
          }}
        >
          <DialogContentText
            id="alert-dialog-description"
            variant="body2"
            color="text.secondary"
          >
            {t('group:message.generic.secure_place', {
              postProcess: 'capitalizeFirstChar',
            })}
          </DialogContentText>

          <TextField
            autoFocus
            type="password"
            value={password}
            autoComplete="new-password"
            name="settings-private-key-decrypt"
            size="small"
            onFocus={() => setIsPrivateKeyPasswordEditable(true)}
            onMouseDown={() => setIsPrivateKeyPasswordEditable(true)}
            onBlur={() => {
              if (!password) {
                setIsPrivateKeyPasswordEditable(false);
              }
            }}
            onChange={(e) => setPassword(e.target.value)}
            InputProps={{
              readOnly: !isPrivateKeyPasswordEditable,
            }}
            inputProps={{
              autoComplete: 'new-password',
              'data-1p-ignore': 'true',
              'data-lpignore': 'true',
              spellCheck: 'false',
            }}
            sx={{
              '& .MuiOutlinedInput-root': { borderRadius: 2 },
              '& input:-webkit-autofill, & input:-webkit-autofill:hover, & input:-webkit-autofill:focus':
                {
                  WebkitBoxShadow:
                    theme.palette.mode === 'dark'
                      ? '0 0 0 100px rgb(38, 42, 50) inset'
                      : '0 0 0 100px rgb(248, 250, 253) inset',
                  WebkitTextFillColor: theme.palette.text.primary,
                  caretColor: theme.palette.text.primary,
                  transition: 'background-color 9999s ease-out 0s',
                },
            }}
          />

          {privateKey && (
            <Button
              variant="outlined"
              size="small"
              onClick={() => {
                navigator.clipboard.writeText(privateKey);
                setInfoSnackCustom({
                  type: 'success',
                  message: t('group:message.generic.private_key_copied', {
                    postProcess: 'capitalizeFirstChar',
                  }),
                });

                setOpenSnackGlobal(true);
              }}
              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
            >
              {t('group:action.copy_private_key', {
                postProcess: 'capitalizeFirstChar',
              })}{' '}
              <ContentCopyIcon fontSize="small" sx={{ ml: 0.5 }} />
            </Button>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => {
              setIsOpen(false);
              setPassword('');
              setPrivateKey('');
            }}
            sx={{ borderRadius: 2, textTransform: 'none' }}
          >
            {t('core:action.cancel', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>

          <Button
            variant="contained"
            size="small"
            onClick={exportPrivateKeyFunc}
            sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
          >
            {t('core:action.decrypt', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
