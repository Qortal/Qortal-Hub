/**
 * The Names tab's and the name page's small texts, in the reader's
 * language: a name's record in short parts ("Registered 12 Oct 2024 ·
 * Updated 13 Oct 2024 · For sale at 5 QORT") and the notes on how a name is
 * written (lib/explorer/rules.ts `nameNotes`). Facts about the spelling,
 * never a judgement of the person.
 */
import type { TFunction } from 'i18next';
import { formatAmountExact, formatDay } from '../../../lib/explorer/format';
import type { NameData } from '../../../lib/explorer/reads';
import type { NameNote } from '../../../lib/explorer/rules';
import { cap } from '../parts';

/** A name's record in short parts: when registered, when updated, for sale. */
export function recordParts(
  record: NameData,
  t: TFunction,
  language: string
): string[] {
  const parts: string[] = [];
  if (typeof record.registered === 'number')
    parts.push(
      String(
        t('explorer:names.registered', {
          date: formatDay(record.registered, language),
          ...cap,
        })
      )
    );
  if (typeof record.updated === 'number')
    parts.push(
      String(
        t('explorer:names.updated', {
          date: formatDay(record.updated, language),
          ...cap,
        })
      )
    );
  if (record.isForSale)
    parts.push(
      String(
        record.salePrice
          ? t('explorer:names.for_sale_at', {
              price: formatAmountExact(record.salePrice, language),
              ...cap,
            })
          : t('explorer:names.for_sale', cap)
      )
    );
  return parts;
}

/** A note on how a name in a list is written, as a sentence about that name. */
export function nameNoteText(note: NameNote, t: TFunction): string {
  switch (note.kind) {
    case 'addressLike':
      return String(t('explorer:names.note.address_like', cap));
    case 'ownerPrefix':
      return String(
        t('explorer:names.note.owner_start', { start: note.start, ...cap })
      );
    case 'ownerSuffix':
      return String(
        t('explorer:names.note.owner_end', { end: note.end, ...cap })
      );
    case 'invisible':
      return note.count === 1
        ? String(t('explorer:names.note.invisible_single', cap))
        : String(
            t('explorer:names.note.invisible', { count: note.count, ...cap })
          );
  }
}
