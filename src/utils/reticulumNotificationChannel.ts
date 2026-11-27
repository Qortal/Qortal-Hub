type ReticulumNotificationChannel = {
  channelId?: unknown;
  name?: unknown;
};

const cleanChannelLabel = (value: unknown): string =>
  (typeof value === 'string' ? value : '').trim().replace(/^#/, '');

/**
 * Resolve a stable channel ID to its current human-readable metadata name.
 * The ID remains the navigation key; this label is only for presentation.
 */
export function getReticulumNotificationChannelLabel(
  channelIdValue: unknown,
  channels: unknown
): string {
  const channelId = cleanChannelLabel(channelIdValue) || 'general';
  if (!Array.isArray(channels)) return channelId;
  const channel = channels.find(
    (candidate: ReticulumNotificationChannel) =>
      cleanChannelLabel(candidate?.channelId) === channelId
  ) as ReticulumNotificationChannel | undefined;
  return cleanChannelLabel(channel?.name) || channelId;
}

/**
 * Return a Unicode symbol representing the channel's visibility/access type:
 *   🌐 public  — regular (members read + write)
 *   🔒 read-only — admin_write (members read, admins write)
 *   🚫 private — admin_private (admins read + write)
 */
export function getChannelVisibilitySymbol(
  channelIdValue: unknown,
  channels: unknown
): string {
  const channelId = cleanChannelLabel(channelIdValue) || 'general';
  if (!Array.isArray(channels)) return '';
  const channel = (
    channels as {
      channelId?: unknown;
      name?: unknown;
      writeMode?: string;
      readMode?: string;
    }[]
  ).find((c) => cleanChannelLabel(c?.channelId) === channelId);
  if (!channel) return '';
  const readMode = channel.readMode;
  const writeMode = channel.writeMode;
  if (readMode === 'admins') return '\u{1F6AB}'; // private
  if (writeMode === 'admins') return '\u{1F512}'; // read-only
  return '\u{1F310}'; // public
}
