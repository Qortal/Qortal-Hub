import { useEffect, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  memberGroupsAtom,
  qortalGroupMeshCallActiveAtom,
} from '../atoms/global';

/**
 * Registers member group ids with Electron main and subscribes to debounced mesh activity
 * so the groups list can show call indicators. Lives under GroupCallProvider (not GroupList)
 * so it runs whenever the user is authenticated — GroupList is unmounted on home/directs.
 */
export function useQortalGroupCallSidebarActivitySync(): void {
  const groups = useAtomValue(memberGroupsAtom);
  const setMeshCallActive = useSetAtom(qortalGroupMeshCallActiveAtom);

  const watchedQortalGroupNumericIds = useMemo(() => {
    const out: number[] = [];
    for (const g of groups) {
      const id = g?.groupId;
      if (id === undefined || id === null || id === '0') continue;
      const n = Number(id);
      if (Number.isFinite(n) && n > 0) out.push(n);
    }
    out.sort((a, b) => a - b);
    return out;
  }, [groups]);

  useEffect(() => {
    const api = window.groupCall;
    if (!api?.onQortalGroupCallActivity || !api.setWatchedQortalGroupIds) {
      return;
    }
    const unsub = api.onQortalGroupCallActivity(({ activeByGroupId }) => {
      setMeshCallActive(activeByGroupId);
    });
    return () => {
      unsub();
      // Do not clear watched ids here: it races with React Strict remounts and leaves main
      // with an empty watch set until the next setWatchedQortalGroupIds, hiding sidebar call icons.
      setMeshCallActive({});
    };
  }, [setMeshCallActive]);

  useEffect(() => {
    const api = window.groupCall;
    if (!api?.setWatchedQortalGroupIds) {
      return;
    }
    let cancelled = false;
    void api
      .setWatchedQortalGroupIds(watchedQortalGroupNumericIds)
      .then((result) => {
        if (cancelled || !result?.success) return;
        setMeshCallActive(result.activeByGroupId ?? {});
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [setMeshCallActive, watchedQortalGroupNumericIds]);
}
