import {
  compareGroupCallElectionAddresses,
  compareRootForwardersSameEpoch,
} from './election-order';
import type { GroupCallTopology } from './groupCallTopology';
import {
  chooseRouterTopologyAuthority,
  DEFAULT_SAME_EPOCH_ROOT_CONFLICT_STICKY_MS,
} from './router';

export function chooseSameEpochTopologyWinner(
  current: GroupCallTopology,
  incoming: GroupCallTopology,
  roomId: string,
  electionDigests?: ReadonlyMap<string, string>,
  sameEpochRootConflictStickyMs: number = DEFAULT_SAME_EPOCH_ROOT_CONFLICT_STICKY_MS
): { acceptIncoming: boolean; reason: string } {
  const decision = chooseRouterTopologyAuthority(current, incoming, {
    roomId,
    sameEpochRootConflictStickyMs,
    compareRoots: (incomingRoot, currentRoot) => {
      const cachedComparison =
        electionDigests &&
        compareGroupCallElectionAddresses(
          incomingRoot,
          currentRoot,
          electionDigests
        );
      if (typeof cachedComparison === 'number') return cachedComparison;
      return compareRootForwardersSameEpoch(incomingRoot, currentRoot, roomId);
    },
  });
  return {
    acceptIncoming: decision.acceptIncoming,
    reason: decision.reason,
  };
}
