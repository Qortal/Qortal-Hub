import { useMemo, useState } from 'react';
import {
  alpha,
  AvatarGroup,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Typography,
  useTheme,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useTranslation } from 'react-i18next';
import { executeEvent } from '../../../utils/events';
import {
  NameAvatar,
  SectionCard,
  SectionTitle,
  StarPicker,
  StarRow,
} from './AppPageParts';
import { usePrimaryNames } from './useAppPage';
import type { PendingVote, RatingSummary, Voter } from './appVotes';
import { useLauncherTabDialog } from '../launcherTabs';

const shortAddress = (address: string) =>
  address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;

export const AppVotersDialog = ({
  open,
  onClose,
  voters,
  initialStar,
  myAddress,
}: {
  open: boolean;
  onClose: () => void;
  voters: Voter[];
  initialStar: number | null;
  myAddress?: string;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  // The opener remounts this dialog each time, so it starts at initialStar.
  const [star, setStar] = useState<number | null>(initialStar);
  const names = usePrimaryNames(
    open ? voters.map((voter) => voter.address) : []
  );
  const shown = star ? voters.filter((voter) => voter.rating === star) : voters;
  const countFor = (value: number) =>
    voters.filter((voter) => voter.rating === value).length;
  // Put away while its launcher tab is hidden, and back with it.
  const dialogShown = useLauncherTabDialog(open);

  return (
    <Dialog fullWidth maxWidth="xs" onClose={onClose} {...dialogShown}>
      <DialogTitle sx={{ alignItems: 'center', display: 'flex', pr: 6 }}>
        {t('core:app_page.voters.title', {
          postProcess: 'capitalizeFirstChar',
        })}
        <IconButton
          aria-label={t('core:action.close', {
            postProcess: 'capitalizeFirstChar',
          })}
          onClick={onClose}
          sx={{ position: 'absolute', right: 12, top: 12 }}
        >
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, px: 3, pb: 1 }}>
        <Chip
          color={star === null ? 'primary' : 'default'}
          label={t('core:app_page.voters.all', {
            total: voters.length,
            postProcess: 'capitalizeFirstChar',
          })}
          onClick={() => setStar(null)}
          variant={star === null ? 'filled' : 'outlined'}
        />
        {[5, 4, 3, 2, 1].map((value) => (
          <Chip
            color={star === value ? 'primary' : 'default'}
            disabled={countFor(value) === 0}
            key={value}
            label={t('core:app_page.voters.stars_filter', {
              total: countFor(value),
              stars: value,
            })}
            onClick={() => setStar(value)}
            variant={star === value ? 'filled' : 'outlined'}
          />
        ))}
      </Box>
      <DialogContent sx={{ pt: 0, px: 1 }}>
        {shown.length === 0 ? (
          <Typography
            sx={{ color: 'text.secondary', p: 2, textAlign: 'center' }}
          >
            {t('core:app_page.voters.none', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        ) : (
          <List dense>
            {shown.map((voter) => {
              const name = names[voter.address];
              return (
                <ListItemButton
                  key={voter.address}
                  onClick={() => {
                    executeEvent('openUserLookupDrawer', {
                      addressOrName: name || voter.address,
                    });
                    onClose();
                  }}
                  sx={{ borderRadius: '12px' }}
                >
                  <ListItemAvatar>
                    <NameAvatar
                      decorative
                      fallback={voter.address}
                      name={name}
                      size={36}
                    />
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Box
                        sx={{ alignItems: 'center', display: 'flex', gap: 1 }}
                      >
                        <Typography
                          noWrap
                          sx={{ fontSize: '14px', fontWeight: 600 }}
                        >
                          {name || shortAddress(voter.address)}
                        </Typography>
                        {voter.address === myAddress && (
                          <Chip
                            label={t('core:app_page.voters.you')}
                            size="small"
                            sx={{ height: 20 }}
                          />
                        )}
                      </Box>
                    }
                    secondary={
                      voter.isInitial
                        ? t('core:app_page.voters.first_rating', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : undefined
                    }
                  />
                  <StarRow
                    label={t('core:app_page.rating.stars_label', {
                      count: voter.rating,
                    })}
                    size={16}
                    value={voter.rating}
                  />
                </ListItemButton>
              );
            })}
          </List>
        )}
        <Typography
          sx={{
            borderTop: `1px solid ${theme.palette.divider}`,
            color: 'text.secondary',
            fontSize: '12px',
            mt: 1,
            pt: 1.5,
            px: 2,
          }}
        >
          {t('core:app_page.voters.public_note', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      </DialogContent>
    </Dialog>
  );
};

export const AppRatingsPanel = ({
  summary,
  voters,
  mine,
  pending,
  pollExists,
  loading,
  canRate,
  myAddress,
  onRate,
}: {
  summary: RatingSummary;
  voters: Voter[];
  mine: Voter | null;
  pending: PendingVote | null;
  /** Whether the node has the app's rating poll yet. */
  pollExists: boolean;
  loading: boolean;
  canRate: boolean;
  myAddress?: string;
  onRate: (rating: number) => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [votersOpen, setVotersOpen] = useState(false);
  const [votersStar, setVotersStar] = useState<number | null>(null);
  // A new key each time it opens: the dialog starts at the star clicked.
  const [votersKey, setVotersKey] = useState(0);
  // The first rating creates the poll: another one before it's in a block
  // would ask to create it again, and pay for that.
  const waitingForPoll = !!pending?.createdPoll && !pollExists;
  const preview = useMemo(() => voters.slice(0, 6), [voters]);
  const previewNames = usePrimaryNames(preview.map((voter) => voter.address));
  const myRating = pending?.rating ?? mine?.rating ?? null;
  const max = Math.max(
    1,
    ...([1, 2, 3, 4, 5] as const).map((s) => summary.counts[s])
  );

  const openVoters = (star: number | null) => {
    setVotersStar(star);
    setVotersKey((value) => value + 1);
    setVotersOpen(true);
  };

  return (
    <SectionCard
      aria-labelledby="app-page-ratings"
      component="section"
      id="app-page-ratings-card"
      sx={{ mb: 2 }}
    >
      <SectionTitle id="app-page-ratings">
        {t('core:app_page.rating.title', {
          postProcess: 'capitalizeFirstChar',
        })}
      </SectionTitle>

      <Box sx={{ alignItems: 'center', display: 'flex', gap: 2.5 }}>
        <Box sx={{ minWidth: 92, textAlign: 'center' }}>
          <Typography
            sx={{
              fontSize: '52px',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              lineHeight: 1,
            }}
          >
            {summary.total > 0 ? summary.average.toFixed(1) : '–'}
          </Typography>
          <Box sx={{ mt: 0.75 }}>
            <StarRow
              label={t('core:app_page.rating.average_label', {
                average: summary.average.toFixed(1),
              })}
              size={17}
              value={summary.average}
            />
          </Box>
          <Typography
            sx={{ color: 'text.secondary', fontSize: '12.5px', mt: 0.25 }}
          >
            {t('core:app_page.rating.count', { count: summary.total })}
          </Typography>
        </Box>
        <Box
          sx={{ display: 'flex', flex: 1, flexDirection: 'column', gap: 0.25 }}
        >
          {([5, 4, 3, 2, 1] as const).map((star) => {
            const count = summary.counts[star];
            return (
              <ButtonBase
                aria-label={t('core:app_page.voters.show_star', {
                  total: count,
                  stars: star,
                  postProcess: 'capitalizeFirstChar',
                })}
                disabled={count === 0 || voters.length === 0}
                key={star}
                onClick={() => openVoters(star)}
                sx={{
                  alignItems: 'center',
                  borderRadius: '8px',
                  display: 'flex',
                  gap: 1,
                  px: 0.5,
                  py: 0.25,
                  '&:hover': {
                    backgroundColor: alpha(theme.palette.text.primary, 0.05),
                  },
                  '&.Mui-focusVisible': {
                    outline: `2px solid ${theme.palette.primary.main}`,
                    outlineOffset: 2,
                  },
                }}
              >
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: '12.5px',
                    width: 10,
                  }}
                >
                  {star}
                </Typography>
                <Box
                  sx={{
                    backgroundColor: alpha(theme.palette.text.primary, 0.08),
                    borderRadius: '6px',
                    flex: 1,
                    height: 8,
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      background: `linear-gradient(90deg, ${theme.palette.warning.main}, ${alpha(theme.palette.warning.light || theme.palette.warning.main, 0.9)})`,
                      borderRadius: '6px',
                      height: '100%',
                      transition: 'width 500ms cubic-bezier(.2,.8,.2,1)',
                      width: `${(count / max) * 100}%`,
                    }}
                  />
                </Box>
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: '12px',
                    minWidth: 22,
                    textAlign: 'end',
                  }}
                >
                  {count}
                </Typography>
              </ButtonBase>
            );
          })}
        </Box>
      </Box>

      <Box
        sx={{
          backgroundColor: alpha(theme.palette.primary.main, 0.07),
          border: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
          borderRadius: '14px',
          mt: 2,
          px: 2,
          py: 1.5,
          textAlign: 'center',
        }}
      >
        <Typography sx={{ fontSize: '14px', fontWeight: 650, mb: 0.5 }}>
          {myRating
            ? t('core:app_page.rating.yours', {
                postProcess: 'capitalizeFirstChar',
              })
            : t('core:app_page.rating.rate_prompt', {
                postProcess: 'capitalizeFirstChar',
              })}
        </Typography>
        <StarPicker
          disabled={!canRate || waitingForPoll}
          onPick={onRate}
          value={myRating}
        />
        {pending ? (
          <Box
            aria-live="polite"
            sx={{
              alignItems: 'center',
              color: 'text.secondary',
              display: 'flex',
              fontSize: '12.5px',
              gap: 1,
              justifyContent: 'center',
            }}
          >
            <CircularProgress size={12} thickness={5} />
            {waitingForPoll
              ? t('core:app_page.rating.pending_first', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('core:app_page.rating.pending', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </Box>
        ) : (
          !canRate && (
            <Typography sx={{ color: 'text.secondary', fontSize: '12.5px' }}>
              {t('core:message.generic.name_rate', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          )
        )}
      </Box>

      {voters.length > 0 && (
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: 1.5,
            justifyContent: 'space-between',
            mt: 2,
          }}
        >
          <AvatarGroup
            max={6}
            sx={{
              '& .MuiAvatar-root': {
                borderColor: theme.palette.background.paper,
              },
            }}
          >
            {preview.map((voter) => (
              <NameAvatar
                fallback={voter.address}
                key={voter.address}
                name={previewNames[voter.address]}
                size={28}
              />
            ))}
          </AvatarGroup>
          <Button
            onClick={() => openVoters(null)}
            size="small"
            sx={{ textTransform: 'none' }}
          >
            {t('core:app_page.voters.open', {
              total: voters.length,
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        </Box>
      )}
      {loading && voters.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
          <CircularProgress size={18} />
        </Box>
      )}

      <AppVotersDialog
        initialStar={votersStar}
        key={votersKey}
        myAddress={myAddress}
        onClose={() => setVotersOpen(false)}
        open={votersOpen}
        voters={voters}
      />
    </SectionCard>
  );
};
