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

export const accountLevel = (level: number): number | undefined => {
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

export const currentTier = (addressInfo): string => {
  if (addressInfo.level === 0) {
    return html`${translate('mintingpage.mchange28')} 0
    (${translate('mintingpage.mchange27')} 0)`;
  } else if (addressInfo.level === 1) {
    return html`${translate('mintingpage.mchange28')} 1
    (${translate('mintingpage.mchange27')} 1 + 2)`;
  } else if (addressInfo.level === 2) {
    return html`${translate('mintingpage.mchange28')} 1
    (${translate('mintingpage.mchange27')} 1 + 2)`;
  } else if (addressInfo.level === 3) {
    return html`${translate('mintingpage.mchange28')} 2
    (${translate('mintingpage.mchange27')} 3 + 4)`;
  } else if (addressInfo.level === 4) {
    return html`${translate('mintingpage.mchange28')} 2
    (${translate('mintingpage.mchange27')} 3 + 4)`;
  } else if (addressInfo.level === 5) {
    return html`${translate('mintingpage.mchange28')} 3
    (${translate('mintingpage.mchange27')} 5 + 6)`;
  } else if (addressInfo.level === 6) {
    return html`${translate('mintingpage.mchange28')} 3
    (${translate('mintingpage.mchange27')} 5 + 6)`;
  } else if (addressInfo.level === 7) {
    return html`${translate('mintingpage.mchange28')} 4
    (${translate('mintingpage.mchange27')} 7 + 8)`;
  } else if (addressInfo.level === 8) {
    return html`${translate('mintingpage.mchange28')} 4
    (${translate('mintingpage.mchange27')} 7 + 8)`;
  } else if (addressInfo.level === 9) {
    return html`${translate('mintingpage.mchange28')} 5
    (${translate('mintingpage.mchange27')} 9 + 10)`;
  } else if (addressInfo.level === 10) {
    return html`${translate('mintingpage.mchange28')} 5
    (${translate('mintingpage.mchange27')} 9 + 10)`;
  }
};

export const tierPercent = (addressInfo, tier4Online): number | undefined => {
  if (addressInfo.level === 0) {
    return 0;
  } else if (addressInfo.level === 1) {
    return 6;
  } else if (addressInfo.level === 2) {
    return 6;
  } else if (addressInfo.level === 3) {
    return 13;
  } else if (addressInfo.level === 4) {
    return 1;
  } else if (addressInfo.level === 5) {
    if (tier4Online < 30) {
      return 45;
    } else {
      return 19;
    }
  } else if (addressInfo.level === 6) {
    if (tier4Online < 30) {
      return 45;
    } else {
      return 19;
    }
  } else if (addressInfo.level === 7) {
    if (tier4Online < 30) {
      return 45;
    } else {
      return 26;
    }
  } else if (addressInfo.level === 8) {
    if (tier4Online < 30) {
      return 45;
    } else {
      return 26;
    }
  } else if (addressInfo.level === 9) {
    return 32;
  } else if (addressInfo.level === 10) {
    return 32;
  } else {
    return undefined;
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

export const levelUpBlocks = (accountInfo, nodeStatus) => {
  if (
    accountInfo?.blocksMinted === undefined ||
    nodeStatus?.height === undefined ||
    accountTargetBlocks(accountInfo?.level) == undefined
  )
    return null;

  const countBlocks =
    accountTargetBlocks(accountInfo?.level)! -
    (accountInfo?.blocksMinted + accountInfo?.blocksMintedAdjustment);

  const countBlocksString = countBlocks.toString();
  return countBlocksString;
};

export const levelUpDays = (
  accountInfo,
  adminInfo,
  nodeHeightBlock,
  nodeStatus
) => {
  if (
    accountInfo?.blocksMinted === undefined ||
    nodeStatus?.height === undefined ||
    accountTargetBlocks(accountInfo?.level) == undefined
  )
    return null;

  const countBlocks =
    accountTargetBlocks(accountInfo?.level)! -
    (accountInfo?.blocksMinted + accountInfo?.blocksMintedAdjustment);

  const countDays = countBlocks / averageBlockDay(adminInfo, nodeHeightBlock);
  return countDays.toFixed(2);
};

export const dayReward = (adminInfo, nodeHeightBlock, nodeStatus) => {
  const reward =
    averageBlockDay(adminInfo, nodeHeightBlock) * blockReward(nodeStatus);
  return reward;
};
