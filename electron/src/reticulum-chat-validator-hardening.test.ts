/**
 * Validators must reject malformed input, not throw.
 *
 * Both `isValidatedGroupMember` and `getValidatedGroupAdminStatus` take an
 * address that callers parse out of inbound wire fields. TypeScript says
 * `address: string`, but the value is `undefined` whenever a peer omits the
 * field — and `undefined.trim()` throws from inside an unawaited async handler,
 * which takes down the main process instead of dropping the frame.
 *
 * These are private methods, so the test reaches them deliberately: the defect
 * was that the boundary accepted a value the type system claims it cannot
 * receive, and only a direct call reproduces that.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReticulumChatManager } from './reticulum-chat';

function tempDbPath(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'rchat-validator-hardening-')
  );
  return path.join(root, 'reticulum-chat.db');
}

type ValidatorInternals = {
  isValidatedGroupMember(
    groupId: number,
    address: unknown
  ): Promise<boolean | null>;
  getValidatedGroupAdminStatus(
    groupId: number,
    address: unknown
  ): Promise<string>;
};

function makeManager() {
  return new ReticulumChatManager({
    dbPath: tempDbPath(),
    // A validator forces the path that reads the address, rather than the
    // `localGroupIds` shortcut taken when no validator is configured.
    validateGroupMember: async () => true,
    validateGroupAdmin: async () => false,
  });
}

describe('Reticulum chat address validators', () => {
  const MANAGED: ReticulumChatManager[] = [];
  const cleanup = () => {
    while (MANAGED.length) {
      try {
        MANAGED.pop()?.close();
      } catch {
        // Closing a partially-constructed manager is not the subject here.
      }
    }
  };

  const internals = (manager: ReticulumChatManager) =>
    manager as unknown as ValidatorInternals;

  it('isValidatedGroupMember returns false for an undefined address', async () => {
    const manager = makeManager();
    MANAGED.push(manager);

    await expect(
      internals(manager).isValidatedGroupMember(716, undefined)
    ).resolves.toBe(false);
    cleanup();
  });

  it('isValidatedGroupMember returns false for a non-string address', async () => {
    const manager = makeManager();
    MANAGED.push(manager);

    for (const value of [null, 42, {}, []]) {
      await expect(
        internals(manager).isValidatedGroupMember(716, value)
      ).resolves.toBe(false);
    }
    cleanup();
  });

  it('isValidatedGroupMember still validates a real address', async () => {
    const manager = makeManager();
    MANAGED.push(manager);

    await expect(
      internals(manager).isValidatedGroupMember(716, '  Qabc123  ')
    ).resolves.toBe(true);
    cleanup();
  });

  it('getValidatedGroupAdminStatus returns not_admin for an undefined address', async () => {
    const manager = makeManager();
    MANAGED.push(manager);

    await expect(
      internals(manager).getValidatedGroupAdminStatus(716, undefined)
    ).resolves.toBe('not_admin');
    cleanup();
  });

  it('getValidatedGroupAdminStatus returns not_admin for a non-string address', async () => {
    const manager = makeManager();
    MANAGED.push(manager);

    for (const value of [null, 0, {}, []]) {
      await expect(
        internals(manager).getValidatedGroupAdminStatus(716, value)
      ).resolves.toBe('not_admin');
    }
    cleanup();
  });

  it('rejects an invalid group id before touching the address', async () => {
    const manager = makeManager();
    MANAGED.push(manager);

    await expect(
      internals(manager).isValidatedGroupMember(0, undefined)
    ).resolves.toBe(false);
    await expect(
      internals(manager).getValidatedGroupAdminStatus(-1, undefined)
    ).resolves.toBe('not_admin');
    cleanup();
  });
});
