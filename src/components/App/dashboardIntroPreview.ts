export const DASHBOARD_LOGIN_INTRO_PREVIEW_STORAGE_KEY =
  'dashboardLoginIntroPreviewMode';
export const DASHBOARD_LOGIN_INTRO_PREVIEW_EVENT =
  'setDashboardLoginIntroPreview';

export const DASHBOARD_LOGIN_INTRO_MODES = [
  { key: 'off', label: 'Off' },
  { key: 'fade', label: 'Fade' },
  { key: 'rise', label: 'Rise' },
  { key: 'settle', label: 'Settle' },
] as const;

export type DashboardLoginIntroMode =
  (typeof DASHBOARD_LOGIN_INTRO_MODES)[number]['key'];

export const parseDashboardLoginIntroMode = (
  value: string | null | undefined
): DashboardLoginIntroMode =>
  DASHBOARD_LOGIN_INTRO_MODES.some((mode) => mode.key === value)
    ? (value as DashboardLoginIntroMode)
    : 'off';

export const getNextDashboardLoginIntroMode = (
  currentMode: DashboardLoginIntroMode
): DashboardLoginIntroMode => {
  const currentIndex = DASHBOARD_LOGIN_INTRO_MODES.findIndex(
    (mode) => mode.key === currentMode
  );

  if (currentIndex === -1) {
    return DASHBOARD_LOGIN_INTRO_MODES[0].key;
  }

  return DASHBOARD_LOGIN_INTRO_MODES[
    (currentIndex + 1) % DASHBOARD_LOGIN_INTRO_MODES.length
  ].key;
};

export const getDashboardLoginIntroModeLabel = (
  mode: DashboardLoginIntroMode
) =>
  DASHBOARD_LOGIN_INTRO_MODES.find((option) => option.key === mode)?.label ??
  'Off';
