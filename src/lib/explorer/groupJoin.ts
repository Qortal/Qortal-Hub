/**
 * Joining a group from the Explorer, and a group's avatar: what each of
 * the Overview's group cards offers the signed-in Hub account, and where
 * the group's picture is. Pure: no reads, no text (GroupsSection puts it
 * into words).
 *
 * The Explorer signs and sends nothing. Join opens Hub's own join window
 * (GlobalActions/JoinGroup), which reads the group, says whether it is
 * open or closed, asks for the fee and sends the join itself. What Hub
 * did comes back here through Hub's own state, which Hub keeps up to date:
 * its task list (`txListAtom`) and its list of the account's groups
 * (`memberGroupsAtom`). Nothing here reads or polls for it.
 */
import { seg } from './core';
import { DEV_GROUP_ID, MINTER_GROUP_ID, type GroupOf } from './reads';

/**
 * What Hub did about a group this session, as its newest record says: a
 * join on its way or waiting for a block (`joining`), a closed group's join
 * request, which its admins decide on (`asked`), or a join that went
 * through or a leave (`changed`: whether the account is in it now is Hub's
 * own list's to say, the node's answer may be older).
 */
export type JoinSent = 'joining' | 'asked' | 'changed';

/**
 * What a group card offers:
 * - `join`: a button, "Ask to join" for a closed group (`closed`);
 * - `joining` / `asked`: Hub sent it; said in the button's place;
 * - `unknown`: whether the account is in it isn't known (its groups are
 *   being read, or that read failed), so no Join;
 * - null: nothing (no one is signed in, the account is in it, or one of
 *   Qortal's own groups: MINTER and the dev group).
 */
export type JoinOffer =
  | { kind: 'join'; closed: boolean }
  | { kind: 'joining' }
  | { kind: 'asked' }
  | { kind: 'unknown' }
  | null;

export interface JoinContext {
  /** The signed-in Hub account, or null. */
  viewer: string | null;
  /** The groups it is in, as the node answered; undefined while not known. */
  viewerGroups: ReadonlySet<number> | undefined;
  /** The groups Hub's own list has it in (memberGroupsAtom). */
  hubGroups: ReadonlySet<number>;
  /** What Hub did about each group this session (joinsSentOf). */
  sent: ReadonlyMap<number, JoinSent>;
}

/**
 * Qortal's own groups, which no one joins from a card: MINTER (its members
 * mint; new ones come in through Q-Mintership's nominations and the Minter
 * Admins' decisions) and the dev group (Qortal's developers).
 */
export const isSpecialGroup = (groupId: number): boolean =>
  groupId === MINTER_GROUP_ID || groupId === DEV_GROUP_ID;

/** The group ids in a list of groups (the node's rows, or Hub's own list). */
export function groupIdsOf(groups: unknown): Set<number> {
  const ids = new Set<number>();
  for (const group of Array.isArray(groups) ? groups : []) {
    const id = Number((group as { groupId?: unknown } | null)?.groupId);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * What Hub did about each group for `viewer` this session, from Hub's task
 * list (`txListAtom`), newest first. Hub's join window puts a join there
 * once its fee is accepted (`joining-group`, while it is being sent); Hub's
 * own ways to join (its join window, Find groups, promoted groups, invites,
 * an event's card) add `joined-group` for an open group, marked done once
 * the account is in it (TaskManager), or `joined-group-request` for a
 * closed one; leaving adds `leave-group`. A Q-App's own JOIN_GROUP request
 * adds nothing. The newest record of a group says where it stands. A record
 * of another account is left out; one that doesn't say whose it is belongs
 * to the signed-in account (Hub clears them at sign-out).
 */
export function joinsSentOf(
  records: unknown,
  viewer: string
): Map<number, JoinSent> {
  const sent = new Map<number, JoinSent>();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record !== 'object') continue;
    const row = record as Record<string, unknown>;
    const kind: JoinSent | null =
      row.type === 'joining-group'
        ? 'joining'
        : row.type === 'joined-group'
          ? row.done === true
            ? 'changed'
            : 'joining'
          : row.type === 'joined-group-request'
            ? 'asked'
            : row.type === 'leave-group'
              ? 'changed'
              : null;
    if (!kind) continue;
    // Whose record it is, read as TaskManager reads it.
    const account = text(row.memberAddress) ?? text(row.creatorAddress);
    if (account !== null && account !== viewer) continue;
    const groupId = Number(row.groupId);
    if (!Number.isSafeInteger(groupId) || groupId <= 0) continue;
    if (!sent.has(groupId)) sent.set(groupId, kind);
  }
  return sent;
}

/**
 * What `group`'s card offers the signed-in account. Never Join while it
 * isn't known whether the account is in the group, never on a group it is
 * in, never on Qortal's own groups, and not while Hub is joining it or its
 * join request waits. A group it joined or left this session is as Hub's
 * own list has it now: one it left (or was removed from) offers Join again.
 */
export function joinOfferFor(
  group: Pick<GroupOf, 'groupId' | 'isOpen'>,
  context: JoinContext
): JoinOffer {
  if (!context.viewer || isSpecialGroup(group.groupId)) return null;
  const sent = context.sent.get(group.groupId);
  const member =
    context.hubGroups.has(group.groupId) ||
    (sent !== 'changed' && !!context.viewerGroups?.has(group.groupId));
  if (member) return null;
  if (sent === 'joining') return { kind: 'joining' };
  if (sent === 'asked') return { kind: 'asked' };
  if (!context.viewerGroups) return { kind: 'unknown' };
  // Core says whether it is open; when it doesn't, Hub's join window does.
  return { kind: 'join', closed: group.isOpen === false };
}

/**
 * Where a group's avatar is on the node, as Hub shows it elsewhere: the
 * THUMBNAIL its owner published as `qortal_group_avatar_<groupId>`, under
 * the owner's name (each part encoded); null when there is no such path.
 */
export function groupAvatarPath(
  ownerName: string,
  groupId: number
): string | null {
  if (!ownerName || !Number.isSafeInteger(groupId) || groupId <= 0) return null;
  try {
    return `/arbitrary/THUMBNAIL/${seg(ownerName)}/${seg(
      `qortal_group_avatar_${groupId}`
    )}?async=true`;
  } catch {
    // A name that is only "." or "..": not a path part.
    return null;
  }
}

/** Characters that show as nothing, and spaces: never an initial. */
const NOT_SHOWN = /[\p{Cf}\p{Cc}\p{Z}\u2800\u3164\uFFA0\u115F\u1160]/gu;
/** The first character a reader sees, with the marks written on it. */
const FIRST_SHOWN = /^\p{M}*(\P{M}\p{M}*)/u;

/** A group name's first visible character, in capitals; null for none. */
export function groupInitial(name: string | null | undefined): string | null {
  const first = FIRST_SHOWN.exec((name ?? '').replace(NOT_SHOWN, ''))?.[1];
  return first ? first.toUpperCase() : null;
}
