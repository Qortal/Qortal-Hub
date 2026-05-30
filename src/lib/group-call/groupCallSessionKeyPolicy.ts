const RECENT_REMOTE_MEDIA_EVIDENCE_MS = 6_000;

export function getStartupKeyAuthorityDecision(opts: {
  myAddress: string;
  designatedRoot?: string | null | undefined;
  otherParticipantCount: number;
  nowMs: number;
  authoritySettleUntilMs: number;
  pendingVerifiedKeyCount: number;
  lastRemoteDecodeAtMs: number;
  trustedRemoteRoot?: string | null | undefined;
  conflictingRemoteRoot?: string | null | undefined;
  recentMediaEvidenceWindowMs?: number;
  hasOccupiedRoomEvidence?: boolean;
  hydratedRemoteParticipantCount?: number;
  bootstrapHasTopology?: boolean;
}):
  | {
      allowMint: true;
      reason: 'authority-wait-expired';
    }
  | {
      allowMint: false;
      reason:
        | 'not-designated-root'
        | 'startup-authority-wait'
        | 'other-participants-visible'
        | 'occupied-room-evidence'
        | 'trusted-remote-root'
        | 'conflicting-remote-root'
        | 'pending-verified-key'
        | 'recent-remote-media';
    } {
  const designatedRoot = opts.designatedRoot?.trim() ?? '';
  if (designatedRoot && designatedRoot !== opts.myAddress) {
    return { allowMint: false, reason: 'not-designated-root' };
  }
  const otherParticipantsVisible = opts.otherParticipantCount > 0;
  const occupiedRoomEvidence =
    opts.hasOccupiedRoomEvidence === true ||
    (opts.hydratedRemoteParticipantCount ?? 0) > 0 ||
    opts.bootstrapHasTopology === true;
  const trustedRoot = opts.trustedRemoteRoot?.trim() ?? '';
  if (trustedRoot && trustedRoot !== opts.myAddress) {
    return { allowMint: false, reason: 'trusted-remote-root' };
  }
  const conflictingRoot = opts.conflictingRemoteRoot?.trim() ?? '';
  if (conflictingRoot && conflictingRoot !== opts.myAddress) {
    return { allowMint: false, reason: 'conflicting-remote-root' };
  }
  if (opts.pendingVerifiedKeyCount > 0) {
    return { allowMint: false, reason: 'pending-verified-key' };
  }
  if (
    opts.lastRemoteDecodeAtMs > 0 &&
    opts.nowMs - opts.lastRemoteDecodeAtMs <=
      (opts.recentMediaEvidenceWindowMs ?? RECENT_REMOTE_MEDIA_EVIDENCE_MS)
  ) {
    return { allowMint: false, reason: 'recent-remote-media' };
  }
  if (otherParticipantsVisible && opts.nowMs < opts.authoritySettleUntilMs) {
    return { allowMint: false, reason: 'other-participants-visible' };
  }
  if (occupiedRoomEvidence && opts.nowMs < opts.authoritySettleUntilMs) {
    return { allowMint: false, reason: 'occupied-room-evidence' };
  }
  if (opts.nowMs < opts.authoritySettleUntilMs) {
    return { allowMint: false, reason: 'startup-authority-wait' };
  }
  return { allowMint: true, reason: 'authority-wait-expired' };
}

export function shouldMintRootSessionKeyImmediately(opts: {
  myAddress: string;
  designatedRoot?: string | null | undefined;
  otherParticipantCount: number;
  nowMs: number;
  authoritySettleUntilMs: number;
  pendingVerifiedKeyCount: number;
  lastRemoteDecodeAtMs: number;
  decryptFailureStreak: number;
  trustedRemoteRoot?: string | null | undefined;
  conflictingRemoteRoot?: string | null | undefined;
  recentMediaEvidenceWindowMs?: number;
  hasOccupiedRoomEvidence?: boolean;
  hydratedRemoteParticipantCount?: number;
  bootstrapHasTopology?: boolean;
}): boolean {
  return getStartupKeyAuthorityDecision(opts).allowMint;
}

