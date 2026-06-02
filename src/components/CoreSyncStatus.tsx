import { useCallback, useEffect, useState } from 'react';
import syncedImg from '../assets/syncStatus/synced.webp';
import syncedMintingImg from '../assets/syncStatus/synced_minting.webp';
import syncingImg from '../assets/syncStatus/syncing.webp';
import '../styles/CoreSyncStatus.css';
import { Box, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { manifestData } from './NotAuthenticated';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  nodeInfosAtom,
  p2pHealthAtom,
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
  p2pActiveOverlayPeers?: number;
};

export const CoreSyncStatus = ({
  renderIcon,
  useExternalTooltip = false,
}: {
  renderIcon?: React.ReactNode;
  useExternalTooltip?: boolean;
}) => {
  const nodeInfos = useAtomValue(nodeInfosAtom);
  const selectedNode = useAtomValue(selectedNodeInfoAtom);
  const setSharedP2pHealth = useSetAtom(p2pHealthAtom);
  const [coreInfos, setCoreInfos] = useState({});
  const [p2pActiveOverlayPeers, setP2pActiveOverlayPeers] = useState<
    number | null
  >(null);
  const [connectedRemoteInterfaces, setConnectedRemoteInterfaces] = useState<
    number | null
  >(null);
  const [p2pHealth, setP2pHealth] = useState<P2pHealthLevel | null>(null);

  const nodeBase = selectedNode?.url || HTTPS_EXT_NODE_QORTAL_LINK;
  const isUsingGateway = nodeBase?.includes('ext-node.qortal.link') ?? false;
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const theme = useTheme();

  const applyReticulumStatus = useCallback(
    (status: ReticulumStatusSnapshot | null | undefined) => {
      const active =
        typeof status?.p2pActiveOverlayPeers === 'number'
          ? status.p2pActiveOverlayPeers
          : null;
      setP2pActiveOverlayPeers(active);
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
        p2pActiveOverlayPeers: status.p2pActiveOverlayPeers ?? 0,
      });
      setP2pHealth(nextP2pHealth);
      setSharedP2pHealth(nextP2pHealth);
    },
    [setSharedP2pHealth]
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
  }, [applyReticulumStatus]);

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

    let imagePath = syncingImg;
    let message: string = '';

    if (isUsingGateway) {
      if (isSynchronizing && syncPercent !== 100) {
        imagePath = syncingImg;
        message = `${t(`core:minting.status.synchronizing`, { percent: syncPercent, postProcess: 'capitalizeFirstChar' })} ${t('core:minting.status.not_minting')}`;
      } else {
        imagePath = syncedImg;
        message = `${t(`core:minting.status.synchronized`, { percent: syncPercent, postProcess: 'capitalizeFirstChar' })} ${t('core:minting.status.not_minting')}`;
      }
    } else if (isMintingPossible) {
      if (isSynchronizing && syncPercent !== 100) {
        imagePath = syncingImg;
        message = `${t(`core:minting.status.synchronizing`, { percent: syncPercent, postProcess: 'capitalizeFirstChar' })} ${t('core:minting.status.minting')}`;
      } else {
        imagePath = syncedMintingImg;
        message = `${t(`core:minting.status.synchronized`, { percent: syncPercent, postProcess: 'capitalizeFirstChar' })} ${t('core:minting.status.minting')}`;
      }
    } else if (!isMintingPossible) {
      if (syncPercent == 100) {
        imagePath = syncedImg;
        message = `${t(`core:minting.status.synchronized`, { percent: syncPercent, postProcess: 'capitalizeFirstChar' })} ${t('core:minting.status.not_minting')}`;
      } else {
        imagePath = syncingImg;
        message = `${t(`core:minting.status.synchronizing`, { percent: syncPercent, postProcess: 'capitalizeFirstChar' })} ${t('core:minting.status.not_minting')}`;
      }
    }

    const iconNode = renderIcon || (
      <img
        src={imagePath}
        style={{ height: 'auto', width: '35px' }}
        alt="sync status"
      />
    );

    const panelNode = (
      <Box
        className="core-panel"
        style={{
          right: 'unset',
          left: 'calc(100% + 16px)',
          top: '0px',
        }}
      >
        <h3>
          {t('core:core.information', { postProcess: 'capitalizeFirstChar' })}
        </h3>

        <h4 className="lineHeight">
          {t('core:core.version', { postProcess: 'capitalizeFirstChar' })}:{' '}
          <span style={{ color: '#03a9f4' }}>{buildVersion}</span>
        </h4>

        <h4 className="lineHeight">{message}</h4>

        <h4 className="lineHeight">
          {t('core:core.block_height', {
            postProcess: 'capitalizeFirstChar',
          })}
          : <span style={{ color: '#03a9f4' }}>{height || ''}</span>
        </h4>

        <h4 className="lineHeight">
          {t('core:core.peers', { postProcess: 'capitalizeFirstChar' })}:{' '}
          <span style={{ color: '#03a9f4' }}>{numberOfConnections || ''}</span>
        </h4>

        <h4 className="lineHeight">
          {t('core:core.data_peers', { postProcess: 'capitalizeFirstChar' })}:{' '}
          <span style={{ color: '#03a9f4' }}>
            {numberOfDataConnections || ''}
          </span>
        </h4>

        {connectedRemoteInterfaces !== null && (
          <h4 className="lineHeight">
            {t('core:core.connected_remote_interfaces', {
              postProcess: 'capitalizeFirstChar',
            })}
            :{' '}
            <span style={{ color: '#03a9f4' }}>
              {connectedRemoteInterfaces}
            </span>
          </h4>
        )}

        {p2pActiveOverlayPeers !== null && (
          <h4 className="lineHeight">
            {t('core:core.p2p_active_overlay_peers', {
              postProcess: 'capitalizeFirstChar',
            })}
            : <span style={{ color: '#03a9f4' }}>{p2pActiveOverlayPeers}</span>
          </h4>
        )}

        {p2pHealth !== null && (
          <h4 className="lineHeight">
            {t('core:core.p2p_health', { postProcess: 'capitalizeFirstChar' })}:{' '}
            <span
              style={{
                color:
                  p2pHealth === 'bad'
                    ? theme.palette.error.main
                    : p2pHealth === 'low'
                      ? theme.palette.warning.main
                      : theme.palette.success.main,
                fontWeight: 600,
              }}
            >
              {t(`core:core.p2p_health_${p2pHealth}`, {
                postProcess: 'capitalizeFirstChar',
              })}
            </span>
          </h4>
        )}

        <h4 className="lineHeight">
          {t('auth:node.using', {
            postProcess: 'capitalizeFirstChar',
          })}
          :{' '}
          <span
            style={{
              color: '#03a9f4',
              ...(isLocalNodeUrl(nodeBase) && {
                fontWeight: 'bold',
                color: theme.palette.other.positive,
              }),
            }}
          >
            {nodeDisplay(nodeBase)}
          </span>
        </h4>

        <h4 className="lineHeight">
          {t('core:ui.version', { postProcess: 'capitalizeFirstChar' })}:{' '}
          <span style={{ color: '#03a9f4' }}>{manifestData.version}</span>
        </h4>
      </Box>
    );

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
