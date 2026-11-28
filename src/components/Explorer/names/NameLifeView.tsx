/**
 * A name's own page, a step of the window (opened from a name on the
 * Names tab, or from a name in a transaction's sentence): its picture and
 * name, who owns it now, its record (when it was registered and last
 * updated, whether it is for sale), notes on how it is written, then its
 * whole history: every change to it since it was registered, by every
 * account that had it and under its earlier spellings, newest first
 * (lib/explorer/nameLife.ts), each as a row that opens to its fields and
 * the accounts involved. The line over the history says when it was
 * registered, how many changes since and how many owners; one under it
 * says where it stops short, and why, when it does.
 *
 * A name no one has now has a page of its own; a failed read offers Retry,
 * and neither is taken for the other. The window's Refresh reads the
 * record and the whole history again. Read-only.
 */
import { useCallback, type ReactNode } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Skeleton,
  Typography,
} from '@mui/material';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { formatCount, formatDay } from '../../../lib/explorer/format';
import {
  NAME_LIFE_HOPS,
  NAME_LIFE_ROWS,
  nameLifeRead,
  type NameLife,
} from '../../../lib/explorer/nameLife';
import { nameDataRead, type NameData } from '../../../lib/explorer/reads';
import { visibleName } from '../../../lib/explorer/rules';
import { useExplorer, useExplorerRead, useStepState } from '../ExplorerContext';
import { AccountRow } from '../ExplorerStart';
import { ExplorerAvatar } from '../ExplorerSearchField';
import { cap, isolate, mutedText, panelSx, ReadError, Section } from '../parts';
import { TxList } from '../transactions/TxListRow';
import { NameNotes, SentenceWithAccount } from './nameParts';
import { recordParts } from './nameWords';

/** Changes shown before "Show all". */
export const LIFE_SHOWN = 10;

function Loading() {
  const { t } = useTranslation(['core']);
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      <CircularProgress size={28} aria-label={t('core:loading.generic', cap)} />
    </Box>
  );
}

/** The line over the history: registered when, how many changes since, how many owners. */
function lifeSummary(
  life: NameLife,
  t: TFunction,
  language: string
): string | null {
  const parts: string[] = [];
  const end = life.end;
  if (end.kind === 'registered') {
    parts.push(
      String(
        t('explorer:name_page.summary_registered', {
          date: formatDay(end.tx.timestamp, language),
          ...cap,
        })
      )
    );
    const changes = life.steps.length - 1;
    parts.push(
      String(
        changes > 0
          ? t('explorer:name_page.changes_since', {
              count: changes,
              shown: formatCount(changes, language),
            })
          : t('explorer:name_page.no_changes_since')
      )
    );
  } else if (life.steps.length) {
    parts.push(
      String(
        t('explorer:name_page.changes_found', {
          count: life.steps.length,
          shown: formatCount(life.steps.length, language),
          ...cap,
        })
      )
    );
  } else return null;
  const owners = new Set(life.owners).size;
  if (owners > 1)
    parts.push(
      String(
        t('explorer:name_page.owners', {
          count: owners,
          shown: formatCount(owners, language),
        })
      )
    );
  return parts.join(' · ');
}

/** Under the history, when it doesn't reach the registration its record gives, or stops short. */
function EndNote({ life }: { life: NameLife }) {
  const { t, i18n } = useTranslation(['explorer']);
  const end = life.end;
  let note: ReactNode = null;
  if (end.kind === 'registered') {
    if (!end.matches && life.registered !== null)
      note = t('explorer:name_page.other_registration', {
        date: formatDay(life.registered, i18n.language),
        ...cap,
      });
  } else if (end.why === 'capped')
    note = (
      <SentenceWithAccount
        textKey="explorer:name_page.cut_capped"
        address={end.at}
        slotName="account"
        values={{ max: formatCount(NAME_LIFE_ROWS, i18n.language) }}
      />
    );
  else if (end.why === 'notFound')
    note = (
      <SentenceWithAccount
        textKey="explorer:name_page.cut_not_found"
        address={end.at}
        slotName="account"
      />
    );
  else
    note = t('explorer:name_page.cut_hops', {
      n: formatCount(NAME_LIFE_HOPS, i18n.language),
      ...cap,
    });
  if (!note) return null;
  return (
    <Typography
      role="note"
      variant="body2"
      sx={(theme) => ({ color: mutedText(theme), overflowWrap: 'anywhere' })}
    >
      {note}
    </Typography>
  );
}

