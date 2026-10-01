import { describe, expect, it } from 'vitest';
import { filterPrivateGroups } from '../privateGroups';

describe('filterPrivateGroups', () => {
  it('keeps private admin groups that are absent from the member-group cache', () => {
    const groups = [
      { groupId: 1, groupName: 'Cached private', isOpen: false },
      { groupId: 2, groupName: 'Admin-only private', isOpen: false },
    ];
    const groupsProperties = {
      1: { isOpen: false },
    };

    expect(filterPrivateGroups(groups, groupsProperties)).toEqual(groups);
  });

  it('uses cached privacy when the group does not include it', () => {
    const privateGroup = { groupId: '3', groupName: 'Private' };
    const publicGroup = { groupId: 4, groupName: 'Public' };

    expect(
      filterPrivateGroups([privateGroup, publicGroup], {
        3: { isOpen: false },
        4: { isOpen: true },
      })
    ).toEqual([privateGroup]);
  });

  it('does not let stale cached metadata override group data', () => {
    const publicGroup = { groupId: 5, groupName: 'Public', isOpen: true };

    expect(
      filterPrivateGroups([publicGroup], {
        5: { isOpen: false },
      })
    ).toEqual([]);
  });
});
