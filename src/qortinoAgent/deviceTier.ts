import QortinoLlm, {
  isQortinoLlmNativeAvailable,
  type QortinoDeviceTier,
} from './qortinoLlm';
import {
  modelTotalBytes,
  QORTINO_MODEL,
  type QortinoModelSpec,
} from './manifest';

/** Room kept free beside the model so the disk is not left at zero. */
export const STORAGE_HEADROOM_BYTES = 300 * 1024 ** 2;

export type DeviceCheck = {
  tier: QortinoDeviceTier;
  /** Bytes still to download (parts already saved are not counted). */
  neededBytes: number;
  enoughStorage: boolean;
  /** Below the recommended RAM: the model runs, but slower and may be closed in the background. */
  lowRam: boolean;
};

export async function readDeviceTier(): Promise<QortinoDeviceTier> {
  if (!isQortinoLlmNativeAvailable()) {
    return {
      totalRamBytes: 8 * 1024 ** 3,
      availRamBytes: 4 * 1024 ** 3,
      availStorageBytes: 20 * 1024 ** 3,
      totalStorageBytes: 64 * 1024 ** 3,
      lowMemory: false,
    };
  }
  return QortinoLlm.getDeviceTier();
}

export function checkDeviceForModel(
  tier: QortinoDeviceTier,
  alreadySavedBytes = 0,
  model: QortinoModelSpec = QORTINO_MODEL
): DeviceCheck {
  const neededBytes = Math.max(0, modelTotalBytes(model) - alreadySavedBytes);
  return {
    tier,
    neededBytes,
    enoughStorage:
      tier.availStorageBytes >= neededBytes + STORAGE_HEADROOM_BYTES,
    lowRam:
      tier.totalRamBytes > 0 &&
      tier.totalRamBytes < model.recommendedRamBytes * 0.9,
  };
}
