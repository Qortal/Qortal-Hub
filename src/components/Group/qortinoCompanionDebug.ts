export const QORTINO_COMPANION_DEBUG_STORAGE_KEY = 'qortinoCompanionDebug';
export const QORTINO_COMPANION_DEBUG_EVENT = 'setQortinoCompanionDebug';

const QORTINO_COMPANION_DEBUG_MIN_OFFSET = -80;
const QORTINO_COMPANION_DEBUG_MAX_OFFSET = 80;

export type QortinoCompanionDebugSettings = {
  bubbleOffsetX: number;
  bubbleOffsetY: number;
  nameOffsetX: number;
  nameOffsetY: number;
  statusOffsetX: number;
  statusOffsetY: number;
};

export const DEFAULT_QORTINO_COMPANION_DEBUG_SETTINGS: QortinoCompanionDebugSettings = {
  bubbleOffsetX: -10,
  bubbleOffsetY: 2,
  nameOffsetX: -1,
  nameOffsetY: 28,
  statusOffsetX: -1,
  statusOffsetY: 24,
};

const normalizeOffset = (value: unknown) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }

  return Math.min(
    QORTINO_COMPANION_DEBUG_MAX_OFFSET,
    Math.max(QORTINO_COMPANION_DEBUG_MIN_OFFSET, Math.round(value))
  );
};

export const sanitizeQortinoCompanionDebugSettings = (
  value: unknown
): QortinoCompanionDebugSettings => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_QORTINO_COMPANION_DEBUG_SETTINGS };
  }

  const parsed = value as Partial<QortinoCompanionDebugSettings>;

  return {
    bubbleOffsetX: normalizeOffset(parsed.bubbleOffsetX),
    bubbleOffsetY: normalizeOffset(parsed.bubbleOffsetY),
    nameOffsetX: normalizeOffset(parsed.nameOffsetX),
    nameOffsetY: normalizeOffset(parsed.nameOffsetY),
    statusOffsetX: normalizeOffset(parsed.statusOffsetX),
    statusOffsetY: normalizeOffset(parsed.statusOffsetY),
  };
};

export const parseQortinoCompanionDebugSettings = (
  rawValue: string | null | undefined
): QortinoCompanionDebugSettings => {
  if (!rawValue) {
    return { ...DEFAULT_QORTINO_COMPANION_DEBUG_SETTINGS };
  }

  try {
    return sanitizeQortinoCompanionDebugSettings(JSON.parse(rawValue));
  } catch {
    return { ...DEFAULT_QORTINO_COMPANION_DEBUG_SETTINGS };
  }
};

export const areQortinoCompanionDebugSettingsEqual = (
  left: QortinoCompanionDebugSettings,
  right: QortinoCompanionDebugSettings
) =>
  left.bubbleOffsetX === right.bubbleOffsetX &&
  left.bubbleOffsetY === right.bubbleOffsetY &&
  left.nameOffsetX === right.nameOffsetX &&
  left.nameOffsetY === right.nameOffsetY &&
  left.statusOffsetX === right.statusOffsetX &&
  left.statusOffsetY === right.statusOffsetY;
