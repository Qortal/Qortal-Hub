/**
 * A Compare, Sponsees or Funded step of the window's history. Only a
 * viewer the level 5+ rule lets in sees them (lib/explorer/access.ts):
 * for anyone else, and while the rule isn't known (Hub switched accounts,
 * the rule is read again), the step shows the account it was about
 * instead, silently, and nothing of Compare or the sets is read.
 */
import { type ReactNode } from 'react';
import { useExplorerAccess } from '../useExplorerAccess';
import { ComparePage } from './ComparePage';
import { FundedPage } from '../sets/FundedPage';
import { SponseesPage } from '../sets/SponseesPage';

export type SetStep =
  | {
      kind: 'compare';
      /** The accounts compared, in their letters' order. */
      accounts: readonly string[];
      /** The account it is about. */
      about: string;
    }
  | { kind: 'sponsees'; address: string }
  | { kind: 'funded'; address: string };

/** The account a step is about: what it falls back to. */
export const aboutOf = (step: SetStep): string =>
  step.kind === 'compare' ? step.about : step.address;

export function SetStepView({
  step,
  trail,
  fallback,
}: {
  step: SetStep;
  /** The trail it was opened from. */
  trail: string[];
  /** The account page shown instead, for a viewer who doesn't see the step. */
  fallback: (address: string) => ReactNode;
}) {
  const full = useExplorerAccess();
  if (!full) return <>{fallback(aboutOf(step))}</>;
  switch (step.kind) {
    case 'compare':
      return <ComparePage accounts={step.accounts} about={step.about} />;
    case 'sponsees':
      return <SponseesPage address={step.address} trail={trail} />;
    case 'funded':
      return <FundedPage address={step.address} trail={trail} />;
  }
}
