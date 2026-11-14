/**
 * Display cleanup for assistant text: QORT is a coin (never "token"),
 * and knowledge is Qortino's — never "my/your pack".
 */
export function normalizeQortCoinLanguage(text: string): string {
  return normalizeAssistantDisplayText(text);
}

function normalizeAssistantDisplayText(text: string): string {
  if (!text) return text;
  let t = text;

  t = t.replace(/\bQORT\s+tokens\b/gi, 'QORT coins');
  t = t.replace(/\bQORT\s+token\b/gi, 'QORT coin');
  t = t.replace(/\bQortal\s+tokens\b/gi, 'Qortal coins');
  t = t.replace(/\bQortal\s+token\b/gi, 'Qortal coin');

  t = t.replace(/\btokens\s+(?:called\s+|named\s+)?QORT\b/gi, 'coins QORT');
  t = t.replace(/\btoken\s+(?:called\s+|named\s+)?QORT\b/gi, 'coin QORT');

  t = t.replace(/\bQORT\s+is\s+(a|the)\s+token\b/gi, 'QORT is $1 coin');
  t = t.replace(/\bQORT,?\s+the\s+token\b/gi, 'QORT, the coin');

  // "native/utility/network/base token" in a sentence that also mentions QORT
  t = t.replace(
    /([^.!?\n]*\bQORT\b[^.!?\n]*?)\b((?:native|utility|network|base)\s+)token\b/gi,
    '$1$2coin'
  );
  t = t.replace(
    /([^.!?\n]*\bQORT\b[^.!?\n]*?)\b((?:native|utility|network|base)\s+)tokens\b/gi,
    '$1$2coins'
  );
  t = t.replace(
    /\b((?:native|utility|network|base)\s+)token\b([^.!?\n]*\bQORT\b)/gi,
    '$1coin$2'
  );
  t = t.replace(
    /\b((?:native|utility|network|base)\s+)tokens\b([^.!?\n]*\bQORT\b)/gi,
    '$1coins$2'
  );

  // Community-facing: knowledge belongs to Qortino, not "your/my pack".
  t = t.replace(
    /\b(my|your)\s+knowledge\s+pack\b/gi,
    "Qortino's on-device knowledge"
  );
  t = t.replace(/\b(my|your)\s+pack\b/gi, "Qortino's on-device knowledge");
  t = t.replace(
    /\bfrom\s+(my|your)\s+notes\b/gi,
    "from Qortino's on-device knowledge"
  );
  t = t.replace(
    /\bin\s+(my|your)\s+knowledge\s+pack\b/gi,
    "in Qortino's on-device knowledge"
  );

  return t;
}
