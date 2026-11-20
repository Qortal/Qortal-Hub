import {
  Box,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  APP_BUDGET_AMOUNTS,
  APP_BUDGET_LIMITS,
  actionsFor,
  qortText,
  type AppBudgetLimits,
} from '../../qortal/appBudgets';
import {
  draftAmount,
  draftEndTime,
  dayText,
  type BudgetDraft,
  type BudgetEndPick,
} from './budgetDraft';

const END_PICKS: BudgetEndPick[] = ['month', 'year', 'date', 'never'];

type BudgetChoicesProps = {
  draft: BudgetDraft;
  onChange: (draft: BudgetDraft) => void;
  /** The fee of one action, for "about N actions". */
  fee: bigint;
  /** What the amount must at least pay for (the request waiting for it). */
  minAmount?: bigint;
  showAmount?: boolean;
  showEnd?: boolean;
  showLimits?: boolean;
  now: number;
  /** Tells apart the fields of two forms on one screen. */
  idPrefix: string;
};

/**
 * Whether the shown choices make a budget: an amount from 0.01 to 1,000 QORT
 * that pays for `minAmount`, and an end that is still to come.
 */
export function isDraftValid(
  draft: BudgetDraft,
  now: number,
  {
    showAmount = true,
    showEnd = true,
    minAmount = BigInt(0),
  }: { showAmount?: boolean; showEnd?: boolean; minAmount?: bigint } = {}
): boolean {
  if (showAmount) {
    const amount = draftAmount(draft);
    if (amount === null || amount < minAmount) return false;
  }
  return !showEnd || draftEndTime(draft, now) !== undefined;
}

/** Amount, end and limits, as a budget is added, refilled or changed. */
export function BudgetChoices({
  draft,
  onChange,
  fee,
  minAmount = BigInt(0),
  showAmount = true,
  showEnd = true,
  showLimits = true,
  now,
  idPrefix,
}: BudgetChoicesProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const capital = { postProcess: 'capitalizeFirstChar' };
  const amount = draftAmount(draft);
  const amountError =
    draft.amountPick === 'custom' && draft.customAmount.trim() !== ''
      ? amount === null
        ? t('core:app_budgets.amount_invalid', capital)
        : amount < minAmount
          ? t('core:app_budgets.amount_too_small', {
              amount: qortText(minAmount),
              ...capital,
            })
          : ''
      : amount !== null && amount < minAmount
        ? t('core:app_budgets.amount_too_small', {
            amount: qortText(minAmount),
            ...capital,
          })
        : '';
  const dateError =
    draft.endPick === 'date' &&
    draft.date !== '' &&
    draftEndTime(draft, now) === undefined
      ? t('core:app_budgets.date_invalid', capital)
      : '';
  const labelSx = {
    color: theme.palette.text.secondary,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  } as const;
  const groupSx = {
    flexWrap: 'wrap',
    gap: 0.75,
    '& .MuiToggleButton-root': {
      border: `1px solid ${theme.palette.divider}`,
      borderRadius: '8px !important',
      fontSize: 13,
      lineHeight: 1.2,
      margin: '0 !important',
      px: 1.25,
      py: 0.6,
      textTransform: 'none',
    },
    '& .MuiToggleButton-root.Mui-selected': {
      borderColor: theme.palette.primary.main,
      color: theme.palette.text.primary,
    },
  } as const;
  const hintSx = {
    color: theme.palette.text.secondary,
    fontSize: 12.5,
    lineHeight: 1.45,
  } as const;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {showAmount && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography id={`${idPrefix}-amount`} sx={labelSx}>
            {t('core:app_budgets.amount', capital)}
          </Typography>
          <ToggleButtonGroup
            aria-labelledby={`${idPrefix}-amount`}
            exclusive
            onChange={(_event, value) => {
              if (value) onChange({ ...draft, amountPick: value });
            }}
            size="small"
            sx={groupSx}
            value={draft.amountPick}
          >
            {APP_BUDGET_AMOUNTS.map((value) => (
              <ToggleButton key={value} value={value}>
                {t('core:app_budgets.amount_qort', { amount: value })}
              </ToggleButton>
            ))}
            <ToggleButton value="custom">
              {t('core:app_budgets.custom', capital)}
            </ToggleButton>
          </ToggleButtonGroup>
          {draft.amountPick === 'custom' && (
            <TextField
              autoFocus
              error={!!amountError}
              inputProps={{
                'aria-label': t('core:app_budgets.custom_amount', capital),
                inputMode: 'decimal',
              }}
              onChange={(event) =>
                onChange({ ...draft, customAmount: event.target.value })
              }
              placeholder="2.5"
              size="small"
              sx={{ maxWidth: 200 }}
              value={draft.customAmount}
              InputProps={{
                endAdornment: (
                  <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>
                    QORT
                  </Typography>
                ),
              }}
            />
          )}
          <Typography
            role={amountError ? 'alert' : undefined}
            sx={{
              ...hintSx,
              color: amountError
                ? theme.palette.error.main
                : theme.palette.text.secondary,
            }}
          >
            {amountError ||
              (amount !== null && fee > BigInt(0)
                ? t('core:app_budgets.about_actions', {
                    count: Number(actionsFor(amount, fee)),
                    fee: qortText(fee),
                    ...capital,
                  })
                : t('core:app_budgets.amount_invalid', capital))}
          </Typography>
        </Box>
      )}

      {showEnd && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography id={`${idPrefix}-end`} sx={labelSx}>
            {t('core:app_budgets.ends', capital)}
          </Typography>
          <ToggleButtonGroup
            aria-labelledby={`${idPrefix}-end`}
            exclusive
            onChange={(_event, value) => {
              if (value) onChange({ ...draft, endPick: value });
            }}
            size="small"
            sx={groupSx}
            value={draft.endPick}
          >
            {END_PICKS.map((value) => (
              <ToggleButton key={value} value={value}>
                {t(`core:app_budgets.end_${value}`, capital)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {draft.endPick === 'date' && (
            <TextField
              error={!!dateError}
              helperText={dateError || ' '}
              inputProps={{
                'aria-label': t('core:app_budgets.last_day', capital),
                min: dayText(now),
              }}
              onChange={(event) =>
                onChange({ ...draft, date: event.target.value })
              }
              size="small"
              sx={{ maxWidth: 200 }}
              type="date"
              value={draft.date}
            />
          )}
        </Box>
      )}

      {showLimits && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography id={`${idPrefix}-limits`} sx={labelSx}>
            {t('core:app_budgets.limits', capital)}
          </Typography>
          <ToggleButtonGroup
            aria-labelledby={`${idPrefix}-limits`}
            exclusive
            onChange={(_event, value: AppBudgetLimits | null) => {
              if (value) onChange({ ...draft, limits: value });
            }}
            size="small"
            sx={groupSx}
            value={draft.limits}
          >
            {APP_BUDGET_LIMITS.map((value) => (
              <ToggleButton key={value} value={value}>
                {t(`core:app_budgets.limits_${value}`, capital)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography sx={hintSx}>
            {t(`core:app_budgets.limits_${draft.limits}_desc`, capital)}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
