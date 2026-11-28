/**
 * One account in the Explorer. `who` is an address, or a name: a name is
 * looked up and the view switches to its owner's address, carrying the
 * name, so the header can say which name it came from. A name no one has,
 * an address the node rejects and an address never used each get a page of
 * their own; a failed read gets Retry. An AT address (a program on the
 * chain) opens a page with its transactions only. (A transaction signature
 * is a step of its own: ExplorerWindow opens it in TxView.)
 *
 * An account's page is its header, the trail, then its tabs (AccountTabs):
 * Overview, Transactions and Names. Each tab reads what it shows when it
 * opens.
 * Read-only: nothing here writes (Send QORT and Block hand over to Hub's
 * own windows and lists).
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { Box, ButtonBase, CircularProgress, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  isAtAddress,
  isQortAddress,
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
  type GroupOf,
  type NamesOf,
  type OnlineShare,
} from '../../lib/explorer/reads';
import {
  minterStandingOf,
  mintingNowOf,
  visibleName,
} from '../../lib/explorer/rules';
import { ALL_TRANSACTIONS, type TxFilter } from '../../lib/explorer/txFamilies';
import { AccountHeader, type NameMatch } from './AccountHeader';
import {
  AccountTabPanel,
  AccountTabs,
  focusTab,
  tabsFor,
  useAccountTab,
  type AccountPage,
  type AccountTabDef,
  type AccountTabId,
} from './AccountTabs';
import {
  useExplorer,
  useExplorerRead,
  useStepState,
  type ReadState,
} from './ExplorerContext';
import { ExplorerAvatar } from './ExplorerSearchField';
import { ExplorerTrail } from './ExplorerTrail';
import { AtAGlance } from './overview/AtAGlance';
import { GroupsSection } from './overview/GroupsSection';
import { MinterSection, MintingSection } from './overview/MinterAndMinting';
import { NotesSection } from './overview/NotesSection';
import { LatestTransactions } from './overview/LatestTransactions';
import { OverviewSummary } from './overview/OverviewSummary';
import { NamesTab } from './names/NamesTab';
import {
  cap,
  CopyButton,
  isolate,
  LoadingLine,
  mutedText,
  panelSx,
  ReadError,
} from './parts';
import { TransactionsTab } from './transactions/TransactionsTab';

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

/**
 * The tab bar and the tab on screen; a page with one tab (an AT) shows it
 * without a bar.
 */
function TabsView({
  tabs,
  render,
}: {
  tabs: readonly AccountTabDef[];
  render: (tab: AccountTabId, open: (tab: AccountTabId) => void) => ReactNode;
}) {
  const [tab, setTab] = useAccountTab(tabs);
  const open = (next: AccountTabId) => {
    setTab(next);
    focusTab(next);
  };
  if (tabs.length < 2) return <>{render(tab, open)}</>;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <AccountTabs tabs={tabs} tab={tab} onChange={setTab} />
      <AccountTabPanel id={tab}>{render(tab, open)}</AccountTabPanel>
    </Box>
  );
}

/** undefined while loading, null when it failed. */
const part = <T,>(read: { data: T | undefined; status: string }) =>
  read.data !== undefined
    ? read.data
    : read.status === 'error'
      ? null
      : undefined;

/** The Overview: its reads start when it opens. */
function OverviewTab({
  account,
  primary,
  names,
  groups,
  online,
  onShowTransactions,
  onShowNames,
}: {
  account: AccountInfo;
  primary: string | null | undefined;
  names: ReadState<NamesOf>;
  groups: ReadState<GroupOf[]>;
  online: ReadState<OnlineShare[]>;
  onShowTransactions: () => void;
  onShowNames: () => void;
}) {
  const { address, publicKey } = account;
  const firstSeen = useExplorerRead(firstSeenRead(address));
  const lastSent = useExplorerRead(
    publicKey ? lastSentRead(address, publicKey) : null
  );
  const payments = useExplorerRead(recentPaymentsRead(address));
  const standing = groups.data ? minterStandingOf(groups.data) : undefined;
  return (
    <>
      <OverviewSummary
        level={account.level}
        standing={groups.status === 'error' ? null : standing}
        names={part(names)}
        firstSeen={part(firstSeen)}
        lastSent={publicKey ? part(lastSent) : null}
        onShowNames={onShowNames}
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
        primary={primary}
        names={names.data}
        onShowNames={onShowNames}
      />
      <LatestTransactions address={address} onShowAll={onShowTransactions} />
    </>
  );
}

/** An account that exists: its header, the trail, then its tabs. */
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
  // The Transactions tab's filter, kept by the step: "All transactions" shows every kind.
  const [, setTxFilter] = useStepState<TxFilter>('txFilter', ALL_TRANSACTIONS);

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
      <TabsView
        tabs={tabsFor({ page: 'account' })}
        render={(tab, open) =>
          tab === 'transactions' ? (
            <TransactionsTab address={address} publicKey={publicKey} />
          ) : tab === 'names' ? (
            <NamesTab address={address} names={names} primary={primary} />
          ) : (
            <OverviewTab
              account={account}
              primary={primary.data}
              names={names}
              groups={groups}
              online={online}
              onShowTransactions={() => {
                setTxFilter(ALL_TRANSACTIONS);
                open('transactions');
              }}
              onShowNames={() => open('names')}
            />
          )
        }
      />
    </Box>
  );
}

/** An AT (a program on the chain): what it is, its address, then its transactions. */
function AtView({ address, trail }: { address: string; trail: string[] }) {
  const { t } = useTranslation(['core', 'explorer', 'group']);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography
          component="h2"
          sx={{
            fontSize: { xs: '1.15rem', sm: '1.3rem' },
            fontWeight: 700,
            lineHeight: 1.25,
          }}
        >
          {t('explorer:at.title', cap)}
        </Typography>
        <Typography
          variant="body2"
          sx={(theme) => ({ color: mutedText(theme) })}
        >
          {t('explorer:at.about', cap)}
        </Typography>
        <Box
          sx={{ alignItems: 'center', display: 'flex', gap: 0.5, minWidth: 0 }}
        >
          <Typography
            component="span"
            variant="body2"
            sx={{
              fontFamily: 'monospace',
              fontSize: '0.82rem',
              minWidth: 0,
              overflowWrap: 'anywhere',
            }}
          >
            {address}
          </Typography>
          <CopyButton
            value={address}
            label={t('core:message.generic.copy_address', cap)}
            copiedMessage={t('group:home.address_copied', cap)}
          />
        </Box>
      </Box>
      <ExplorerTrail trail={trail} />
      <TabsView
        tabs={tabsFor({ page: 'at' })}
        render={() => <TransactionsTab address={address} publicKey={null} />}
      />
    </Box>
  );
}

/** An address: whether the node knows it, and the account (or the AT) if it does. */
function AddressView({
  address,
  page,
  openedBy,
  trail,
  onShown,
}: {
  address: string;
  page: AccountPage;
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
  if (page === 'at') return <AtView address={address} trail={trail} />;
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
  if (isQortAddress(who) || isAtAddress(who))
    return (
      <AddressView
        address={who}
        page={isAtAddress(who) ? 'at' : 'account'}
        openedBy={openedBy}
        trail={trail}
        onShown={onShown}
      />
    );
  return <NameView key={who} name={who} onResolved={onNameResolved} />;
}
