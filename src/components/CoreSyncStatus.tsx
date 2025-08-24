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

export const CoreSyncStatus = () => {
  const [nodeInfos] = useAtom(nodeInfosAtom);
  const [coreInfos, setCoreInfos] = useState({});

  const [isUsingGateway, setIsUsingGateway] = useState(
    getBaseApiReact()?.includes('ext-node.qortal.link') ?? false
  );

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

    getCoreInfos();

    const interval = setInterval(() => {
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
            {t('auth:node.using_public', {
              postProcess: 'capitalizeFirstChar',
            })}
            :{' '}
            <span style={{ color: '#03a9f4' }}>
              {isUsingGateway?.toString()}
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
