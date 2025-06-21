import i18n from '../../i18n/i18n';
import { AddressLevelEntry } from './Minting';

const accountTargetBlocks = (level: number): number | undefined => {
  if (level === 0) {
    return 7200;
  } else if (level === 1) {
    return 72000;
  } else if (level === 2) {
    return 201600;
  } else if (level === 3) {
    return 374400;
  } else if (level === 4) {
    return 618400;
  } else if (level === 5) {
    return 964000;
  } else if (level === 6) {
    return 1482400;
  } else if (level === 7) {
    return 2173600;
  } else if (level === 8) {
    return 3037600;
  } else if (level === 9) {
    return 4074400;
  } else {
    return undefined; // fallback: should never reach this point
  }
};

export const nextLevel = (level: number): number | undefined => {
  if (level === 0) {
    return 1;
  } else if (level === 1) {
    return 2;
  } else if (level === 2) {
    return 3;
  } else if (level === 3) {
    return 4;
  } else if (level === 4) {
    return 5;
  } else if (level === 5) {
    return 6;
  } else if (level === 6) {
    return 7;
  } else if (level === 7) {
    return 8;
  } else if (level === 8) {
    return 9;
  } else if (level === 9) {
    return 10;
  } else {
    return undefined; // fallback: should never reach this point
  }
};

export const blockReward = (nodeStatus): number => {
  if (nodeStatus.height < 259201) {
    return 5.0;
  } else if (nodeStatus.height < 518401) {
    return 4.75;
  } else if (nodeStatus.height < 777601) {
    return 4.5;
  } else if (nodeStatus.height < 1036801) {
    return 4.25;
  } else if (nodeStatus.height < 1296001) {
    return 4.0;
  } else if (nodeStatus.height < 1555201) {
    return 3.75;
  } else if (nodeStatus.height < 1814401) {
    return 3.5;
  } else if (nodeStatus.height < 2073601) {
    return 3.25;
  } else if (nodeStatus.height < 2332801) {
    return 3.0;
  } else if (nodeStatus.height < 2592001) {
    return 2.75;
  } else if (nodeStatus.height < 2851201) {
    return 2.5;
  } else if (nodeStatus.height < 3110401) {
    return 2.25;
  } else {
    return 2.0;
  }
};

export const currentTier = (level): string | undefined => {
  if (level === 0) {
    return 'Tier 0 (Level 0)'; // TODO translate
  } else if (level === 1 || level === 2) {
    return 'Tier 1 (Level 1 + 2)';
  } else if (level === 3 || level === 4) {
    return 'Tier 2 (Level 3 + 4)';
  } else if (level === 5 || level === 6) {
    return 'Tier 3 (Level 5 + 6)';
  } else if (level === 7 || level === 8) {
    return 'Tier 4 (Level 7 + 8)';
  } else if (level === 9 || level === 10) {
    return 'Tier 5 (Level 9 + 10)';
  } else {
    return undefined; // fallback: should never reach this point
  }
};

export const tierPercent = (accountInfo, tier4Online): number => {
  if (accountInfo !== null) {
    const level = accountInfo.level;
    if (level === 0) {
      return 0;
    } else if (level === 1 || level === 2) {
      return 6;
    } else if (level === 3 || level === 4) {
      return 13;
    } else if (level === 5 || level === 6) {
      if (tier4Online < 30) {
        return 45;
      } else {
        return 19;
      }
    } else if (level === 7 || level === 8) {
      if (tier4Online < 30) {
        return 45;
      } else {
        return 26;
      }
    } else if (level === 9 || level === 10) {
      return 32;
    }
  }
  return 0; // fallback: should never reach this point
};

export const countMintersInLevel = (
  level: number,
  addressLevel: AddressLevelEntry[],
  tier4Online: number
): number | undefined => {
  if (addressLevel && addressLevel.length > 0) {
    if (level === 0) {
      const countTier0 = addressLevel[0].count;
      return countTier0;
    } else if (level === 1 || level === 2) {
      const countTier1 = addressLevel[1].count + addressLevel[2].count;
      return countTier1;
    } else if (level === 3 || level === 4) {
      const countTier2 = addressLevel[3].count + addressLevel[4].count;
      return countTier2;
    } else if (level === 5 || level === 6) {
      if (tier4Online < 30) {
        const countTier3 =
          addressLevel[5].count +
          addressLevel[6].count +
          addressLevel[7].count +
          addressLevel[8].count;
        return countTier3;
      } else {
        const countTier3 = addressLevel[5].count + addressLevel[6].count;
        return countTier3;
      }
    } else if (level === 7 || level === 8) {
      if (tier4Online < 30) {
        const countTier4 =
          addressLevel[5].count +
          addressLevel[6].count +
          addressLevel[7].count +
          addressLevel[8].count;
        return countTier4;
      } else {
        const countTier4 = addressLevel[7].count + addressLevel[8].count;
        return countTier4;
      }
    } else if (level === 9 || level === 10) {
      const countTier5 = addressLevel[9].count + addressLevel[10].count;
      return countTier5;
    }
  }

  return undefined; // fallback: should never reach this point
};

