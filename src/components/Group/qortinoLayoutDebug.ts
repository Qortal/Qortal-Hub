export const QORTINO_LAYOUT_DEBUG_STORAGE_KEY = 'qortinoLayoutDebug';
export const QORTINO_LAYOUT_DEBUG_EVENT = 'setQortinoLayoutDebug';

const QORTINO_LAYOUT_DEBUG_MIN_OFFSET = -80;
const QORTINO_LAYOUT_DEBUG_MAX_OFFSET = 80;

export type QortinoLayoutDebugSettings = {
  musicHeaderOffsetY: number;
  nodeStatusOffsetY: number;
  prevNextOffsetY: number;
  progressOffsetY: number;
  separatorOffsetY: number;
  titleAuthorOffsetY: number;
  vinylOffsetY: number;
};

const LEGACY_QORTINO_LAYOUT_DEBUG_SETTINGS: QortinoLayoutDebugSettings = {
  musicHeaderOffsetY: 25,
  nodeStatusOffsetY: -5,
  prevNextOffsetY: 25,
  progressOffsetY: 32,
  separatorOffsetY: 24,
  titleAuthorOffsetY: 22,
  vinylOffsetY: 21,
};

export const DEFAULT_QORTINO_LAYOUT_DEBUG_SETTINGS: QortinoLayoutDebugSettings =
  {
    musicHeaderOffsetY: 15,
    nodeStatusOffsetY: -5,
    prevNextOffsetY: 15,
    progressOffsetY: 28,
    separatorOffsetY: 24,
    titleAuthorOffsetY: 19,
    vinylOffsetY: 13,
  };

const normalizeOffset = (value: unknown) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }

  return Math.min(
    QORTINO_LAYOUT_DEBUG_MAX_OFFSET,
    Math.max(QORTINO_LAYOUT_DEBUG_MIN_OFFSET, Math.round(value))
  );
};

export const sanitizeQortinoLayoutDebugSettings = (
  value: unknown
): QortinoLayoutDebugSettings => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_QORTINO_LAYOUT_DEBUG_SETTINGS };
  }

  const parsed = value as Partial<QortinoLayoutDebugSettings>;

  return {
    musicHeaderOffsetY: normalizeOffset(parsed.musicHeaderOffsetY),
    nodeStatusOffsetY: normalizeOffset(parsed.nodeStatusOffsetY),
    prevNextOffsetY: normalizeOffset(parsed.prevNextOffsetY),
    progressOffsetY: normalizeOffset(parsed.progressOffsetY),
    separatorOffsetY: normalizeOffset(parsed.separatorOffsetY),
    titleAuthorOffsetY: normalizeOffset(parsed.titleAuthorOffsetY),
    vinylOffsetY: normalizeOffset(parsed.vinylOffsetY),
  };
};

export const parseQortinoLayoutDebugSettings = (
  rawValue: string | null | undefined
): QortinoLayoutDebugSettings => {
  if (!rawValue) {
    return { ...DEFAULT_QORTINO_LAYOUT_DEBUG_SETTINGS };
  }

  try {
    const sanitized = sanitizeQortinoLayoutDebugSettings(JSON.parse(rawValue));

    return areQortinoLayoutDebugSettingsEqual(
      sanitized,
      LEGACY_QORTINO_LAYOUT_DEBUG_SETTINGS
    )
      ? { ...DEFAULT_QORTINO_LAYOUT_DEBUG_SETTINGS }
      : sanitized;
  } catch {
    return { ...DEFAULT_QORTINO_LAYOUT_DEBUG_SETTINGS };
  }
};

export const areQortinoLayoutDebugSettingsEqual = (
  left: QortinoLayoutDebugSettings,
  right: QortinoLayoutDebugSettings
) =>
  left.musicHeaderOffsetY === right.musicHeaderOffsetY &&
  left.nodeStatusOffsetY === right.nodeStatusOffsetY &&
  left.prevNextOffsetY === right.prevNextOffsetY &&
  left.progressOffsetY === right.progressOffsetY &&
  left.separatorOffsetY === right.separatorOffsetY &&
  left.titleAuthorOffsetY === right.titleAuthorOffsetY &&
  left.vinylOffsetY === right.vinylOffsetY;
