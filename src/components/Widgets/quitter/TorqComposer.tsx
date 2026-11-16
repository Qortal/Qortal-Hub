import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  IconButton,
  LinearProgress,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PollOutlinedIcon from '@mui/icons-material/PollOutlined';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { userInfoAtom } from '../../../atoms/global';
import { QuitterPublishCancelledError } from './quitterPublish';
import { TORQ_APP_NAME, openTorqPost } from './torqFeed';
import {
  normalizeTorqPoll,
  publishTorqPost,
  TORQ_MAX_IMAGES,
  TORQ_MIN_POLL_OPTIONS,
} from './torqPublish';
import {
  plainTextToTorqDoc,
  torqDocToPostBody,
  type TorqDocNode,
} from './torqRichText';
import { TorqPollEditor } from './TorqPollEditor';
import { TorqTextEditor } from './TorqTextEditor';

export type PublishedTorqPost = { author: string; postIdentifier: string };

type TorqComposerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a post is published, so the feed can show it. */
  onPublished?: (post: PublishedTorqPost) => void;
};

type ImageDraft = { id: string; file: File; previewUrl: string };

/**
 * 'preparing': photos are being compressed, Cancel stops it.
 * 'submitted': the post is with Hub's approval dialog or on its way to QDN.
 */
type PublishPhase = 'idle' | 'preparing' | 'submitted';

const IMAGE_TYPES = 'image/jpeg,image/png,image/webp';

const isCancelError = (err: unknown) =>
  err instanceof QuitterPublishCancelledError ||
  (err as Error | null)?.name === 'QuitterPublishCancelledError';

/** The image type, from the file or else from its name. */
const imageMimeOf = (file: File): string => {
  const type = typeof file?.type === 'string' ? file.type : '';
  if (type.startsWith('image/')) return type;
  const ext = String(file?.name || '')
    .toLowerCase()
    .match(/\.(jpe?g|png|webp|gif)$/)?.[1];
  if (!ext) return '';
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
};

let nextImageId = 0;

/**
 * Home's "Post to Torq": a one-line entry at the top of the Torq feed that
 * opens, in place, into a composer for text, photos and a poll. The draft
 * stays while the feed window does.
 */
