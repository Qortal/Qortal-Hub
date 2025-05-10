import { useEffect, useState } from 'react';
import syncedImg from '../assets/syncStatus/synced.png';
import syncedMintingImg from '../assets/syncStatus/synced_minting.png';
import syncingImg from '../assets/syncStatus/syncing.png';
import { getBaseApiReact } from '../App';
import '../styles/CoreSyncStatus.css';
import { useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { manifestData } from '../ExtStates/NotAuthenticated';

export const CoreSyncStatus = () => {
  const [nodeInfos, setNodeInfos] = useState({});
  const [coreInfos, setCoreInfos] = useState({});
  const [isUsingGateway, setIsUsingGateway] = useState(false);

  const { t } = useTranslation(['auth', 'core']);
  const theme = useTheme();

  useEffect(() => {
    const getNodeInfos = async () => {
      try {
        setIsUsingGateway(
          !!getBaseApiReact()?.includes('ext-node.qortal.link')
        );
        const url = `${getBaseApiReact()}/admin/status`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const data = await response.json();
        setNodeInfos(data);
      } catch (error) {
        console.error('Request failed', error);
      }
    };

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

    getNodeInfos();
    getCoreInfos();

    const interval = setInterval(() => {
      getNodeInfos();
      getCoreInfos();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const renderSyncStatusIcon = () => {
    const {
      isSynchronizing = false,
      syncPercent = 0,
      isMintingPossible = false,
      height = 0,
      numberOfConnections = 0,
    } = nodeInfos;
    const buildVersion = coreInfos?.buildVersion
      ? coreInfos?.buildVersion.substring(0, 12)
      : '';

    let imagePath = syncingImg;
    let message = t('core:message.status.synchronizing', {
      postProcess: 'capitalize',
    });

    if (isMintingPossible && !isUsingGateway) {
      imagePath = syncedMintingImg;
      message = `${t(`core:message.status.${isSynchronizing ? 'synchronizing' : 'synchronized'}`, { postProcess: 'capitalize' })} ${t('core:message.status.minting')}`;
    } else if (isSynchronizing === true && syncPercent === 99) {
      imagePath = syncingImg;
    } else if (isSynchronizing && !isMintingPossible && syncPercent === 100) {
      imagePath = syncingImg;
      message = `${t('core:message.status.synchronizing', { postProcess: 'capitalize' })} ${!isUsingGateway ? t('core:message.status.not_minting') : ''}`;
    } else if (!isSynchronizing && !isMintingPossible && syncPercent === 100) {
      imagePath = syncedImg;
      message = `${t('core:message.status.synchronized', { postProcess: 'capitalize' })} ${!isUsingGateway ? t('core:message.status.not_minting') : ''}`;
    } else if (isSynchronizing && isMintingPossible && syncPercent === 100) {
      imagePath = syncingImg;
      message = `${t('core:message.status.synchronizing', { postProcess: 'capitalize' })} ${!isUsingGateway ? t('core:message.status.minting') : ''}`;
    } else if (!isSynchronizing && isMintingPossible && syncPercent === 100) {
      imagePath = syncedMintingImg;
      message = `${t('core:message.status.synchronized', { postProcess: 'capitalize' })} ${!isUsingGateway ? t('core:message.status.minting') : ''}`;
    }

    return (
      <div
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

        <div
          className="core-panel"
          style={{
            right: 'unset',
            left: '55px',
            top: '10px',
          }}
        >
          <h3>{t('core:core.information', { postProcess: 'capitalize' })}</h3>
          <h4 className="lineHeight">
            {t('core:core.version', { postProcess: 'capitalize' })}:{' '}
            <span style={{ color: '#03a9f4' }}>{buildVersion}</span>
          </h4>
          <h4 className="lineHeight">{message}</h4>
          <h4 className="lineHeight">
            {t('core:core.block_height', { postProcess: 'capitalize' })}:{' '}
            <span style={{ color: '#03a9f4' }}>{height || ''}</span>
          </h4>
          <h4 className="lineHeight">
            {t('core:core.peers', { postProcess: 'capitalize' })}:{' '}
            <span style={{ color: '#03a9f4' }}>
              {numberOfConnections || ''}
            </span>
          </h4>
          <h4 className="lineHeight">
            {t('auth:node.using_public', { postProcess: 'capitalize' })}:{' '}
            <span style={{ color: '#03a9f4' }}>
              {isUsingGateway?.toString()}
            </span>
          </h4>
          <h4 className="lineHeight">
            {t('core:ui.version')}:{' '}
            <span style={{ color: '#03a9f4' }}>{manifestData.version}</span>
          </h4>
        </div>
      </div>
    );
  };

  return <div id="core-sync-status-id">{renderSyncStatusIcon()}</div>;
};
