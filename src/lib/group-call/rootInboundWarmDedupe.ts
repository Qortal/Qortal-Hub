/**
 * Dedupe keys for root→peer inbound Reticulum path warm (see useGroupVoiceCall).
 * Must stay in sync with join-generation + address construction there.
 */
export function buildRootInboundWarmDedupeKeys(
  joinGeneration: number,
  address: string
): { warmKey: string; stressKey: string } {
  return {
    warmKey: `${joinGeneration}:${address}`,
    stressKey: `${joinGeneration}:stress:${address}`,
  };
}

/** Clear warm dedupe entries for a peer so leave/rejoin can run inbound warm again. */
export function clearRootInboundWarmDedupeForPeer(
  joinGeneration: number,
  address: string,
  warmSet: Set<string>,
  stressSet: Set<string>
): void {
  const { warmKey, stressKey } = buildRootInboundWarmDedupeKeys(
    joinGeneration,
    address
  );
  warmSet.delete(warmKey);
  stressSet.delete(stressKey);
}
