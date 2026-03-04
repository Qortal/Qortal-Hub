export interface GroupProps {
  myAddress: string;
  desktopViewMode: string;
  isMain?: boolean;
  isOpenDrawerProfile?: boolean;
  logoutFunc?: () => Promise<void>;
  setDesktopViewMode: (mode: string) => void;
  setIsOpenDrawerProfile: (open: boolean) => void;
}
