import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  Collapse,
  LinearProgress,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { useTranslation } from 'react-i18next';
import {
  USUAL_ACTION_FEE_ATOMIC,
  budgetLeft,
  budgetState,
  changeAppBudget,
  qortText,
  refillAppBudget,
  removeAppBudget,
  topUpAppBudget,
  type AppBudget,
  type BudgetApp,
} from '../../qortal/appBudgets';
import { SidePanelAppIcon } from '../Desktop/SidePanelAppIcon';
import { BudgetChoices, isDraftValid } from './BudgetChoices';
import {
  changeDraft,
  draftAmount,
  draftEndTime,
  newBudgetDraft,
  type BudgetDraft,
} from './budgetDraft';

type Mode = 'view' | 'add' | 'top_up' | 'change' | 'renew' | 'remove';

type AppBudgetCardProps = {
  address: string;
  app: BudgetApp;
  /** Null when the app has no budget yet: the card offers to add one. */
  budget: AppBudget | null;
  now: number;
  /** Shown folded, as one line, until clicked. */
  collapsible?: boolean;
};

export const formatBudgetDate = (time: number, language: string): string => {
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(
      time
    );
  } catch {
    return new Date(time).toLocaleDateString();
  }
};

/** One app's budget: what is used and left, and what can be done with it. */
export function AppBudgetCard({
  address,
  app,
  budget,
  now,
  collapsible = false,
}: AppBudgetCardProps) {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const capital = { postProcess: 'capitalizeFirstChar' };
  const [open, setOpen] = useState(!collapsible);
  const [mode, setMode] = useState<Mode>(budget ? 'view' : 'add');
  const [draft, setDraft] = useState<BudgetDraft>(() =>
    newBudgetDraft(budget?.limits)
  );
  const [notSaved, setNotSaved] = useState(false);
  const state = budget ? budgetState(budget, now) : null;
  // A form that no longer fits the budget closes: Top up and Change once it
  // has ended, Renew once it runs again (renewed in the approval window),
  // Add once there is one.
  const shownMode: Mode = !budget
    ? 'add'
    : mode === 'add' ||
        (state === 'ended' && (mode === 'top_up' || mode === 'change')) ||
        (state !== 'ended' && mode === 'renew')
      ? 'view'
      : mode;
  const idPrefix = `app-budget-${app.service}-${app.name}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-');

  const startForm = (next: Mode) => {
    setNotSaved(false);
    setDraft(
      next === 'change' && budget
        ? changeDraft(budget.expiresAt, budget.limits)
        : newBudgetDraft(budget?.limits)
    );
    setMode(next);
  };

  const finish = (saved: boolean) => {
    setNotSaved(!saved);
    if (saved) setMode('view');
  };

  const submit = () => {
    const time = Date.now();
    if (shownMode === 'add' || shownMode === 'renew') {
      const amount = draftAmount(draft);
      const expiresAt = draftEndTime(draft, time);
      if (amount === null || expiresAt === undefined) return;
      finish(
        refillAppBudget(
          address,
          app,
          { amount, expiresAt, limits: draft.limits },
          time
        )
      );
    } else if (shownMode === 'top_up') {
      const amount = draftAmount(draft);
      if (amount === null) return;
      finish(topUpAppBudget(address, app, amount, time));
    } else if (shownMode === 'change') {
      const expiresAt = draftEndTime(draft, time);
      if (expiresAt === undefined) return;
      finish(
        changeAppBudget(address, app, { expiresAt, limits: draft.limits }, time)
      );
    } else if (shownMode === 'remove') {
      finish(removeAppBudget(address, app));
    }
  };

  const formFields = {
    add: { showAmount: true, showEnd: true, showLimits: true },
    renew: { showAmount: true, showEnd: true, showLimits: true },
    top_up: { showAmount: true, showEnd: false, showLimits: false },
    change: { showAmount: false, showEnd: true, showLimits: true },
  }[shownMode];
  const submitLabel = {
    add: t('core:app_budgets.add', capital),
    renew: t('core:app_budgets.renew', capital),
    top_up: t('core:app_budgets.top_up', capital),
    change: t('core:action.save', capital),
    remove: t('core:action.remove', capital),
  }[shownMode];
  const canSubmit =
    shownMode === 'remove' ||
    (!!formFields && isDraftValid(draft, now, formFields));

  const used = budget ? BigInt(budget.used) : BigInt(0);
  const total = budget ? BigInt(budget.total) : BigInt(0);
  const progress =
    total > BigInt(0)
      ? Math.min(100, Number((used * BigInt(10000)) / total) / 100)
      : 0;
  const stateChip =
    state === 'ended' ? (
      <Chip
        color="default"
        label={t('core:app_budgets.ended_on', {
          date: formatBudgetDate(budget.expiresAt, i18n.language),
          ...capital,
        })}
        size="small"
      />
    ) : state === 'used_up' ? (
      <Chip
        color="warning"
        label={t('core:app_budgets.used_up', capital)}
        size="small"
        variant="outlined"
      />
    ) : null;

  const header = (
    <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.25, minWidth: 0 }}>
      <SidePanelAppIcon name={app.name} size={32} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box
          sx={{ alignItems: 'center', display: 'flex', gap: 0.75, minWidth: 0 }}
        >
          <Typography
            sx={{
              fontSize: 14.5,
              fontWeight: 700,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              unicodeBidi: 'isolate',
              whiteSpace: 'nowrap',
            }}
          >
            {app.name}
          </Typography>
          <Typography
            sx={{
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: '6px',
              color: theme.palette.text.secondary,
              flexShrink: 0,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: '0.06em',
              lineHeight: 1.2,
              px: 0.6,
              py: 0.2,
            }}
          >
            {app.service}
          </Typography>
        </Box>
        {budget && (
          <Typography
            sx={{ color: theme.palette.text.secondary, fontSize: 12.5 }}
          >
            {t('core:app_budgets.left', {
              amount: qortText(
                budgetLeft(budget) > BigInt(0) ? budgetLeft(budget) : BigInt(0)
              ),
            })}
            {' · '}
            {budget.expiresAt === null
              ? t('core:app_budgets.no_end')
              : state === 'ended'
                ? t('core:app_budgets.ended_on', {
                    date: formatBudgetDate(budget.expiresAt, i18n.language),
                  })
                : t('core:app_budgets.ends_on', {
                    date: formatBudgetDate(budget.expiresAt, i18n.language),
                  })}
          </Typography>
        )}
      </Box>
      {stateChip}
      {collapsible && (
        <ExpandMoreRoundedIcon
          sx={{
            color: theme.palette.text.secondary,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 160ms ease',
          }}
        />
      )}
    </Box>
  );

  return (
    <Box
      data-testid={`app-budget-${app.service}-${app.name}`}
      sx={{
        backgroundColor: alpha(
          theme.palette.background.elevated ?? theme.palette.background.paper,
          0.5
        ),
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '12px',
        p: 1.5,
      }}
    >
      {collapsible ? (
        <ButtonBase
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          sx={{
            borderRadius: '8px',
            display: 'block',
            textAlign: 'left',
            width: '100%',
          }}
        >
          {header}
        </ButtonBase>
      ) : (
        header
      )}

      <Collapse in={open} unmountOnExit>
        {budget ? (
          <Box
            sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1.5 }}
          >
            <Box
              sx={{
                alignItems: 'baseline',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '4px 12px',
                justifyContent: 'space-between',
              }}
            >
              <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>
                {t('core:app_budgets.used_of', {
                  used: qortText(used),
                  total: qortText(total),
                })}
              </Typography>
              <Typography
                sx={{ color: theme.palette.text.secondary, fontSize: 12.5 }}
              >
                {t('core:app_budgets.actions', { count: budget.actions })}
              </Typography>
            </Box>
            <LinearProgress
              aria-label={t('core:app_budgets.used_of', {
                used: qortText(used),
                total: qortText(total),
              })}
              color={state === 'active' ? 'primary' : 'warning'}
              sx={{
                // A neutral track: at 0 used the bar must look empty.
                backgroundColor: alpha(theme.palette.text.secondary, 0.2),
                borderRadius: 4,
                height: 6,
              }}
              value={progress}
              variant="determinate"
            />
            <Typography
              sx={{ color: theme.palette.text.secondary, fontSize: 12.5 }}
            >
              {t(`core:app_budgets.limits_${budget.limits}_desc`, capital)}
            </Typography>
            {shownMode === 'view' && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.5 }}>
                {state === 'ended' ? (
                  <Button
                    onClick={() => startForm('renew')}
                    size="small"
                    sx={{ textTransform: 'none' }}
                    variant="contained"
                  >
                    {t('core:app_budgets.renew', capital)}
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => startForm('top_up')}
                      size="small"
                      sx={{ textTransform: 'none' }}
                      variant={state === 'used_up' ? 'contained' : 'outlined'}
                    >
                      {t('core:app_budgets.top_up', capital)}
                    </Button>
                    <Button
                      onClick={() => startForm('change')}
                      size="small"
                      sx={{ textTransform: 'none' }}
                      variant="outlined"
                    >
                      {t('core:action.change', capital)}
                    </Button>
                  </>
                )}
                <Button
                  color="error"
                  onClick={() => startForm('remove')}
                  size="small"
                  sx={{ textTransform: 'none' }}
                >
                  {t('core:action.remove', capital)}
                </Button>
              </Box>
            )}
          </Box>
        ) : (
          <Typography
            sx={{ color: theme.palette.text.secondary, fontSize: 13, mt: 1 }}
          >
            {t('core:app_budgets.no_budget', { name: app.name, ...capital })}
          </Typography>
        )}

        {shownMode !== 'view' && (
          <Box
            component="form"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) submit();
            }}
            sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1.5 }}
          >
            {shownMode === 'remove' ? (
              <Typography sx={{ fontSize: 13.5 }}>
                {t('core:app_budgets.remove_confirm', {
                  name: app.name,
                  ...capital,
                })}
              </Typography>
            ) : (
              <BudgetChoices
                draft={draft}
                fee={USUAL_ACTION_FEE_ATOMIC}
                idPrefix={`${idPrefix}-${shownMode}`}
                now={now}
                onChange={setDraft}
                {...formFields}
              />
            )}
            {notSaved && (
              <Alert severity="error" sx={{ fontSize: 13 }}>
                {t('core:app_budgets.not_saved', capital)}
              </Alert>
            )}
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              {budget && (
                <Button
                  onClick={() => {
                    setNotSaved(false);
                    setMode('view');
                  }}
                  size="small"
                  sx={{ textTransform: 'none' }}
                >
                  {t('core:action.cancel', capital)}
                </Button>
              )}
              <Button
                color={shownMode === 'remove' ? 'error' : 'primary'}
                disabled={!canSubmit}
                size="small"
                sx={{ textTransform: 'none' }}
                type="submit"
                variant="contained"
              >
                {submitLabel}
              </Button>
            </Box>
          </Box>
        )}
      </Collapse>
    </Box>
  );
}
