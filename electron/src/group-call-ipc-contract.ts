export type GroupCallJoinIpcArguments = [
  roomId: string,
  chatId: string,
  localAddress: string,
  signature: string,
  publicKey: string,
  timestamp: number,
  reticulumDestinationHash: string,
  joinGeneration?: number,
  topologyEpochFloor?: number,
  reticulumIdentityPublicKeyBase64?: string,
  joinRkSignature?: string,
  dmVoiceAudioLinkRole?: 'opener' | 'waiter',
  takeover?: boolean,
  dmVoicePeerDestinationHash?: string,
  dmVoiceCallId?: string,
];

type IpcInvoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

/**
 * Keep every renderer's group-call join bridge on the same positional IPC
 * contract. Dropping a trailing argument can change the signed join envelope
 * after it crosses into main and causes otherwise valid peers to be rejected.
 */
export function invokeGroupCallJoin(
  invoke: IpcInvoke,
  ...args: GroupCallJoinIpcArguments
): Promise<unknown> {
  return invoke('gcall:join', ...args);
}
