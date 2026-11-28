import { Box, Typography, alpha, useTheme } from '@mui/material';
import SavingsOutlinedIcon from '@mui/icons-material/SavingsOutlined';
import { useTranslation } from 'react-i18next';
import type { ApprovalBudgetInfo } from '../../qortal/appBudgetApproval';
import { USUAL_ACTION_FEE_ATOMIC } from '../../qortal/appBudgets';
import { parseDecimalAmount } from '../../transactions/paymentSafety';
import { formatBudgetDate } from './AppBudgetCard';
import { BudgetChoices } from './BudgetChoices';
import type { BudgetDraft } from './budgetDraft';

/** QORT text from the window's payload, in 1e-8 units (0 when unreadable). */
export function atomicFromText(value: unknown): bigint {
  try {
    return parseDecimalAmount(value, { allowZero: true }).atomic;
  } catch {
    return BigInt(0);
  }
}

/** What a top-up must at least pay for: the request waiting for it. */
export const refillMinimum = (info: ApprovalBudgetInfo): bigint =>
  atomicFromText(info.fee) * BigInt(Math.max(1, info.count || 1));

type BudgetRefillSectionProps = {
  info: ApprovalBudgetInfo;
  appName: string;
  draft: BudgetDraft;
  onDraftChange: (draft: BudgetDraft) => void;
  now: number;
};

/**
 * In the approval window, when the app's budget is used up or has ended: what
 * happened, and the choices "Top up and approve" uses.
 */
export function BudgetRefillSection({
  info,
  appName,
  draft,
  onDraftChange,
  now,
}: BudgetRefillSectionProps) {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const capital = { postProcess: 'capitalizeFirstChar' };
  const ended = info.state === 'ended';

  return (
    <Box
      data-testid="budget-refill"
      sx={{
        backgroundColor: alpha(
          theme.palette.primary.main,
          theme.palette.mode === 'dark' ? 0.08 : 0.05
        ),
        border: `1px solid ${alpha(theme.palette.primary.main, 0.28)}`,
        borderRadius: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        p: '14px',
        width: '100%',
      }}
    >
      <Box sx={{ alignItems: 'flex-start', display: 'flex', gap: 1.25 }}>
        <SavingsOutlinedIcon
          sx={{ color: theme.palette.primary.main, fontSize: 22, mt: '1px' }}
        />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700 }}>
            {ended && info.endedAt !== null
              ? t('core:app_budgets.refill.ended_title', {
                  date: formatBudgetDate(info.endedAt, i18n.language),
                  ...capital,
                })
              : t('core:app_budgets.refill.used_up_title', capital)}
          </Typography>
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: 13.5,
              lineHeight: 1.5,
              overflowWrap: 'anywhere',
            }}
          >
            {t(
              ended
                ? 'core:app_budgets.refill.ended_text'
                : 'core:app_budgets.refill.used_up_text',
              {
                name: appName,
                used: info.used,
                total: info.total,
                ...capital,
              }
            )}
          </Typography>
        </Box>
      </Box>
      <BudgetChoices
        draft={draft}
        // A chat message has no fee: estimate at the usual one.
        fee={atomicFromText(info.fee) || USUAL_ACTION_FEE_ATOMIC}
        idPrefix="approval-budget"
        minAmount={refillMinimum(info)}
        now={now}
        onChange={onDraftChange}
      />
    </Box>
  );
}
