/**
 * One account in the Explorer. `who` is an address, or a name: a name is
 * looked up and the view switches to its owner's address, carrying the
 * name, so the header can say which name it came from. A name no one has,
 * an address the node rejects, an address never used, an AT address and a
 * transaction signature each get a page of their own; a failed read gets
 * Retry. Read-only: nothing here writes (Send QORT and Block hand over to
 * Hub's own windows and lists).
 */
import { useEffect, useRef } from 'react';
import { Box, ButtonBase, CircularProgress, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  isAtAddress,
  isQortAddress,
  isSignature,
  looksLikeAddress,
} from '../../lib/explorer/addresses';
import {
  accountRead,
  devAdminsRead,
  firstSeenRead,
  groupsOfRead,
  lastSentRead,
  nameDataRead,
  namesOfRead,
  namesStartingRead,
  onlineRead,
  primaryNameRead,
  recentPaymentsRead,
  type AccountInfo,
} from '../../lib/explorer/reads';
import {
  minterStandingOf,
  mintingNowOf,
  visibleName,
} from '../../lib/explorer/rules';
import { AccountHeader, type NameMatch } from './AccountHeader';
import { useExplorer, useExplorerRead } from './ExplorerContext';
import { ExplorerAvatar } from './ExplorerSearchField';
import { ExplorerTrail } from './ExplorerTrail';
import { AtAGlance } from './overview/AtAGlance';
import { GroupsSection } from './overview/GroupsSection';
import { MinterSection, MintingSection } from './overview/MinterAndMinting';
import { NotesSection } from './overview/NotesSection';
import { OverviewSummary } from './overview/OverviewSummary';
import { RecentPayments } from './overview/RecentPayments';
import {
  cap,
  isolate,
  LoadingLine,
  mutedText,
  panelSx,
  ReadError,
} from './parts';

function Message({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
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
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function Loading() {
  const { t } = useTranslation(['core']);
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      <CircularProgress size={28} aria-label={t('core:loading.generic', cap)} />
    </Box>
  );
}

function Mono({ text }: { text: string }) {
  return (
    <Typography
      variant="body2"
      sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}
    >
      {text}
    </Typography>
  );
}

/** Names that start with what was typed, to open one of them instead. */
function NamesStartingWith({ text }: { text: string }) {
  const { t } = useTranslation(['core', 'explorer']);
  const { openAccount } = useExplorer();
  const search = useExplorerRead(namesStartingRead(text));
  if (search.status === 'error')
    return (
      <ReadError
        message={t('explorer:account.similar_failed', cap)}
        onRetry={search.retry}
      />
    );
  if (search.data === undefined)
    return <LoadingLine label={t('core:loading.generic', cap)} />;
  const names = search.data;
  if (!names.length)
    return (
      <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
        {t('explorer:account.no_similar_names', cap)}
      </Typography>
    );
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Typography variant="body2" sx={(theme) => ({ color: mutedText(theme) })}>
        {t('explorer:account.similar_names', cap)}
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {names.map((name) => (
          <li key={name}>
            <ButtonBase
              onClick={() => openAccount(name)}
              sx={(theme) => ({
                alignItems: 'center',
                borderRadius: '8px',
                display: 'flex',
                gap: 1,
                minHeight: 36,
                px: 0.75,
                '&:hover': { backgroundColor: theme.palette.action.hover },
                '&.Mui-focusVisible': {
                  outline: `2px solid ${theme.palette.primary.main}`,
                },
              })}
            >
              <ExplorerAvatar name={name} size={24} />
              <bdi dir="auto">{visibleName(name)}</bdi>
            </ButtonBase>
          </li>
        ))}
      </Box>
    </Box>
  );
}

