import { Fragment, useCallback, useEffect, useState } from 'react';
import syncedImg from '../assets/syncStatus/synced.webp';
import syncedMintingImg from '../assets/syncStatus/synced_minting.webp';
import syncingImg from '../assets/syncStatus/syncing.webp';
import '../styles/CoreSyncStatus.css';
import { Box, Chip, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import qortalLogoOfficial from '../assets/sidebar/qortal-logo-official.webp';
import qortalLogoMinting from '../assets/sidebar/qortal-logo-official-minting.webp';
import { NodeStateLogo } from './Desktop/NodeStateLogo';
import { nodeStateFor } from './Desktop/nodeState';
import { useTranslation } from 'react-i18next';
import { manifestData } from './NotAuthenticated';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  nodeInfosAtom,
  p2pHealthAtom,
  reticulumEnabledAtom,
  selectedNodeInfoAtom,
} from '../atoms/global';
import { nodeDisplay } from '../utils/helpers';
import { computeP2pHealth, type P2pHealthLevel } from '../lib/p2pHealth';

export type { P2pHealthLevel };
import {
  HTTPS_EXT_NODE_QORTAL_LINK,
  isLocalNodeUrl,
} from '../constants/constants';

type ReticulumStatusSnapshot = {
  onlineRemoteHubInterfaces?: number;
  p2pOutboundOverlayPeers?: number;
  p2pInboundOverlayPeers?: number;
  p2pActiveOverlayPeers?: number;
  p2pReceivingOverlayPeers?: number;
  p2pReceivingOverlayPeersStableMs?: number;
};

