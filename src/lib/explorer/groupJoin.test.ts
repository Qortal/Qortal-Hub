import { describe, expect, it, vi } from 'vitest';

vi.mock('../../App', () => ({
  getBaseApiReact: () => 'http://node.test',
}));

import {
  groupAvatarPath,
  groupIdsOf,
  groupInitial,
  joinOfferFor,
  joinsSentOf,
  type JoinContext,
} from './groupJoin';
import { DEV_GROUP_ID, MINTER_GROUP_ID } from './reads';

// What a group card offers the signed-in Hub account, read from Hub's own
// task list and list of its groups, and where a group's avatar is.

const VIEWER = `Q${'V'.repeat(33)}`;
const OTHER = `Q${'O'.repeat(33)}`;

const context = (extra: Partial<JoinContext> = {}): JoinContext => ({
  viewer: VIEWER,
  viewerGroups: new Set([11]),
  hubGroups: new Set(),
  sent: new Map(),
  ...extra,
});

const open = (groupId: number) => ({ groupId, isOpen: true });
const closed = (groupId: number) => ({ groupId, isOpen: false });

describe('groupIdsOf', () => {
  it('takes the ids of the node’s rows and of Hub’s own list, as numbers or text', () => {
    expect(
      groupIdsOf([
        { groupId: 7 },
        { groupId: '9' },
        { groupId: 0 },
        { groupId: 'x' },
        null,
        {},
      ])
    ).toEqual(new Set([7, 9]));
    expect(groupIdsOf(undefined)).toEqual(new Set());
  });
});

describe('joinsSentOf', () => {
  it('reads a join being sent, one waiting for a block, one that went through, a closed group’s request and a leave', () => {
    expect(
      joinsSentOf(
        [
          { type: 'joining-group', groupId: 5, done: false },
          { type: 'joined-group', groupId: 7, done: false },
          { type: 'joined-group', groupId: 8, done: true },
          { type: 'joined-group-request', groupId: '9', done: false },
          { type: 'joined-group-request', groupId: 10, done: true },
          { type: 'leave-group', groupId: 12, done: false },
          { type: 'created-group', groupId: 14, done: false },
        ],
        VIEWER
      )
    ).toEqual(
      new Map([
        [5, 'joining'],
        [7, 'joining'],
        [8, 'changed'],
        [9, 'asked'],
        // In a block, a request is still its admins' to decide.
        [10, 'asked'],
        [12, 'changed'],
      ])
    );
  });

  it('leaves out another account’s records, and keeps one that doesn’t say whose it is', () => {
    expect(
      joinsSentOf(
        [
          { type: 'joined-group', groupId: 7, memberAddress: OTHER },
          { type: 'joined-group-request', groupId: 9, creatorAddress: OTHER },
          { type: 'joined-group', groupId: 11, creatorAddress: VIEWER },
          { type: 'joined-group-request', groupId: 13 },
        ],
        VIEWER
      )
    ).toEqual(
      new Map([
        [11, 'joining'],
        [13, 'asked'],
      ])
    );
  });

  it('takes a group’s newest record, Hub’s task list being newest first', () => {
    expect(
      joinsSentOf(
        [
          // Left after joining.
          { type: 'leave-group', groupId: 7, done: true },
          { type: 'joined-group', groupId: 7, done: true },
          // Joining again after leaving.
          { type: 'joining-group', groupId: 9, done: false },
          { type: 'leave-group', groupId: 9, done: true },
          // Asking again after leaving.
          { type: 'joined-group-request', groupId: 11, done: false },
          { type: 'leave-group', groupId: 11, done: true },
          { type: 'joined-group-request', groupId: 11, done: true },
        ],
        VIEWER
      )
    ).toEqual(
      new Map([
        [7, 'changed'],
        [9, 'joining'],
        [11, 'asked'],
      ])
    );
  });

  it('reads nothing from records it can’t use', () => {
    expect(
      joinsSentOf(
        [{ type: 'joined-group', groupId: 'x' }, { type: 'joined-group' }, 5],
        VIEWER
      )
    ).toEqual(new Map());
    expect(joinsSentOf(null, VIEWER)).toEqual(new Map());
  });
});

