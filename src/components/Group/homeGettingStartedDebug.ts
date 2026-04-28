export type GettingStartedDebugStepKey =
  | 'get_six_qorts'
  | 'register_name'
  | 'load_avatar';

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
