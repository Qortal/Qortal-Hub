import React, { createContext, useContext, useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  infoSnackGlobalAtom,
  openSnackGlobalAtom,
} from '../atoms/global';
import type { GroupCallControllerApi } from '../lib/group-call/audioEngineTypes';

export type GroupCallContextValue = GroupCallControllerApi;

export const GroupCallContext = createContext<GroupCallContextValue | null>(null);

export function useGroupCallContext(): GroupCallContextValue {
  const ctx = useContext(GroupCallContext);
  if (!ctx) {
    throw new Error(
      'useGroupCallContext must be used within GroupCallProvider'
    );
  }
  return ctx;
}

/**
 * Surfaces join errors from the active group-call controller via the app-wide snackbar.
 */
export function GroupCallJoinErrorNotifier() {
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
              : gcallJoinError === 'not_group_member' ||
                  gcallJoinError === 'member_gate_failed'
                ? t('core:group_call_not_member', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : gcallJoinError === 'join_sign_failed' ||
                    gcallJoinError === 'groupcall_api_missing' ||
                    gcallJoinError === 'missing-user'
                  ? t('core:group_call_join_sign_or_setup_failed', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('core:group_call_join_failed_generic', {
                      code: gcallJoinError,
                      postProcess: 'capitalizeFirstChar',
                    });
    setInfoSnack({ type: 'error', message });
    setOpenSnack(true);
    clearGcallJoinError();
  }, [gcallJoinError, clearGcallJoinError, t, setInfoSnack, setOpenSnack]);

  return null;
}
