import React, { createContext, useContext } from 'react';
import { useAtomValue } from 'jotai';
import { groupChatOpenAtom } from '../atoms/global';
import { useGroupVoiceCall } from '../hooks/useGroupVoiceCall';
import { useQortalGroupCallSidebarActivitySync } from '../hooks/useQortalGroupCallSidebarActivitySync';

export type GroupCallContextValue = ReturnType<typeof useGroupVoiceCall>;

const GroupCallContext = createContext<GroupCallContextValue | null>(null);

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
    <GroupCallContext.Provider value={value}>{children}</GroupCallContext.Provider>
  );
}

export function useGroupCallContext(): GroupCallContextValue {
  const ctx = useContext(GroupCallContext);
  if (!ctx) {
    throw new Error('useGroupCallContext must be used within GroupCallProvider');
  }
  return ctx;
}
