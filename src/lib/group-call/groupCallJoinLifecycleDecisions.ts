export function shouldApplyJoinSessionSnapshot(opts: {
  currentCallSessionId: string;
  hasInstalledRoomKey: boolean;
  needsSessionKey: boolean;
}): boolean {
  if (opts.hasInstalledRoomKey) return false;
  if (!opts.needsSessionKey) return false;
  return opts.currentCallSessionId === '';
}

export function shouldSubscribeToJoinedGroupCallEvents(opts: {
  roomState: 'idle' | 'joining' | 'connected' | 'ended';
  mainJoinReady: boolean;
}): boolean {
  return opts.roomState === 'connected' && opts.mainJoinReady;
}

export function shouldDelayPostJoinRosterElection(opts: {
  hydratedRemoteParticipantCount: number;
  currentRoot: string | null | undefined;
  trustedRemoteRoot: string | null | undefined;
  hasOccupiedRoomEvidence?: boolean;
}): boolean {
  if ((opts.currentRoot?.trim() ?? '') !== '') return false;
  if ((opts.trustedRemoteRoot?.trim() ?? '') !== '') return false;
  return (
    opts.hydratedRemoteParticipantCount > 0 ||
    opts.hasOccupiedRoomEvidence === true
  );
}

export function hasOccupiedRoomEvidenceForJoin(opts: {
  sameRoomRejoin: boolean;
  hydratedRemoteParticipantCount: number;
  bootstrapParticipantCount: number;
  bootstrapTopologyEpoch: number;
  bootstrapHasTopology: boolean;
  lastObservedEpoch: number;
  trustedRemoteRoot: string | null | undefined;
  bootstrapCallSessionId: string | null | undefined;
  bootstrapMediaSessionGeneration: number | null | undefined;
}): boolean {
  if (opts.hydratedRemoteParticipantCount > 0) return true;
  if (opts.bootstrapParticipantCount > 1) return true;
  if (opts.bootstrapHasTopology) return true;
  if (opts.bootstrapTopologyEpoch > 0) return true;
  if (opts.lastObservedEpoch > 0) return true;
  if ((opts.trustedRemoteRoot?.trim() ?? '') !== '') return true;
  if (!opts.sameRoomRejoin) return false;
  return (
    (opts.bootstrapCallSessionId?.trim() ?? '') !== '' ||
    (opts.bootstrapMediaSessionGeneration ?? 0) > 1
  );
}

export function shouldDeferLocalTopologyElection(opts: {
  nowMs: number;
  authorityDelayUntilMs: number;
}): boolean {
  return opts.authorityDelayUntilMs > opts.nowMs;
}

export function getPostJoinHydratedParticipants(opts: {
  localAddress: string;
  mainRoster: Array<{ address: string; publicKey: string }>;
  existingParticipants: ReadonlyMap<
    string,
    { publicKey: string; lastJoinTs: number; joinGeneration?: number }
  >;
}): Array<{ address: string; publicKey: string }> {
  const hydrated: Array<{ address: string; publicKey: string }> = [];
  const seen = new Set<string>();
  for (const participant of opts.mainRoster ?? []) {
    const address = participant?.address?.trim?.() ?? '';
    if (!address || address === opts.localAddress) continue;
    if (opts.existingParticipants.has(address) || seen.has(address)) continue;
    seen.add(address);
    hydrated.push({
      address,
      publicKey: participant?.publicKey?.trim?.() ?? '',
    });
  }
  return hydrated;
}

export function mergeHydratedParticipantsIntoUiList<T extends { address: string }>(
  opts: {
    previousParticipants: T[];
    hydratedParticipants: Array<{ address: string; publicKey: string }>;
  }
): Array<T | (T & { publicKey: string; speaking: false; role: 'participant' })> {
  const existing = new Set(opts.previousParticipants.map((p) => p.address));
  const next = opts.hydratedParticipants
    .filter((p) => !existing.has(p.address))
    .map((p) => ({
      address: p.address,
      publicKey: p.publicKey,
      speaking: false as const,
      role: 'participant' as const,
    }));
  return next.length > 0
    ? [...opts.previousParticipants, ...next]
    : opts.previousParticipants;
}

export function shouldContinueAfterParticipantJoinRefresh(opts: {
  existingJoinGeneration?: number;
  incomingJoinGeneration?: number;
}): boolean {
  return (
    opts.existingJoinGeneration === undefined &&
    opts.incomingJoinGeneration !== undefined
  );
}

export function shouldIgnoreParticipantLeftEvent(opts: {
  localAddress: string;
  leavingAddress: string;
}): boolean {
  return opts.localAddress === opts.leavingAddress;
}

export function shouldSendCachedQuitLeave(opts: {
  roomState: 'idle' | 'joining' | 'connected' | 'ended';
  hasGroupCallApi: boolean;
  hasCachedLeave: boolean;
  alreadySent: boolean;
}): boolean {
  return (
    opts.roomState === 'connected' &&
    opts.hasGroupCallApi &&
    opts.hasCachedLeave &&
    !opts.alreadySent
  );
}

export function shouldAcceptKeyRecoveryRequestGeneration(opts: {
  requestMediaSessionGeneration: number;
  localMediaSessionGeneration: number;
}): boolean {
  return opts.requestMediaSessionGeneration >= opts.localMediaSessionGeneration;
}

export function countRecentlyHealthyRemoteSources(opts: {
  lastSuccessfulDecodeAtBySource: ReadonlyMap<string, number>;
  nowMs: number;
  healthyWindowMs: number;
}): number {
  let count = 0;
  for (const [, ts] of opts.lastSuccessfulDecodeAtBySource) {
    if (opts.nowMs - ts <= opts.healthyWindowMs) count++;
  }
  return count;
}

export function shouldEscalateRoomWideKeyRecovery(opts: {
  hasRoomKey: boolean;
  repeatedFailures: boolean;
  noRecentDecode: boolean;
  recentlyHealthyRemoteSourceCount: number;
  withinPostKeyGrace?: boolean;
  prolongedNoRecentDecode?: boolean;
}): boolean {
  if (!opts.hasRoomKey) return true;
  if (opts.repeatedFailures) {
    return opts.recentlyHealthyRemoteSourceCount === 0;
  }
  if (opts.withinPostKeyGrace) return false;
  if (!opts.noRecentDecode) return false;
  return opts.prolongedNoRecentDecode === true;
}

export function shouldPromoteStandbyRootAfterHeartbeatTimeout(opts: {
  heartbeatSilentMs: number;
  heartbeatTimeoutMs: number;
  rootPeerRequiresReconnect: boolean;
}): boolean {
  if (opts.heartbeatSilentMs < opts.heartbeatTimeoutMs) return false;
  return opts.rootPeerRequiresReconnect;
}