export function getSessionUpdatedKeyRecoveryAction(opts: {
  myAddress: string;
  isLocalRoot: boolean;
  hasOwnedRoomKey: boolean;
  designatedRoot?: string | null | undefined;
  otherParticipantCount: number;
  nowMs: number;
  authoritySettleUntilMs: number;
  pendingVerifiedKeyCount: number;
  lastRemoteDecodeAtMs: number;
  decryptFailureStreak: number;
  trustedRemoteRoot?: string | null | undefined;
  conflictingRemoteRoot?: string | null | undefined;
  recentMediaEvidenceWindowMs?: number;
  hasOccupiedRoomEvidence?: boolean;
  hydratedRemoteParticipantCount?: number;
  bootstrapHasTopology?: boolean;
}): 'redistribute-existing' | 'mint-immediately' | 'request-recovery' {
  if (!opts.isLocalRoot) return 'request-recovery';
  if (opts.hasOwnedRoomKey) return 'redistribute-existing';
  return shouldMintRootSessionKeyImmediately(opts)
    ? 'mint-immediately'
    : 'request-recovery';
}

export function shouldAcceptIncomingRoomKeySender(opts: {
  currentRoot: string;
  senderAddress: string;
  senderInRoster: boolean;
}): boolean {
  return Boolean(opts.currentRoot) && opts.senderAddress === opts.currentRoot;
}

export function shouldAcceptIncomingRoomKeySenderRelaxed(opts: {
  currentRoot: string;
  senderAddress: string;
  senderInRoster: boolean;
  awaitingAuthoritativeKey: boolean;
  myAddress: string;
  trustedRemoteRoot: string;
  designatedRoot: string | null;
  participantCount: number;
}): boolean {
  return shouldAcceptIncomingRoomKeySender(opts);
}

export function shouldIgnoreRedundantRoomKeyDelivery(opts: {
  hasInstalledRoomKey: boolean;
  payloadCallSessionId: string;
  localCallSessionId: string;
  payloadMediaSessionGeneration: number;
  localMediaSessionGeneration: number;
  payloadKeyCommitment: string;
  installedKeyCommitment: string | null;
  sameIdentityInstallInFlight: boolean;
}): boolean {
  const sameSession =
    opts.payloadCallSessionId === opts.localCallSessionId &&
    opts.payloadMediaSessionGeneration === opts.localMediaSessionGeneration;
  if (!sameSession) return false;
  if (opts.sameIdentityInstallInFlight) return true;
  if (!opts.hasInstalledRoomKey) return false;
  return (
    !!opts.installedKeyCommitment &&
    opts.payloadKeyCommitment === opts.installedKeyCommitment
  );
}

export function shouldAdoptTrustedRootSessionDuringRecovery(opts: {
  hasInstalledRoomKey: boolean;
  senderAddress: string;
  currentRoot: string;
  payloadCallSessionId: string;
  localCallSessionId: string;
  payloadMediaSessionGeneration: number;
  localMediaSessionGeneration: number;
  decryptFailureStreak: number;
  lastRemoteDecodeAtMs: number;
  nowMs: number;
  noDecodeWindowMs: number;
  startupGraceUntilMs: number;
}): boolean {
  if (!opts.hasInstalledRoomKey) return false;
  if (!opts.currentRoot || opts.senderAddress !== opts.currentRoot) return false;
  const sessionMismatch =
    opts.payloadCallSessionId !== opts.localCallSessionId ||
    opts.payloadMediaSessionGeneration !== opts.localMediaSessionGeneration;
  if (!sessionMismatch) return false;
  if (opts.payloadMediaSessionGeneration > opts.localMediaSessionGeneration) {
    return true;
  }
  if (opts.nowMs <= opts.startupGraceUntilMs) return true;
  const repeatedFailures = opts.decryptFailureStreak >= 3;
  const noRecentDecode =
    opts.lastRemoteDecodeAtMs <= 0 ||
    opts.nowMs - opts.lastRemoteDecodeAtMs >= opts.noDecodeWindowMs;
  return repeatedFailures || noRecentDecode;
}

export function getTrustedRootForRejoinElection(opts: {
  currentRoot: string | null | undefined;
  trustedRemoteRoot: string | null | undefined;
  trustedRemoteRootLastSeenAtMs: number;
  nowMs: number;
  staleAfterMs: number;
  rosterAddresses: Iterable<string>;
}): string | null {
  const roster = new Set<string>();
  for (const rawAddress of opts.rosterAddresses) {
    const address = rawAddress.trim();
    if (address) roster.add(address);
  }
  const currentRoot = opts.currentRoot?.trim() ?? '';
  if (currentRoot && roster.has(currentRoot)) {
    return currentRoot;
  }
  const trustedRemoteRoot = opts.trustedRemoteRoot?.trim() ?? '';
  if (!trustedRemoteRoot || !roster.has(trustedRemoteRoot)) return null;
  if (opts.trustedRemoteRootLastSeenAtMs <= 0) return null;
  if (opts.nowMs - opts.trustedRemoteRootLastSeenAtMs > opts.staleAfterMs) {
    return null;
  }
  return trustedRemoteRoot;
}

