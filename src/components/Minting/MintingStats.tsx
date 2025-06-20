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
    return 'Tier 0 (Level 0)';
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

export const tierPercent = (accountInfo, tier4Online): number | undefined => {
  if (accountInfo.level === 0) {
    return 0;
  } else if (accountInfo.level === 1) {
    return 6;
  } else if (accountInfo.level === 2) {
    return 6;
  } else if (accountInfo.level === 3) {
    return 13;
  } else if (accountInfo.level === 4) {
    return 1;
  } else if (accountInfo.level === 5) {
    if (tier4Online < 30) {
      return 45;
    } else {
      return 19;
    }
  } else if (accountInfo.level === 6) {
    if (tier4Online < 30) {
      return 45;
    } else {
      return 19;
    }
  } else if (accountInfo.level === 7) {
    if (tier4Online < 30) {
      return 45;
    } else {
      return 26;
    }
  } else if (accountInfo.level === 8) {
    if (tier4Online < 30) {
      return 45;
    } else {
      return 26;
    }
  } else if (accountInfo.level === 9) {
    return 32;
  } else if (accountInfo.level === 10) {
    return 32;
  } else {
    return undefined; // fallback: should never reach this point
  }
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

// 	_countReward() {
// 		if (accountInfo.level === 0) {
// 			return '0'
// 		} else if (accountInfo.level === 1) {
// 			const countReward10 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[1].count + addressLevel[2].count)).toFixed(8)
// 			const countReward11 = (countReward10).toString()
// 			return countReward11
// 		} else if (accountInfo.level === 2) {
// 			const countReward20 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[1].count + addressLevel[2].count)).toFixed(8)
// 			const countReward21 = (countReward20).toString()
// 			return countReward21
// 		} else if (accountInfo.level === 3) {
// 			const countReward30 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[3].count + addressLevel[4].count)).toFixed(8)
// 			const countReward31 = (countReward30).toString()
// 			return countReward31
// 		} else if (accountInfo.level === 4) {
// 			const countReward40 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[3].count + addressLevel[4].count)).toFixed(8)
// 			const countReward41 = (countReward40).toString()
// 			return countReward41
// 		} else if (accountInfo.level === 5) {
// 			if (this.tier4Online < 30) {
// 				const countReward50 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[5].count + addressLevel[6].count + addressLevel[7].count + addressLevel[8].count)).toFixed(8)
// 				const countReward51 = (countReward50).toString()
// 				return countReward51
// 			} else {
// 				const countReward50 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[5].count + addressLevel[6].count)).toFixed(8)
// 				const countReward51 = (countReward50).toString()
// 				return countReward51
// 			}
// 		} else if (accountInfo.level === 6) {
// 			if (this.tier4Online < 30) {
// 				const countReward60 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[5].count + addressLevel[6].count + addressLevel[7].count + addressLevel[8].count)).toFixed(8)
// 				const countReward61 = (countReward60).toString()
// 				return countReward61
// 			} else {
// 				const countReward60 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[5].count + addressLevel[6].count)).toFixed(8)
// 				const countReward61 = (countReward60).toString()
// 				return countReward61
// 			}
// 		} else if (accountInfo.level === 7) {
// 			if (this.tier4Online < 30) {
// 				const countReward70 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[5].count + addressLevel[6].count + addressLevel[7].count + addressLevel[8].count)).toFixed(8)
// 				const countReward71 = (countReward70).toString()
// 				return countReward71
// 			} else {
// 				const countReward70 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[7].count + addressLevel[8].count)).toFixed(8)
// 				const countReward71 = (countReward70).toString()
// 				return countReward71
// 			}
// 		} else if (accountInfo.level === 8) {
// 			if (this.tier4Online < 30) {
// 				const countReward80 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[5].count + addressLevel[6].count + addressLevel[7].count + addressLevel[8].count)).toFixed(8)
// 				const countReward81 = (countReward80).toString()
// 				return countReward81
// 			} else {
// 				const countReward80 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[7].count + addressLevel[8].count)).toFixed(8)
// 				const countReward81 = (countReward80).toString()
// 				return countReward81
// 			}
// 		} else if (accountInfo.level === 9) {
// 			const countReward90 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[9].count + addressLevel[10].count)).toFixed(8)
// 			const countReward91 = (countReward90).toString()
// 			return countReward91
// 		} else if (accountInfo.level === 10) {
// 			const countReward100 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[9].count + addressLevel[10].count)).toFixed(8)
// 			const countReward101 = (countReward100).toString()
// 			return countReward101
// 		}
// 	}

// 	_countRewardDay() {
// 		if (accountInfo.level === 0) {
// 			return '0'
// 		} else if (accountInfo.level === 1) {
// 			const countRewardDay10 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[1].count + addressLevel[2].count) * this._timeCalc()).toFixed(8)
// 			const countRewardDay11 = (countRewardDay10).toString()
// 			return countRewardDay11
// 		} else if (accountInfo.level === 2) {
// 			const countRewardDay20 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[1].count + addressLevel[2].count) * this._timeCalc()).toFixed(8)
// 			const countRewardDay21 = (countRewardDay20).toString()
// 			return countRewardDay21
// 		} else if (accountInfo.level === 3) {
// 			const countRewardDay30 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[3].count + addressLevel[4].count) * this._timeCalc()).toFixed(8)
// 			const countRewardDay31 = (countRewardDay30).toString()
// 			return countRewardDay31
// 		} else if (accountInfo.level === 4) {
// 			const countRewardDay40 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[3].count + addressLevel[4].count) * this._timeCalc()).toFixed(8)
// 			const countRewardDay41 = (countRewardDay40).toString()
// 			return countRewardDay41
// 		} else if (accountInfo.level === 5) {
// 			if (this.tier4Online < 30) {
// 				const countRewardDay50 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[5].count + addressLevel[6].count + addressLevel[7].count + addressLevel[8].count) * this._timeCalc()).toFixed(8)
// 				const countRewardDay51 = (countRewardDay50).toString()
// 				return countRewardDay51
// 			} else {
// 				const countRewardDay50 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[5].count + addressLevel[6].count) * this._timeCalc()).toFixed(8)
// 				const countRewardDay51 = (countRewardDay50).toString()
// 				return countRewardDay51
// 			}
// 		} else if (accountInfo.level === 6) {
// 			if (this.tier4Online < 30) {
// 				const countRewardDay60 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[5].count + addressLevel[6].count + addressLevel[7].count + addressLevel[8].count) * this._timeCalc()).toFixed(8)
// 				const countRewardDay61 = (countRewardDay60).toString()
// 				return countRewardDay61
// 			} else {
// 				const countRewardDay60 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[5].count + addressLevel[6].count) * this._timeCalc()).toFixed(8)
// 				const countRewardDay61 = (countRewardDay60).toString()
// 				return countRewardDay61
// 			}
// 		} else if (accountInfo.level === 7) {
// 			if (this.tier4Online < 30) {
// 				const countRewardDay70 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[5].count + addressLevel[6].count + addressLevel[7].count + addressLevel[8].count) * this._timeCalc()).toFixed(8)
// 				const countRewardDay71 = (countRewardDay70).toString()
// 				return countRewardDay71
// 			} else {
// 				const countRewardDay70 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[7].count + addressLevel[8].count) * this._timeCalc()).toFixed(8)
// 				const countRewardDay71 = (countRewardDay70).toString()
// 				return countRewardDay71
// 			}
// 		} else if (accountInfo.level === 8) {
// 			if (this.tier4Online < 30) {
// 				const countRewardDay80 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[5].count + addressLevel[6].count + addressLevel[7].count + addressLevel[8].count) * this._timeCalc()).toFixed(8)
// 				const countRewardDay81 = (countRewardDay80).toString()
// 				return countRewardDay81
// 			} else {
// 				const countRewardDay80 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[7].count + addressLevel[8].count) * this._timeCalc()).toFixed(8)
// 				const countRewardDay81 = (countRewardDay80).toString()
// 				return countRewardDay81
// 			}
// 		} else if (accountInfo.level === 9) {
// 			const countRewardDay90 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[9].count + addressLevel[10].count) * this._timeCalc()).toFixed(8)
// 			const countRewardDay91 = (countRewardDay90).toString()
// 			return countRewardDay91
// 		} else if (accountInfo.level === 10) {
// 			const countRewardDay100 = ((this._blockReward() / 100 * this._tierPercent()) / (addressLevel[9].count + addressLevel[10].count) * this._timeCalc()).toFixed(8)
// 			const countRewardDay101 = (countRewardDay100).toString()
// 			return countRewardDay101
// 		}
// 	}

export const mintingStatus = (nodeStatus): string => {
  if (
    nodeStatus.isMintingPossible === true &&
    nodeStatus.isSynchronizing === true
  ) {
    // this.cssMinting = 'blue';
    return i18n.t('core:message.status.minting', {
      postProcess: 'capitalizeFirstChar',
    });
  } else if (
    nodeStatus.isMintingPossible === true &&
    nodeStatus.isSynchronizing === false
  ) {
    // this.cssMinting = 'blue';
    return i18n.t('core:message.status.minting', {
      postProcess: 'capitalizeFirstChar',
    });
  } else if (
    nodeStatus.isMintingPossible === false &&
    nodeStatus.isSynchronizing === true
  ) {
    // this.cssMinting = 'red';
    return i18n.t('core:message.status.synchronizing', {
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
    return i18n.t('core:message.status.not_minting', {
      postProcess: 'capitalizeFirstChar',
    });
  } else {
    return i18n.t('core:message.status.no_status', {
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
): number | undefined => {
  if (
    accountInfo?.blocksMinted === undefined ||
    nodeStatus?.height === undefined ||
    accountTargetBlocks(accountInfo?.level) == undefined
  )
    return undefined;

  const countBlocks =
    accountTargetBlocks(accountInfo?.level)! -
    (accountInfo?.blocksMinted + accountInfo?.blocksMintedAdjustment);

  const countDays = countBlocks / averageBlockDay(adminInfo, nodeHeightBlock);
  return countDays;
};

export const dayReward = (adminInfo, nodeHeightBlock, nodeStatus) => {
  const reward =
    averageBlockDay(adminInfo, nodeHeightBlock) * blockReward(nodeStatus);
  return reward;
};
