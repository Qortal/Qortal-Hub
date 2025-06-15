const accountTargetBlocks = (level: number) => {
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
    return 0; // fallback: should never reach this point
  }
};

export const accountLevel = (level: number): number => {
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
    return 0; // fallback: should never reach this point
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

export const averageBlockDay = (adminInfo, nodeHeightBlock) => {
  const time = adminInfo.currentTimestamp - nodeHeightBlock.timestamp;
  const average: number = time / 1000 / 1440;
  const averageBlockDay = 86400 / average;
  return averageBlockDay;
};

export const averageBlockTime = (adminInfo, nodeHeightBlock) => {
  const avgBlockString = adminInfo.currentTimestamp - nodeHeightBlock.timestamp;
  const averageTimeString = avgBlockString / 1000 / 1440;
  return averageTimeString;
};

export const levelUpBlocks = (accountInfo, nodeStatus) => {
  if (
    accountInfo?.blocksMinted === undefined ||
    nodeStatus?.height === undefined
  )
    return null;

  const countBlocks =
    accountTargetBlocks(accountInfo?.level) -
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
    nodeStatus?.height === undefined
  )
    return null;

  const countBlocks =
    accountTargetBlocks(accountInfo?.level) -
    (accountInfo?.blocksMinted + accountInfo?.blocksMintedAdjustment);

  const countDays = countBlocks / averageBlockDay(adminInfo, nodeHeightBlock);
  return countDays.toFixed(2);
};

export const dayReward = (adminInfo, nodeHeightBlock, nodeStatus) => {
  const reward =
    averageBlockDay(adminInfo, nodeHeightBlock) * blockReward(nodeStatus);
  return reward;
};
