import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mentionBroadcastScope,
  mentionTitleKey,
  mentionTitleTarget,
  normalizeMentionBroadcastScope,
  type MentionBroadcastScopeInput,
} from './reticulumMentionNotificationTitle';

const GROUP_ID = 42;
const CHANNEL = 'general';
const ONLINE_SINCE = 1_000_000;
const AFTER_ONLINE = ONLINE_SINCE + 5_000;
const BEFORE_ONLINE = ONLINE_SINCE - 5_000;

const hereTarget = (overrides: Record<string, unknown> = {}) => ({
  type: 'here',
  groupId: GROUP_ID,
  channelId: CHANNEL,
  ...overrides,
});

const everyoneTarget = (overrides: Record<string, unknown> = {}) => ({
  type: 'everyone',
  groupId: GROUP_ID,
  ...overrides,
});

const input = (
  overrides: Partial<MentionBroadcastScopeInput> = {}
): MentionBroadcastScopeInput => ({
  privilegedMentionAuthorized: true,
  groupId: GROUP_ID,
  channelId: CHANNEL,
  timestamp: AFTER_ONLINE,
  onlineSinceMs: ONLINE_SINCE,
  mentionTargets: [],
  ...overrides,
});

describe('mentionBroadcastScope', () => {
  it('returns null when the post carries no broadcast target', () => {
    expect(mentionBroadcastScope(input())).toBeNull();
  });

  it('returns everyone for an authorized @everyone', () => {
    expect(
      mentionBroadcastScope(input({ mentionTargets: [everyoneTarget()] }))
    ).toBe('everyone');
  });

  it('returns here for an authorized @here in the same channel', () => {
    expect(
      mentionBroadcastScope(input({ mentionTargets: [hereTarget()] }))
    ).toBe('here');
  });

  it('returns here when both targets are authorized', () => {
    // @here is the narrower audience, so it is the more accurate claim.
    expect(
      mentionBroadcastScope(
        input({ mentionTargets: [everyoneTarget(), hereTarget()] })
      )
    ).toBe('here');
  });

  it('returns here regardless of target order', () => {
    expect(
      mentionBroadcastScope(
        input({ mentionTargets: [hereTarget(), everyoneTarget()] })
      )
    ).toBe('here');
  });

  it('ignores an @here scoped to a different channel', () => {
    expect(
      mentionBroadcastScope(
        input({
          mentionTargets: [hereTarget({ channelId: 'other-channel' })],
        })
      )
    ).toBeNull();
  });

  it('ignores an @here from before this session started', () => {
    // Nobody knows who was online at that point, so the target cannot be honoured.
    expect(
      mentionBroadcastScope(
        input({
          timestamp: BEFORE_ONLINE,
          mentionTargets: [hereTarget()],
        })
      )
    ).toBeNull();
  });

  it('still honours an @everyone from before this session started', () => {
    // @everyone is not time-scoped, only @here is.
    expect(
      mentionBroadcastScope(
        input({
          timestamp: BEFORE_ONLINE,
          mentionTargets: [everyoneTarget()],
        })
      )
    ).toBe('everyone');
  });

  it('returns null when the sender is not authorized to broadcast', () => {
    expect(
      mentionBroadcastScope(
        input({
          privilegedMentionAuthorized: false,
          mentionTargets: [hereTarget(), everyoneTarget()],
        })
      )
    ).toBeNull();
  });

  it('ignores targets addressed to another group', () => {
    expect(
      mentionBroadcastScope(
        input({
          mentionTargets: [
            hereTarget({ groupId: GROUP_ID + 1 }),
            everyoneTarget({ groupId: GROUP_ID + 1 }),
          ],
        })
      )
    ).toBeNull();
  });

  it('tolerates missing mentionTargets', () => {
    expect(
      mentionBroadcastScope(input({ mentionTargets: undefined }))
    ).toBeNull();
  });

  it('tolerates malformed targets without throwing', () => {
    expect(
      mentionBroadcastScope(
        input({ mentionTargets: [null as never, {} as never, 'x' as never] })
      )
    ).toBeNull();
  });
});

describe('mentionTitleKey', () => {
  it('uses the "you" sentence for a direct mention', () => {
    expect(mentionTitleKey(null)).toBe(
      'reticulum:notification.mention_you_in_group'
    );
  });

  it('uses the special-mention sentence for @here', () => {
    expect(mentionTitleKey('here')).toBe(
      'reticulum:notification.mention_special_in_group'
    );
  });

  it('uses the special-mention sentence for @everyone', () => {
    expect(mentionTitleKey('everyone')).toBe(
      'reticulum:notification.mention_special_in_group'
    );
  });
});

describe('mentionTitleTarget', () => {
  it('returns the token with its sigil, untranslated, for @here', () => {
    expect(mentionTitleTarget('here')).toBe('@here');
  });

  it('returns the token with its sigil, untranslated, for @everyone', () => {
    expect(mentionTitleTarget('everyone')).toBe('@everyone');
  });

  it('returns an empty string for a direct mention, never a token', () => {
    // A caller that reuses the result on the "you" sentence must not be able to
    // render "mentioned @everyone" for a direct ping.
    expect(mentionTitleTarget(null)).toBe('');
  });
});

describe('normalizeMentionBroadcastScope', () => {
  it('keeps the two real tokens', () => {
    expect(normalizeMentionBroadcastScope('here')).toBe('here');
    expect(normalizeMentionBroadcastScope('everyone')).toBe('everyone');
  });

  it('maps null and undefined to a direct mention', () => {
    expect(normalizeMentionBroadcastScope(null)).toBeNull();
    expect(normalizeMentionBroadcastScope(undefined)).toBeNull();
  });

  it('maps a falsy non-null value to a direct mention', () => {
    // '' would otherwise pass mentionTitleKey's `=== null` test and pick the
    // special-mention sentence.
    expect(normalizeMentionBroadcastScope('')).toBeNull();
    expect(normalizeMentionBroadcastScope(0)).toBeNull();
    expect(normalizeMentionBroadcastScope(false)).toBeNull();
  });

  it('maps unknown strings and objects to a direct mention', () => {
    expect(normalizeMentionBroadcastScope('HERE')).toBeNull();
    expect(normalizeMentionBroadcastScope(' @here')).toBeNull();
    expect(normalizeMentionBroadcastScope('group')).toBeNull();
    expect(normalizeMentionBroadcastScope({})).toBeNull();
  });

  it('makes an untrusted payload render the "you" sentence', () => {
    // The end-to-end shape of the guard: a stray value must not select
    // mention_special_in_group.
    const scope = normalizeMentionBroadcastScope('');
    expect(mentionTitleKey(scope)).toBe(
      'reticulum:notification.mention_you_in_group'
    );
  });
});

describe('module shape', () => {
  it('has no imports, so the headless scenario harness can type-strip it', () => {
    // electron/scenarios/notifications.mjs loads renderer modules by source and
    // Node's type stripping only handles an empty import graph. A single import
    // here would silently make this rule unreachable from the scenario suite.
    const source = readFileSync(
      join(
        process.cwd(),
        'src/components/Group/reticulumMentionNotificationTitle.ts'
      ),
      'utf8'
    );
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/^\s*export\s+\*\s+from\s/m);
  });
});