/** The whole history: read when the page opens, kept as one entry of the window's cache. */
function WholeHistory({ name }: { name: string }) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const { cache } = useExplorer();
  // The walk starts from the record the page shows: one read of it, shared.
  const readRecord = useCallback(() => {
    const spec = nameDataRead(name);
    return cache.read(spec.key, spec.load, { ttlMs: spec.ttlMs });
  }, [cache, name]);
  const life = useExplorerRead(nameLifeRead(name, readRecord));
  const [all, setAll] = useStepState('lifeAll', false);
  const shownName = isolate(visibleName(life.data?.name ?? name));

  let body: ReactNode;
  if (life.status === 'error')
    body = (
      <ReadError
        message={t('explorer:name_page.life_failed', cap)}
        onRetry={life.retry}
      />
    );
  else if (life.data === undefined)
    body = (
      <Box role="status" sx={{ minWidth: 0 }}>
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:name_page.reading', cap)}
        </Typography>
        <Skeleton variant="text" width="85%" aria-hidden />
        <Skeleton variant="text" width="50%" aria-hidden />
      </Box>
    );
  else if (life.data === null)
    body = (
      <Typography variant="body2" role="status">
        {t('explorer:names.no_record', cap)}
      </Typography>
    );
  else {
    const data = life.data;
    const shown = all ? data.steps : data.steps.slice(0, LIFE_SHOWN);
    const summary = lifeSummary(data, t, i18n.language);
    body = (
      <Box
        sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}
      >
        {summary ? (
          <Typography
            role="status"
            sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
          >
            {summary}
          </Typography>
        ) : null}
        {shown.length ? (
          <TxList
            rows={shown}
            viewpoint={null}
            label={t('explorer:name_page.steps_label', {
              name: shownName,
              ...cap,
            })}
          />
        ) : null}
        {data.steps.length > shown.length ? (
          <Button
            size="small"
            variant="outlined"
            onClick={() => setAll(true)}
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('explorer:tx.show_all', { count: data.steps.length, ...cap })}
          </Button>
        ) : null}
        <EndNote life={data} />
      </Box>
    );
  }
  return (
    <Section
      id="explorer-name-history"
      title={t('explorer:name_page.history', cap)}
    >
      <Box sx={panelSx}>{body}</Box>
    </Section>
  );
}

function NamePage({ asked, record }: { asked: string; record: NameData }) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const parts = recordParts(record, t, i18n.language);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Box
          sx={{ alignItems: 'center', display: 'flex', gap: 1.5, minWidth: 0 }}
        >
          <ExplorerAvatar name={record.name} size={56} />
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.25,
              minWidth: 0,
            }}
          >
            <Typography
              component="h2"
              sx={{
                fontSize: { xs: '1.15rem', sm: '1.3rem' },
                fontWeight: 700,
                lineHeight: 1.25,
                overflowWrap: 'anywhere',
              }}
            >
              <bdi dir="auto">{visibleName(record.name)}</bdi>
            </Typography>
            <Typography
              variant="body2"
              sx={(theme) => ({ color: mutedText(theme) })}
            >
              {t('explorer:name_page.kind', cap)}
            </Typography>
          </Box>
        </Box>
        {asked !== record.name ? (
          <Typography
            role="note"
            variant="body2"
            sx={(theme) => ({
              color: mutedText(theme),
              overflowWrap: 'anywhere',
            })}
          >
            {t('explorer:name_page.matched', {
              asked: isolate(visibleName(asked)),
              matched: isolate(visibleName(record.name)),
              ...cap,
            })}
          </Typography>
        ) : null}
        {parts.length ? (
          <Typography
            variant="body2"
            sx={(theme) => ({
              color: mutedText(theme),
              overflowWrap: 'anywhere',
            })}
          >
            {parts.join(' · ')}
          </Typography>
        ) : null}
        <NameNotes name={record.name} owner={record.owner} />
      </Box>
      <Section
        id="explorer-name-owner"
        title={t('explorer:name_page.owner', cap)}
      >
        <Box sx={panelSx}>
          <AccountRow address={record.owner} fromExplorer />
        </Box>
      </Section>
      <WholeHistory name={asked} />
    </Box>
  );
}

export function NameLifeView({ name }: { name: string }) {
  const { t } = useTranslation(['explorer']);
  const record = useExplorerRead(nameDataRead(name));
  if (record.status === 'error')
    return (
      <Box sx={panelSx}>
        <ReadError
          message={t('explorer:name_page.failed', cap)}
          onRetry={record.retry}
        />
      </Box>
    );
  if (record.data === undefined) return <Loading />;
  if (record.data === null)
    return (
      <Box
        sx={(theme) => ({
          ...panelSx(theme),
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        })}
      >
        <Typography
          role="status"
          sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}
        >
          {t('explorer:name_page.nobody', {
            name: isolate(visibleName(name)),
            ...cap,
          })}
        </Typography>
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:name_page.nobody_hint', cap)}
        </Typography>
      </Box>
    );
  return <NamePage asked={name} record={record.data} />;
}
