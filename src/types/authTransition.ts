export type SharedElementRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export type AuthUnlockTransitionSnapshot = {
  addressLabel: string;
  addressRect: SharedElementRect;
  avatarRect: SharedElementRect;
  avatarSrc?: string;
  displayName: string;
  nameRect: SharedElementRect;
};
