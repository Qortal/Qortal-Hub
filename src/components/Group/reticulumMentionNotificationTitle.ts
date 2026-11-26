/**
 * Which `@here` / `@everyone` broadcast reached the reader, and how the mention
 * notification title should describe it.
 *
 * This module has NO imports on purpose. `electron/scenarios/notifications.mjs`
 * loads renderer notification modules by source path and Node's type stripping
 * only loads files with an empty import graph (see `docs/Headless Hub.md`), so a
 * single import here would make the rule unreachable from the scenario harness —
 * the same constraint `reticulumNotificationPlan.ts` lives under.
 *
 * DO NOT add imports to this file.
 */

/**
 * `'here'` and `'everyone'` are authorized broadcasts; `null` means there was
 * no broadcast, so the reader was reached some other way (normally a direct
 * `@name` mention).
 */
export type MentionBroadcastScope = 'here' | 'everyone' | null;

export interface MentionBroadcastScopeInput {
  /** `event.privilegedMentionAuthorized === true` — the sender was authorised to broadcast. */
  privilegedMentionAuthorized: boolean;
  /** The event's group. A target for another group never applies. */
  groupId: number;
  /** The event's channel. `@here` is channel-scoped, `@everyone` is not. */
  channelId: string;
  /** The event's timestamp, used for the `@here` session guard. */
  timestamp: number;
  /**
   * When this renderer session started. `@here` means "everyone online *now*",
   * so a target older than this session cannot be honoured — nobody knows who
   * was online at that point.
   */
  onlineSinceMs: number;
  /** `event.mentionTargets` — the signed semantic mention targets. */
  mentionTargets: Array<Record<string, unknown>> | undefined;
}

/**
 * Resolve which authorized broadcast applies to the reader, if any.
 *
 * Specificity, narrowest first: `@here` beats `@everyone`. `@here` addresses the
 * people online at that moment, a strictly smaller audience than the whole
 * group, so when a post carries both it is the more accurate description of how
 * the reader was reached.
 *
 * IMPORTANT: `mentionBroadcastScope(...) !== null` must stay equivalent to
 * "an authorized broadcast applies", because `Group.tsx` defines its
 * `authorizedReticulumBroadcastApplies()` boolean in exactly those terms. If a
 * scope could be returned for a target the boolean rejects — or the reverse —
 * the notification gate and the title would disagree about the same post. That
 * is the whole reason the two are derived from one function instead of being
 * computed separately.
 */
export function mentionBroadcastScope(
  input: MentionBroadcastScopeInput
): MentionBroadcastScope {
  if (input.privilegedMentionAuthorized !== true) return null;

  const groupId = Number(input.groupId);
  const eventChannelId = String(input.channelId || 'general');

  let sawEveryone = false;

  for (const target of input.mentionTargets || []) {
    if (Number(target?.groupId) !== groupId) continue;

    if (
      target?.type === 'here' &&
      String(target?.channelId || eventChannelId) === eventChannelId &&
      Number(input.timestamp || 0) >= input.onlineSinceMs
    ) {
      // Narrowest scope wins, so stop looking.
      return 'here';
    }

    if (target?.type === 'everyone') sawEveryone = true;
  }

  return sawEveryone ? 'everyone' : null;
}

/**
 * The i18n key for the mention notification title.
 *
 * Returns a key rather than a sentence so the caller's namespaces and language
 * reactivity apply; `@here` / `@everyone` are passed as the `{{target}}` value,
 * sigil included, and are never transcribed into a locale file.
 */
export function mentionTitleKey(scope: MentionBroadcastScope): string {
  return scope === null
    ? 'reticulum:notification.mention_you_in_group'
    : 'reticulum:notification.mention_special_in_group';
}

/**
 * Narrow an untrusted value to a `MentionBroadcastScope`.
 *
 * The `q-chat-mention-notification` bus is untyped (`executeEvent` takes
 * `any`), so the field can arrive as anything. Only the two exact tokens count;
 * everything else — including `''`, a stray string, a number — is a direct
 * mention. Without this, a falsy-but-not-null value would slip past
 * `mentionTitleKey`'s `=== null` test and render "@everyone" on a title that
 * should say "you".
 */
export function normalizeMentionBroadcastScope(
  value: unknown
): MentionBroadcastScope {
  return value === 'here' || value === 'everyone' ? value : null;
}

/**
 * The `{{target}}` value for a non-null scope.
 *
 * Returns `''` for `null` deliberately. The direct-mention sentence has no
 * `{{target}}` placeholder today, so the value is unused — but a ternary keyed
 * on `scope === 'here'` would hand back "@everyone" for `null`, and a future
 * template edit that reused the same call site would then put "mentioned
 * @everyone" on a direct ping. An empty string cannot become that.
 */
export function mentionTitleTarget(scope: MentionBroadcastScope): string {
  if (scope === 'here') return '@here';
  if (scope === 'everyone') return '@everyone';
  return '';
}
