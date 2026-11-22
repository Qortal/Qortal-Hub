/**
 * What an account of the Connections circle stands for (from
 * Q-Mintership+'s CircleNodeDialog): what was recorded between them, in
 * the list's own sentences with when and the list's tags, then the
 * transactions behind it, each as the Transactions tab's row (a Q-Asset
 * trade's orders are read when the dialog opens). "Explore" opens that
 * account in the Explorer, a step of the trail. The same evidence as the
 * list's rows, nothing more.
 */
import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  nodeOrders,
  nodeTransactions,
  type CircleNode,
} from '../../../lib/explorer/circle';
import type { Finding } from '../../../lib/explorer/findings';
import { useExplorer } from '../ExplorerContext';
import { cap, isolate, mutedText } from '../parts';
import { TxSentence } from '../transactions/TxSentence';
import {
  EvidenceBySignatures,
  EvidenceList,
  evidenceWords,
  useAccountLabel,
  whenText,
} from './ConnectionRow';

const DIALOG_TEXT = {
  '& .MuiTypography-body2': { fontSize: '0.875rem', lineHeight: 1.45 },
  '& .MuiButton-root': { textTransform: 'none' },
} as const;

export function CircleNodeDialog({
  node,
  address,
  tagsOf,
  onClose,
}: {
  /** The account pressed; null when closed. */
  node: CircleNode | null;
  /** The account whose connections these are: what is behind it is told from its side. */
  address: string;
  tagsOf: (finding: Finding) => Array<string | null>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['core', 'explorer']);
  const { openAccount } = useExplorer();
  // The last one stays while the dialog closes, so its content doesn't jump.
  const [shown, setShown] = useState<CircleNode | null>(node);
  useEffect(() => {
    if (node) setShown(node);
  }, [node]);
  const current = node ?? shown;
  const { label } = useAccountLabel(current?.address ?? null, true);
  if (!current) return null;
  const name = isolate(label);
  const title = String(
    t(`explorer:circle.dialog.${current.side}`, { name, ...cap })
  );
  const txs = nodeTransactions(current);
  const orders = nodeOrders(current);
  const listLabel = (kind: 'transactions' | 'orders', count: number) =>
    String(
      t('explorer:connections.evidence.list_with', {
        words: evidenceWords(kind, count, t, i18n.language),
        name,
        ...cap,
      })
    );
  return (
    <Dialog
      open={node !== null}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="explorer-circle-node-title"
      slotProps={{
        paper: {
          sx: (theme) => ({
            backgroundColor: theme.palette.background.default,
            backgroundImage: 'none',
            ...DIALOG_TEXT,
          }),
        },
      }}
    >
      <DialogTitle
        id="explorer-circle-node-title"
        sx={{ fontSize: '1.05rem', fontWeight: 700, overflowWrap: 'anywhere' }}
      >
        {title}
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}
      >
        <Box
          component="ul"
          aria-label={t('explorer:circle.dialog.recorded', cap)}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            listStyle: 'none',
            m: 0,
            p: 0,
          }}
        >
          {current.findings.map((finding) => {
            const tags = tagsOf(finding).filter((tag): tag is string =>
              Boolean(tag)
            );
            return (
              <Box component="li" key={finding.key} sx={{ minWidth: 0 }}>
                <Typography
                  component="div"
                  sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
                >
                  <TxSentence sentence={finding.sentence} near />
                </Typography>
                <Typography
                  variant="body2"
                  sx={(theme) => ({ color: mutedText(theme) })}
                >
                  {[whenText(finding, t, i18n.language), ...tags].join(' · ')}
                </Typography>
              </Box>
            );
          })}
        </Box>
        {txs.length ? (
          <EvidenceList
            txs={txs}
            viewpoint={address}
            stepKey={`circle:${current.key}`}
            label={listLabel('transactions', txs.length)}
          />
        ) : null}
        {orders.length ? (
          <EvidenceBySignatures
            signatures={orders}
            viewpoint={address}
            stepKey={`circle:${current.key}:orders`}
            label={listLabel('orders', orders.length)}
          />
        ) : null}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, pb: 2 }}>
        <Button
          variant="outlined"
          onClick={() => {
            onClose();
            openAccount(current.address, { fromExplorer: true });
          }}
        >
          {t('explorer:circle.dialog.explore', { name, ...cap })}
        </Button>
        <Button onClick={onClose}>{t('core:action.close', cap)}</Button>
      </DialogActions>
    </Dialog>
  );
}