export const CoreSyncStatus = ({
  renderIcon,
  useExternalTooltip = false,
  panelOnly = false,
}: {
  renderIcon?: React.ReactNode;
  useExternalTooltip?: boolean;
  /** Only the information, laid out in place (in a popover), no icon. */
  panelOnly?: boolean;
}) => {
  const nodeInfos = useAtomValue(nodeInfosAtom);
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const reticulumEnabled = useAtomValue(reticulumEnabledAtom);
  const setSharedP2pHealth = useSetAtom(p2pHealthAtom);
  const [coreInfos, setCoreInfos] = useState({});
  const [p2pOutboundOverlayPeers, setP2pOutboundOverlayPeers] = useState<
    number | null
  >(null);
  const [p2pInboundOverlayPeers, setP2pInboundOverlayPeers] = useState<
    number | null
  >(null);
  const [connectedRemoteInterfaces, setConnectedRemoteInterfaces] = useState<
    number | null
  >(null);
  const [p2pHealth, setP2pHealth] = useState<P2pHealthLevel | null>(null);

  const nodeBase = selectedNode?.url || HTTPS_EXT_NODE_QORTAL_LINK;
  const isUsingGateway = nodeBase?.includes('ext-node.qortal.link') ?? false;
  const { t, i18n } = useTranslation(['auth', 'core', 'group', 'question']);
  const theme = useTheme();

  const applyReticulumStatus = useCallback(
    (status: ReticulumStatusSnapshot | null | undefined) => {
      if (!reticulumEnabled) {
        setP2pOutboundOverlayPeers(null);
        setP2pInboundOverlayPeers(null);
        setConnectedRemoteInterfaces(null);
        setP2pHealth(null);
        setSharedP2pHealth('unknown');
        return;
      }
      setP2pOutboundOverlayPeers(
        typeof status?.p2pOutboundOverlayPeers === 'number'
          ? status.p2pOutboundOverlayPeers
          : null
      );
      setP2pInboundOverlayPeers(
        typeof status?.p2pInboundOverlayPeers === 'number'
          ? status.p2pInboundOverlayPeers
          : null
      );
      setConnectedRemoteInterfaces(
        typeof status?.onlineRemoteHubInterfaces === 'number'
          ? status.onlineRemoteHubInterfaces
          : null
      );
      if (!status) {
        setP2pHealth(null);
        setSharedP2pHealth('unknown');
        return;
      }
      const hubs = status.onlineRemoteHubInterfaces ?? 0;
      const nextP2pHealth = computeP2pHealth({
        onlineRemoteHubInterfaces: hubs,
        p2pReceivingOverlayPeers: status.p2pReceivingOverlayPeers,
        p2pReceivingOverlayPeersStableMs:
          status.p2pReceivingOverlayPeersStableMs,
        p2pActiveOverlayPeers: status.p2pActiveOverlayPeers ?? 0,
        p2pOutboundOverlayPeers: status.p2pOutboundOverlayPeers,
        p2pInboundOverlayPeers: status.p2pInboundOverlayPeers,
      });
      setP2pHealth(nextP2pHealth);
      setSharedP2pHealth(nextP2pHealth);
    },
    [reticulumEnabled, setSharedP2pHealth]
  );

  useEffect(() => {
    let canceled = false;
    const getCoreInfos = async () => {
      try {
        const url = `${nodeBase}/admin/info`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const data = await response.json();
        if (!canceled) {
          setCoreInfos(data);
        }
      } catch (error) {
        console.error('Request failed', error);
        if (!canceled) {
          setCoreInfos({});
        }
      }
    };

    setCoreInfos({});
    getCoreInfos();

    const interval = setInterval(getCoreInfos, 30000);

    return () => {
      canceled = true;
      clearInterval(interval);
    };
  }, [nodeBase]);

  useEffect(() => {
    let canceled = false;
    const api = window.electronAPI as any;
    if (!reticulumEnabled) {
      applyReticulumStatus(null);
      return;
    }
    if (typeof api?.reticulumGetStatus !== 'function') {
      applyReticulumStatus(null);
      return;
    }

    void api
      .reticulumGetStatus()
      .then((status) => {
        if (!canceled) applyReticulumStatus(status);
      })
      .catch(() => {
        if (!canceled) applyReticulumStatus(null);
      });

    const unsubscribe =
      typeof api.onReticulumStatus === 'function'
        ? api.onReticulumStatus((status) => {
            if (!canceled) applyReticulumStatus(status);
          })
        : undefined;

    const reconciliationInterval = window.setInterval(() => {
      void api
        .reticulumGetStatus?.()
        .then((status) => {
          if (!canceled) applyReticulumStatus(status);
        })
        .catch(() => {
          if (!canceled) applyReticulumStatus(null);
        });
    }, 120000);

    return () => {
      canceled = true;
      unsubscribe?.();
      window.clearInterval(reconciliationInterval);
    };
  }, [applyReticulumStatus, reticulumEnabled]);

  const renderSyncStatusIcon = () => {
    const {
      isSynchronizing = false,
      syncPercent = 0,
      isMintingPossible = false,
      height = 0,
      numberOfConnections = 0,
      numberOfDataConnections = 0,
    } = nodeInfos;
    const buildVersion = coreInfos?.buildVersion
      ? coreInfos?.buildVersion.substring(0, 20)
      : '';

    // The default icon: syncing, synced, or synced and minting.
    let imagePath = syncingImg;
    if (isUsingGateway) {
      imagePath =
        isSynchronizing && syncPercent !== 100 ? syncingImg : syncedImg;
    } else if (isMintingPossible) {
      imagePath =
        isSynchronizing && syncPercent !== 100 ? syncingImg : syncedMintingImg;
    } else {
      imagePath = syncPercent == 100 ? syncedImg : syncingImg;
    }

    const iconNode = renderIcon || (
      <img
        src={imagePath}
        style={{ height: 'auto', width: '35px' }}
        alt="sync status"
      />
    );

    // The panel: the node's state, then its numbers, in Hub's colours.
    const nodeState = nodeStateFor(
      selectedNode?.url,
      nodeInfos as { isMintingPossible?: boolean }
    );
    const isMinting = nodeState === 'minting';
    const isSynced =
      isUsingGateway || isMintingPossible
        ? !(isSynchronizing && syncPercent !== 100)
        : syncPercent == 100;
    const stateColor =
      nodeState === 'minting'
        ? theme.palette.other.minting
        : nodeState === 'own'
          ? theme.palette.primary.main
          : theme.palette.text.secondary;
    const healthColor =
      p2pHealth === 'bad'
        ? theme.palette.error.main
        : p2pHealth === 'low'
          ? theme.palette.warning.main
          : theme.palette.success.main;
    const chipSx = (color: string) => ({
      backgroundColor: alpha(color, 0.14),
      border: `1px solid ${alpha(color, 0.38)}`,
      color,
      fontSize: '0.72rem',
      fontWeight: 700,
      height: 22,
    });
    const capitalize = { postProcess: 'capitalizeFirstChar' };
    const rows: [string, React.ReactNode][] = [
      [
        t('core:core.block_height', capitalize),
        height ? Number(height).toLocaleString(i18n.language) : '—',
      ],
      [t('core:core.peers', capitalize), numberOfConnections || 0],
      [t('core:core.data_peers', capitalize), numberOfDataConnections || 0],
    ];
    if (connectedRemoteInterfaces !== null) {
      rows.push([
        t('core:core.connected_remote_interfaces', capitalize),
        connectedRemoteInterfaces,
      ]);
    }
    if (p2pOutboundOverlayPeers !== null || p2pInboundOverlayPeers !== null) {
      rows.push([
        t('core:core.p2p_active_overlay_peers', capitalize),
        t('core:core.p2p_peers_out_in', {
          in: p2pInboundOverlayPeers ?? 0,
          out: p2pOutboundOverlayPeers ?? 0,
        }),
      ]);
    }
    if (p2pHealth !== null) {
      rows.push([
        t('core:core.p2p_health', capitalize),
        <Box
          component="span"
          key="health"
          sx={{
            alignItems: 'center',
            color: healthColor,
            display: 'inline-flex',
            gap: 0.6,
          }}
        >
          <Box
            component="span"
            sx={{
              backgroundColor: healthColor,
              borderRadius: '50%',
              height: 7,
              width: 7,
            }}
          />
          {t(`core:core.p2p_health_${p2pHealth}`, capitalize)}
        </Box>,
      ]);
    }
    rows.push(
      [t('auth:node.using', capitalize), nodeDisplay(nodeBase)],
      [t('core:core.version', capitalize), buildVersion || '—'],
      [t('core:ui.version', capitalize), manifestData.version]
    );

    const panelNode = (
      <Box
        className={panelOnly ? undefined : 'core-panel'}
        style={
          panelOnly
            ? undefined
            : {
                right: 'unset',
                left: 'calc(100% + 16px)',
                top: '0px',
              }
        }
        sx={{ minWidth: 250, textAlign: 'left' }}
      >
        <Box
          sx={{ alignItems: 'center', display: 'flex', gap: 1.25, mb: 1.25 }}
        >
          <NodeStateLogo
            alt=""
            highlighted
            mintingSrc={qortalLogoMinting}
            size={30}
            src={qortalLogoOfficial}
            state={nodeState}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{ fontSize: '0.92rem', fontWeight: 700, lineHeight: 1.25 }}
            >
              {t('core:core.information', capitalize)}
            </Typography>
            <Typography
              sx={{
                color: stateColor,
                fontSize: '0.76rem',
                fontWeight: 600,
                lineHeight: 1.3,
              }}
            >
              {t(`core:node_state.${nodeState}`)}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.25 }}>
          <Chip
            label={t(
              isSynced
                ? 'core:minting.status.synchronized'
                : 'core:minting.status.synchronizing',
              { percent: syncPercent, ...capitalize }
            )}
            size="small"
            sx={chipSx(
              isSynced ? theme.palette.success.main : theme.palette.warning.main
            )}
          />
          <Chip
            label={t(
              isMinting ? 'core:core.minting' : 'core:core.not_minting',
              capitalize
            )}
            size="small"
            sx={chipSx(
              isMinting
                ? theme.palette.other.minting
                : theme.palette.text.secondary
            )}
          />
        </Box>

        <Box
          component="dl"
          sx={{
            columnGap: 2.5,
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            m: 0,
            rowGap: 0.55,
          }}
        >
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <Typography
                component="dt"
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '0.78rem',
                }}
              >
                {label}
              </Typography>
              <Typography
                component="dd"
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: '0.8rem',
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 600,
                  m: 0,
                  minWidth: 0,
                  overflow: 'hidden',
                  textAlign: 'right',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {value}
              </Typography>
            </Fragment>
          ))}
        </Box>
      </Box>
    );

    if (panelOnly) return panelNode;

    if (useExternalTooltip) {
      return (
        <>
          <span>{iconNode}</span>
          {panelNode}
        </>
      );
    }

    return (
      <Box
        className="tooltip"
        data-theme={theme.palette.mode}
        style={{ display: 'inline' }}
      >
        <span>{iconNode}</span>
        {panelNode}
      </Box>
    );
  };

  return <Box id="core-sync-status-id">{renderSyncStatusIcon()}</Box>;
};
