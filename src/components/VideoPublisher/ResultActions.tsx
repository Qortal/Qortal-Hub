import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Typography,
  useTheme,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PublishedRecord } from '../../lib/videoPublisher';
import { executeEvent } from '../../utils/events';
import { formatQort } from './format';
import { errorMessageKey } from './videoPublisherErrors';
import type { RemovalState } from './videoPublisherTypes';

export const APP_NAMES: Record<PublishedRecord['app'], string> = {
  qtube: 'Q-Tube',
  subscreen: 'Subscreen',
  torq: 'Torq',
  qshare: 'Q-Share',
};

/** Opens what was published in its app, in a Hub tab. */
export const openPublished = (record: PublishedRecord) => {
  executeEvent('addTab', { data: { ...record.open, identifier: '' } });
  executeEvent('open-apps-mode', {});
};

/** Copy link, with a moment of "copied". */
export const CopyLinkButton = ({ link }: { link: string }) => {
  const { t } = useTranslation(['core']);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(link);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
      size="small"
      startIcon={copied ? <CheckRoundedIcon /> : <LinkRoundedIcon />}
      sx={{ textTransform: 'none' }}
    >
      {copied
        ? t('core:video_publisher.actions.copied')
        : t('core:video_publisher.actions.copy_link')}
    </Button>
  );
};

/** The fee of a removal against the balance (VideoPublisherController.quote). */
export type PublishQuote = {
  unitFee: number;
  total: number;
  balance: number | null;
  enough: boolean | null;
};

type RemovalQuote = Pick<PublishQuote, 'total' | 'balance' | 'enough'>;
type Quote = RemovalQuote | 'loading' | 'failed';

/**
 * Remove: QDN can't erase a publish, so each resource is replaced; the
 * dialog says so, with the fee, before anything goes.
 */
export const RemoveDialog = ({
  count,
  onClose,
  onConfirm,
  open,
  quote,
  record,
}: {
  count: number;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  quote: () => Promise<RemovalQuote>;
  record: PublishedRecord;
}) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const locale = i18n.language;
  const [fee, setFee] = useState<Quote>('loading');
  // Asked once per opening, however often the card around it re-renders.
  const quoteRef = useRef(quote);
  quoteRef.current = quote;
  useEffect(() => {
    if (!open) return;
    let live = true;
    setFee('loading');
    quoteRef.current().then(
      (result) => live && setFee(result),
      () => live && setFee('failed')
    );
    return () => {
      live = false;
    };
  }, [open]);
  const short = typeof fee === 'object' && fee.enough === false;
  return (
    <Dialog onClose={onClose} open={open}>
      <DialogTitle>
        {t('core:video_publisher.remove_confirm.title_from', {
          app: APP_NAMES[record.app],
          title: record.title,
        })}
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          {t('core:video_publisher.remove_confirm.body', {
            app: APP_NAMES[record.app],
            count,
          })}
        </DialogContentText>
        <Typography
          sx={{
            color: fee === 'failed' ? theme.palette.error.main : undefined,
            fontSize: '0.85rem',
            fontWeight: 600,
            mt: 1.5,
          }}
        >
          {fee === 'loading'
            ? t('core:video_publisher.confirm.fee_loading')
            : fee === 'failed'
              ? t('core:video_publisher.confirm.fee_failed')
              : t('core:video_publisher.remove_confirm.fee', {
                  total: formatQort(fee.total, locale),
                })}
        </Typography>
        {short ? (
          <Typography
            sx={{ color: theme.palette.error.main, fontSize: '0.8rem' }}
          >
            {t('core:video_publisher.error.balance')}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          {t('core:video_publisher.actions.cancel')}
        </Button>
        <Button
          color="error"
          // An unknown fee, or one the balance doesn't cover, isn't paid.
          disabled={fee === 'loading' || fee === 'failed' || short}
          onClick={onConfirm}
          sx={{ textTransform: 'none' }}
          variant="contained"
        >
          {t('core:video_publisher.actions.remove_from', {
            app: APP_NAMES[record.app],
          })}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

/**
 * What can be done with something published: open it, copy its link,
 * remove it (when it's this account's).
 */
export const PublishedActions = ({
  canRemove,
  onRemove,
  partial = false,
  quote,
  record,
  removal,
  removalCount,
  removalLeft = removalCount,
  removalError,
}: {
  canRemove: boolean;
  onRemove: () => void;
  /** Only part of it went up: Remove takes that part away. */
  partial?: boolean;
  quote: (count: number) => Promise<RemovalQuote>;
  record: PublishedRecord;
  removal?: RemovalState;
  removalCount: number;
  /** What Remove still replaces (one that stopped half way), and pays for. */
  removalLeft?: number;
  removalError?: string;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [confirming, setConfirming] = useState(false);
  const app = APP_NAMES[record.app];

  if (removal === 'removed') {
    return (
      <Typography
        sx={{ color: theme.palette.text.secondary, fontSize: '0.8rem' }}
      >
        {t('core:video_publisher.status.removed', { app })}
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'grid', gap: 0.5 }}>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.5,
        }}
      >
        {partial ? null : (
          <>
            <Button
              onClick={() => openPublished(record)}
              size="small"
              startIcon={<OpenInNewRoundedIcon />}
              sx={{ textTransform: 'none' }}
              variant="outlined"
            >
              {t('core:video_publisher.actions.open_in', { app })}
            </Button>
            <CopyLinkButton link={record.link} />
          </>
        )}
        {canRemove && removalCount > 0 ? (
          <Button
            color="error"
            disabled={removal === 'removing'}
            onClick={() => setConfirming(true)}
            size="small"
            startIcon={<DeleteOutlineRoundedIcon />}
            sx={{ textTransform: 'none' }}
          >
            {removal === 'removing'
              ? t('core:video_publisher.status.removing')
              : partial
                ? t('core:video_publisher.actions.remove_partial')
                : t('core:video_publisher.actions.remove_from', { app })}
          </Button>
        ) : null}
      </Box>
      {removal === 'failed' ? (
        <Typography
          role="alert"
          sx={{ color: theme.palette.error.main, fontSize: '0.76rem' }}
        >
          {t(errorMessageKey(removalError))}
        </Typography>
      ) : null}
      <RemoveDialog
        count={removalLeft}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onRemove();
        }}
        open={confirming}
        quote={() => quote(removalLeft)}
        record={record}
      />
    </Box>
  );
};
