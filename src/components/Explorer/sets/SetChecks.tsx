/**
 * Checks across a set of accounts (from Q-Mintership+'s SetChecks), on the
 * Sponsees page, each run only when asked, two accounts at a time, with
 * progress and Stop: a read already running finishes (its answer is kept
 * in the window's cache for next time), and an account being checked makes
 * no more reads (it isn't counted). Leaving the step stops a check the same
 * way. A check's results belong to the history step: Back and Forward show
 * them as they were left.
 *
 * - "Who made their first QORT payment": where each one's first QORT came
 *   from (as the Connections tab finds it), grouped by who paid it; a first
 *   QORT payment is a PAYMENT, as on the Funded page.
 * - "Where their QORT went": each one's QORT payments sent (its first
 *   1,000 at most), grouped by who received them; AT addresses are left
 *   out and counted.
 *
 * Facts with their denominators (the accounts checked, never the ones
 * left); what couldn't be read is counted, never left out as if there were
 * nothing, and a node that can't read payments between accounts says so.
 */
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Box, Button, LinearProgress, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { fundingRead } from '../../../lib/explorer/connectionReads';
import type { Funding } from '../../../lib/explorer/connections';
import {
  FUNDED_PAGES,
  fundedPageRead,
} from '../../../lib/explorer/compareReads';
import { formatCount } from '../../../lib/explorer/format';
import { fromAtomic } from '../../../lib/explorer/txWords';
import {
  accountRead,
  type ReadSpec,
  type TxRow,
} from '../../../lib/explorer/reads';
import {
  groupFirstPayers,
  setSentence,
  wentTo,
} from '../../../lib/explorer/sets';
import { useExplorer, useStepState } from '../ExplorerContext';
import { cap, mutedText, Section, tileSx } from '../parts';
import { TxSentence } from '../transactions/TxSentence';

/** Result rows shown before "Show more". */
const ROWS = 20;
/** Accounts read at once. */
const AT_ONCE = 2;

/** What one account's check found, or that it couldn't be read. */
type Checked<T> = { ok: true; value: T } | { ok: false };

type Run<T> =
  | { state: 'idle' }
  | { state: 'running'; done: number; total: number }
  | {
      state: 'done';
      stopped: boolean;
      done: number;
      total: number;
      results: Map<string, Checked<T>>;
    };

/**
 * One account's check. `halted` says the run was stopped or its step left:
 * a check of several reads makes no more of them then, and answers
 * undefined (it wasn't checked).
 */
type Check<T> = (
  address: string,
  halted: () => boolean
) => Promise<T | undefined>;

/**
 * Runs `check` over `accounts`, AT_ONCE at a time, when started. The run
 * belongs to the history step (`stepKey`): Back and Forward show it as it
 * was left, and one whose step was left ends there, stopped.
 */
function useSetRun<T>(
  accounts: readonly string[],
  check: Check<T>,
  stepKey: string
) {
  const [run, setRun] = useStepState<Run<T>>(stepKey, { state: 'idle' });
  const turn = useRef(0);
  const stopped = useRef(false);
  const checkRef = useRef(check);
  checkRef.current = check;
  // Leaving the step: no new account starts, and an account being checked
  // makes no more reads. Check again is offered only once every lane has
  // ended, so two runs never overlap.
  useEffect(
    () => () => {
      turn.current += 1;
      stopped.current = true;
    },
    []
  );
  const start = useCallback(() => {
    const id = ++turn.current;
    stopped.current = false;
    const halted = () => stopped.current || turn.current !== id;
    const list = [...accounts];
    const results = new Map<string, Checked<T>>();
    let next = 0;
    let done = 0;
    setRun({ state: 'running', done, total: list.length });
    const lane = async () => {
      while (next < list.length && !halted()) {
        const address = list[next++];
        let checked: Checked<T>;
        try {
          const value = await checkRef.current(address, halted);
          // Stopped part-way: not checked.
          if (value === undefined) continue;
          checked = { ok: true, value };
        } catch {
          checked = { ok: false };
        }
        results.set(address, checked);
        done += 1;
        setRun({ state: 'running', done, total: list.length });
      }
    };
    void Promise.all(
      Array.from({ length: Math.max(1, Math.min(AT_ONCE, list.length)) }, lane)
    ).then(() =>
      setRun({
        state: 'done',
        stopped: stopped.current,
        done,
        total: list.length,
        results,
      })
    );
  }, [accounts, setRun]);
  const stop = useCallback(() => {
    stopped.current = true;
  }, []);
  return { run, start, stop };
}

