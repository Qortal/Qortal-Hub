/**
 * Canonical string key for Qortal member group ids (positive integers, no leading zeros).
 * Aligns UI lookups with Electron main `activeByGroupId` built from numeric ids.
 */
export function qortalMemberGroupIdKey(groupId: unknown): string | null {
  if (groupId === undefined || groupId === null || groupId === '') return null;
  const n = Number(groupId);
  if (!Number.isFinite(n) || n <= 0) return null;
  const i = Math.trunc(n);
  if (i !== n) return null;
  return String(i);
}

/** Mesh call map from main uses these keys; `group.groupId` may be "00123" vs "123". */
export function meshCallActiveForMemberGroup(
  activeByGroupId: Record<string, boolean>,
  groupId: unknown
): boolean {
  const canonical = qortalMemberGroupIdKey(groupId);
  if (canonical && activeByGroupId[canonical]) return true;
  if (groupId !== undefined && groupId !== null && groupId !== '') {
    if (activeByGroupId[String(groupId)]) return true;
  }
  return false;
}

export function meshCallParticipantCountForMemberGroup(
  participantCountByGroupId: Record<string, number>,
  groupId: unknown
): number | null {
  const canonical = qortalMemberGroupIdKey(groupId);
  if (
    canonical &&
    Number.isFinite(participantCountByGroupId[canonical]) &&
    participantCountByGroupId[canonical] > 0
  ) {
    return Math.trunc(participantCountByGroupId[canonical]);
  }
  if (groupId !== undefined && groupId !== null && groupId !== '') {
    const count = participantCountByGroupId[String(groupId)];
    if (Number.isFinite(count) && count > 0) {
      return Math.trunc(count);
    }
  }
  return null;
}

export const meshCallMaxParticipantsForMemberGroup =
  meshCallParticipantCountForMemberGroup;