/** An account that exists: its header, the trail, then its Overview. */
function AccountView({
  account,
  openedBy,
  trail,
}: {
  account: AccountInfo;
  openedBy: NameMatch | null;
  trail: string[];
}) {
  const { address, publicKey } = account;
  const primary = useExplorerRead(primaryNameRead(address));
  const names = useExplorerRead(namesOfRead(address));
  const groups = useExplorerRead(groupsOfRead(address));
  const online = useExplorerRead(onlineRead());
  const devAdmins = useExplorerRead(devAdminsRead());
  const firstSeen = useExplorerRead(firstSeenRead(address));
  const lastSent = useExplorerRead(
    publicKey ? lastSentRead(address, publicKey) : null
  );
  const payments = useExplorerRead(recentPaymentsRead(address));

  /** undefined while loading, null when it failed. */
  const part = <T,>(read: { data: T | undefined; status: string }) =>
    read.data !== undefined
      ? read.data
      : read.status === 'error'
        ? null
        : undefined;

  const standing = groups.data ? minterStandingOf(groups.data) : undefined;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <AccountHeader
        account={account}
        primary={primary.data}
        onRetryPrimary={primary.status === 'error' ? primary.retry : null}
        names={names.data}
        standing={standing}
        devAdmin={Boolean(devAdmins.data?.includes(address))}
        minting={online.data ? mintingNowOf(online.data, address) : undefined}
        openedBy={openedBy}
      />
      <ExplorerTrail trail={trail} />
      <OverviewSummary
        level={account.level}
        standing={groups.status === 'error' ? null : standing}
        names={part(names)}
        firstSeen={part(firstSeen)}
        lastSent={publicKey ? part(lastSent) : null}
      />
      <AtAGlance
        account={account}
        firstSeen={firstSeen}
        groups={groups}
        payments={payments}
      />
      <GroupsSection address={address} read={groups} />
      <MinterSection read={groups} />
      <MintingSection
        address={address}
        hasPublicKey={Boolean(publicKey)}
        online={online}
      />
      <NotesSection
        address={address}
        penalty={account.blocksMintedPenalty}
        primary={primary.data ?? null}
      />
      <RecentPayments owner={address} read={payments} />
    </Box>
  );
}

/** An address: whether the node knows it, and the account if it does. */
function AddressView({
  address,
  openedBy,
  trail,
  onShown,
}: {
  address: string;
  openedBy: NameMatch | null;
  trail: string[];
  onShown: (address: string) => void;
}) {
  const { t } = useTranslation(['explorer']);
  const explored = useExplorerRead(accountRead(address));
  const shown =
    explored.data?.kind === 'account' ? explored.data.account.address : null;
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  useEffect(() => {
    if (shown) onShownRef.current(shown);
  }, [shown]);

  if (explored.status === 'error')
    return (
      <Box sx={panelSx}>
        <ReadError
          message={t('explorer:account.failed', cap)}
          onRetry={explored.retry}
        />
      </Box>
    );
  if (!explored.data) return <Loading />;
  if (explored.data.kind === 'invalid')
    return (
      <Message title={t('explorer:account.invalid', cap)}>
        <Mono text={address} />
      </Message>
    );
  if (explored.data.kind === 'unused')
    return (
      <Message title={t('explorer:account.unused', cap)}>
        <Mono text={address} />
      </Message>
    );
  return (
    <AccountView
      account={explored.data.account}
      openedBy={openedBy}
      trail={trail}
    />
  );
}

/** A name: its owner, or a page saying no one has it. */
function NameView({
  name,
  onResolved,
}: {
  name: string;
  onResolved: (owner: string, match: NameMatch) => void;
}) {
  const { t } = useTranslation(['explorer']);
  const lookup = useExplorerRead(nameDataRead(name));
  const found = lookup.data ?? null;
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  useEffect(() => {
    if (found)
      onResolvedRef.current(found.owner, { typed: name, matched: found.name });
  }, [found, name]);

  if (lookup.status === 'error')
    return (
      <Box sx={panelSx}>
        <ReadError
          message={t('explorer:account.name_failed', cap)}
          onRetry={lookup.retry}
        />
      </Box>
    );
  if (lookup.data === undefined || found) return <Loading />;
  if (looksLikeAddress(name))
    return (
      <Message title={t('explorer:account.invalid', cap)}>
        <Mono text={name} />
      </Message>
    );
  return (
    <Message
      title={t('explorer:account.no_such_name', {
        name: isolate(visibleName(name)),
        ...cap,
      })}
    >
      <NamesStartingWith text={name} />
    </Message>
  );
}

export function ExplorerAccount({
  who,
  openedBy,
  trail,
  onNameResolved,
  onShown,
}: {
  who: string;
  openedBy: NameMatch | null;
  trail: string[];
  onNameResolved: (owner: string, match: NameMatch) => void;
  onShown: (address: string) => void;
}) {
  const { t } = useTranslation(['explorer']);
  if (isQortAddress(who))
    return (
      <AddressView
        address={who}
        openedBy={openedBy}
        trail={trail}
        onShown={onShown}
      />
    );
  if (isAtAddress(who))
    return (
      <Message title={t('explorer:account.at_address', cap)}>
        <Mono text={who} />
      </Message>
    );
  if (isSignature(who))
    return (
      <Message title={t('explorer:account.signature', cap)}>
        <Mono text={who} />
      </Message>
    );
  return <NameView key={who} name={who} onResolved={onNameResolved} />;
}
