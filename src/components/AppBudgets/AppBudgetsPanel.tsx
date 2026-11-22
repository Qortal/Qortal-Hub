import { Box, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  hasBudgetEnded,
  isSameBudgetApp,
  type AppBudget,
  type BudgetApp,
} from '../../qortal/appBudgets';
import { AllowedForApp, AllowedForOtherApps } from './AllowedWithoutAsking';
import { AppBudgetCard } from './AppBudgetCard';
import { useAppBudgets, useNow } from './useAppBudgets';

type AppBudgetsPanelProps = {
  /** The signed-in account. */
  address: string;
  /** The Q-App or website on screen, when there is one. */
  currentApp: BudgetApp | null;
  /** The tab it is open in. */
  currentTabId?: string | null;
};

const byName = (a: AppBudget, b: AppBudget) =>
  a.name.localeCompare(b.name) || a.service.localeCompare(b.service);

/**
 * The search bar's budget panel: the app on screen first, with what else it
 * may do without asking, then the other budgets of this account, the ones
 * that have ended, and the "always allow" boxes ticked for other apps.
 */
export function AppBudgetsPanel({
  address,
  currentApp,
  currentTabId = null,
}: AppBudgetsPanelProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const capital = { postProcess: 'capitalizeFirstChar' };
  const budgets = useAppBudgets(address);
  const now = useNow();
  const current = currentApp
    ? (budgets.find((b) => isSameBudgetApp(b, currentApp)) ?? null)
    : null;
  const others = budgets.filter(
    (b) => !currentApp || !isSameBudgetApp(b, currentApp)
  );
  const running = others.filter((b) => !hasBudgetEnded(b, now)).sort(byName);
  const ended = others
    .filter((b) => hasBudgetEnded(b, now))
    .sort((a, b) => b.expiresAt - a.expiresAt);
  const sectionSx = {
    color: theme.palette.text.secondary,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.08em',
    mb: 1,
    mt: 2,
    textTransform: 'uppercase',
  } as const;
  const keyOf = (app: BudgetApp) => `${app.service}/${app.name.toLowerCase()}`;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <Typography component="h2" sx={{ fontSize: 16, fontWeight: 700 }}>
        {t('core:app_budgets.title', capital)}
      </Typography>
      <Typography
        sx={{
          color: theme.palette.text.secondary,
          fontSize: 13,
          lineHeight: 1.5,
          mt: 0.5,
        }}
      >
        {t('core:app_budgets.intro', capital)}
      </Typography>
      <Typography
        sx={{
          color: theme.palette.text.secondary,
          fontSize: 12.5,
          lineHeight: 1.45,
          mt: 0.75,
        }}
      >
        {t('core:app_budgets.always_asks', capital)}
      </Typography>

      {currentApp && (
        <>
          <Typography component="h3" sx={sectionSx}>
            {t('core:app_budgets.this_app', capital)}
          </Typography>
          <AppBudgetCard
            address={address}
            app={current ?? currentApp}
            budget={current}
            key={keyOf(currentApp)}
            now={now}
          />
          <AllowedForApp
            address={address}
            app={currentApp}
            key={`allowed-${keyOf(currentApp)}`}
            tabId={currentTabId}
          />
        </>
      )}

      {running.length > 0 && (
        <>
          <Typography component="h3" sx={sectionSx}>
            {currentApp
              ? t('core:app_budgets.other_budgets', capital)
              : t('core:app_budgets.all_budgets', capital)}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {running.map((budget) => (
              <AppBudgetCard
                address={address}
                app={budget}
                budget={budget}
                collapsible
                key={keyOf(budget)}
                now={now}
              />
            ))}
          </Box>
        </>
      )}

      {ended.length > 0 && (
        <>
          <Typography component="h3" sx={sectionSx}>
            {t('core:app_budgets.ended', capital)}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {ended.map((budget) => (
              <AppBudgetCard
                address={address}
                app={budget}
                budget={budget}
                collapsible
                key={keyOf(budget)}
                now={now}
              />
            ))}
          </Box>
        </>
      )}

      <AllowedForOtherApps
        address={address}
        except={currentApp}
        sectionSx={sectionSx}
      />

      {!currentApp && budgets.length === 0 && (
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: 13,
            mt: 2,
          }}
        >
          {t('core:app_budgets.none_yet', capital)}
        </Typography>
      )}
    </Box>
  );
}