function CheckCard({
  id,
  title,
  about,
  total,
  run,
  onStart,
  onStop,
  children,
}: {
  id: string;
  title: string;
  about: string;
  total: number;
  run: Run<unknown>;
  onStart: () => void;
  onStop: () => void;
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const running = run.state === 'running';
  return (
    <Box
      component="section"
      aria-labelledby={`${id}-title`}
      sx={(theme) => ({
        ...tileSx(theme),
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      })}
    >
      <Typography
        id={`${id}-title`}
        component="h4"
        sx={{ fontSize: '0.95rem', fontWeight: 700, m: 0 }}
      >
        {title}
      </Typography>
      <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
        {about}
      </Typography>
      {run.state !== 'idle' ? (
        <>
          {running ? (
            <LinearProgress
              variant="determinate"
              value={run.total ? (run.done / run.total) * 100 : 0}
              aria-label={title}
            />
          ) : null}
          <Typography role="status" variant="body2">
            {running
              ? t('explorer:set_checks.progress', {
                  done: formatCount(run.done, language),
                  total: formatCount(run.total, language),
                })
              : run.stopped
                ? t('explorer:set_checks.stopped', {
                    done: formatCount(run.done, language),
                    total: formatCount(run.total, language),
                  })
                : t('explorer:set_checks.done', {
                    count: run.total,
                    shown: formatCount(run.total, language),
                  })}
          </Typography>
        </>
      ) : null}
      {/* One button that stays (start, Stop, Check again): the focus stays on it. */}
      <Button
        size="small"
        variant={running ? 'text' : 'outlined'}
        disabled={!running && total === 0}
        onClick={running ? onStop : onStart}
        sx={{ alignSelf: 'flex-start' }}
      >
        {running
          ? t('explorer:set_checks.stop', cap)
          : run.state === 'done'
            ? t('explorer:set_checks.again', cap)
            : t('explorer:set_checks.start', {
                count: total,
                shown: formatCount(total, language),
                ...cap,
              })}
      </Button>
      {children}
    </Box>
  );
}

function ShowMore({
  stepKey,
  total,
  children,
}: {
  stepKey: string;
  total: number;
  children: (shown: number) => ReactNode;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const [shown, setShown] = useStepState<number>(stepKey, ROWS);
  return (
    <>
      {children(shown)}
      {total > shown ? (
        <Button
          size="small"
          onClick={() => setShown(shown + ROWS)}
          sx={{ alignSelf: 'flex-start' }}
        >
          {t('explorer:connections.payments.show_more', {
            count: Math.min(ROWS, total - shown),
            shown: formatCount(Math.min(ROWS, total - shown), i18n.language),
            ...cap,
          })}
        </Button>
      ) : null}
    </>
  );
}

const LIST_SX = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0.75,
  listStyle: 'none',
  m: 0,
  p: 0,
} as const;

function Note({ children }: { children: ReactNode }) {
  return (
    <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
      {children}
    </Typography>
  );
}

function FirstPayers({
  results,
}: {
  results: Map<string, Checked<Funding | null>>;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const funding = new Map<string, Funding | null>();
  let failed = 0;
  for (const [address, checked] of results)
    if (checked.ok) funding.set(address, checked.value);
    else failed += 1;
  const grouped = groupFirstPayers(funding);
  const counted = (key: string, count: number) =>
    t(key, { count, shown: formatCount(count, language), ...cap });
  return (
    <>
      {grouped.payers.length ? (
        <ShowMore stepKey="setFirstShown" total={grouped.payers.length}>
          {(shown) => (
            <Box
              component="ul"
              aria-label={t('explorer:set_checks.first.title', cap)}
              sx={LIST_SX}
            >
              {grouped.payers.slice(0, shown).map((payer) => (
                <Typography
                  component="li"
                  key={payer.from}
                  sx={{ overflowWrap: 'anywhere' }}
                >
                  <TxSentence
                    sentence={setSentence('first_payer', funding.size, {
                      from: { kind: 'account', address: payer.from },
                      accounts: {
                        kind: 'number',
                        value: payer.accounts.length,
                      },
                    })}
                  />
                </Typography>
              ))}
            </Box>
          )}
        </ShowMore>
      ) : (
        <Note>{t('explorer:set_checks.first.empty', cap)}</Note>
      )}
      {grouped.other ? (
        <Note>{counted('explorer:set_checks.first.other', grouped.other)}</Note>
      ) : null}
      {grouped.none ? (
        <Note>{counted('explorer:set_checks.first.none', grouped.none)}</Note>
      ) : null}
      {failed ? (
        <Note>{counted('explorer:set_checks.failed', failed)}</Note>
      ) : null}
    </>
  );
}

interface Sent {
  rows: TxRow[];
  /** It sent more than the Explorer reads. */
  beyond: boolean;
}

function WentTo({
  results,
}: {
  /** null: the node can't read payments between accounts. */
  results: Map<string, Checked<Sent | null>>;
}) {
  const { t, i18n } = useTranslation(['explorer']);
  const language = i18n.language;
  const sent = new Map<string, TxRow[]>();
  let failed = 0;
  let beyond = 0;
  let unsupported = false;
  for (const [address, checked] of results)
    if (!checked.ok) failed += 1;
    else if (checked.value === null) unsupported = true;
    else {
      sent.set(address, checked.value.rows);
      if (checked.value.beyond) beyond += 1;
    }
  // As on the Funded page: the node can't, never "couldn't be read" for each.
  if (unsupported && !sent.size)
    return <Note>{t('explorer:funded.unsupported', cap)}</Note>;
  const { recipients, atLeftOut } = wentTo(sent);
  const counted = (key: string, count: number) =>
    t(key, { count, shown: formatCount(count, language), ...cap });
  return (
    <>
      {recipients.length ? (
        <ShowMore stepKey="setWentShown" total={recipients.length}>
          {(shown) => (
            <Box
              component="ul"
              aria-label={t('explorer:set_checks.went.title', cap)}
              sx={LIST_SX}
            >
              {recipients.slice(0, shown).map((entry) => (
                <Box component="li" key={entry.address} sx={{ minWidth: 0 }}>
                  <Typography component="div" sx={{ overflowWrap: 'anywhere' }}>
                    <TxSentence
                      sentence={setSentence('went_to', sent.size, {
                        to: { kind: 'account', address: entry.address },
                        amount: {
                          kind: 'amount',
                          amounts: [
                            {
                              amount: fromAtomic(entry.qort),
                              asset: { id: 0, name: null },
                            },
                          ],
                        },
                        accounts: {
                          kind: 'number',
                          value: entry.from.length,
                        },
                      })}
                    />
                  </Typography>
                  <Note>
                    {t('explorer:compare.common.payments', {
                      count: entry.count,
                      shown: formatCount(entry.count, language),
                    })}
                  </Note>
                </Box>
              ))}
            </Box>
          )}
        </ShowMore>
      ) : (
        <Note>{t('explorer:set_checks.went.empty', cap)}</Note>
      )}
      {atLeftOut ? (
        <Note>{counted('explorer:set_checks.went.ats', atLeftOut)}</Note>
      ) : null}
      {beyond ? (
        <Note>{counted('explorer:set_checks.went.beyond', beyond)}</Note>
      ) : null}
      {failed ? (
        <Note>{counted('explorer:set_checks.failed', failed)}</Note>
      ) : null}
    </>
  );
}

export function SetChecks({ accounts }: { accounts: readonly string[] }) {
  const { t } = useTranslation(['explorer']);
  const { cache } = useExplorer();
  const read = useCallback(
    <T,>(spec: ReadSpec<T>) =>
      cache.read(spec.key, spec.load, { ttlMs: spec.ttlMs }),
    [cache]
  );
  const first = useSetRun<Funding | null>(
    accounts,
    async (address) => {
      const explored = await read(accountRead(address));
      if (explored.kind !== 'account') return null;
      return read(fundingRead(explored.account));
    },
    'setChecksFirst'
  );
  const went = useSetRun<Sent | null>(
    accounts,
    async (address, halted) => {
      const rows: TxRow[] = [];
      for (let page = 0; page < FUNDED_PAGES; page++) {
        // Stopped, or the step was left: no more pages for it.
        if (page > 0 && halted()) return undefined;
        const answer = await read(fundedPageRead(address, page));
        // A node that can't read payments between accounts can't tell.
        if (answer === null) return null;
        rows.push(...answer.rows);
        if (!answer.full) return { rows, beyond: false };
        if (page === FUNDED_PAGES - 1)
          return { rows, beyond: Boolean(answer.beyond) };
      }
      return { rows, beyond: false };
    },
    'setChecksWent'
  );
  const total = accounts.length;
  return (
    <Section
      id="explorer-set-checks"
      title={t('explorer:set_checks.title', cap)}
    >
      <CheckCard
        id="explorer-set-first"
        title={t('explorer:set_checks.first.title', cap)}
        about={t('explorer:set_checks.first.about', cap)}
        total={total}
        run={first.run as Run<unknown>}
        onStart={first.start}
        onStop={first.stop}
      >
        {first.run.state === 'done' ? (
          <FirstPayers results={first.run.results} />
        ) : null}
      </CheckCard>
      <CheckCard
        id="explorer-set-went"
        title={t('explorer:set_checks.went.title', cap)}
        about={t('explorer:set_checks.went.about', cap)}
        total={total}
        run={went.run as Run<unknown>}
        onStart={went.start}
        onStop={went.stop}
      >
        {went.run.state === 'done' ? (
          <WentTo results={went.run.results} />
        ) : null}
      </CheckCard>
    </Section>
  );
}