describe('joinOfferFor', () => {
  it('offers Join on an open group, Ask to join on a closed one, and Join when Core doesn’t say', () => {
    expect(joinOfferFor(open(7), context())).toEqual({
      kind: 'join',
      closed: false,
    });
    expect(joinOfferFor(closed(9), context())).toEqual({
      kind: 'join',
      closed: true,
    });
    expect(joinOfferFor({ groupId: 13, isOpen: null }, context())).toEqual({
      kind: 'join',
      closed: false,
    });
  });

  it('offers nothing when no one is signed in', () => {
    expect(joinOfferFor(open(7), context({ viewer: null }))).toBeNull();
  });

  it('offers nothing on Qortal’s own groups: MINTER and the dev group', () => {
    expect(joinOfferFor(closed(MINTER_GROUP_ID), context())).toBeNull();
    expect(joinOfferFor(closed(DEV_GROUP_ID), context())).toBeNull();
  });

  it('offers nothing on a group the node or Hub has the account in', () => {
    expect(joinOfferFor(open(11), context())).toBeNull();
    expect(
      joinOfferFor(open(7), context({ hubGroups: new Set([7]) }))
    ).toBeNull();
  });

  it('offers no Join while it isn’t known whether the account is in the group', () => {
    expect(joinOfferFor(open(7), context({ viewerGroups: undefined }))).toEqual(
      { kind: 'unknown' }
    );
  });

  it('says what Hub sent in Join’s place', () => {
    const sent = new Map([
      [7, 'joining' as const],
      [9, 'asked' as const],
    ]);
    expect(joinOfferFor(open(7), context({ sent }))).toEqual({
      kind: 'joining',
    });
    expect(joinOfferFor(closed(9), context({ sent }))).toEqual({
      kind: 'asked',
    });
    // What Hub sent is known even while the account's groups are read again.
    expect(
      joinOfferFor(open(7), context({ sent, viewerGroups: undefined }))
    ).toEqual({ kind: 'joining' });
  });

  it('takes a group the account joined or left in this session as Hub’s own list has it now, whatever an older answer of the node says', () => {
    const sent = new Map([[7, 'changed' as const]]);
    // In it, as Hub's list says, though the node's older answer doesn't.
    expect(
      joinOfferFor(open(7), context({ sent, hubGroups: new Set([7]) }))
    ).toBeNull();
    // Not in it any more (left, or removed), though the node's older answer
    // still lists it.
    expect(
      joinOfferFor(open(7), context({ sent, viewerGroups: new Set([7, 11]) }))
    ).toEqual({ kind: 'join', closed: false });
  });
});

describe('a group the account joined and then left in this session', () => {
  const left = (groupId: number, joined: string) =>
    joinsSentOf(
      [
        {
          type: 'leave-group',
          groupId,
          done: true,
          creatorAddress: VIEWER,
        },
        {
          type: joined,
          groupId,
          done: true,
          creatorAddress: VIEWER,
        },
      ],
      VIEWER
    );
  // The node and Hub's own list both say it is in gamma (11) only.
  const now = (sent: JoinContext['sent']) =>
    context({ viewerGroups: new Set([11]), hubGroups: new Set([11]), sent });

  it('offers Join again on an open group it left after joining it', () => {
    expect(joinOfferFor(open(7), now(left(7, 'joined-group')))).toEqual({
      kind: 'join',
      closed: false,
    });
  });

  it('offers Ask to join again on a closed group it left after its request was accepted', () => {
    expect(
      joinOfferFor(closed(9), now(left(9, 'joined-group-request')))
    ).toEqual({ kind: 'join', closed: true });
  });
});

describe('groupAvatarPath', () => {
  it('is the THUMBNAIL its owner published for the group, the name as one encoded part', () => {
    expect(groupAvatarPath('Second', 7)).toBe(
      '/arbitrary/THUMBNAIL/Second/qortal_group_avatar_7?async=true'
    );
    expect(groupAvatarPath('Second Room/?#%', 7)).toBe(
      '/arbitrary/THUMBNAIL/Second%20Room%2F%3F%23%25/qortal_group_avatar_7?async=true'
    );
  });

  it('is no path for a name that can’t be a path part, or for no group', () => {
    expect(groupAvatarPath('..', 7)).toBeNull();
    expect(groupAvatarPath('.', 7)).toBeNull();
    expect(groupAvatarPath('', 7)).toBeNull();
    expect(groupAvatarPath('Second', Number.NaN)).toBeNull();
  });
});

describe('groupInitial', () => {
  it('is the first character a reader sees, in capitals', () => {
    expect(groupInitial('alpha')).toBe('A');
    expect(groupInitial('  beta')).toBe('B');
    expect(groupInitial('\u200B\u2800gamma')).toBe('G');
    expect(groupInitial('e\u0301clair')).toBe('E\u0301');
    expect(groupInitial('\u{1F3AE} players')).toBe('\u{1F3AE}');
  });

  it('is none for a name with nothing to see', () => {
    expect(groupInitial('')).toBeNull();
    expect(groupInitial('\u200B \u3164')).toBeNull();
    expect(groupInitial(null)).toBeNull();
  });
});
