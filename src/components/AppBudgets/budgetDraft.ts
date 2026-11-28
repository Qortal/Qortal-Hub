import {
  APP_BUDGET_AMOUNTS,
  budgetAmountFrom,
  budgetEndTime,
  type AppBudgetEnd,
  type AppBudgetLimits,
} from '../../qortal/appBudgets';

export type BudgetEndPick = AppBudgetEnd['kind'];

/** What the amount, end and limit choices hold while the user picks. */
export type BudgetDraft = {
  /** One of APP_BUDGET_AMOUNTS, or 'custom'. */
  amountPick: string;
  customAmount: string;
  endPick: BudgetEndPick;
  /** YYYY-MM-DD, for endPick 'date'. */
  date: string;
  limits: AppBudgetLimits;
};

export const newBudgetDraft = (
  limits: AppBudgetLimits = 'standard'
): BudgetDraft => ({
  amountPick: APP_BUDGET_AMOUNTS[0],
  customAmount: '',
  endPick: 'month',
  date: '',
  limits,
});

export const draftAmountText = (draft: BudgetDraft): string =>
  draft.amountPick === 'custom' ? draft.customAmount.trim() : draft.amountPick;

/** The amount chosen, in 1e-8 units; null when it isn't a valid amount. */
export const draftAmount = (draft: BudgetDraft): bigint | null =>
  budgetAmountFrom(draftAmountText(draft));

export const draftEnd = (draft: BudgetDraft): AppBudgetEnd =>
  draft.endPick === 'date'
    ? { kind: 'date', date: draft.date }
    : { kind: draft.endPick };

/** When the chosen end is, or undefined when it isn't a valid end. */
export const draftEndTime = (
  draft: BudgetDraft,
  now: number
): number | null | undefined => budgetEndTime(draftEnd(draft), now);

/**
 * The choices as the approval window answers them; get.ts checks them again
 * with budgetChoiceFrom.
 */
export const draftAnswer = (draft: BudgetDraft) => ({
  amount: draftAmountText(draft),
  end: draftEnd(draft),
  limits: draft.limits,
});

/** YYYY-MM-DD of the day `time` falls on, this PC's time. */
export function dayText(time: number): string {
  const day = new Date(time);
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const date = String(day.getDate()).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${date}`;
}

/**
 * The choices a Change form starts with: the budget's own end (its day, or
 * no end date) and limits, so saving without a change keeps them.
 */
export const changeDraft = (
  expiresAt: number | null,
  limits: AppBudgetLimits
): BudgetDraft => ({
  ...newBudgetDraft(limits),
  endPick: expiresAt === null ? 'never' : 'date',
  date: expiresAt === null ? '' : dayText(expiresAt),
});
