export type QortinoLayoutDebugSettings = {
  musicHeaderOffsetY: number;
  nodeStatusOffsetY: number;
  prevNextOffsetY: number;
  progressOffsetY: number;
  separatorOffsetY: number;
  titleAuthorOffsetY: number;
  vinylOffsetY: number;
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
