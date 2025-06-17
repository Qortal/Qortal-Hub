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

export const currentTier = (addressInfo): string | undefined => {
  if (addressInfo.level === 0) {
    return 'Tier 0 (Level 0)';
  } else if (addressInfo.level === 1 || addressInfo.level === 2) {
    return 'Tier 1 (Level 1 + 2)';
  } else if (addressInfo.level === 3 || addressInfo.level === 4) {
    return 'Tier 2 (Level 3 + 4)';
  } else if (addressInfo.level === 5 || addressInfo.level === 6) {
    return 'Tier 3 (Level 5 + 6)';
  } else if (addressInfo.level === 7 || addressInfo.level === 8) {
    return 'Tier 4 (Level 7 + 8)';
  } else if (addressInfo.level === 9 || addressInfo.level === 10) {
    return 'Tier 5 (Level 9 + 10)';
  } else {
    return undefined; // fallback: should never reach this point
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

// _countLevels() {
// 		if (this.addressInfo.level === 0) {
// 			let countTier0 = (this.addressLevel[0].count).toString()
// 			return '' + countTier0
// 		} else if (this.addressInfo.level === 1) {
// 			let countTier10 = (this.addressLevel[1].count + this.addressLevel[2].count).toString()
// 			return '' + countTier10
// 		} else if (this.addressInfo.level === 2) {
// 			let countTier11 = (this.addressLevel[1].count + this.addressLevel[2].count).toString()
// 			return '' + countTier11
// 		} else if (this.addressInfo.level === 3) {
// 			let countTier20 = (this.addressLevel[3].count + this.addressLevel[4].count).toString()
// 			return '' + countTier20
// 		} else if (this.addressInfo.level === 4) {
// 			let countTier21 = (this.addressLevel[3].count + this.addressLevel[4].count).toString()
// 			return '' + countTier21
// 		} else if (this.addressInfo.level === 5) {
// 			if (this.tier4Online < 30) {
// 				let countTier30 = (this.addressLevel[5].count + this.addressLevel[6].count + this.addressLevel[7].count + this.addressLevel[8].count).toString()
// 				return '' + countTier30
// 			} else {
// 				let countTier30 = (this.addressLevel[5].count + this.addressLevel[6].count).toString()
// 				return '' + countTier30
// 			}
// 		} else if (this.addressInfo.level === 6) {
// 			if (this.tier4Online < 30) {
// 				let countTier31 = (this.addressLevel[5].count + this.addressLevel[6].count + this.addressLevel[7].count + this.addressLevel[8].count).toString()
// 				return '' + countTier31
// 			} else {
// 				let countTier31 = (this.addressLevel[5].count + this.addressLevel[6].count).toString()
// 				return '' + countTier31
// 			}
// 		} else if (this.addressInfo.level === 7) {
// 			if (this.tier4Online < 30) {
// 				let countTier40 = (this.addressLevel[5].count + this.addressLevel[6].count + this.addressLevel[7].count + this.addressLevel[8].count).toString()
// 				return '' + countTier40
// 			} else {
// 				let countTier40 = (this.addressLevel[7].count + this.addressLevel[8].count).toString()
// 				return '' + countTier40
// 			}
// 		} else if (this.addressInfo.level === 8) {
// 			if (this.tier4Online < 30) {
// 				let countTier40 = (this.addressLevel[5].count + this.addressLevel[6].count + this.addressLevel[7].count + this.addressLevel[8].count).toString()
// 				return '' + countTier40
// 			} else {
// 				let countTier41 = (this.addressLevel[7].count + this.addressLevel[8].count).toString()
// 				return '' + countTier41
// 			}
// 		} else if (this.addressInfo.level === 9) {
// 			let countTier50 = (this.addressLevel[9].count + this.addressLevel[10].count).toString()
// 			return '' + countTier50
// 		} else if (this.addressInfo.level === 10) {
// 			let countTier51 = (this.addressLevel[9].count + this.addressLevel[10].count).toString()
// 			return '' + countTier51
// 		}
// 	}

// 	_countReward() {
// 		if (this.addressInfo.level === 0) {
// 			return '0'
// 		} else if (this.addressInfo.level === 1) {
// 			let countReward10 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[1].count + this.addressLevel[2].count)).toFixed(8)
// 			let countReward11 = (countReward10).toString()
// 			return '' + countReward11
// 		} else if (this.addressInfo.level === 2) {
// 			let countReward20 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[1].count + this.addressLevel[2].count)).toFixed(8)
// 			let countReward21 = (countReward20).toString()
// 			return '' + countReward21
// 		} else if (this.addressInfo.level === 3) {
// 			let countReward30 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[3].count + this.addressLevel[4].count)).toFixed(8)
// 			let countReward31 = (countReward30).toString()
// 			return '' + countReward31
// 		} else if (this.addressInfo.level === 4) {
// 			let countReward40 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[3].count + this.addressLevel[4].count)).toFixed(8)
// 			let countReward41 = (countReward40).toString()
// 			return '' + countReward41
// 		} else if (this.addressInfo.level === 5) {
// 			if (this.tier4Online < 30) {
// 				let countReward50 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[5].count + this.addressLevel[6].count + this.addressLevel[7].count + this.addressLevel[8].count)).toFixed(8)
// 				let countReward51 = (countReward50).toString()
// 				return '' + countReward51
// 			} else {
// 				let countReward50 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[5].count + this.addressLevel[6].count)).toFixed(8)
// 				let countReward51 = (countReward50).toString()
// 				return '' + countReward51
// 			}
// 		} else if (this.addressInfo.level === 6) {
// 			if (this.tier4Online < 30) {
// 				let countReward60 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[5].count + this.addressLevel[6].count + this.addressLevel[7].count + this.addressLevel[8].count)).toFixed(8)
// 				let countReward61 = (countReward60).toString()
// 				return '' + countReward61
// 			} else {
// 				let countReward60 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[5].count + this.addressLevel[6].count)).toFixed(8)
// 				let countReward61 = (countReward60).toString()
// 				return '' + countReward61
// 			}
// 		} else if (this.addressInfo.level === 7) {
// 			if (this.tier4Online < 30) {
// 				let countReward70 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[5].count + this.addressLevel[6].count + this.addressLevel[7].count + this.addressLevel[8].count)).toFixed(8)
// 				let countReward71 = (countReward70).toString()
// 				return '' + countReward71
// 			} else {
// 				let countReward70 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[7].count + this.addressLevel[8].count)).toFixed(8)
// 				let countReward71 = (countReward70).toString()
// 				return '' + countReward71
// 			}
// 		} else if (this.addressInfo.level === 8) {
// 			if (this.tier4Online < 30) {
// 				let countReward80 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[5].count + this.addressLevel[6].count + this.addressLevel[7].count + this.addressLevel[8].count)).toFixed(8)
// 				let countReward81 = (countReward80).toString()
// 				return '' + countReward81
// 			} else {
// 				let countReward80 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[7].count + this.addressLevel[8].count)).toFixed(8)
// 				let countReward81 = (countReward80).toString()
// 				return '' + countReward81
// 			}
// 		} else if (this.addressInfo.level === 9) {
// 			let countReward90 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[9].count + this.addressLevel[10].count)).toFixed(8)
// 			let countReward91 = (countReward90).toString()
// 			return '' + countReward91
// 		} else if (this.addressInfo.level === 10) {
// 			let countReward100 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[9].count + this.addressLevel[10].count)).toFixed(8)
// 			let countReward101 = (countReward100).toString()
// 			return '' + countReward101
// 		}
// 	}

// 	_countRewardDay() {
// 		if (this.addressInfo.level === 0) {
// 			return '0'
// 		} else if (this.addressInfo.level === 1) {
// 			let countRewardDay10 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[1].count + this.addressLevel[2].count) * this._timeCalc()).toFixed(8)
// 			let countRewardDay11 = (countRewardDay10).toString()
// 			return '' + countRewardDay11
// 		} else if (this.addressInfo.level === 2) {
// 			let countRewardDay20 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[1].count + this.addressLevel[2].count) * this._timeCalc()).toFixed(8)
// 			let countRewardDay21 = (countRewardDay20).toString()
// 			return '' + countRewardDay21
// 		} else if (this.addressInfo.level === 3) {
// 			let countRewardDay30 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[3].count + this.addressLevel[4].count) * this._timeCalc()).toFixed(8)
// 			let countRewardDay31 = (countRewardDay30).toString()
// 			return '' + countRewardDay31
// 		} else if (this.addressInfo.level === 4) {
// 			let countRewardDay40 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[3].count + this.addressLevel[4].count) * this._timeCalc()).toFixed(8)
// 			let countRewardDay41 = (countRewardDay40).toString()
// 			return '' + countRewardDay41
// 		} else if (this.addressInfo.level === 5) {
// 			if (this.tier4Online < 30) {
// 				let countRewardDay50 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[5].count + this.addressLevel[6].count + this.addressLevel[7].count + this.addressLevel[8].count) * this._timeCalc()).toFixed(8)
// 				let countRewardDay51 = (countRewardDay50).toString()
// 				return '' + countRewardDay51
// 			} else {
// 				let countRewardDay50 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[5].count + this.addressLevel[6].count) * this._timeCalc()).toFixed(8)
// 				let countRewardDay51 = (countRewardDay50).toString()
// 				return '' + countRewardDay51
// 			}
// 		} else if (this.addressInfo.level === 6) {
// 			if (this.tier4Online < 30) {
// 				let countRewardDay60 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[5].count + this.addressLevel[6].count + this.addressLevel[7].count + this.addressLevel[8].count) * this._timeCalc()).toFixed(8)
// 				let countRewardDay61 = (countRewardDay60).toString()
// 				return '' + countRewardDay61
// 			} else {
// 				let countRewardDay60 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[5].count + this.addressLevel[6].count) * this._timeCalc()).toFixed(8)
// 				let countRewardDay61 = (countRewardDay60).toString()
// 				return '' + countRewardDay61
// 			}
// 		} else if (this.addressInfo.level === 7) {
// 			if (this.tier4Online < 30) {
// 				let countRewardDay70 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[5].count + this.addressLevel[6].count + this.addressLevel[7].count + this.addressLevel[8].count) * this._timeCalc()).toFixed(8)
// 				let countRewardDay71 = (countRewardDay70).toString()
// 				return '' + countRewardDay71
// 			} else {
// 				let countRewardDay70 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[7].count + this.addressLevel[8].count) * this._timeCalc()).toFixed(8)
// 				let countRewardDay71 = (countRewardDay70).toString()
// 				return '' + countRewardDay71
// 			}
// 		} else if (this.addressInfo.level === 8) {
// 			if (this.tier4Online < 30) {
// 				let countRewardDay80 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[5].count + this.addressLevel[6].count + this.addressLevel[7].count + this.addressLevel[8].count) * this._timeCalc()).toFixed(8)
// 				let countRewardDay81 = (countRewardDay80).toString()
// 				return '' + countRewardDay81
// 			} else {
// 				let countRewardDay80 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[7].count + this.addressLevel[8].count) * this._timeCalc()).toFixed(8)
// 				let countRewardDay81 = (countRewardDay80).toString()
// 				return '' + countRewardDay81
// 			}
// 		} else if (this.addressInfo.level === 9) {
// 			let countRewardDay90 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[9].count + this.addressLevel[10].count) * this._timeCalc()).toFixed(8)
// 			let countRewardDay91 = (countRewardDay90).toString()
// 			return '' + countRewardDay91
// 		} else if (this.addressInfo.level === 10) {
// 			let countRewardDay100 = ((this._blockReward() / 100 * this._tierPercent()) / (this.addressLevel[9].count + this.addressLevel[10].count) * this._timeCalc()).toFixed(8)
// 			let countRewardDay101 = (countRewardDay100).toString()
// 			return '' + countRewardDay101
// 		}
// 	}

export const mintingStatus = () => {
  if (
    this.nodeInfo.isMintingPossible === true &&
    this.nodeInfo.isSynchronizing === true
  ) {
    this.cssMinting = 'blue';
    return html`${translate('appinfo.minting')}`;
  } else if (
    this.nodeInfo.isMintingPossible === true &&
    this.nodeInfo.isSynchronizing === false
  ) {
    this.cssMinting = 'blue';
    return html`${translate('appinfo.minting')}`;
  } else if (
    this.nodeInfo.isMintingPossible === false &&
    this.nodeInfo.isSynchronizing === true
  ) {
    this.cssMinting = 'red';
    return html`(${translate('appinfo.synchronizing')}...
    ${this.nodeStatus.syncPercent !== undefined
      ? this.nodeStatus.syncPercent + '%'
      : ''})`;
  } else if (
    this.nodeInfo.isMintingPossible === false &&
    this.nodeInfo.isSynchronizing === false
  ) {
    this.cssMinting = 'red';
    return html`${translate('mintingpage.mchange9')}`;
  } else {
    return 'No Status';
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
