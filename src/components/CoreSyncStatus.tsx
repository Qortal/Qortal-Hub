import React, { useEffect, useState } from 'react';
import syncedImg from '../assets/syncStatus/synced.png'
import syncedMintingImg from '../assets/syncStatus/synced_minting.png'
import syncingImg from '../assets/syncStatus/syncing.png'
import { getBaseApiReact } from '../App';
import './CoreSyncStatus.css'
export const CoreSyncStatus = ({imageSize, position}) => {
  const [nodeInfos, setNodeInfos] = useState({});
  const [coreInfos, setCoreInfos] = useState({});
  const [isUsingGateway, setIsUsingGateway] = useState(false);

  useEffect(() => {
    const getNodeInfos = async () => {
  

      try {
        setIsUsingGateway(!!getBaseApiReact()?.includes('ext-node.qortal.link'))
             const url = `${getBaseApiReact()}/admin/status`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
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
          method: "GET",
          headers: {
            "Content-Type": "application/json",
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
    const { isSynchronizing = false, syncPercent = 0, isMintingPossible = false, height = 0, numberOfConnections = 0 } = nodeInfos;
    const buildVersion = coreInfos?.buildVersion ? coreInfos?.buildVersion.substring(0, 12) : '';

    let imagePath = syncingImg;
    let message = `Synchronizing`
    if (isMintingPossible && !isUsingGateway) {
      imagePath = syncedMintingImg;
      message = `${isSynchronizing ? 'Synchronizing' : 'Synchronized'} ${'(Minting)'}`
    } else if (isSynchronizing === true && syncPercent === 99) {
      imagePath = syncingImg
    } else if (isSynchronizing && !isMintingPossible && syncPercent === 100) {
      imagePath = syncingImg;
      message = `Synchronizing ${isUsingGateway ? '' :'(Not Minting)'}`
    } else if (!isSynchronizing && !isMintingPossible && syncPercent === 100) {
      imagePath = syncedImg
      message = `Synchronized ${isUsingGateway ? '' :'(Not Minting)'}`
    } else if (isSynchronizing && isMintingPossible && syncPercent === 100) {
      imagePath = syncingImg;
      message = `Synchronizing ${isUsingGateway ? '' :'(Minting)'}`
    } else if (!isSynchronizing && isMintingPossible && syncPercent === 100) {
      imagePath = syncedMintingImg;
      message = `Synchronized ${isUsingGateway ? '' :'(Minting)'}`
    }

    

    return (
      <div className="tooltip" style={{ display: 'inline' }}>
        <span><img src={imagePath} style={{ height: 'auto', width: imageSize ? imageSize : '24px' }} alt="sync status" /></span>
        <div className="bottom" style={{
          right: position && 'unset',
          left: position && '0px'
        }}>
          <h3>Core Information</h3>
          <h4 className="lineHeight">Core Version: <span style={{ color: '#03a9f4' }}>{buildVersion}</span></h4>
          <h4 className="lineHeight">{message}</h4>
          <h4 className="lineHeight">Block Height: <span style={{ color: '#03a9f4' }}>{height || ''}</span></h4>
          <h4 className="lineHeight">Connected Peers: <span style={{ color: '#03a9f4' }}>{numberOfConnections || ''}</span></h4>
          <h4 className="lineHeight">Using gateway: <span style={{ color: '#03a9f4' }}>{isUsingGateway?.toString()}</span></h4>
          <i></i>
        </div>
      </div>
    );
  };

  return (
    <div id="core-sync-status-id">
      {renderSyncStatusIcon()}
    </div>
  );
};

