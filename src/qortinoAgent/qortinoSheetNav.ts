/**
 * Open and close Qortino's panel from anywhere in Hub.
 */
import { getDefaultStore } from 'jotai';
import { qortinoAgentOpenAtom, qortinoAgentParkedAtom } from '../atoms/global';

/**
 * A Q-App or a guide opens from Qortino's answer. On a phone Qortino steps
 * aside for it; in Hub the panel stays beside the new tab, so the answer can
 * be read along with the app.
 */
export function parkQortinoAgentSheet(): void {
  /* nothing to do on desktop */
}

export function restoreQortinoAgentSheet(): boolean {
  const store = getDefaultStore();
  if (!store.get(qortinoAgentParkedAtom)) return false;
  store.set(qortinoAgentParkedAtom, false);
  store.set(qortinoAgentOpenAtom, true);
  return true;
}

/** Open Qortino's panel (from Home, the sidebar or a notification). */
export function openQortinoAgentSheet(): void {
  const store = getDefaultStore();
  store.set(qortinoAgentParkedAtom, false);
  store.set(qortinoAgentOpenAtom, true);
}

export function closeQortinoAgentSheet(): void {
  const store = getDefaultStore();
  store.set(qortinoAgentOpenAtom, false);
  store.set(qortinoAgentParkedAtom, false);
}

export function toggleQortinoAgentSheet(): void {
  const store = getDefaultStore();
  if (store.get(qortinoAgentOpenAtom)) closeQortinoAgentSheet();
  else openQortinoAgentSheet();
}