export const countReward = (
  accountInfo,
  addressLevel: AddressLevelEntry[],
  nodeStatus,
  tier4Online: number
): number => {
  if (accountInfo != null && addressLevel && addressLevel.length > 0) {
    const level = accountInfo.level;
    if (level === 0) {
      return 0;
    } else if (level === 1 || level === 2) {
      const countReward12: number = parseFloat(
        (
          ((blockReward(nodeStatus) / 100) *
            tierPercent(accountInfo, tier4Online)) /
          (addressLevel[1].count + addressLevel[2].count)
        ).toFixed(8)
      );
      return countReward12;
    } else if (level === 3 || level === 4) {
      const countReward34 = parseFloat(
        (
          ((blockReward(nodeStatus) / 100) *
            tierPercent(accountInfo, tier4Online)) /
          (addressLevel[3].count + addressLevel[4].count)
        ).toFixed(8)
      );
      return countReward34;
    } else if (level === 5 || level === 6) {
      if (tier4Online < 30) {
        const countReward56 = parseFloat(
          (
            ((blockReward(nodeStatus) / 100) *
              tierPercent(accountInfo, tier4Online)) /
            (addressLevel[5].count +
              addressLevel[6].count +
              addressLevel[7].count +
              addressLevel[8].count)
          ).toFixed(8)
        );
        return countReward56;
      } else {
        const countReward56 = parseFloat(
          (
            ((blockReward(nodeStatus) / 100) *
              tierPercent(accountInfo, tier4Online)) /
            (addressLevel[5].count + addressLevel[6].count)
          ).toFixed(8)
        );
        return countReward56;
      }
    } else if (level === 7 || level === 8) {
      if (tier4Online < 30) {
        const countReward78 = parseFloat(
          (
            ((blockReward(nodeStatus) / 100) *
              tierPercent(accountInfo, tier4Online)) /
            (addressLevel[5].count +
              addressLevel[6].count +
              addressLevel[7].count +
              addressLevel[8].count)
          ).toFixed(8)
        );
        return countReward78;
      } else {
        const countReward78 = parseFloat(
          (
            ((blockReward(nodeStatus) / 100) *
              tierPercent(accountInfo, tier4Online)) /
            (addressLevel[7].count + addressLevel[8].count)
          ).toFixed(8)
        );
        return countReward78;
      }
    } else if (level === 9 || level === 10) {
      const countReward910 = parseFloat(
        (
          ((blockReward(nodeStatus) / 100) *
            tierPercent(accountInfo, tier4Online)) /
          (addressLevel[9].count + addressLevel[10].count)
        ).toFixed(8)
      );
      return countReward910;
    }
  }
  return 0; // fallback: should never reach this point
};

export const countRewardDay = (
  accountInfo,
  addressLevel: AddressLevelEntry[],
  adminInfo,
  nodeHeightBlock,
  nodeStatus,
  tier4Online: number
): number => {
  if (accountInfo != null && addressLevel && addressLevel.length > 0) {
    const level = accountInfo.level;
    const timeCalc = averageBlockDay(adminInfo, nodeHeightBlock);
    if (level === 0) {
      return 0;
    } else if (level === 1 || level === 2) {
      const countRewardDay12 = parseFloat(
        (
          (((blockReward(nodeStatus) / 100) *
            tierPercent(accountInfo, tier4Online)) /
            (addressLevel[1].count + addressLevel[2].count)) *
          timeCalc
        ).toFixed(8)
      );
      return countRewardDay12;
    } else if (level === 3 || level === 4) {
      const countRewardDay34 = parseFloat(
        (
          (((blockReward(nodeStatus) / 100) *
            tierPercent(accountInfo, tier4Online)) /
            (addressLevel[3].count + addressLevel[4].count)) *
          timeCalc
        ).toFixed(8)
      );
      return countRewardDay34;
    } else if (level === 5 || level === 6) {
      if (this.tier4Online < 30) {
        const countRewardDay56 = parseFloat(
          (
            (((blockReward(nodeStatus) / 100) *
              tierPercent(accountInfo, tier4Online)) /
              (addressLevel[5].count +
                addressLevel[6].count +
                addressLevel[7].count +
                addressLevel[8].count)) *
            timeCalc
          ).toFixed(8)
        );
        return countRewardDay56;
      } else {
        const countRewardDay56 = parseFloat(
          (
            (((blockReward(nodeStatus) / 100) *
              tierPercent(accountInfo, tier4Online)) /
              (addressLevel[5].count + addressLevel[6].count)) *
            timeCalc
          ).toFixed(8)
        );
        return countRewardDay56;
      }
    } else if (level === 7 || level === 8) {
      if (this.tier4Online < 30) {
        const countRewardDay78 = parseFloat(
          (
            (((blockReward(nodeStatus) / 100) *
              tierPercent(accountInfo, tier4Online)) /
              (addressLevel[5].count +
                addressLevel[6].count +
                addressLevel[7].count +
                addressLevel[8].count)) *
            timeCalc
          ).toFixed(8)
        );
        return countRewardDay78;
      } else {
        const countRewardDay78 = parseFloat(
          (
            (((blockReward(nodeStatus) / 100) *
              tierPercent(accountInfo, tier4Online)) /
              (addressLevel[7].count + addressLevel[8].count)) *
            timeCalc
          ).toFixed(8)
        );
        return countRewardDay78;
      }
    } else if (level === 9 || level === 10) {
      const countRewardDay910 = parseFloat(
        (
          (((blockReward(nodeStatus) / 100) *
            tierPercent(accountInfo, tier4Online)) /
            (addressLevel[9].count + addressLevel[10].count)) *
          timeCalc
        ).toFixed(8)
      );
      return countRewardDay910;
    }
  }
  return 0; // fallback: should never reach this point
};

