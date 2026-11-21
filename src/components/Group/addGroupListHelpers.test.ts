import { describe, expect, it } from 'vitest';
import { isOpenGroup, isPendingGroup, isJoinedGroup } from './AddGroupList';

// These three predicates decide whether a click on a group sends a JOIN_GROUP
// transaction (money) or a join *request*, and whether the button is disabled.
// Getting any of them wrong costs the user a fee.

describe('isOpenGroup', () => {
  it('treats a numeric 0 groupType as open', () => {
    expect(isOpenGroup({ groupType: 0 })).toBe(true);
  });

  it("treats the string '0' as open, as GroupList's Number() guard does", () => {
    // AddGroupList used `groupType === 0` strictly, so a string '0' from the
    // node rendered a public group as private and recorded a join *request*
    // instead of the join the user asked for.
    expect(isOpenGroup({ groupType: '0' })).toBe(true);
  });

  it("treats 'OPEN' as open", () => {
    expect(isOpenGroup({ groupType: 'OPEN' })).toBe(true);
  });

  it('treats isOpen === true as open', () => {
    expect(isOpenGroup({ isOpen: true })).toBe(true);
  });

  it('treats a closed group as closed', () => {
    expect(isOpenGroup({ groupType: 1 })).toBe(false);
    expect(isOpenGroup({ groupType: '1' })).toBe(false);
    expect(isOpenGroup({ groupType: 'CLOSED' })).toBe(false);
    // A missing/unknown type must not be assumed open: that would send a JOIN
    // the group may reject, taking a fee for nothing.
    expect(isOpenGroup({})).toBe(false);
    expect(isOpenGroup(null)).toBe(false);
  });
});

describe('isPendingGroup', () => {
  const tx = (over: Record<string, unknown> = {}) => ({
    type: 'joined-group',
    groupId: '7',
    done: false,
    ...over,
  });

  it('reports a pending open-group join', () => {
    expect(isPendingGroup([tx()], '7')).toBe(true);
  });

  it('reports a pending private-group join REQUEST as pending', () => {
    // A private group writes 'joined-group-request', which the predicate did
    // not match, so the row looked un-joined and every re-click signed and paid
    // for another JOIN_GROUP.
    expect(isPendingGroup([tx({ type: 'joined-group-request' })], '7')).toBe(
      true
    );
  });

  it('is not pending once done', () => {
    expect(isPendingGroup([tx({ done: true })], '7')).toBe(false);
    expect(isPendingGroup([tx({ type: 'joined-group-request', done: true })], '7')).toBe(
      false
    );
  });

  it('matches on the group, not any group', () => {
    expect(isPendingGroup([tx({ groupId: '8' })], '7')).toBe(false);
  });

  it('compares ids as strings, as the server sends numbers', () => {
    expect(isPendingGroup([tx({ groupId: 7 })], '7')).toBe(true);
    expect(isPendingGroup([tx({ groupId: 7 })], 7 as unknown as string)).toBe(
      true
    );
  });

  it('is not pending for an unrelated tx type', () => {
    expect(isPendingGroup([tx({ type: 'something-else' })], '7')).toBe(false);
  });
});

describe('isJoinedGroup', () => {
  it('matches by string id', () => {
    expect(isJoinedGroup([{ groupId: 3 }], '3')).toBe(true);
    expect(isJoinedGroup([{ groupId: 3 }], '4')).toBe(false);
  });
});
