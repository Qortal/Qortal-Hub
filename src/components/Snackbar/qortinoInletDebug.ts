export const QORTINO_INLET_DEBUG_STORAGE_KEY = 'qortinoInletDebug';
export const QORTINO_INLET_DEBUG_EVENT = 'setQortinoInletDebug';

const QORTINO_INLET_DEBUG_MIN_SCALE = 0.7;
const QORTINO_INLET_DEBUG_MAX_SCALE = 1.4;
const QORTINO_INLET_DEBUG_MIN_ROUNDNESS = 0.72;
const QORTINO_INLET_DEBUG_MAX_ROUNDNESS = 1.28;
const QORTINO_INLET_DEBUG_MIN_OFFSET = -40;
const QORTINO_INLET_DEBUG_MAX_OFFSET = 40;

export type QortinoInletDebugSettings = {
  faceHeightScale: number;
  faceWidthScale: number;
  headHeightScale: number;
  headWidthScale: number;
  offsetX: number;
  offsetY: number;
  shellRoundness: number;
};

export const DEFAULT_QORTINO_INLET_DEBUG_SETTINGS: QortinoInletDebugSettings = {
  faceHeightScale: 1.3,
  faceWidthScale: 1.15,
  headHeightScale: 1.1,
  headWidthScale: 1.05,
  offsetX: -4,
  offsetY: -5,
  shellRoundness: 1.2,
};

const normalizeScale = (value: unknown) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 1;
  }

  const clamped = Math.min(
    QORTINO_INLET_DEBUG_MAX_SCALE,
    Math.max(QORTINO_INLET_DEBUG_MIN_SCALE, value)
  );

  return Math.round(clamped * 100) / 100;
};

const normalizeRoundness = (value: unknown) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 1;
  }

  const clamped = Math.min(
    QORTINO_INLET_DEBUG_MAX_ROUNDNESS,
    Math.max(QORTINO_INLET_DEBUG_MIN_ROUNDNESS, value)
  );

  return Math.round(clamped * 100) / 100;
};

const normalizeOffset = (value: unknown) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }

  return Math.min(
    QORTINO_INLET_DEBUG_MAX_OFFSET,
    Math.max(QORTINO_INLET_DEBUG_MIN_OFFSET, Math.round(value))
  );
};

export const sanitizeQortinoInletDebugSettings = (
  value: unknown
): QortinoInletDebugSettings => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_QORTINO_INLET_DEBUG_SETTINGS };
  }

  const parsed = value as Partial<QortinoInletDebugSettings>;

  return {
    faceHeightScale: normalizeScale(parsed.faceHeightScale),
    faceWidthScale: normalizeScale(parsed.faceWidthScale),
    headHeightScale: normalizeScale(parsed.headHeightScale),
    headWidthScale: normalizeScale(parsed.headWidthScale),
    offsetX: normalizeOffset(parsed.offsetX),
    offsetY: normalizeOffset(parsed.offsetY),
    shellRoundness: normalizeRoundness(parsed.shellRoundness),
  };
};

export const parseQortinoInletDebugSettings = (
  rawValue: string | null | undefined
): QortinoInletDebugSettings => {
  if (!rawValue) {
    return { ...DEFAULT_QORTINO_INLET_DEBUG_SETTINGS };
  }

  try {
    return sanitizeQortinoInletDebugSettings(JSON.parse(rawValue));
  } catch {
    return { ...DEFAULT_QORTINO_INLET_DEBUG_SETTINGS };
  }
};

export const areQortinoInletDebugSettingsEqual = (
  left: QortinoInletDebugSettings,
  right: QortinoInletDebugSettings
) =>
  left.faceHeightScale === right.faceHeightScale &&
  left.faceWidthScale === right.faceWidthScale &&
  left.headHeightScale === right.headHeightScale &&
  left.headWidthScale === right.headWidthScale &&
  left.offsetX === right.offsetX &&
  left.offsetY === right.offsetY &&
  left.shellRoundness === right.shellRoundness;
