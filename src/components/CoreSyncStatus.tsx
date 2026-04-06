import { useEffect, useState } from 'react';
import syncedImg from '../assets/syncStatus/synced.webp';
import syncedMintingImg from '../assets/syncStatus/synced_minting.webp';
import syncingImg from '../assets/syncStatus/syncing.webp';
import { getBaseApiReact } from '../App';
import '../styles/CoreSyncStatus.css';
import { Box, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { manifestData } from './NotAuthenticated';
import { useAtom } from 'jotai';
import { nodeInfosAtom } from '../atoms/global';
import { nodeDisplay } from '../utils/helpers';
import { isLocalNodeUrl } from '../constants/constants';
import { computeP2pHealth, type P2pHealthLevel } from '../lib/p2pHealth';

export type { P2pHealthLevel };

export const CoreSyncStatus = () => {
  const [nodeInfos] = useAtom(nodeInfosAtom);
  const [coreInfos, setCoreInfos] = useState({});
  const [p2pOutboundPeers, setP2pOutboundPeers] = useState<number | null>(null);
  const [p2pInboundPeers, setP2pInboundPeers] = useState<number | null>(null);
  const [connectedRemoteInterfaces, setConnectedRemoteInterfaces] = useState<
    number | null
  >(null);
  const [p2pHealth, setP2pHealth] = useState<P2pHealthLevel | null>(null);

  const [nodeBase, setNodeBase] = useState(getBaseApiReact());
  const isUsingGateway = nodeBase?.includes('ext-node.qortal.link') ?? false;
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const theme = useTheme();

  useEffect(() => {
    const getCoreInfos = async () => {
      try {
        const url = `${getBaseApiReact()}/admin/info`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const data = await response.json();
        setCoreInfos(data);
      } catch (error) {
        console.error('Request failed', error);
      }
    };

    const fetchP2pReticulumStatus = async () => {
      const api = window.electronAPI;
      if (typeof api?.reticulumGetStatus !== 'function') {
        setP2pOutboundPeers(null);
        setP2pInboundPeers(null);
        setConnectedRemoteInterfaces(null);
        setP2pHealth(null);
        return;
      }
      try {
        const status = await api.reticulumGetStatus();
        const out =
          typeof status.p2pOutboundPeers === 'number' ? status.p2pOutboundPeers : null;
        const inn =
          typeof status.p2pInboundPeers === 'number' ? status.p2pInboundPeers : null;
        setP2pOutboundPeers(out);
        setP2pInboundPeers(inn);
        setConnectedRemoteInterfaces(
          typeof status.onlineRemoteHubInterfaces === 'number'
            ? status.onlineRemoteHubInterfaces
            : null
        );
        const hubs = status.onlineRemoteHubInterfaces ?? 0;
        const outbound = status.p2pOutboundPeers ?? 0;
        const inbound = status.p2pInboundPeers ?? 0;
        setP2pHealth(
          computeP2pHealth({
            onlineRemoteHubInterfaces: hubs,
            p2pOutboundPeers: outbound,
            p2pInboundPeers: inbound,
          })
        );
      } catch {
        setP2pOutboundPeers(null);
        setP2pInboundPeers(null);
        setConnectedRemoteInterfaces(null);
        setP2pHealth(null);
      }
    };

    const tick = () => {
      void getCoreInfos();
      void fetchP2pReticulumStatus();
    };

    tick();

    const interval = setInterval(tick, 30000);

    return () => clearInterval(interval);
  }, []);

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

    return (
      <Box
        className="tooltip"
        data-theme={theme.palette.mode}
        style={{ display: 'inline' }}
      >
        <span>
          <img
            src={imagePath}
            style={{ height: 'auto', width: '35px' }}
            alt="sync status"
          />
        </span>

        <Box
          className="core-panel"
          style={{
            right: 'unset',
            left: '55px',
            top: '10px',
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
            <span style={{ color: '#03a9f4' }}>
              {numberOfConnections || ''}
            </span>
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

          {p2pOutboundPeers !== null && p2pInboundPeers !== null && (
            <>
              <h4 className="lineHeight">
                {t('core:core.p2p_outbound_peers', {
                  postProcess: 'capitalizeFirstChar',
                })}
                :{' '}
                <span style={{ color: '#03a9f4' }}>{p2pOutboundPeers}</span>
              </h4>
              <h4 className="lineHeight">
                {t('core:core.p2p_inbound_peers', {
                  postProcess: 'capitalizeFirstChar',
                })}
                :{' '}
                <span style={{ color: '#03a9f4' }}>{p2pInboundPeers}</span>
              </h4>
            </>
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
      </Box>
    );
  };

  return <Box id="core-sync-status-id">{renderSyncStatusIcon()}</Box>;
};
