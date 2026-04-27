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
