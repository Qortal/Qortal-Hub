export const QORTINO_LOOK_DEBUG_STORAGE_KEY = 'homeQortinoLookDebug';
export const QORTINO_LOOK_DEBUG_EVENT = 'setQortinoLookDebug';

const QORTINO_LOOK_DEBUG_MIN_SCALE = 0.55;
const QORTINO_LOOK_DEBUG_MAX_SCALE = 1.85;

export type QortinoLookDebugSettings = {
  antennaLength: number;
  antennaScale: number;
  bodyScale: number;
  bodyWidthScale: number;
  faceScale: number;
  logoScale: number;
};

export const DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS: QortinoLookDebugSettings = {
  antennaLength: 0.85,
  antennaScale: 1.7,
  bodyScale: 0.95,
  bodyWidthScale: 1,
  faceScale: 1.45,
  logoScale: 1.7,
};

const normalizeQortinoLookScale = (value: unknown) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 1;
  }

  const clamped = Math.min(
    QORTINO_LOOK_DEBUG_MAX_SCALE,
    Math.max(QORTINO_LOOK_DEBUG_MIN_SCALE, value)
  );

  return Math.round(clamped * 100) / 100;
};

export const sanitizeQortinoLookDebugSettings = (
  value: unknown
): QortinoLookDebugSettings => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS };
  }

  const parsed = value as Partial<QortinoLookDebugSettings>;

  return {
    antennaLength: normalizeQortinoLookScale(parsed.antennaLength),
    antennaScale: normalizeQortinoLookScale(parsed.antennaScale),
    bodyScale: normalizeQortinoLookScale(parsed.bodyScale),
    bodyWidthScale: normalizeQortinoLookScale(parsed.bodyWidthScale),
    faceScale: normalizeQortinoLookScale(parsed.faceScale),
    logoScale: normalizeQortinoLookScale(parsed.logoScale),
  };
};

export const parseQortinoLookDebugSettings = (
  rawValue: string | null | undefined
): QortinoLookDebugSettings => {
  if (!rawValue) {
    return { ...DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS };
  }

  try {
    return sanitizeQortinoLookDebugSettings(JSON.parse(rawValue));
  } catch {
    return { ...DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS };
  }
};

export const areQortinoLookDebugSettingsEqual = (
  left: QortinoLookDebugSettings,
  right: QortinoLookDebugSettings
) =>
  left.antennaLength === right.antennaLength &&
  left.antennaScale === right.antennaScale &&
  left.bodyScale === right.bodyScale &&
  left.bodyWidthScale === right.bodyWidthScale &&
  left.faceScale === right.faceScale &&
  left.logoScale === right.logoScale;
