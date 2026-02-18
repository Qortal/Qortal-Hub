export interface GroupProps {
  balance: number;
  myAddress: string;
  userInfo: any;
  desktopViewMode: string;
  isMain?: boolean;
  isOpenDrawerProfile?: boolean;
  logoutFunc?: () => Promise<void>;
  setDesktopViewMode: (mode: string) => void;
  setIsOpenDrawerProfile: (open: boolean) => void;
}
