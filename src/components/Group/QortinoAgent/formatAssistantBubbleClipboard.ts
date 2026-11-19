/**
 * Plain-text export of a Qortino assistant bubble — includes the Q-App cards
 * and guide links shown under the answer, not only `content`.
 */
import type { TFunction } from 'i18next';
import type { OfficialResourceLink } from '../../../qortinoAgent/officialResources';
import type { MatchedQApp } from '../../../qortinoAgent/qAppCatalog';

type ClipboardBubble = {
  content?: string;
  apps?: MatchedQApp[];
  links?: OfficialResourceLink[];
};

/** Full visible answer as plain text, for Copy and for a report on it. */
export function formatAssistantBubbleForClipboard(
  m: ClipboardBubble,
  t: TFunction
): string {
  const parts: string[] = [];

  if (m.content?.trim()) {
    parts.push(m.content.trim());
  }

  if (m.apps?.length) {
    parts.push(
      `${t('core:qortino_agent.chat.qapps_heading')}:\n` +
        m.apps
          .map((a) => {
            const title = a.entry.title || a.entry.name;
            const summary = a.entry.summary?.trim();
            return summary ? `• ${title} — ${summary}` : `• ${title}`;
          })
          .join('\n')
    );
  }

  if (m.links?.length) {
    parts.push(
      `${t('core:qortino_agent.chat.links_heading')}:\n` +
        m.links
          .map((l) => {
            const target =
              l.href ||
              (l.service && l.name
                ? // Encoded, so a name with spaces stays one link when pasted.
                  `qortal://${l.service}/${encodeURIComponent(l.name)}`
                : '');
            return target ? `• ${l.label}: ${target}` : `• ${l.label}`;
          })
          .join('\n')
    );
  }

  return parts.join('\n\n').trim();
}
