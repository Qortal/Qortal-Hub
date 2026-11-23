import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import {
  Box,
  Button,
  Collapse,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { canDismissPublished, type PublishedEntry } from './publishedHistory';
import { APP_NAMES, PublishedActions } from './ResultActions';
import type {
  PublishAccount,
  VideoPublisherController,
} from './videoPublisherController';

const dateText = (publishedAt: number, locale: string) => {
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(publishedAt));
  } catch {
    return new Date(publishedAt).toLocaleString();
  }
};

const Row = function Row({
  account,
  controller,
  entry,
}: {
  account: PublishAccount & { address: string | null };
  controller: VideoPublisherController;
  entry: PublishedEntry;
}) {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const title = entry.record.title || entry.record.link;
  const removable = controller.canRemoveSaved(entry);
  return (
    <Box
      aria-label={title}
      component="li"
      data-removal={entry.removal ?? 'none'}
      sx={{
        borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
        display: 'grid',
        gap: 0.5,
        listStyle: 'none',
        py: 0.75,
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'grid',
          gap: 1,
          gridTemplateColumns: 'minmax(0, 1fr) auto',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: '0.82rem', fontWeight: 650 }}>
            {title}
          </Typography>
          <Typography
            noWrap
            sx={{ color: theme.palette.text.secondary, fontSize: '0.72rem' }}
          >
            {[
              t(`core:video_publisher.published.kind.${entry.kind}`),
              dateText(entry.publishedAt, i18n.language),
              entry.partial ? t('core:video_publisher.published.partial') : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        </Box>
        {canDismissPublished(entry) ? (
          <Tooltip
            title={
              entry.removal === 'removed'
                ? t('core:video_publisher.published.dismiss')
                : t('core:video_publisher.published.dismiss_kept', {
                    app: APP_NAMES[entry.record.app],
                  })
            }
          >
            <IconButton
              aria-label={t('core:video_publisher.published.dismiss_of', {
                name: title,
              })}
              onClick={() => controller.dismissSaved(entry.id)}
              size="small"
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Box>
      <PublishedActions
        canRemove={
          Boolean(account.name) &&
          account.name === entry.record.name &&
          (removable || entry.removal === 'removing')
        }
        onRemove={() => void controller.removeSaved(entry.id, account)}
        partial={Boolean(entry.partial)}
        quote={(count) =>
          controller.quote(count, account.address, account.publicKey)
        }
        record={entry.record}
        removal={entry.removal}
        removalCount={controller.removalCount(entry.record)}
        removalLeft={controller.savedRemovalLeft(entry.id)}
        removalError={entry.removalError}
      />
    </Box>
  );
};

/**
 * What this account published from here, newest first: Open, Copy link and
 * Remove after "Clear finished" or a restart too. Collapsed until opened.
 */
export const PublishedList = ({
  account,
  controller,
  entries,
}: {
  account: PublishAccount & { address: string | null };
  controller: VideoPublisherController;
  entries: readonly PublishedEntry[];
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!entries.length) return null;
  return (
    <Box
      aria-label={t('core:video_publisher.published.list')}
      component="section"
      sx={{
        border: `1px solid ${alpha(theme.palette.text.primary, 0.1)}`,
        borderRadius: '10px',
        flexShrink: 0,
        px: 1,
        py: 0.25,
      }}
    >
      <Button
        aria-controls={listId}
        aria-expanded={open}
        color="inherit"
        endIcon={
          <ExpandMoreRoundedIcon
            sx={{
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform 160ms ease',
            }}
          />
        }
        fullWidth
        onClick={() => setOpen((current) => !current)}
        size="small"
        sx={{
          color: theme.palette.text.secondary,
          fontSize: '0.72rem',
          fontWeight: 700,
          justifyContent: 'space-between',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {t('core:video_publisher.published.heading', {
          count: entries.length,
        })}
      </Button>
      <Collapse in={open} unmountOnExit>
        <Box
          component="ul"
          id={listId}
          sx={{ display: 'grid', m: 0, pb: 0.5, pt: 0, px: 0 }}
        >
          {entries.map((entry) => (
            <Row
              account={account}
              controller={controller}
              entry={entry}
              key={entry.id}
            />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
};
