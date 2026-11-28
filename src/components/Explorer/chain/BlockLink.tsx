/**
 * "Transactions in this block", under one transaction's block: opens
 * Transactions on Qortal at that block alone, every kind but messages, in
 * the order they were made (oldest first), as a step from what is on screen.
 */
import { useTranslation } from 'react-i18next';
import { useExplorer } from '../ExplorerContext';
import { cap, InlineLink } from '../parts';

export function BlockTransactionsLink({ height }: { height: number }) {
  const { t } = useTranslation(['explorer']);
  const { openChain } = useExplorer();
  return (
    <InlineLink
      type="button"
      onClick={() =>
        openChain({
          blocks: { kind: 'from', start: height, span: 1 },
          order: 'oldest',
        })
      }
    >
      {t('explorer:chain.in_block', cap)}
    </InlineLink>
  );
}
