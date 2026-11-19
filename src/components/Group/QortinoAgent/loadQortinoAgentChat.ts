/** The chat chunk (with the curated answers) loads on demand; the gate never needs it. */
export type QortinoChatModule = typeof import('./QortinoAgentChat');

export const loadQortinoAgentChat = (): Promise<QortinoChatModule> =>
  import('./QortinoAgentChat');
