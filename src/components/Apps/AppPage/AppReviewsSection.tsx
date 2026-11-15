import { useEffect, useMemo, useRef, useState } from 'react';
import {
  alpha,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import RateReviewRoundedIcon from '@mui/icons-material/RateReviewRounded';
import ReplyRoundedIcon from '@mui/icons-material/ReplyRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import { executeEvent } from '../../../utils/events';
import {
  LinkifiedText,
  NameAvatar,
  RelativeTime,
  SectionCard,
  SectionTitle,
  StarRow,
} from './AppPageParts';
import { REVIEW_LIMITS, ReviewItem, ReviewThread } from './appReviews';
import type { ReviewActionResult } from './useAppReviews';

type Sort = 'newest' | 'highest' | 'lowest';

const ownerCache = new Map<string, string>();

/** The address that owns each name, to find the author's vote. */
const useNameOwners = (names: string[]) => {
  // Names as published (Core may look them up as written), one per person.
  const joined = useMemo(() => {
    const byKey = new Map<string, string>();
    names.forEach((name) => {
      if (!byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
    });
    return Array.from(byKey.values()).sort().join('\n');
  }, [names]);
  const [owners, setOwners] = useState<Record<string, string>>({});
  useEffect(() => {
    const list = joined ? joined.split('\n') : [];
    let alive = true;
    const snapshot = () => {
      const next: Record<string, string> = {};
      list.forEach((name) => {
        const key = name.toLowerCase();
        if (ownerCache.has(key)) next[key] = ownerCache.get(key)!;
      });
      return next;
    };
    setOwners(snapshot());
    const missing = list.filter((name) => !ownerCache.has(name.toLowerCase()));
    let index = 0;
    const worker = async () => {
      while (alive && index < missing.length) {
        const name = missing[index++];
        try {
          const response = await fetch(
            `${getBaseApiReact()}/names/${encodeURIComponent(name)}`
          );
          const data = response.ok ? await response.json() : null;
          ownerCache.set(
            name.toLowerCase(),
            typeof data?.owner === 'string' ? data.owner : ''
          );
        } catch {
          ownerCache.set(name.toLowerCase(), '');
        }
        if (alive) setOwners(snapshot());
      }
    };
    Array.from({ length: Math.min(4, missing.length) }, () => worker());
    return () => {
      alive = false;
    };
  }, [joined]);
  return owners;
};

const Composer = ({
  initial,
  limit,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus,
}: {
  initial: string;
  limit: number;
  placeholder: string;
  submitLabel: string;
  onSubmit: (text: string) => Promise<boolean>;
  onCancel?: () => void;
  autoFocus?: boolean;
}) => {
  const { t } = useTranslation(['core']);
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const trimmed = text.trim();
  return (
    <Box>
      <TextField
        autoFocus={autoFocus}
        fullWidth
        inputProps={{ maxLength: limit }}
        minRows={3}
        multiline
        onChange={(event) => setText(event.target.value.slice(0, limit))}
        placeholder={placeholder}
        value={text}
        sx={{ '& .MuiOutlinedInput-root': { borderRadius: '14px' } }}
      />
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1,
          justifyContent: 'space-between',
          mt: 1,
        }}
      >
        <Typography sx={{ color: 'text.secondary', fontSize: '12px' }}>
          {t('core:app_page.reviews.characters', {
            length: text.length,
            limit,
          })}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {onCancel && (
            <Button
              disabled={busy}
              onClick={onCancel}
              sx={{ textTransform: 'none' }}
            >
              {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
            </Button>
          )}
          <Button
            disableElevation
            disabled={busy || !trimmed || trimmed === initial.trim()}
            onClick={async () => {
              setBusy(true);
              const done = await onSubmit(trimmed);
              setBusy(false);
              if (done) setText('');
            }}
            startIcon={
              busy ? <CircularProgress color="inherit" size={14} /> : null
            }
            sx={{ borderRadius: '12px', textTransform: 'none' }}
            variant="contained"
          >
            {submitLabel}
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

const YourReviewLoading = () => {
  const { t } = useTranslation(['core']);
  return (
    <Box
      aria-live="polite"
      sx={{
        alignItems: 'center',
        color: 'text.secondary',
        display: 'flex',
        fontSize: '13.5px',
        gap: 1,
        py: 1,
      }}
    >
      <CircularProgress size={14} />
      {t('core:app_page.reviews.loading_yours', {
        postProcess: 'capitalizeFirstChar',
      })}
    </Box>
  );
};

const PendingChip = () => {
  const { t } = useTranslation(['core']);
  return (
    <Tooltip
      title={t('core:app_page.reviews.pending_hint', {
        postProcess: 'capitalizeFirstChar',
      })}
    >
      <Chip
        icon={<CircularProgress size={10} thickness={6} />}
        label={t('core:app_page.reviews.pending', {
          postProcess: 'capitalizeFirstChar',
        })}
        size="small"
        sx={{ height: 22 }}
      />
    </Tooltip>
  );
};

const AuthorLine = ({
  item,
  isDeveloper,
  rating,
}: {
  item: ReviewItem;
  isDeveloper: boolean;
  rating: number | null;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  return (
    <Box
      sx={{
        alignItems: 'center',
        columnGap: 1,
        display: 'flex',
        flexWrap: 'wrap',
        rowGap: 0.25,
      }}
    >
      <Typography
        component="button"
        onClick={() =>
          executeEvent('openUserLookupDrawer', { addressOrName: item.name })
        }
        sx={{
          background: 'none',
          border: 0,
          color: 'text.primary',
          cursor: 'pointer',
          fontSize: '14.5px',
          fontWeight: 650,
          p: 0,
          '&:hover': { textDecoration: 'underline' },
        }}
      >
        {item.name}
      </Typography>
      {isDeveloper && (
        <Chip
          icon={<VerifiedRoundedIcon sx={{ fontSize: 14 }} />}
          label={t('core:app_page.reviews.developer', {
            postProcess: 'capitalizeFirstChar',
          })}
          size="small"
          sx={{
            backgroundColor: alpha(theme.palette.primary.main, 0.16),
            fontWeight: 600,
            height: 20,
          }}
        />
      )}
      {rating ? (
        <StarRow
          label={t('core:app_page.rating.stars_label', { count: rating })}
          size={15}
          value={rating}
        />
      ) : null}
      <RelativeTime sx={{ fontSize: '12.5px' }} timestamp={item.created} />
      {item.updated > item.created + 60_000 && !item.pending && (
        <Typography sx={{ color: 'text.secondary', fontSize: '12px' }}>
          {t('core:app_page.reviews.edited')}
        </Typography>
      )}
      {item.pending && <PendingChip />}
    </Box>
  );
};

const ReviewCard = ({
  thread,
  appName,
  ratingFor,
  myName,
  canWrite,
  onEdit,
  onReply,
  onRemove,
}: {
  thread: ReviewThread;
  appName: string;
  ratingFor: (name: string) => number | null;
  myName?: string;
  canWrite: boolean;
  onEdit: () => void;
  onReply: (parentName: string, text: string) => Promise<boolean>;
  onRemove: (item: ReviewItem) => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [replying, setReplying] = useState(false);
  const [showReplies, setShowReplies] = useState(thread.replies.length <= 2);
  const { review, replies } = thread;
  const mine = !!myName && review.name.toLowerCase() === myName.toLowerCase();
  const isDeveloper = (name: string) =>
    name.toLowerCase() === appName.toLowerCase();

  return (
    <Box
      component="article"
      sx={{
        borderTop: `1px solid ${theme.palette.divider}`,
        py: 2,
        '&:first-of-type': { borderTop: 0, pt: 0.5 },
      }}
    >
      <Box sx={{ display: 'flex', gap: 1.5 }}>
        <NameAvatar decorative name={review.name} size={40} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <AuthorLine
            isDeveloper={isDeveloper(review.name)}
            item={review}
            rating={ratingFor(review.name)}
          />
          {review.deleted ? (
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: '14px',
                fontStyle: 'italic',
                mt: 0.5,
              }}
            >
              {t('core:app_page.reviews.removed', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          ) : (
            <LinkifiedText sx={{ mt: 0.5 }} text={review.text} />
          )}
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 0.5,
              ml: -1,
              mt: 0.5,
            }}
          >
            {canWrite && !review.deleted && (
              <Button
                onClick={() => setReplying((value) => !value)}
                size="small"
                startIcon={<ReplyRoundedIcon />}
                sx={{ color: 'text.secondary', textTransform: 'none' }}
              >
                {t('core:app_page.reviews.reply', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Button>
            )}
            {mine && !review.deleted && (
              <>
                <Button
                  // The snippet is cut short: edit only the whole text.
                  disabled={!review.complete}
                  onClick={onEdit}
                  size="small"
                  startIcon={
                    review.complete ? (
                      <EditRoundedIcon />
                    ) : (
                      <CircularProgress color="inherit" size={14} />
                    )
                  }
                  sx={{ color: 'text.secondary', textTransform: 'none' }}
                >
                  {t('core:action.edit', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
                <Button
                  onClick={() => onRemove(review)}
                  size="small"
                  startIcon={<DeleteOutlineRoundedIcon />}
                  sx={{ color: 'text.secondary', textTransform: 'none' }}
                >
                  {t('core:action.delete', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
              </>
            )}
            {replies.length > 0 && (
              <Button
                aria-expanded={showReplies}
                onClick={() => setShowReplies((value) => !value)}
                size="small"
                sx={{ textTransform: 'none' }}
              >
                {showReplies
                  ? t('core:app_page.reviews.hide_replies', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('core:app_page.reviews.show_replies', {
                      count: replies.length,
                      postProcess: 'capitalizeFirstChar',
                    })}
              </Button>
            )}
          </Box>

          <Collapse in={replying} unmountOnExit>
            <Box sx={{ mt: 1 }}>
              <Composer
                autoFocus
                initial=""
                limit={REVIEW_LIMITS.reply}
                onCancel={() => setReplying(false)}
                onSubmit={async (text) => {
                  const done = await onReply(review.name, text);
                  if (done) {
                    setReplying(false);
                    setShowReplies(true);
                  }
                  return done;
                }}
                placeholder={t('core:app_page.reviews.reply_placeholder', {
                  name: review.name,
                  postProcess: 'capitalizeFirstChar',
                })}
                submitLabel={t('core:app_page.reviews.post_reply', {
                  postProcess: 'capitalizeFirstChar',
                })}
              />
            </Box>
          </Collapse>

          <Collapse in={showReplies && replies.length > 0}>
            <Box
              sx={{
                borderInlineStart: `2px solid ${alpha(theme.palette.primary.main, 0.3)}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.5,
                mt: 1,
                ps: 2,
                paddingInlineStart: '16px',
              }}
            >
              {replies.map((reply) => {
                const own =
                  !!myName && reply.name.toLowerCase() === myName.toLowerCase();
                return (
                  <Box
                    key={reply.identifier}
                    sx={{ display: 'flex', gap: 1.25 }}
                  >
                    <NameAvatar decorative name={reply.name} size={30} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <AuthorLine
                        isDeveloper={isDeveloper(reply.name)}
                        item={reply}
                        rating={null}
                      />
                      <LinkifiedText
                        sx={{ fontSize: '14px', mt: 0.25 }}
                        text={reply.text}
                      />
                    </Box>
                    {own && !reply.pending && (
                      <Tooltip
                        title={t('core:action.delete', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      >
                        <IconButton
                          aria-label={t('core:action.delete', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                          onClick={() => onRemove(reply)}
                          size="small"
                        >
                          <DeleteOutlineRoundedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                );
              })}
            </Box>
          </Collapse>
        </Box>
      </Box>
    </Box>
  );
};

export const AppReviewsSection = ({
  appName,
  appTitle,
  threads,
  loading,
  failed,
  hasMore,
  myName,
  myReview,
  ratingByAddress,
  myRating,
  prompt,
  onDismissPrompt,
  onLoadMore,
  onRetry,
  submitReview,
  submitReply,
  removeItem,
  onResult,
}: {
  appName: string;
  appTitle: string;
  threads: ReviewThread[];
  loading: boolean;
  failed: boolean;
  hasMore: boolean;
  myName?: string;
  myReview: ReviewItem | null;
  ratingByAddress: Map<string, number>;
  myRating: number | null;
  prompt: number | null;
  onDismissPrompt: () => void;
  onLoadMore: () => void;
  onRetry: () => void;
  submitReview: (text: string) => Promise<ReviewActionResult>;
  submitReply: (parent: string, text: string) => Promise<ReviewActionResult>;
  removeItem: (item: ReviewItem) => Promise<ReviewActionResult>;
  onResult: (result: ReviewActionResult, success: string) => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [sort, setSort] = useState<Sort>('newest');
  const [composing, setComposing] = useState(false);
  const promptRef = useRef<HTMLDivElement>(null);
  const canWrite = !!myName;
  const owners = useNameOwners(threads.map((thread) => thread.review.name));
  const ratingFor = (name: string) => {
    if (myName && name.toLowerCase() === myName.toLowerCase() && myRating)
      return myRating;
    const owner = owners[name.toLowerCase()];
    return owner ? (ratingByAddress.get(owner) ?? null) : null;
  };

  useEffect(() => {
    if (prompt && promptRef.current) {
      promptRef.current.scrollIntoView?.({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [prompt]);

  const sorted = useMemo(() => {
    const list = [...threads];
    if (sort === 'newest') return list;
    const score = (thread: ReviewThread) => ratingFor(thread.review.name) ?? 0;
    return list.sort((a, b) =>
      sort === 'highest'
        ? score(b) - score(a) || b.review.created - a.review.created
        : (score(a) || 6) - (score(b) || 6) ||
          b.review.created - a.review.created
    );
    // ratingFor reads owners and votes, both in the deps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads, sort, owners, ratingByAddress, myRating]);

  const visibleCount = threads.filter(
    (thread) => !thread.review.deleted
  ).length;
  // Until the whole text is loaded, the search's snippet is all there is:
  // editing that would publish it cut short.
  const myReviewLoading = !!myReview && !myReview.complete;
  // A composer starts again from the text once a newer version arrives.
  const composerKey = myReview
    ? `${myReview.updated}-${myReview.complete}`
    : 'new';
  const submitLabel = myReview
    ? t('core:app_page.reviews.update', {
        postProcess: 'capitalizeFirstChar',
      })
    : t('core:app_page.reviews.post', {
        postProcess: 'capitalizeFirstChar',
      });
  const loadMoreButton = hasMore && (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
      <Button onClick={onLoadMore} sx={{ textTransform: 'none' }}>
        {t('core:app_page.reviews.load_more', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Button>
    </Box>
  );

  const postReview = async (text: string) => {
    const result = await submitReview(text);
    onResult(
      result,
      t('core:app_page.reviews.sent', { postProcess: 'capitalizeFirstChar' })
    );
    if (result.ok) {
      setComposing(false);
      onDismissPrompt();
    }
    return result.ok;
  };

  return (
    <SectionCard
      aria-labelledby="app-page-reviews"
      component="section"
      sx={{ mb: 2 }}
    >
      <SectionTitle
        action={
          <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
            {threads.length > 1 && (
              <Select
                inputProps={{
                  'aria-label': t('core:app_page.reviews.sort', {
                    postProcess: 'capitalizeFirstChar',
                  }),
                }}
                onChange={(event) => setSort(event.target.value as Sort)}
                size="small"
                sx={{ borderRadius: '10px', fontSize: '13px' }}
                value={sort}
              >
                <MenuItem value="newest">
                  {t('core:app_page.reviews.sort_newest', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </MenuItem>
                <MenuItem value="highest">
                  {t('core:app_page.reviews.sort_highest', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </MenuItem>
                <MenuItem value="lowest">
                  {t('core:app_page.reviews.sort_lowest', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </MenuItem>
              </Select>
            )}
            {canWrite && !composing && !prompt && (
              <Button
                disabled={myReviewLoading}
                onClick={() => setComposing(true)}
                size="small"
                startIcon={
                  myReviewLoading ? (
                    <CircularProgress color="inherit" size={14} />
                  ) : (
                    <RateReviewRoundedIcon />
                  )
                }
                sx={{ borderRadius: '10px', textTransform: 'none' }}
                title={
                  myReviewLoading
                    ? t('core:app_page.reviews.loading_yours', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    : undefined
                }
                variant="outlined"
              >
                {myReview
                  ? t('core:app_page.reviews.edit_yours', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('core:app_page.reviews.write', {
                      postProcess: 'capitalizeFirstChar',
                    })}
              </Button>
            )}
          </Box>
        }
        id="app-page-reviews"
      >
        {t('core:app_page.reviews.title', {
          postProcess: 'capitalizeFirstChar',
        })}
        {visibleCount > 0 && (
          <Typography
            component="span"
            sx={{
              color: 'text.secondary',
              fontSize: '15px',
              fontWeight: 500,
              ml: 1,
            }}
          >
            {visibleCount}
          </Typography>
        )}
      </SectionTitle>

      <Collapse in={!!prompt} unmountOnExit>
        <Box
          ref={promptRef}
          sx={{
            background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.16)}, ${alpha(theme.palette.warning.main, 0.1)})`,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
            borderRadius: '16px',
            mb: 2,
            p: 2,
            position: 'relative',
          }}
        >
          <IconButton
            aria-label={t('core:app_page.reviews.not_now', {
              postProcess: 'capitalizeFirstChar',
            })}
            onClick={onDismissPrompt}
            size="small"
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: 1,
              mb: 0.5,
              pr: 4,
            }}
          >
            <AutoAwesomeRoundedIcon
              sx={{ color: theme.palette.warning.main }}
            />
            <Typography sx={{ fontSize: '15.5px', fontWeight: 700 }}>
              {t('core:app_page.reviews.prompt_title', {
                name: appTitle,
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
          {prompt ? (
            <Box sx={{ mb: 1 }}>
              <StarRow
                label={t('core:app_page.rating.stars_label', { count: prompt })}
                size={18}
                value={prompt}
              />
            </Box>
          ) : null}
          <Typography
            sx={{ color: 'text.secondary', fontSize: '13.5px', mb: 1.5 }}
          >
            {myReview
              ? t('core:app_page.reviews.prompt_update', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('core:app_page.reviews.prompt_text', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </Typography>
          {myReviewLoading ? (
            <YourReviewLoading />
          ) : (
            <Composer
              autoFocus
              initial={myReview?.text || ''}
              key={composerKey}
              limit={REVIEW_LIMITS.review}
              onCancel={onDismissPrompt}
              onSubmit={postReview}
              placeholder={t('core:app_page.reviews.placeholder', {
                postProcess: 'capitalizeFirstChar',
              })}
              submitLabel={submitLabel}
            />
          )}
        </Box>
      </Collapse>

      <Collapse in={composing && !prompt} unmountOnExit>
        <Box sx={{ mb: 2 }}>
          {!myRating && (
            <Typography
              sx={{ color: 'text.secondary', fontSize: '13px', mb: 1 }}
            >
              {t('core:app_page.reviews.rate_too', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          )}
          {myReviewLoading ? (
            <YourReviewLoading />
          ) : (
            <Composer
              autoFocus
              initial={myReview?.text || ''}
              key={composerKey}
              limit={REVIEW_LIMITS.review}
              onCancel={() => setComposing(false)}
              onSubmit={postReview}
              placeholder={t('core:app_page.reviews.placeholder', {
                postProcess: 'capitalizeFirstChar',
              })}
              submitLabel={submitLabel}
            />
          )}
          <Typography sx={{ color: 'text.secondary', fontSize: '12px', mt: 1 }}>
            {t('core:app_page.reviews.public_note', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </Box>
      </Collapse>

      {loading && threads.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={22} />
        </Box>
      ) : failed && threads.length === 0 ? (
        <Box sx={{ py: 2, textAlign: 'center' }}>
          <Typography sx={{ color: 'text.secondary', fontSize: '14px', mb: 1 }}>
            {t('core:app_page.reviews.load_failed', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
          <Button onClick={onRetry} size="small" sx={{ textTransform: 'none' }}>
            {t('core:retry', { postProcess: 'capitalizeFirstChar' })}
          </Button>
        </Box>
      ) : threads.length === 0 ? (
        <Box sx={{ py: 2, textAlign: 'center' }}>
          <RateReviewRoundedIcon
            sx={{ color: 'text.secondary', fontSize: 32 }}
          />
          <Typography
            sx={{ color: 'text.secondary', fontSize: '14px', mt: 0.5 }}
          >
            {canWrite
              ? t('core:app_page.reviews.empty_invite', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('core:app_page.reviews.empty', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </Typography>
          {loadMoreButton}
        </Box>
      ) : (
        <Box>
          {sorted.map((thread) => (
            <ReviewCard
              appName={appName}
              canWrite={canWrite}
              key={thread.review.identifier + thread.review.name}
              myName={myName}
              onEdit={() => setComposing(true)}
              onRemove={async (item) => {
                const result = await removeItem(item);
                onResult(
                  result,
                  t('core:app_page.reviews.removed_sent', {
                    postProcess: 'capitalizeFirstChar',
                  })
                );
              }}
              onReply={async (parent, text) => {
                const result = await submitReply(parent, text);
                onResult(
                  result,
                  t('core:app_page.reviews.reply_sent', {
                    postProcess: 'capitalizeFirstChar',
                  })
                );
                return result.ok;
              }}
              ratingFor={ratingFor}
              thread={thread}
            />
          ))}
          {loadMoreButton}
        </Box>
      )}
    </SectionCard>
  );
};