export function getConflictingRootForAuthorityWait(opts: {
  currentRoot: string | null | undefined;
  conflictingRemoteRoot: string | null | undefined;
  conflictingRemoteRootLastSeenAtMs: number;
  nowMs: number;
  staleAfterMs: number;
  rosterAddresses: Iterable<string>;
}): string | null {
  const roster = new Set<string>();
  for (const rawAddress of opts.rosterAddresses) {
    const address = rawAddress.trim();
    if (address) roster.add(address);
  }
  const currentRoot = opts.currentRoot?.trim() ?? '';
  const conflictingRoot = opts.conflictingRemoteRoot?.trim() ?? '';
  if (!conflictingRoot || conflictingRoot === currentRoot) return null;
  if (!roster.has(conflictingRoot)) return null;
  if (opts.conflictingRemoteRootLastSeenAtMs <= 0) return null;
  if (opts.nowMs - opts.conflictingRemoteRootLastSeenAtMs > opts.staleAfterMs) {
    return null;
  }
  return conflictingRoot;
}

export function shouldAllowSimultaneousJoinKeyFallback(opts: {
  myAddress: string;
  designatedRoot?: string | null | undefined;
  otherParticipantCount: number;
  trustedRemoteRoot: string | null | undefined;
  conflictingRemoteRoot: string | null | undefined;
  nowMs: number;
  authoritySettleUntilMs: number;
  pendingVerifiedKeyCount?: number;
  lastRemoteDecodeAtMs?: number;
  recentMediaEvidenceWindowMs?: number;
  hasOccupiedRoomEvidence?: boolean;
  hydratedRemoteParticipantCount?: number;
  bootstrapHasTopology?: boolean;
}): boolean {
  return getStartupKeyAuthorityDecision({
    myAddress: opts.myAddress,
    designatedRoot: opts.designatedRoot,
    otherParticipantCount: opts.otherParticipantCount,
    nowMs: opts.nowMs,
    authoritySettleUntilMs: opts.authoritySettleUntilMs,
    pendingVerifiedKeyCount: opts.pendingVerifiedKeyCount ?? 0,
    lastRemoteDecodeAtMs: opts.lastRemoteDecodeAtMs ?? 0,
    trustedRemoteRoot: opts.trustedRemoteRoot,
    conflictingRemoteRoot: opts.conflictingRemoteRoot,
    recentMediaEvidenceWindowMs: opts.recentMediaEvidenceWindowMs,
    hasOccupiedRoomEvidence: opts.hasOccupiedRoomEvidence,
    hydratedRemoteParticipantCount: opts.hydratedRemoteParticipantCount,
    bootstrapHasTopology: opts.bootstrapHasTopology,
  }).allowMint;
}

function getDesignatedRootFromElectionDigests(
  addresses: string[],
  electionDigests: ReadonlyMap<string, string>,
  fallbackRoot?: string | null | undefined
): string | null {
  let winner = '';
  let winningDigest = '';
  for (const address of addresses) {
    const digest = electionDigests.get(address)?.trim() ?? '';
    if (!digest) continue;
    if (!winner || digest.localeCompare(winningDigest) < 0) {
      winner = address;
      winningDigest = digest;
    }
  }
  if (winner) return winner;
  const fallback = fallbackRoot?.trim() ?? '';
  return fallback && addresses.includes(fallback) ? fallback : null;
}

export function resolveDesignatedRootForSessionKey(opts: {
  rosterAddresses: readonly string[];
  electionDigests: ReadonlyMap<string, string>;
  topologyRootForwarder?: string | null;
}): string | null {
  const roster = [...opts.rosterAddresses];
  const digestPick = getDesignatedRootFromElectionDigests(
    roster,
    opts.electionDigests,
    opts.topologyRootForwarder
  );
  const topologyRootForwarder = opts.topologyRootForwarder?.trim() ?? '';
  if (!topologyRootForwarder || !roster.includes(topologyRootForwarder)) {
    return digestPick;
  }
  if (
    digestPick &&
    digestPick !== topologyRootForwarder &&
    roster.includes(digestPick)
  ) {
    return topologyRootForwarder;
  }
  return digestPick;
}
