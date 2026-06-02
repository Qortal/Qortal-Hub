import { createContext, useContext, type ReactNode } from 'react';
import { useVoiceCall, type UseVoiceCallReturn } from '../hooks/useVoiceCall';

const VoiceCallContext = createContext<UseVoiceCallReturn | null>(null);

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const value = useVoiceCall();
  return (
    <VoiceCallContext.Provider value={value}>{children}</VoiceCallContext.Provider>
  );
}

export function useVoiceCallContext(): UseVoiceCallReturn {
  const ctx = useContext(VoiceCallContext);
  if (!ctx) {
    throw new Error('useVoiceCallContext must be used within VoiceCallProvider');
  }
  return ctx;
}
