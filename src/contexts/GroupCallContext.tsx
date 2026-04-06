import React, { createContext, useContext, useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  groupChatOpenAtom,
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
} from '../atoms/global';
import { useGroupVoiceCall } from '../hooks/useGroupVoiceCall';
import { useQortalGroupCallSidebarActivitySync } from '../hooks/useQortalGroupCallSidebarActivitySync';

export type GroupCallContextValue = ReturnType<typeof useGroupVoiceCall>;

const GroupCallContext = createContext<GroupCallContextValue | null>(null);

/**
 * Surfaces join errors from useGroupVoiceCall via the app-wide snackbar (all entry points).
 */
function GroupCallJoinErrorNotifier() {
  const { gcallJoinError, clearGcallJoinError } = useGroupCallContext();
  const setInfoSnack = useSetAtom(infoSnackGlobalAtom);
  const setOpenSnack = useSetAtom(openSnackGlobalAtom);
  const { t } = useTranslation(['core']);

  useEffect(() => {
    if (!gcallJoinError) return;
    const message =
      gcallJoinError === 'members_fetch_failed'
        ? t('core:group_call_members_fetch_failed', {
            postProcess: 'capitalizeFirstChar',
          })
        : gcallJoinError === 'presence_offline'
          ? t('core:group_call_presence_offline', {
              postProcess: 'capitalizeFirstChar',
            })
          : gcallJoinError === 'reticulum_not_ready'
            ? t('core:group_call_reticulum_not_ready', {
                postProcess: 'capitalizeFirstChar',
              })
            : gcallJoinError === 'p2p_health_not_good'
              ? t('core:group_call_p2p_health_not_good', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('core:group_call_not_member', {
                  postProcess: 'capitalizeFirstChar',
                });
    setInfoSnack({ type: 'error', message });
    setOpenSnack(true);
    clearGcallJoinError();
  }, [gcallJoinError, clearGcallJoinError, t, setInfoSnack, setOpenSnack]);

  return null;
}

/**
 * Single useGroupVoiceCall instance for support UI, agent dashboard, and Qortal group header.
 * uiActive follows the group support panel so metrics flush while that panel is open.
 */
export function GroupCallProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const groupChatOpen = useAtomValue(groupChatOpenAtom);
  useQortalGroupCallSidebarActivitySync();
  const value = useGroupVoiceCall(groupChatOpen);
  return (
    <GroupCallContext.Provider value={value}>
      <GroupCallJoinErrorNotifier />
      {children}
    </GroupCallContext.Provider>
  );
}

export function useGroupCallContext(): GroupCallContextValue {
  const ctx = useContext(GroupCallContext);
  if (!ctx) {
    throw new Error('useGroupCallContext must be used within GroupCallProvider');
  }
  return ctx;
}
