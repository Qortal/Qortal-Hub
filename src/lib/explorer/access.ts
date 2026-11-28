/**
 * Who sees the Explorer's detailed parts: "the level 5+ rule", the same
 * as Q-Mintership+'s. Minter Admins (the admins of MINTER, group 694),
 * MINTER members at level 5 or above, and Dev Admins (the admins of the
 * dev group, group 1) see them. Everyone else sees the rest of the
 * Explorer, and nothing says that anything is left out.
 *
 * This hides parts of Hub's screen; it doesn't protect data. Everything
 * the detailed parts show is public on the chain: any node answers anyone
 * who asks, and Hub is open source. Like Q-Mintership+, it only keeps
 * chain-analysis tools out of everyone's way.
 *
 * The detailed parts so far: the Connections tab, the Overview's Direct
 * links, and exchanges' accounts named as such.
 *
 * Reads, through the window's cache, for the signed-in Hub account: its
 * account (its level) and its groups (MINTER membership and admin), and
 * the Dev Admins only when those two don't settle it. A read that fails
 * leaves the answer unknown: the detailed parts stay out (fail closed),
 * and an unknown answer is never kept.
 */
import type { ExplorerCache } from './cache';
import {
  accountRead,
  devAdminsRead,
  groupsOfRead,
  type ReadSpec,
} from './reads';
import { minterStandingOf } from './rules';

/** The lowest level at which a MINTER member sees the detailed parts. */
export const FULL_VIEW_MIN_LEVEL = 5;

/** How long a viewer's answer is kept: reopening the window within it reads nothing again. */
export const ACCESS_TTL_MS = 60_000;

export interface ExplorerViewer {
  /** An admin of MINTER. */
  isAdmin: boolean;
  /** A member of MINTER. */
  isMember: boolean;
  level: number;
}

/** A Minter Admin, or a MINTER member at level 5 or above. */
export function fullExplorerByRole(viewer: ExplorerViewer): boolean {
  return (
    viewer.isAdmin || (viewer.isMember && viewer.level >= FULL_VIEW_MIN_LEVEL)
  );
}

/** By role, or as a Dev Admin. */
export function fullExplorerAccess(
  viewer: ExplorerViewer,
  isDevAdmin: boolean
): boolean {
  return fullExplorerByRole(viewer) || isDevAdmin;
}

/** A read's outcome: what it answered, or that it failed. */
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

const outcome = <T>(promise: Promise<T>): Promise<Outcome<T>> =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error })
  );

/**
 * Whether `viewer` sees the detailed parts: true or false once the node's
 * answers settle it; a rejection while they don't (a read failed), so the
 * caller keeps them out and never keeps that as an answer.
 *
 * - Its groups say it is a Minter Admin: true (its level doesn't matter).
 * - A MINTER member: by its level.
 * - Anyone else, or a member whose level couldn't be read: the Dev Admins
 *   decide, read only now.
 */
export async function readFullExplorer(
  viewer: string,
  cache: ExplorerCache
): Promise<boolean> {
  const read = <T>(spec: ReadSpec<T>) =>
    cache.read(spec.key, spec.load, { ttlMs: spec.ttlMs });
  const [account, groups] = await Promise.all([
    outcome(read(accountRead(viewer))),
    outcome(read(groupsOfRead(viewer))),
  ]);
  /** What its role says: undefined while a read it needs failed. */
  let byRole: boolean | undefined;
  if (groups.ok) {
    const standing = minterStandingOf(groups.value);
    if (standing === 'admin') return true;
    if (standing === 'outside') byRole = false;
    else if (account.ok) {
      // A valid address the node never saw has level 0.
      const level =
        account.value.kind === 'account' ? account.value.account.level : 0;
      byRole = fullExplorerByRole({ isAdmin: false, isMember: true, level });
    }
  }
  if (byRole) return true;
  // Not settled by its role: whether it is a Dev Admin decides (its failure rejects).
  const devAdmins = await read(devAdminsRead());
  if (devAdmins.includes(viewer)) return true;
  if (byRole === false) return false;
  // A read its role needed failed, and it isn't a Dev Admin: unknown.
  const failed = (groups.ok ? account : groups) as {
    ok: false;
    error: unknown;
  };
  throw failed.error;
}
