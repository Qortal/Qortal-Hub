export const DASHBOARD_GETTING_STARTED_DEBUG_STORAGE_KEY =
  'dashboardGettingStartedDebugOverrides';
export const DASHBOARD_GETTING_STARTED_DEBUG_EVENT =
  'setDashboardGettingStartedDebugOverrides';

export const GETTING_STARTED_DEBUG_STEPS = [
  {
    key: 'get_six_qorts',
    label: 'Get 6 QORT',
  },
  {
    key: 'register_name',
    label: 'Register Name',
  },
  {
    key: 'load_avatar',
    label: 'Load Avatar',
  },
] as const;

export type GettingStartedDebugStepKey =
  (typeof GETTING_STARTED_DEBUG_STEPS)[number]['key'];

export type GettingStartedDebugOverrides = Record<
  GettingStartedDebugStepKey,
  boolean
>;

export const EMPTY_GETTING_STARTED_DEBUG_OVERRIDES: GettingStartedDebugOverrides =
  {
    get_six_qorts: false,
    register_name: false,
    load_avatar: false,
  };

export const parseGettingStartedDebugOverrides = (
  rawValue: string | null | undefined
): GettingStartedDebugOverrides => {
  if (!rawValue) {
    return { ...EMPTY_GETTING_STARTED_DEBUG_OVERRIDES };
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<GettingStartedDebugOverrides>;
    return {
      get_six_qorts: parsed.get_six_qorts === true,
      register_name: parsed.register_name === true,
      load_avatar: parsed.load_avatar === true,
    };
  } catch {
    return { ...EMPTY_GETTING_STARTED_DEBUG_OVERRIDES };
  }
};
