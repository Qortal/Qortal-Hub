export interface GroupProps {
  myAddress: string;
  desktopViewMode: string;
  isMain?: boolean;
  logoutFunc?: () => Promise<void>;
  onOpenSettings?: () => void;
  setDesktopViewMode: (mode: string) => void;
}