export const TorqComposer = ({
  open,
  onOpenChange,
  onPublished,
}: TorqComposerProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const tc = useCallback(
    (key: string, options: Record<string, unknown> = {}) =>
      t(`core:torq_composer.${key}`, {
        postProcess: 'capitalizeFirstChar',
        ...options,
      }),
    [t]
  );
  const userInfo = useAtomValue(userInfoAtom);
  const userName =
    typeof userInfo?.name === 'string' ? userInfo.name.trim() : '';
  const hasName = userName.length > 0;
  const isOpen = open && hasName;

  const [doc, setDoc] = useState<TorqDocNode>(() => plainTextToTorqDoc(''));
  const [images, setImages] = useState<ImageDraft[]>([]);
  const [pollChoices, setPollChoices] = useState<string[] | null>(null);
  const [pollAnonymous, setPollAnonymous] = useState(false);
  const [phase, setPhase] = useState<PublishPhase>('idle');
  const [progress, setProgress] = useState<{
    message: string;
    percent: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [lastPublished, setLastPublished] = useState<PublishedTorqPost | null>(
    null
  );
  const titleId = useId();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Leaving Home drops the draft: free its previews, and stop a publish that
  // has not reached the approval dialog yet.
  useEffect(
    () => () => {
      if (phaseRef.current === 'preparing') abortRef.current?.abort();
      abortRef.current = null;
      imagesRef.current.forEach((image) =>
        URL.revokeObjectURL(image.previewUrl)
      );
    },
    []
  );

  const body = useMemo(() => torqDocToPostBody(doc), [doc]);
  const normalizedPoll = useMemo(
    () => (pollChoices ? normalizeTorqPoll(pollChoices) : null),
    [pollChoices]
  );
  const publishing = phase !== 'idle';
  const pollInvalid = pollChoices != null && !normalizedPoll;
  const hasContent =
    body.text.length > 0 || images.length > 0 || normalizedPoll != null;
  const canPost = hasName && !publishing && !pollInvalid && hasContent;

  const handleOpen = () => {
    setLastPublished(null);
    onOpenChange(true);
  };

  const handleCancel = () => {
    if (phase === 'submitted') return;
    if (phase === 'preparing') {
      // Nothing was sent yet: drop this publish, it stops before the dialog.
      abortRef.current?.abort();
      abortRef.current = null;
      setPhase('idle');
      setProgress(null);
      return;
    }
    setError('');
    onOpenChange(false);
  };

  const addImageFiles = (files: File[]) => {
    setError('');
    const remaining = TORQ_MAX_IMAGES - images.length;
    const next: ImageDraft[] = [];
    for (const file of files.slice(0, Math.max(0, remaining))) {
      const mime = imageMimeOf(file);
      if (mime === 'image/gif') {
        setError(tc('error.gif_images_unsupported'));
        continue;
      }
      if (!mime) continue;
      nextImageId += 1;
      next.push({
        id: `torq-image-${nextImageId}`,
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (files.length > remaining) {
      setError(tc('error.too_many_images', { count: TORQ_MAX_IMAGES }));
    }
    if (next.length) setImages((prev) => [...prev, ...next]);
  };

  const removeImage = (id: string) => {
    const image = images.find((item) => item.id === id);
    if (image) URL.revokeObjectURL(image.previewUrl);
    setImages((prev) => prev.filter((item) => item.id !== id));
  };

  const moveImage = (index: number, delta: number) => {
    setImages((prev) => {
      const swapWith = index + delta;
      if (swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return next;
    });
  };

  const togglePoll = () => {
    if (pollChoices) {
      setPollChoices(null);
      setPollAnonymous(false);
      return;
    }
    setPollChoices(Array.from({ length: TORQ_MIN_POLL_OPTIONS }, () => ''));
  };

  const clearDraft = () => {
    imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    setImages([]);
    setDoc(plainTextToTorqDoc(''));
    setPollChoices(null);
    setPollAnonymous(false);
  };

  const handlePost = async () => {
    if (!canPost) return;
    const abort = new AbortController();
    abortRef.current = abort;
    // False once cancelled or unmounted: what this publish says goes nowhere.
    const isCurrent = () => abortRef.current === abort;
    setPhase('preparing');
    setError('');
    setProgress({ message: tc('progress.preparing_post'), percent: 0 });
    try {
      const { postIdentifier } = await publishTorqPost({
        text: body.text,
        richText: body.richText,
        userName,
        images: images.map((item) => ({ file: item.file })),
        poll: pollChoices
          ? normalizeTorqPoll(pollChoices, { anonymous: pollAnonymous })
          : null,
        onProgress: (message, percent) => {
          if (isCurrent()) setProgress({ message, percent });
        },
        onSubmitted: () => {
          if (isCurrent()) setPhase('submitted');
        },
        signal: abort.signal,
      });
      if (!isCurrent()) return;
      const published = { author: userName, postIdentifier };
      clearDraft();
      setLastPublished(published);
      onOpenChange(false);
      onPublished?.(published);
    } catch (err) {
      // A declined approval is the user's choice: the draft stays as it was.
      if (isCurrent() && !isCancelError(err)) {
        console.error('[Torq] publish failed', err);
        setError(
          err instanceof Error && err.message
            ? err.message
            : tc('error.publish_failed')
        );
      }
    } finally {
      if (isCurrent()) {
        abortRef.current = null;
        setPhase('idle');
        setProgress(null);
      }
    }
  };

  const isDark = theme.palette.mode === 'dark';
  // Visible on Home's panels in both themes (border.main is near the dark
  // panel colour).
  const borderColor = alpha(theme.palette.text.primary, isDark ? 0.12 : 0.14);
  const entrySx = {
    alignItems: 'center',
    backgroundColor: isDark
      ? alpha(theme.palette.common.white, 0.03)
      : alpha(theme.palette.common.black, 0.02),
    border: `1px solid ${borderColor}`,
    borderRadius: '999px',
    display: 'flex',
    flexShrink: 0,
    gap: 1,
    minHeight: 34,
    minWidth: 0,
    px: 1.25,
    width: '100%',
  } as const;
  const entryTextSx = {
    fontSize: '0.78rem',
    fontWeight: 600,
    minWidth: 0,
  } as const;
  const overlayButtonSx = {
    backgroundColor: alpha(theme.palette.common.black, 0.55),
    color: theme.palette.common.white,
    height: 24,
    padding: 0,
    position: 'absolute',
    width: 24,
    '&:hover': { backgroundColor: alpha(theme.palette.common.black, 0.72) },
    '&.Mui-disabled': { display: 'none' },
  } as const;

  if (!hasName) {
    return (
      <Box sx={{ ...entrySx, color: theme.palette.text.secondary, py: 0.75 }}>
        <InfoOutlinedIcon sx={{ flexShrink: 0, fontSize: 16 }} />
        <Typography sx={{ ...entryTextSx, lineHeight: 1.35 }}>
          {tc('register_name', { app: TORQ_APP_NAME })}
        </Typography>
      </Box>
    );
  }

  if (!isOpen) {
    return (
      <Box
        sx={{
          ...entrySx,
          flexWrap: 'wrap',
          gap: 0.5,
          pr: lastPublished ? 0.5 : 1.25,
          transition: 'background-color 140ms ease',
          '&:hover': { backgroundColor: theme.palette.action.hover },
        }}
      >
        <ButtonBase
          onClick={handleOpen}
          sx={{
            alignItems: 'center',
            borderRadius: '999px',
            color: lastPublished
              ? theme.palette.text.primary
              : theme.palette.text.secondary,
            display: 'flex',
            flex: '1 1 auto',
            gap: 1,
            justifyContent: 'flex-start',
            minHeight: 32,
            minWidth: 0,
            textAlign: 'left',
            '&:focus-visible': {
              outline: `2px solid ${alpha(theme.palette.primary.main, 0.6)}`,
              outlineOffset: 2,
            },
          }}
        >
          {lastPublished ? (
            <CheckCircleRoundedIcon
              sx={{
                color: theme.palette.success.main,
                flexShrink: 0,
                fontSize: 16,
              }}
            />
          ) : (
            <EditOutlinedIcon sx={{ flexShrink: 0, fontSize: 16 }} />
          )}
          <Typography noWrap sx={entryTextSx}>
            {lastPublished
              ? tc('published_to', { app: TORQ_APP_NAME })
              : tc('post_to', { app: TORQ_APP_NAME })}
          </Typography>
        </ButtonBase>
        {lastPublished ? (
          <Button
            size="small"
            startIcon={<OpenInNewRoundedIcon />}
            onClick={() =>
              openTorqPost(lastPublished.author, lastPublished.postIdentifier)
            }
            sx={{
              borderRadius: '999px',
              flexShrink: 0,
              fontSize: '0.72rem',
              fontWeight: 650,
              minHeight: 28,
              px: 1,
              textTransform: 'none',
            }}
          >
            {tc('open_latest_post')}
          </Button>
        ) : null}
      </Box>
    );
  }

  return (
    <Box
      aria-labelledby={titleId}
      component="section"
      sx={{
        backgroundColor: isDark
          ? alpha(theme.palette.common.white, 0.02)
          : alpha(theme.palette.common.white, 0.35),
        border: `1px solid ${borderColor}`,
        borderRadius: '12px',
        display: 'flex',
        flex: '0 1 auto',
        flexDirection: 'column',
        gap: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        p: 1,
      }}
    >
      <Typography
        id={titleId}
        sx={{
          color: theme.palette.text.primary,
          flexShrink: 0,
          fontSize: '0.8rem',
          fontWeight: 650,
          px: 0.25,
        }}
      >
        {tc('post_to', { app: TORQ_APP_NAME })}
      </Typography>

      {/* Scrolls on its own when the window is short; the buttons stay. */}
      <Box
        sx={{
          display: 'flex',
          flex: '0 1 auto',
          flexDirection: 'column',
          gap: 1,
          minHeight: 0,
          overflowY: 'auto',
          // The feed's own thin, themed scrollbar.
          scrollbarColor: `${alpha(theme.palette.text.secondary, 0.3)} transparent`,
          scrollbarWidth: 'thin',
          '&::-webkit-scrollbar': {
            width: '10px',
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundClip: 'padding-box',
            backgroundColor: alpha(theme.palette.text.secondary, 0.24),
            border: '3px solid transparent',
            borderRadius: '999px',
          },
        }}
      >
        <TorqTextEditor
          initialDoc={doc}
          disabled={publishing}
          onChange={setDoc}
        />

        {pollChoices ? (
          <TorqPollEditor
            choices={pollChoices}
            anonymous={pollAnonymous}
            disabled={publishing}
            onChoicesChange={setPollChoices}
            onAnonymousChange={setPollAnonymous}
            onRemove={() => {
              setPollChoices(null);
              setPollAnonymous(false);
            }}
          />
        ) : null}

        {images.length > 0 ? (
          <Box
            sx={{
              display: 'grid',
              flexShrink: 0,
              gap: 0.75,
              gridTemplateColumns: 'repeat(auto-fill, minmax(76px, 1fr))',
            }}
          >
            {images.map((image, index) => (
              <Box
                key={image.id}
                sx={{
                  aspectRatio: '1 / 1',
                  backgroundColor: alpha(theme.palette.text.primary, 0.05),
                  borderRadius: '10px',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <Box
                  component="img"
                  src={image.previewUrl}
                  alt=""
                  sx={{
                    display: 'block',
                    height: '100%',
                    objectFit: 'cover',
                    width: '100%',
                  }}
                />
                <IconButton
                  size="small"
                  aria-label={tc('remove_image')}
                  disabled={publishing}
                  onClick={() => removeImage(image.id)}
                  sx={{ ...overlayButtonSx, right: 4, top: 4 }}
                >
                  <CloseRoundedIcon sx={{ fontSize: 16 }} />
                </IconButton>
                {images.length > 1 ? (
                  <>
                    <IconButton
                      size="small"
                      aria-label={tc('move_image_earlier')}
                      disabled={publishing || index === 0}
                      onClick={() => moveImage(index, -1)}
                      sx={{ ...overlayButtonSx, bottom: 4, left: 4 }}
                    >
                      <ChevronLeftRoundedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={tc('move_image_later')}
                      disabled={publishing || index === images.length - 1}
                      onClick={() => moveImage(index, 1)}
                      sx={{ ...overlayButtonSx, bottom: 4, right: 4 }}
                    >
                      <ChevronRightRoundedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </>
                ) : null}
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexShrink: 0,
          flexWrap: 'wrap',
          gap: 0.75,
          justifyContent: 'space-between',
        }}
      >
        <Box sx={{ display: 'flex', gap: 0.25 }}>
          <input
            ref={imageInputRef}
            data-testid="torq-composer-image-input"
            type="file"
            accept={IMAGE_TYPES}
            multiple
            hidden
            onChange={(event) => {
              addImageFiles(Array.from(event.target.files || []));
              event.target.value = '';
            }}
          />
          <IconButton
            size="small"
            aria-label={tc('add_image')}
            disabled={publishing || images.length >= TORQ_MAX_IMAGES}
            onClick={() => imageInputRef.current?.click()}
          >
            <ImageOutlinedIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            aria-label={tc('add_poll')}
            aria-pressed={pollChoices != null}
            disabled={publishing}
            onClick={togglePoll}
            sx={
              pollChoices
                ? {
                    backgroundColor: alpha(theme.palette.primary.main, 0.12),
                    color: theme.palette.primary.main,
                  }
                : undefined
            }
          >
            <PollOutlinedIcon fontSize="small" />
          </IconButton>
        </Box>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.75,
            justifyContent: 'flex-end',
            ml: 'auto',
          }}
        >
          <Button
            size="small"
            color="inherit"
            disabled={phase === 'submitted'}
            onClick={handleCancel}
            sx={{
              borderRadius: '999px',
              fontWeight: 650,
              px: 1.5,
              textTransform: 'none',
            }}
          >
            {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={!canPost}
            onClick={() => void handlePost()}
            startIcon={
              publishing ? (
                <CircularProgress size={14} color="inherit" />
              ) : (
                <SendRoundedIcon />
              )
            }
            sx={{
              borderRadius: '999px',
              fontWeight: 650,
              px: 1.75,
              textTransform: 'none',
            }}
          >
            {publishing
              ? tc('publishing')
              : t('core:action.publish', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </Button>
        </Box>
      </Box>

      {progress ? (
        <Box sx={{ flexShrink: 0 }}>
          <LinearProgress
            aria-label={progress.message}
            variant="determinate"
            value={progress.percent}
            sx={{ borderRadius: 999, height: 4 }}
          />
          <Typography
            aria-live="polite"
            sx={{ color: theme.palette.text.secondary, fontSize: 12, mt: 0.5 }}
          >
            {progress.message}
          </Typography>
        </Box>
      ) : null}
      {pollInvalid ? (
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            flexShrink: 0,
            fontSize: 12,
          }}
        >
          {tc('poll_needs_choices', { count: TORQ_MIN_POLL_OPTIONS })}
        </Typography>
      ) : null}
      {error ? (
        <Typography
          role="alert"
          sx={{
            color: theme.palette.error.main,
            flexShrink: 0,
            fontSize: 12.5,
          }}
        >
          {error}
        </Typography>
      ) : null}
    </Box>
  );
};
