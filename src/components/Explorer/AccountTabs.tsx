/**
 * An account page's tabs: Overview · Transactions. They are a list, so a
 * later part adds its tab (Names, Connections, Trades, Assets) as one more
 * entry, and a tab only some viewers see says so in `shown`.
 *
 * The tab belongs to the history step (useStepState): switching tabs
 * changes the step in place, never adds one, and Back and Forward show the
 * tab each step was left on. The bar is MUI's: arrow keys move between the
 * tabs, Enter or Space opens one, and on a narrow window it scrolls
 * sideways.
 */
import { type ReactNode } from 'react';
import { Box, Tab, Tabs } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useStepState } from './ExplorerContext';
import { cap } from './parts';

export type AccountTabId = 'overview' | 'transactions';

/** What a page is: a personal account, or an AT (a program on the chain). */
export type AccountPage = 'account' | 'at';

export interface AccountTabContext {
  page: AccountPage;
}

export interface AccountTabDef {
  id: AccountTabId;
  /** Its label's key. */
  label: string;
  /** The pages that have it. */
  pages: readonly AccountPage[];
  /** For a tab only some viewers see: whether this one does. */
  shown?: (context: AccountTabContext) => boolean;
}

/** Every tab, in order. */
export const ACCOUNT_TABS: readonly AccountTabDef[] = [
  { id: 'overview', label: 'explorer:tabs.overview', pages: ['account'] },
  {
    id: 'transactions',
    label: 'explorer:tabs.transactions',
    pages: ['account', 'at'],
  },
];

/** The tabs a page shows. */
export function tabsFor(context: AccountTabContext): AccountTabDef[] {
  return ACCOUNT_TABS.filter(
    (tab) => tab.pages.includes(context.page) && (tab.shown?.(context) ?? true)
  );
}

export const tabElementId = (id: AccountTabId) => `explorer-tab-${id}`;
export const panelElementId = (id: AccountTabId) => `explorer-panel-${id}`;

/**
 * The tab this step shows, and the way to switch it. A tab the page
 * doesn't have (an old step, a tab not shown to this viewer) opens the
 * first one instead.
 */
export function useAccountTab(
  tabs: readonly AccountTabDef[]
): [AccountTabId, (id: AccountTabId) => void] {
  const [stored, setTab] = useStepState<AccountTabId | null>('tab', null);
  const tab = tabs.some((each) => each.id === stored)
    ? (stored as AccountTabId)
    : (tabs[0]?.id ?? 'overview');
  return [tab, setTab];
}

/** Put the keyboard on a tab, once it is on screen. */
export function focusTab(id: AccountTabId) {
  requestAnimationFrame(() =>
    document.getElementById(tabElementId(id))?.focus()
  );
}

export function AccountTabs({
  tabs,
  tab,
  onChange,
}: {
  tabs: readonly AccountTabDef[];
  tab: AccountTabId;
  onChange: (id: AccountTabId) => void;
}) {
  const { t } = useTranslation(['explorer']);
  return (
    <Box
      sx={(theme) => ({
        borderBottom: `1px solid ${theme.palette.divider}`,
        minWidth: 0,
      })}
    >
      <Tabs
        value={tab}
        onChange={(_event, value: AccountTabId) => onChange(value)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        aria-label={t('explorer:tabs.label', cap)}
        sx={{ minHeight: 40 }}
      >
        {tabs.map((each) => (
          <Tab
            key={each.id}
            value={each.id}
            label={t(each.label, cap)}
            id={tabElementId(each.id)}
            aria-controls={panelElementId(each.id)}
            sx={{
              fontWeight: 600,
              minHeight: 40,
              minWidth: 0,
              px: { xs: 1.5, sm: 2 },
              textTransform: 'none',
            }}
          />
        ))}
      </Tabs>
    </Box>
  );
}

export function AccountTabPanel({
  id,
  children,
}: {
  id: AccountTabId;
  children: ReactNode;
}) {
  return (
    <Box
      role="tabpanel"
      id={panelElementId(id)}
      aria-labelledby={tabElementId(id)}
      sx={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}
    >
      {children}
    </Box>
  );
}
