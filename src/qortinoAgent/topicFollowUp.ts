/**
 * Resolve topic continuations like "what is it in depth" / "tell me more"
 * against the prior user question — without stealing clear new questions.
 */

export function isTopicFollowUpQuery(query: string): boolean {
  const t = query.trim().toLowerCase().replace(/[’']/g, "'");
  if (!t) return false;

  // Explicit continuation phrases
  if (
    /^(tell me more|more detail|more details|go deeper|elaborate|expand( on)?|in (more )?depth|deeper please|say more)\b/.test(
      t
    )
  ) {
    return true;
  }
  if (/^(more about|explain more about)\s+(it|that|this)\b/.test(t)) {
    return true;
  }

  // Pronoun topic refs: "what is it…", "how does it work", "why is that"
  if (
    /\b(it|that|this)\b/.test(t) &&
    /^(what|how|why|explain|describe|define|tell|give)\b/.test(t)
  ) {
    return true;
  }

  // Short depth asks that only make sense as continuations
  if (t.length <= 40 && /\bin (more )?depth\b/.test(t)) {
    return true;
  }

  return false;
}

/** Pull the subject from a prior ask ("what is qortal" → "qortal"). */
export function extractPriorTopicSubject(prior: string): string {
  const p = prior.trim().replace(/[?!.]+$/g, '');
  const m = p.match(
    /^(?:what\s+is|what'?s|whats|explain|tell\s+me\s+about|define|describe|how\s+does)\s+(.+)$/i
  );
  if (m?.[1]) {
    return m[1]
      .replace(/\s+work$/i, '')
      .replace(/^(the|a|an)\s+/i, '')
      .trim();
  }
  return p;
}

function lastSubstantiveUserQuestion(
  priorMessages: Array<{ role: string; content: string }>
): string | null {
  for (let i = priorMessages.length - 1; i >= 0; i -= 1) {
    const m = priorMessages[i];
    if (m?.role !== 'user') continue;
    const c = m.content?.trim();
    if (!c) continue;
    if (isTopicFollowUpQuery(c)) continue;
    return c;
  }
  return null;
}

/**
 * Rewrite a continuation against the previous user topic.
 * Example: prior "what is qortal" + "what is it in depth"
 *       → "what is qortal in depth"
 */
export function resolveTopicFollowUpQuery(
  query: string,
  priorMessages: Array<{ role: string; content: string }>
): { text: string; priorTopic: string | null; expanded: boolean } {
  const raw = query.trim();
  if (!isTopicFollowUpQuery(raw)) {
    return { text: raw, priorTopic: null, expanded: false };
  }
  const prior = lastSubstantiveUserQuestion(priorMessages);
  if (!prior) {
    return { text: raw, priorTopic: null, expanded: false };
  }

  const subject = extractPriorTopicSubject(prior);
  let text = raw;

  if (/\bwhat\s+is\s+it\b/i.test(text) && subject) {
    text = text.replace(/\bwhat\s+is\s+it\b/i, `what is ${subject}`);
  } else if (/\bwhat\s+are\s+they\b/i.test(text) && subject) {
    text = text.replace(/\bwhat\s+are\s+they\b/i, `what are ${subject}`);
  } else if (/\bhow\s+does\s+it\s+work\b/i.test(text) && subject) {
    text = text.replace(
      /\bhow\s+does\s+it\s+work\b/i,
      `how does ${subject} work`
    );
  } else if (/\bexplain\s+(it|that|this)\b/i.test(text) && subject) {
    text = text.replace(/\bexplain\s+(it|that|this)\b/i, `explain ${subject}`);
  } else if (
    /^(tell me more|more detail|more details|go deeper|elaborate|expand)\b/i.test(
      text
    )
  ) {
    text = `${prior.replace(/[?!.]+$/g, '')} in more detail`;
  } else if (/^in (more )?depth\b/i.test(text) && subject) {
    text = `what is ${subject} in depth`;
  } else if (/\bin (more )?depth\b/i.test(text) && subject) {
    // "what is it in depth" already rewritten above; other "… in depth"
    if (
      !new RegExp(
        `\\b${subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
        'i'
      ).test(text)
    ) {
      text = `${prior.replace(/[?!.]+$/g, '')} in depth`;
    }
  } else {
    text = `${prior.replace(/[?!.]+$/g, '')}\nFollow-up: ${raw}`;
  }

  return { text: text.trim(), priorTopic: prior, expanded: text !== raw };
}
