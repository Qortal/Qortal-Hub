export function compareGroupCallElectionDigests(
  aDigest: string,
  bDigest: string
): number {
  const left = aDigest.trim();
  const right = bDigest.trim();
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function compareGroupCallElectionAddresses(
  a: string,
  b: string,
  electionDigests: ReadonlyMap<string, string>
): number | null {
  const aDigest = electionDigests.get(a)?.trim() ?? '';
  const bDigest = electionDigests.get(b)?.trim() ?? '';
  if (!aDigest || !bDigest) return null;
  return compareGroupCallElectionDigests(aDigest, bDigest);
}
