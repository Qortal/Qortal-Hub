import { useEffect, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { memberGroupsAtom, groupJoinBumpTimestampsAtom } from '../atoms/global';
import {
  readReticulumGroupOrder,
  persistReticulumGroupOrder,
} from '../components/Group/reticulumGroupRail';

const GENERAL_GROUP_ID = '0';

/**
 * Detects groups that appear in `memberGroupsAtom` after the initial load
 * and bumps them to the top of the groups sidebar — as if a new post was
 * made there — so the user can easily see a group they just joined.
 *
 * Non-rail mode: sets a bump timestamp in `groupJoinBumpTimestampsAtom`,
 * which the sort in `memberGroupsWithReticulumChatAtom` uses as
 * `Math.max(group.timestamp, bumpTimestamp)` so the group sorts first.
 *
 * Rail mode: prepends the group ID to the persisted manual order in
 * localStorage via `persistReticulumGroupOrder`.
 */
export function useBumpNewlyJoinedGroups() {
  const memberGroups = useAtomValue(memberGroupsAtom);
  const setJoinBumpTimestamps = useSetAtom(groupJoinBumpTimestampsAtom);
  const prevGroupIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const currentIds = new Set(
      (memberGroups || [])
        .map((g: any) => String(g?.groupId ?? ''))
        .filter((id) => id && id !== GENERAL_GROUP_ID)
    );

    if (prevGroupIdsRef.current === null) {
      prevGroupIdsRef.current = currentIds;
      return;
    }

    // Skip the first data load (transition from empty to populated).
    // A genuine new-group-join only happens when we already had
    // some groups and a new one appears.
    if (prevGroupIdsRef.current.size === 0) {
      prevGroupIdsRef.current = currentIds;
      return;
    }

    const newIds: string[] = [];
    for (const id of currentIds) {
      if (!prevGroupIdsRef.current.has(id)) {
        newIds.push(id);
      }
    }

    if (newIds.length > 0) {
      const now = Date.now();
      setJoinBumpTimestamps((prev) => {
        const next = { ...prev };
        for (const id of newIds) {
          next[id] = now;
        }
        return next;
      });

      const currentOrder = readReticulumGroupOrder();
      const updatedOrder = [
        ...newIds,
        ...currentOrder.filter((id) => !newIds.includes(id)),
      ];
      persistReticulumGroupOrder(updatedOrder);
    }

    prevGroupIdsRef.current = currentIds;
  }, [memberGroups, setJoinBumpTimestamps]);
}
