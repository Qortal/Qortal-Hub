const collectVisibleMessageText = (value: unknown, out: string[]): void => {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectVisibleMessageText(item, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, next] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'type' || key === 'attrs') continue;
    collectVisibleMessageText(next, out);
  }
};

export const reticulumVisibleSearchTextFromPayload = (
  payload: unknown
): string => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return typeof payload === 'string'
      ? payload
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  }

  const record = payload as Record<string, unknown>;
  const strings: string[] = [];
  collectVisibleMessageText(record.message || record.messageText, strings);
  if (Array.isArray(record.attachments)) {
    for (const attachment of record.attachments) {
      if (!attachment || typeof attachment !== 'object') continue;
      const attachmentRecord = attachment as Record<string, unknown>;
      const fileName =
        typeof attachmentRecord.fileName === 'string'
          ? attachmentRecord.fileName.trim()
          : typeof attachmentRecord.name === 'string'
            ? attachmentRecord.name.trim()
            : '';
      if (fileName) strings.push(fileName);
    }
  }

  return strings
    .join(' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
