/**
 * What a field for one more account to compare gets typed into it, made
 * an account's address as the rest of the Explorer does: an address as it
 * is; a name, by its owner (the node matches names ignoring case and
 * look-alike letters); an AT address, a transaction signature or text
 * written like an address but not one, said in words instead. A name's
 * answer that arrives after another lookup, or after the field went (its
 * step left, the window closed, the Hub account switched), is dropped.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isAtAddress,
  isQortAddress,
  isSignature,
  looksLikeAddress,
} from '../../../lib/explorer/addresses';
import { nameDataRead } from '../../../lib/explorer/reads';
import { visibleName } from '../../../lib/explorer/rules';
import { useExplorer } from '../ExplorerContext';
import { isolate } from '../parts';

/** What the field says: a key and its options. */
export interface LookupNote {
  key: string;
  options?: Record<string, unknown>;
  /** A name is being looked up. */
  pending?: boolean;
}

export function useAccountLookup(onAccount: (address: string) => void) {
  const { cache } = useExplorer();
  const [note, setNote] = useState<LookupNote | null>(null);
  const onAccountRef = useRef(onAccount);
  onAccountRef.current = onAccount;
  const run = useRef(0);
  // Anything still on its way when the field goes is dropped.
  useEffect(
    () => () => {
      run.current += 1;
    },
    []
  );

  const lookUp = useCallback(
    (typed: string) => {
      const id = ++run.current;
      const text = typed.trim();
      if (!text) return;
      if (isQortAddress(text)) {
        setNote(null);
        onAccountRef.current(text);
        return;
      }
      if (isAtAddress(text)) {
        setNote({ key: 'explorer:compare.add.at' });
        return;
      }
      if (isSignature(text)) {
        setNote({ key: 'explorer:compare.add.transaction' });
        return;
      }
      if (looksLikeAddress(text)) {
        setNote({ key: 'explorer:account.invalid' });
        return;
      }
      const name = isolate(visibleName(text));
      setNote({
        key: 'explorer:compare.add.looking_up',
        options: { name },
        pending: true,
      });
      const spec = nameDataRead(text);
      cache.read(spec.key, spec.load, { ttlMs: spec.ttlMs }).then(
        (found) => {
          if (run.current !== id) return;
          if (found) {
            setNote(null);
            onAccountRef.current(found.owner);
          } else
            setNote({
              key: 'explorer:account.no_such_name',
              options: { name },
            });
        },
        () => {
          if (run.current === id)
            setNote({ key: 'explorer:account.name_failed' });
        }
      );
    },
    [cache]
  );

  /** Say something else in the field's line (an account already compared). */
  const say = useCallback((next: LookupNote | null) => {
    run.current += 1;
    setNote(next);
  }, []);

  return { lookUp, note, say };
}
