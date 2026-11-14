/**
 * Helpers so Fast/Max prefer finished answers over mid-cut text,
 * and so "Continue assembling" is only offered when the reply is clearly truncated.
 */

/** Rough on-device token estimate (English-ish). */
function estimateTokenCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const words = t.split(/\s+/).filter(Boolean).length;
  return Math.max(Math.ceil(words * 1.35), Math.ceil(t.length / 3.6));
}

/** True when the reply looks truncated mid-section / mid-sentence. */
export function looksIncompleteAnswer(text: string): boolean {
  const t = text.replace(/\s+$/g, '');
  if (!t || t.length < 24) return false;

  // Bare heading at the end (classic Max cut: "...Practical Tips").
  if (
    /(?:^|\n)\s*(?:#{1,3}\s*)?(?:\*\*)?(?:Practical Tips|Tips|Steps|Notes|Warnings?|Summary|Checklist|Next steps|Important|Remember|Gear|Water|Shelter|Food|First aid|Hygiene|Security)(?:\*\*)?\s*:?\s*$/i.test(
      t
    )
  ) {
    return true;
  }

  const lines = t.split('\n').filter((l) => l.trim());
  const last = (lines[lines.length - 1] || '').trim();
  if (!last) return true;

  // Trailing connector / unfinished clause.
  if (/[,;:]\s*$/.test(last)) return true;
  if (
    /\b(and|or|with|to|for|of|the|a|an|including|such as|e\.g\.?|etc)\s*$/i.test(
      last
    )
  ) {
    return true;
  }

  // Short dangling bullet / numbered step (no terminal punctuation).
  if (/^[-*•]\s+\S.{0,80}$/.test(last) && !/[.!?…)]$/.test(last)) {
    return true;
  }
  if (/^\d+[.)]\s+\S.{0,80}$/.test(last) && !/[.!?…)]$/.test(last)) {
    return true;
  }

  // Prose line without terminal punctuation (allow short list items / headings).
  if (
    last.length > 20 &&
    !/^[-*•\d#]/.test(last) &&
    !/[.!?…)"\]]\s*$/.test(last) &&
    !/:\s*$/.test(last)
  ) {
    return true;
  }

  // Ellipsis / "more later" cut markers.
  if (/\.\.\.\s*$|…\s*$|—\s*$/.test(last)) return true;

  return false;
}

/**
 * Whether to show "Continue assembling".
 * Conservative on purpose: complete short FAQs and finished Max lists must NOT
 * get a Continue button (that just regenerates the same answer).
 */
export function shouldOfferContinueAssemble(
  text: string,
  options?: { maxTokens?: number; mode?: 'fast' | 'max' }
): boolean {
  const t = text.replace(/\s+$/g, '');
  if (!t || t.length < 40) return false;

  // Primary signal: visibly cut mid-thought / mid-heading / dangling bullet.
  if (looksIncompleteAnswer(t)) return true;

  const maxTokens = options?.maxTokens ?? 0;
  if (maxTokens > 0) {
    const est = estimateTokenCount(t);
    // Only treat as budget-truncated when we nearly filled n_predict AND the
    // ending still looks like a list/section that could continue — not every
    // long finished reply.
    const nearCap = est >= Math.floor(maxTokens * 0.92);
    if (nearCap) {
      const last = (
        t
          .split('\n')
          .filter((l) => l.trim())
          .pop() || ''
      ).trim();
      const endsLikeListItem = /^[-*•\d]/.test(last);
      const endsWithColonHeading = /:\s*$/.test(last);
      if (endsLikeListItem || endsWithColonHeading) return true;
    }
  }

  return false;
}

/** Drop a trailing unfinished sentence/heading so Fast stays short-but-complete. */
export function trimIncompleteTail(text: string): string {
  const t = text.replace(/\s+$/g, '');
  if (!looksIncompleteAnswer(t)) return t;

  const lines = t.split('\n');
  while (lines.length > 1) {
    const last = (lines[lines.length - 1] || '').trim();
    const isBareHeading =
      /^(?:#{1,3}\s*)?(?:\*\*)?(?:Practical Tips|Tips|Steps|Notes|Warnings?|Summary|Checklist|Next steps|Important|Remember)(?:\*\*)?\s*:?\s*$/i.test(
        last
      );
    const isDangling =
      !last ||
      isBareHeading ||
      /[,;:]\s*$/.test(last) ||
      /\b(and|or|with|to|for|of|the|a|an)\s*$/i.test(last) ||
      (last.length > 20 &&
        !/^[-*•\d#]/.test(last) &&
        !/[.!?…)"\]]\s*$/.test(last));
    if (!isDangling) break;
    lines.pop();
  }

  const trimmed = lines.join('\n').replace(/\s+$/g, '');
  return trimmed.length >= 24 ? trimmed : t;
}
