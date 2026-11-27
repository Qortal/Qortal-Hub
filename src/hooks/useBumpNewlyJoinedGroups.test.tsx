import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { memberGroupsAtom, groupJoinBumpTimestampsAtom } from '../atoms/global';
import {
  readReticulumGroupOrder,
  persistReticulumGroupOrder,
  RETICULUM_GROUP_ORDER_STORAGE_KEY,
} from '../components/Group/reticulumGroupRail';
import { useBumpNewlyJoinedGroups } from './useBumpNewlyJoinedGroups';

vi.mock('../components/Group/reticulumGroupRail', async () => {
  const actual = await vi.importActual<
    typeof import('../components/Group/reticulumGroupRail')
  >('../components/Group/reticulumGroupRail');
  return {
    ...actual,
    persistReticulumGroupOrder: vi.fn(),
  };
});

function renderHookWithStore(store: ReturnType<typeof createStore>) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return renderHook(() => useBumpNewlyJoinedGroups(), { wrapper });
}

describe('useBumpNewlyJoinedGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem(RETICULUM_GROUP_ORDER_STORAGE_KEY);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not bump on initial load', () => {
    const store = createStore();
    store.set(memberGroupsAtom, [
      { groupId: '1', groupName: 'Alpha' },
      { groupId: '2', groupName: 'Beta' },
    ]);

    renderHookWithStore(store);

    expect(store.get(groupJoinBumpTimestampsAtom)).toEqual({});
    expect(persistReticulumGroupOrder).not.toHaveBeenCalled();
  });

  it('bumps a newly-appeared group to the top', () => {
    const store = createStore();
    store.set(memberGroupsAtom, [{ groupId: '1', groupName: 'Alpha' }]);

    const { rerender } = renderHookWithStore(store);

    act(() => {
      store.set(memberGroupsAtom, [
        { groupId: '1', groupName: 'Alpha' },
        { groupId: '2', groupName: 'Beta' },
      ]);
    });

    rerender();

    const bumps = store.get(groupJoinBumpTimestampsAtom);
    expect(bumps['2']).toBeTypeOf('number');
    expect(bumps['2']).toBeGreaterThan(0);
    expect(persistReticulumGroupOrder).toHaveBeenCalledWith(['2']);
  });

  it('does not bump the General group (id 0)', () => {
    const store = createStore();
    store.set(memberGroupsAtom, [{ groupId: '1', groupName: 'Alpha' }]);

    const { rerender } = renderHookWithStore(store);

    act(() => {
      store.set(memberGroupsAtom, [
        { groupId: '1', groupName: 'Alpha' },
        { groupId: '0', groupName: 'General' },
      ]);
    });

    rerender();

    const bumps = store.get(groupJoinBumpTimestampsAtom);
    expect(bumps['0']).toBeUndefined();
  });

  it('prepends multiple new groups to the rail order', () => {
    const store = createStore();
    store.set(memberGroupsAtom, [{ groupId: '1', groupName: 'Alpha' }]);

    const { rerender } = renderHookWithStore(store);

    act(() => {
      store.set(memberGroupsAtom, [
        { groupId: '1', groupName: 'Alpha' },
        { groupId: '2', groupName: 'Beta' },
        { groupId: '3', groupName: 'Gamma' },
      ]);
    });

    rerender();

    expect(persistReticulumGroupOrder).toHaveBeenCalledWith(['2', '3']);
  });

  it('does not re-bump already-seen groups', () => {
    const store = createStore();
    store.set(memberGroupsAtom, [
      { groupId: '1', groupName: 'Alpha' },
      { groupId: '2', groupName: 'Beta' },
    ]);

    const { rerender } = renderHookWithStore(store);

    act(() => {
      store.set(memberGroupsAtom, [
        { groupId: '1', groupName: 'Alpha' },
        { groupId: '2', groupName: 'Beta' },
      ]);
    });

    rerender();

    expect(store.get(groupJoinBumpTimestampsAtom)).toEqual({});
    expect(persistReticulumGroupOrder).not.toHaveBeenCalled();
  });

  it('does not bump all groups on initial data load from empty', () => {
    const store = createStore();
    store.set(memberGroupsAtom, []);

    const { rerender } = renderHookWithStore(store);

    act(() => {
      store.set(memberGroupsAtom, [
        { groupId: '1', groupName: 'Alpha' },
        { groupId: '2', groupName: 'Beta' },
        { groupId: '3', groupName: 'Gamma' },
      ]);
    });

    rerender();

    expect(store.get(groupJoinBumpTimestampsAtom)).toEqual({});
    expect(persistReticulumGroupOrder).not.toHaveBeenCalled();
  });
});
