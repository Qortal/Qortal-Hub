/**
 * A transaction's raw API answer as the Explorer shows it (in a list row's
 * details and on its own page): Core's JSON, with what must never show
 * taken out: what a message says (a MESSAGE's or CHAT's data, an AT's
 * message), and what identifies a resource published under a private QDN
 * service (`…_PRIVATE`, and MAIL). Pure: the words put in their place come
 * from the caller.
 */
import type { TxRow } from './reads';
import { isPrivateService, serviceName } from './qdnServices';

/** The fields of an encrypted resource's transaction that would tell what it holds. */
const PRIVATE_QDN_FIELDS = ['identifier', 'data', 'secret', 'metadataHash'];

/**
 * The transaction as raw data for the screen: Core's JSON, with a
 * message's content and a private resource's identifier and data replaced
 * by `notShown` ("(not shown)" in the reader's language).
 */
export function rawForDisplay(
  tx: TxRow,
  notShown: string
): Record<string, unknown> {
  const shown: Record<string, unknown> = { ...tx };
  if ((tx.type === 'MESSAGE' || tx.type === 'CHAT') && 'data' in shown)
    shown.data = notShown;
  if (tx.type === 'AT' && 'message' in shown) shown.message = notShown;
  if (tx.type === 'ARBITRARY' && isPrivateService(serviceName(tx.service)))
    for (const key of PRIVATE_QDN_FIELDS)
      if (key in shown) shown[key] = notShown;
  return shown;
}