export const mintingStatus = (nodeStatus): string => {
  if (
    nodeStatus.isMintingPossible === true &&
    nodeStatus.isSynchronizing === true
  ) {
    // this.cssMinting = 'blue';
    return i18n.t('core:minting.status.minting', {
      postProcess: 'capitalizeFirstChar',
    });
  } else if (
    nodeStatus.isMintingPossible === true &&
    nodeStatus.isSynchronizing === false
  ) {
    // this.cssMinting = 'blue';
    return i18n.t('core:minting.status.minting', {
      postProcess: 'capitalizeFirstChar',
    });
  } else if (
    nodeStatus.isMintingPossible === false &&
    nodeStatus.isSynchronizing === true
  ) {
    // this.cssMinting = 'red';
    return i18n.t('core:minting.status.synchronizing', {
      postProcess: 'capitalizeFirstChar',
    }) +
      nodeStatus.syncPercent !==
      undefined
      ? nodeStatus.syncPercent + '%'
      : '';
  } else if (
    nodeStatus.isMintingPossible === false &&
    nodeStatus.isSynchronizing === false
  ) {
    // this.cssMinting = 'red';
    return i18n.t('core:minting.status.not_minting', {
      postProcess: 'capitalizeFirstChar',
    });
  } else {
    return i18n.t('core:minting.status.no_status', {
      postProcess: 'capitalizeFirstChar',
    });
  }
};

export const averageBlockTime = (adminInfo, nodeHeightBlock) => {
  const avgBlock = adminInfo.currentTimestamp - nodeHeightBlock.timestamp;
  const averageTime = avgBlock / 1000 / 1440;
  return averageTime;
};

export const averageBlockDay = (adminInfo, nodeHeightBlock) => {
  const averageBlockDay = 86400 / averageBlockTime(adminInfo, nodeHeightBlock);
  return averageBlockDay;
};

export const levelUpBlocks = (accountInfo, nodeStatus): number => {
  if (
    accountInfo?.blocksMinted === undefined ||
    nodeStatus?.height === undefined ||
    accountTargetBlocks(accountInfo?.level) == undefined
  )
    return 0;

  const nextBatch = 1000 - (nodeStatus.height % 1000);
  const countBlocks =
    accountTargetBlocks(accountInfo?.level)! -
    (accountInfo?.blocksMinted + accountInfo?.blocksMintedAdjustment) +
    1000;
  const countBlocksActual = countBlocks + nextBatch - (countBlocks % 1000);
  return countBlocksActual;
};

export const levelUpDays = (
  accountInfo,
  adminInfo,
  nodeHeightBlock,
  nodeStatus
): number | undefined => {
  if (
    accountInfo?.blocksMinted === undefined ||
    nodeStatus?.height === undefined ||
    accountTargetBlocks(accountInfo?.level) == undefined
  )
    return undefined;

  const nextBatch = 1000 - (nodeStatus.height % 1000);
  const countBlocks =
    accountTargetBlocks(accountInfo?.level)! -
    (accountInfo?.blocksMinted + accountInfo?.blocksMintedAdjustment) +
    1000;

  const countBlocksActual = countBlocks + nextBatch - (countBlocks % 1000);
  const countDays =
    countBlocksActual / averageBlockDay(adminInfo, nodeHeightBlock);
  return countDays;
};

export const dayReward = (adminInfo, nodeHeightBlock, nodeStatus) => {
  const reward =
    averageBlockDay(adminInfo, nodeHeightBlock) * blockReward(nodeStatus);
  return reward;
};
