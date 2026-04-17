export interface GroupProps {
  myAddress: string;
  desktopViewMode: string;
  isMain?: boolean;
  logoutFunc?: () => Promise<void>;
  setDesktopViewMode: (mode: string) => void;
}
