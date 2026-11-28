import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CloseFullscreenRoundedIcon from '@mui/icons-material/CloseFullscreenRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import MovieRoundedIcon from '@mui/icons-material/MovieRounded';
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import PauseCircleOutlineRoundedIcon from '@mui/icons-material/PauseCircleOutlineRounded';
import PlayCircleOutlineRoundedIcon from '@mui/icons-material/PlayCircleOutlineRounded';
import PlayCircleRoundedIcon from '@mui/icons-material/PlayCircleRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import SaveAltRoundedIcon from '@mui/icons-material/SaveAltRounded';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Collapse,
  IconButton,
  LinearProgress,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { memo, useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type VideoCodec,
  videoToolPreviewUrl,
} from '../../../electron/src/video-tool-types';
import {
  episodeLabel,
  isListedInSubscreen,
  languageName,
  subscreenQuality,
} from '../../lib/videoPublisher';
import { CoverPicker } from './CoverPicker';
import { DestinationTag, destinationAppName } from './DestinationPicker';
import { homeWindowWiderThan } from '../Group/HomeDesktop/homeWindows';
import {
  containerName,
  formatBytes,
  formatDuration,
  keptFormatText,
  listFormat,
  probeSummary,
  resolutionOf,
} from './format';
import { ItemFieldsForm } from './ItemFieldsForm';
import {
  convertingProgressText,
  itemProgress,
  itemStatusText,
  isItemBusy,
} from './itemStatus';
import { calloutSx } from './publisherTheme';
import { CopyLinkButton, PublishedActions } from './ResultActions';
import {
  chosenOption,
  effectiveQuality,
  qualityOptions,
  readyAsIs,
} from './qualityOptions';
import { qualityLabel } from './QualityPicker';
import {
  effectiveFields,
  type MissingField,
  missingFields,
  posterWanted,
  shortOutput,
} from './queueHelpers';
import { AudioTrackSelect, SubtitleList } from './TrackLists';
import type {
  PublishAccount,
  VideoPublisherController,
} from './videoPublisherController';
import { errorMessageKey } from './videoPublisherErrors';
import type {
  ItemFields,
  QueueItem,
  VideoPublisherSettings,
} from './videoPublisherTypes';

type Props = {
  controller: VideoPublisherController;
  /** Remove only acts on what this account's name published. */
  account: PublishAccount & { address: string | null };
  canMoveDown: boolean;
  canMoveUp: boolean;
  /** The destination of the run it's in, else the one chosen. */
  destination: VideoPublisherSettings['destination'];
  /** Its place among its series' episodes, for its default title. */
  index: number;
  item: QueueItem;
  limitBytes: number;
  /** The picture format the window converts to (its estimates follow). */
  codec: VideoCodec;
  /** Several ready videos: each has a tick for the next Publish. */
  tickable: boolean;
  /**
   * An episode the series' playlist still has to take in: it stays listed.
   * From the window, which follows the run (the card only its video).
   */
  held: boolean;
  /** Remove waits: the series' playlist that lists it is going up. */
  removalBlocked: boolean;
  expanded: boolean;
  onToggle: (id: string) => void;
  settings: VideoPublisherSettings;
};

const MISSING_KEYS: Record<MissingField, string> = {
  title: 'core:video_publisher.missing.title',
  category: 'core:video_publisher.missing.category',
  subcategory: 'core:video_publisher.missing.subcategory',
  genre: 'core:video_publisher.missing.genre',
  subtitle_language: 'core:video_publisher.missing.subtitle_language',
  title_too_long: 'core:video_publisher.missing.title_too_long',
  series_title: 'core:video_publisher.missing.series_title',
  series_title_too_long: 'core:video_publisher.missing.series_title_too_long',
  series_genre: 'core:video_publisher.missing.series_genre',
};

export const QueueItemCard = memo(function QueueItemCard({
  account,
  canMoveDown,
  canMoveUp,
  codec,
  controller,
  destination: windowDestination,
  expanded,
  held,
  index,
  item,
  limitBytes,
  onToggle,
  removalBlocked,
  settings,
  tickable,
}: Props) {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const detailsId = useId();
  const locale = i18n.language;
  const isDark = theme.palette.mode === 'dark';
  const editable = item.phase === 'ready';
  // A video that went into a run keeps that run's destination and fields.
  const run = editable ? undefined : item.context;
  const destination = run?.destination ?? windowDestination;
  const shared = run?.shared ?? settings.shared;
  const seriesTitle = run?.series?.title ?? settings.series.title;
  const fieldsEditable =
    editable ||
    item.phase === 'waiting' ||
    item.phase === 'converting' ||
    item.phase === 'review' ||
    (item.phase === 'converted' && destination !== 'save') ||
    // Nothing went up yet: its fields can be fixed before Retry.
    ((item.phase === 'failed' || item.phase === 'cancelled') &&
      !item.record &&
      !item.removal);
  const busy = isItemBusy(item);
  const probing = item.phase === 'probing';
  // Nothing went up and nothing's converted: a Cancel (or a failure) before
  // the end goes back to the start, so everything can change for Retry.
  const untouched = !item.record && !item.removal;
  const notConverted =
    !item.output &&
    untouched &&
    (item.phase === 'failed' || item.phase === 'cancelled');
  // The sound and a burned-in track are part of the picture being made.
  const pictureEditable = editable || notConverted;
  // Text subtitles can change until it goes up: a converted video's are
  // written again, one converting gets them when it's done.
  const subtitlesEditable =
    pictureEditable ||
    item.phase === 'waiting' ||
    item.phase === 'converting' ||
    item.phase === 'converted' ||
    item.phase === 'review' ||
    ((item.phase === 'failed' || item.phase === 'cancelled') && untouched);
  const fields = effectiveFields(item, shared);
  // Said while the file is read too, so the card doesn't grow (and the ones
  // under it move) the moment its probe comes back.
  const missing =
    item.probe || probing ? missingFields(destination, item, shared) : [];
  const [previewMinimized, setPreviewMinimized] = useState(false);
  const options = useMemo(
    () => qualityOptions(item.probe, limitBytes, item.audioIndex, codec),
    [item.probe, limitBytes, item.audioIndex, codec]
  );
  const chosen = effectiveQuality(options, settings.quality, item.quality);
  const chosenSize = chosenOption(options, chosen.quality)?.estimateBytes;
  const progress = itemProgress(item);
  const title =
    (destination === 'subscreen-series'
      ? [
          episodeLabel(fields.season, fields.episode, fields.episodeKind),
          fields.episodeTitle,
        ]
          .filter(Boolean)
          .join(' · ')
      : fields.title) || item.source.name;

  const changeFields = useCallback(
    (change: Partial<ItemFields>) =>
      controller.updateItem(item.id, (current) => ({
        fields: { ...current.fields, ...change },
      })),
    [controller, item.id]
  );
  const loadFrames = useCallback(
    () => void controller.loadFrames(item.id),
    [controller, item.id]
  );

  // Unticked: it waits for a later Publish (another app, say).
  const leftOut = editable && tickable && Boolean(item.unticked);
  const notes: {
    key: string;
    text: string;
    tone: 'warning' | 'info' | 'success';
  }[] = [];
  // Its file already plays in the apps and fits the limit: it can go up as
  // it is (Keep as is), without converting.
  if (item.probe && editable && destination !== 'save' && readyAsIs(options)) {
    notes.push({
      key: 'as_is',
      text: t(
        chosen.quality === 'keep'
          ? 'core:video_publisher.as_is.kept'
          : 'core:video_publisher.as_is.ready',
        {
          format: keptFormatText(locale, item.probe, item.audioIndex),
          keep: t('core:video_publisher.quality.keep'),
          limit: formatBytes(limitBytes, locale),
          quality: t('core:video_publisher.quality.heading'),
        }
      ),
      tone: 'success',
    });
  }
  // Shorter than its original (a file cut off): it waits to be checked,
  // and says why.
  const short = shortOutput(item);
  if (short) {
    notes.push({
      key: 'short_output',
      text: t('core:video_publisher.notes.short_output', {
        converted: formatDuration(short.convertedSec),
        original: formatDuration(short.originalSec),
      }),
      tone: 'warning',
    });
  }
  if (item.probe?.video?.hdr) {
    notes.push({
      key: 'hdr',
      text: t('core:video_publisher.notes.hdr'),
      tone: 'info',
    });
  }
  if (
    destination === 'subscreen-film' &&
    item.probe &&
    !isListedInSubscreen(item.probe.durationSec)
  ) {
    notes.push({
      key: 'short',
      text: t('core:video_publisher.notes.short_film'),
      tone: 'warning',
    });
  }
  if (item.probe && editable) {
    if (!chosen.quality) {
      notes.push({
        key: 'quality',
        text: t('core:video_publisher.error.no_quality_fits'),
        tone: 'warning',
      });
    } else if (chosen.steppedDown) {
      notes.push({
        key: 'quality',
        text: t('core:video_publisher.quality.stepped_down', {
          quality: qualityLabel(t, settings.quality),
          used: qualityLabel(t, chosen.quality),
        }),
        tone: 'info',
      });
    }
  }
  // An unticked video waits for a later publish: its gaps aren't asked yet.
  if (missing.length && (editable || fieldsEditable) && !leftOut) {
    notes.push({
      key: 'missing',
      text: t('core:video_publisher.missing.needs', {
        fields: listFormat(
          locale,
          missing.map((field) => t(MISSING_KEYS[field]))
        ),
      }),
      tone: 'warning',
    });
  }
  // A film or a series shows with an upright poster: until the real one is
  // chosen, the card says a frame of the video goes in its place.
  const poster = posterWanted(destination, fields.category);
  if (
    poster &&
    fieldsEditable &&
    !leftOut &&
    item.probe &&
    item.fields.cover?.kind !== 'image'
  ) {
    notes.push({
      key: 'poster',
      text: t('core:video_publisher.cover.no_poster'),
      tone: 'warning',
    });
  }
  if (item.subtitlesBusy) {
    notes.push({
      key: 'subtitles_busy',
      text: t('core:video_publisher.subtitles.updating'),
      tone: 'info',
    });
  }
  if (item.failedSubtitles) {
    notes.push({
      key: 'subtitles',
      text: t('core:video_publisher.subtitles.failed', {
        count: item.failedSubtitles,
      }),
      tone: 'warning',
    });
  }

  // A size's quality name ("1080p"), as Subscreen names it too.
  const linesOf = (width?: number, height?: number) => {
    const lines = subscreenQuality(width ?? 0, height ?? 0);
    return lines ? t('core:video_publisher.quality.step', { lines }) : '';
  };
  // The original as it came: its type and size first, then the rest.
  const original = item.probe
    ? [
        containerName(item.probe, item.source.name),
        formatBytes(item.source.size, locale),
        linesOf(
          item.probe.video?.displayWidth,
          item.probe.video?.displayHeight
        ),
        resolutionOf(item.probe),
        formatDuration(item.probe.durationSec),
        probeSummary(t, item.probe),
      ]
    : [formatBytes(item.source.size, locale)];
  // What it became, beside it, once converted.
  const output = item.output;
  const smallerPercent =
    output && item.source.size > 0 && output.size < item.source.size
      ? Math.round((1 - output.size / item.source.size) * 100)
      : 0;
  const converted = output
    ? [
        'MP4',
        output.codec ? t(`core:video_publisher.format.${output.codec}`) : '',
        formatBytes(output.size, locale),
        linesOf(output.width, output.height),
        `${output.width}×${output.height}`,
        smallerPercent >= 1
          ? t('core:video_publisher.queue.smaller', { percent: smallerPercent })
          : '',
      ]
    : null;
  // A video whose length isn't known has no size to promise.
  const plan =
    editable && chosen.quality
      ? item.probe?.durationSec > 0
        ? t('core:video_publisher.quality.converts_at', {
            quality: qualityLabel(t, chosen.quality),
            size: formatBytes(chosenSize ?? 0, locale),
          })
        : qualityLabel(t, chosen.quality)
      : null;
  const detailLine = (label: string, parts: string[], tone?: string) => (
    <Typography
      sx={{
        color: theme.palette.text.secondary,
        display: '-webkit-box',
        fontSize: '0.78rem',
        overflow: 'hidden',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: 2,
      }}
    >
      <Box
        component="span"
        sx={{ color: tone ?? theme.palette.text.primary, fontWeight: 650 }}
      >
        {label}
      </Box>
      {` ${parts.filter(Boolean).join(' · ')}`}
    </Typography>
  );

  const statusColor =
    item.phase === 'failed' || item.phase === 'unusable'
      ? theme.palette.error.main
      : item.phase === 'done'
        ? theme.palette.success.main
        : busy
          ? theme.palette.primary.main
          : theme.palette.text.secondary;
  const removal = item.removal;
  // Not once a Remove started: a retry would list what it replaced.
  const canRetry = controller.canRetry(item);
  const canSave = item.phase === 'converted' && item.saved === false;
  // A series episode: its own page, while the series card has the rest.
  const episodeLink =
    item.phase === 'done' && !item.record ? item.link : undefined;
  const thumb = item.thumbnail ?? item.frames?.[0]?.dataUrl;
  const needsSomething = Boolean(missing.length && editable && !leftOut);

  return (
    <Box
      aria-label={title}
      component="li"
      data-phase={item.phase}
      sx={{
        bgcolor: alpha(theme.palette.background.paper, isDark ? 0.78 : 0.92),
        border: `1px solid ${alpha(theme.palette.text.primary, isDark ? 0.08 : 0.1)}`,
        borderRadius: '14px',
        // What still needs something shows as a stripe down its edge.
        boxShadow: needsSomething
          ? `inset 3px 0 0 ${theme.palette.warning.main}`
          : `0 1px 2px ${alpha(theme.palette.common.black, isDark ? 0.24 : 0.06)}`,
        display: 'grid',
        gap: 1,
        listStyle: 'none',
        opacity: leftOut ? 0.7 : 1,
        p: 1.5,
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'grid',
          gap: 1.25,
          gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        }}
      >
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.25 }}>
          {editable && tickable ? (
            <Tooltip title={t('core:video_publisher.queue.tick_hint')}>
              <Checkbox
                checked={!item.unticked}
                inputProps={{
                  'aria-label': t('core:video_publisher.queue.tick', {
                    name: title,
                  }),
                }}
                onChange={(_event, ticked) =>
                  controller.setTicked(item.id, ticked)
                }
                size="small"
                sx={{ ml: -0.75, p: 0.5 }}
              />
            </Tooltip>
          ) : null}
          <Box
            data-testid="video-publisher-thumb"
            sx={{
              alignItems: 'center',
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              borderRadius: '10px',
              boxShadow: `0 0 0 1px ${alpha(theme.palette.text.primary, 0.08)}`,
              color: theme.palette.primary.main,
              display: 'flex',
              flexShrink: 0,
              height: 63,
              justifyContent: 'center',
              overflow: 'hidden',
              width: 112,
              [homeWindowWiderThan(760)]: { height: 81, width: 144 },
              // A slim queue pane (a tall, narrow window): room for the name.
              '@container vp-queue (max-width: 420px)': {
                height: 47,
                width: 84,
              },
            }}
          >
            {item.phase === 'probing' ? (
              <CircularProgress size={20} />
            ) : thumb ? (
              <Box
                alt=""
                component="img"
                src={thumb}
                sx={{ height: '100%', objectFit: 'cover', width: '100%' }}
              />
            ) : (
              <MovieRoundedIcon fontSize="large" />
            )}
          </Box>
        </Box>
        <Box sx={{ display: 'grid', gap: 0.25, minWidth: 0 }}>
          <Typography
            noWrap
            sx={{ fontSize: '0.92rem', fontWeight: 650 }}
            title={item.source.relativePath || item.source.name}
          >
            {title}
          </Typography>
          {detailLine(t('core:video_publisher.queue.original'), original)}
          {converted
            ? detailLine(
                t('core:video_publisher.queue.converted'),
                converted,
                theme.palette.success.main
              )
            : null}
          {/* Not a live region: it changes with every percent. The window
              announces only what happened (VideoPublisher's status). */}
          {/* A div: the app's picture in it is one (never inside a <p>). */}
          <Typography
            component="div"
            noWrap
            sx={{ color: statusColor, fontSize: '0.8rem', fontWeight: 600 }}
          >
            {/* Where it went: videos of one run can go to different apps. */}
            {run ? <DestinationTag destination={destination} /> : null}
            {leftOut
              ? t('core:video_publisher.status.left_out')
              : itemStatusText(t, item, destination)}
            {plan && !leftOut ? (
              <Box
                component="span"
                sx={{ color: theme.palette.text.secondary, fontWeight: 400 }}
              >
                {` · ${plan}`}
              </Box>
            ) : null}
          </Typography>
        </Box>
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.25 }}>
          {editable && (canMoveUp || canMoveDown) ? (
            <>
              <Tooltip title={t('core:video_publisher.queue.move_up')}>
                <span>
                  <IconButton
                    aria-label={t('core:video_publisher.queue.move_up')}
                    disabled={!canMoveUp}
                    onClick={() => controller.moveItem(item.id, -1)}
                    size="small"
                  >
                    <ArrowUpwardRoundedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('core:video_publisher.queue.move_down')}>
                <span>
                  <IconButton
                    aria-label={t('core:video_publisher.queue.move_down')}
                    disabled={!canMoveDown}
                    onClick={() => controller.moveItem(item.id, 1)}
                    size="small"
                  >
                    <ArrowDownwardRoundedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </>
          ) : null}
          {/* There while the file is read too: a click then isn't lost, the
              details open once it's read. */}
          {item.probe || probing ? (
            <Tooltip
              title={
                expanded
                  ? t('core:video_publisher.queue.hide_details')
                  : t('core:video_publisher.queue.details')
              }
            >
              <IconButton
                aria-controls={detailsId}
                aria-expanded={expanded}
                aria-label={t('core:video_publisher.queue.details_of', {
                  name: title,
                })}
                onClick={() => onToggle(item.id)}
                size="small"
              >
                <ExpandMoreRoundedIcon
                  fontSize="small"
                  sx={{
                    transform: expanded ? 'rotate(180deg)' : 'none',
                    transition: 'transform 160ms ease',
                  }}
                />
              </IconButton>
            </Tooltip>
          ) : null}
          {item.phase === 'converting' && controller.canPause() ? (
            <Tooltip
              title={
                item.paused
                  ? t('core:video_publisher.actions.resume')
                  : t('core:video_publisher.actions.pause')
              }
            >
              <IconButton
                aria-label={
                  item.paused
                    ? t('core:video_publisher.queue.resume_item', {
                        name: title,
                      })
                    : t('core:video_publisher.queue.pause_item', {
                        name: title,
                      })
                }
                aria-pressed={Boolean(item.paused)}
                onClick={() =>
                  void (item.paused
                    ? controller.resumeItem(item.id)
                    : controller.pauseItem(item.id))
                }
                size="small"
              >
                {item.paused ? (
                  <PlayCircleOutlineRoundedIcon fontSize="small" />
                ) : (
                  <PauseCircleOutlineRoundedIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          ) : null}
          {busy ? (
            item.phase === 'saving' ? null : (
              <Tooltip title={t('core:video_publisher.actions.cancel')}>
                <IconButton
                  aria-label={t('core:video_publisher.queue.cancel_item', {
                    name: title,
                  })}
                  onClick={() => void controller.cancelItem(item.id)}
                  size="small"
                >
                  <StopCircleOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )
          ) : held ? null : (
            <Tooltip title={t('core:video_publisher.queue.remove_short')}>
              <IconButton
                aria-label={t('core:video_publisher.queue.remove', {
                  name: title,
                })}
                disabled={removal === 'removing'}
                onClick={() => void controller.removeItem(item.id)}
                size="small"
              >
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {progress !== null ? (
        <Box
          sx={{
            alignItems: 'center',
            columnGap: 1.25,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
          }}
        >
          <LinearProgress
            aria-label={title}
            sx={{
              borderRadius: 2,
              height: 8,
              // Paused: the bar stands, dimmed.
              opacity: item.paused ? 0.45 : 1,
            }}
            value={progress}
            variant={
              (item.phase === 'converting' && !item.percent && !item.paused) ||
              (item.phase === 'publishing' && item.publish?.onNode)
                ? 'indeterminate'
                : 'determinate'
            }
          />
          <Typography
            data-testid="video-publisher-progress-text"
            sx={{
              fontSize: '0.84rem',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {item.phase === 'converting'
              ? convertingProgressText(t, item)
              : t('core:video_publisher.status.percent', {
                  percent: Math.floor(progress),
                })}
          </Typography>
        </Box>
      ) : null}

      {notes.map((note) => {
        const toneColor =
          note.tone === 'warning'
            ? theme.palette.warning.main
            : note.tone === 'success'
              ? theme.palette.success.main
              : theme.palette.primary.main;
        const Icon =
          note.tone === 'warning'
            ? WarningAmberRoundedIcon
            : note.tone === 'success'
              ? CheckCircleRoundedIcon
              : InfoOutlinedIcon;
        return (
          <Typography
            data-testid={`video-publisher-note-${note.key}`}
            key={note.key}
            sx={{
              ...calloutSx(theme, toneColor),
              color:
                note.tone === 'info'
                  ? theme.palette.text.secondary
                  : theme.palette.text.primary,
              fontSize: '0.76rem',
              lineHeight: 1.45,
            }}
          >
            <Icon
              aria-hidden
              sx={{
                color:
                  note.tone === 'success' && !isDark
                    ? theme.palette.success.dark
                    : toneColor,
                flexShrink: 0,
                fontSize: '1rem',
                mt: '1px',
              }}
            />
            <span>{note.text}</span>
          </Typography>
        );
      })}

      {item.error ? (
        <Typography
          role="alert"
          sx={{ color: theme.palette.error.main, fontSize: '0.76rem' }}
        >
          {t(errorMessageKey(item.error.code))}
        </Typography>
      ) : null}

      {item.phase === 'review' && item.jobId && item.output ? (
        <Box sx={{ display: 'grid', gap: 0.75 }}>
          {/* Minimized, it leaves room for the other videos; Save it /
              Publish it stay. */}
          <Button
            aria-expanded={!previewMinimized}
            color="inherit"
            onClick={() => setPreviewMinimized((current) => !current)}
            size="small"
            startIcon={
              previewMinimized ? (
                <OpenInFullRoundedIcon fontSize="small" />
              ) : (
                <CloseFullscreenRoundedIcon fontSize="small" />
              )
            }
            sx={{ justifySelf: 'start', textTransform: 'none' }}
          >
            {previewMinimized
              ? t('core:video_publisher.review.show_preview')
              : t('core:video_publisher.review.minimize')}
          </Button>
          {previewMinimized ? null : (
            <Box
              aria-label={t('core:video_publisher.review.heading')}
              component="video"
              controls
              // hub-video:// is another origin: without CORS mode the
              // subtitle tracks are refused.
              crossOrigin="anonymous"
              preload="metadata"
              src={videoToolPreviewUrl(item.jobId)}
              sx={{
                aspectRatio: `${item.output.width || 16} / ${item.output.height || 9}`,
                bgcolor: theme.palette.common.black,
                borderRadius: '8px',
                maxHeight: 320,
                width: '100%',
              }}
            >
              {item.output.subtitles.map((track, position) => (
                <track
                  default={position === 0}
                  key={track.id}
                  kind="subtitles"
                  label={track.label || languageName(track.language, locale)}
                  src={videoToolPreviewUrl(
                    item.jobId,
                    `subtitles/${track.id}.vtt`
                  )}
                  srcLang={track.language}
                />
              ))}
            </Box>
          )}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            <Button
              // Held while a field doesn't fit the app (the note above says
              // which): a title over its limit would be cut without a word.
              disabled={missing.length > 0}
              onClick={() => controller.approve(item.id)}
              size="small"
              sx={{ textTransform: 'none' }}
              variant="contained"
            >
              {destination === 'save'
                ? t('core:video_publisher.review.save')
                : t('core:video_publisher.review.publish')}
            </Button>
            <Button
              color="inherit"
              onClick={() => void controller.discard(item.id)}
              size="small"
              sx={{ textTransform: 'none' }}
            >
              {t('core:video_publisher.review.discard')}
            </Button>
          </Box>
        </Box>
      ) : null}

      {item.savedFile ? (
        <Box
          sx={{
            bgcolor: alpha(theme.palette.success.main, isDark ? 0.1 : 0.07),
            border: `1px solid ${alpha(theme.palette.success.main, 0.3)}`,
            borderRadius: '8px',
            display: 'grid',
            gap: 0.75,
            p: 1,
          }}
        >
          <Typography sx={{ fontSize: '0.8rem' }}>
            <Box component="span" sx={{ fontWeight: 650 }}>
              {t('core:video_publisher.queue.saved_to')}
            </Box>{' '}
            <Box
              component="span"
              data-testid="video-publisher-saved-path"
              sx={{
                color: theme.palette.text.secondary,
                overflowWrap: 'anywhere',
              }}
            >
              {item.savedFile.path}
            </Box>
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            <Button
              onClick={() => void controller.openSaved(item.id, 'open')}
              size="small"
              startIcon={<PlayCircleRoundedIcon />}
              sx={{ textTransform: 'none' }}
              variant="contained"
            >
              {t('core:video_publisher.actions.play_saved')}
            </Button>
            <Button
              onClick={() => void controller.openSaved(item.id, 'folder')}
              size="small"
              startIcon={<FolderOpenRoundedIcon />}
              sx={{ textTransform: 'none' }}
              variant="outlined"
            >
              {t('core:video_publisher.actions.show_in_folder')}
            </Button>
          </Box>
          {item.savedFileError ? (
            <Typography
              role="alert"
              sx={{ color: theme.palette.error.main, fontSize: '0.76rem' }}
            >
              {t(errorMessageKey(item.savedFileError))}
            </Typography>
          ) : null}
        </Box>
      ) : null}

      {canRetry || canSave || episodeLink ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {canRetry ? (
            <Button
              // The upload asks for approval again, with its fee.
              onClick={() => controller.retry(item.id)}
              size="small"
              startIcon={<ReplayRoundedIcon />}
              sx={{ textTransform: 'none' }}
              variant="outlined"
            >
              {t('core:video_publisher.actions.retry')}
            </Button>
          ) : null}
          {episodeLink ? <CopyLinkButton link={episodeLink} /> : null}
          {canSave ? (
            <Button
              onClick={() => void controller.saveItem(item.id)}
              size="small"
              startIcon={<SaveAltRoundedIcon />}
              sx={{ textTransform: 'none' }}
              variant="contained"
            >
              {t('core:video_publisher.actions.save_now')}
            </Button>
          ) : null}
        </Box>
      ) : null}
      {item.record ? (
        <PublishedActions
          canRemove={
            Boolean(account.name) &&
            account.name === item.record.name &&
            !removalBlocked
          }
          onRemove={() => void controller.removePublished(item.id, account)}
          partial={item.phase !== 'done'}
          quote={(count) =>
            controller.quote(count, account.address, account.publicKey)
          }
          record={item.record}
          removal={removal}
          removalCount={controller.removalCount(item.record)}
          removalLeft={controller.removalLeftOf(item.id)}
          removalError={item.removalError}
        />
      ) : null}

      <Collapse in={expanded && Boolean(item.probe)} unmountOnExit>
        <Box
          id={detailsId}
          sx={{
            borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
            display: 'grid',
            gap: 1.75,
            pt: 1.25,
          }}
        >
          {destination !== 'save' ? (
            <ItemFieldsForm
              destination={destination}
              disabled={!fieldsEditable}
              fields={fields}
              index={index}
              missing={missing}
              onChange={changeFields}
              seriesTitle={seriesTitle}
            />
          ) : null}
          {destination !== 'save' ? (
            <CoverPicker
              askPoster={
                poster === 'subscreen'
                  ? t('core:video_publisher.cover.poster_prompt_subscreen')
                  : poster === 'qtube'
                    ? t('core:video_publisher.cover.poster_prompt_qtube')
                    : undefined
              }
              automaticLabel={
                destination === 'subscreen-series'
                  ? t('core:video_publisher.cover.series_poster')
                  : destination === 'subscreen-film'
                    ? t('core:video_publisher.cover.automatic_upright')
                    : undefined
              }
              disabled={!fieldsEditable}
              frames={item.frames}
              framesState={item.framesState}
              heading={
                destination === 'subscreen-film' ||
                destination === 'subscreen-series'
                  ? t('core:video_publisher.cover.poster_heading')
                  : t('core:video_publisher.cover.heading')
              }
              onChange={(cover) => changeFields({ cover })}
              onLoadFrames={loadFrames}
              poster={
                destination === 'subscreen-film' ||
                destination === 'subscreen-series'
              }
              sourceId={item.source.id}
              value={item.fields.cover ?? null}
            />
          ) : null}
          {item.probe && item.probe.audio.length > 1 ? (
            <AudioTrackSelect
              disabled={!pictureEditable}
              onChange={(audioIndex) =>
                controller.updateItem(item.id, { audioIndex })
              }
              probe={item.probe}
              value={item.audioIndex}
            />
          ) : null}
          {destination === 'save' ? (
            <SubtitleList
              burnIndex={item.burnSubtitleIndex}
              burnOnly
              disabled={!pictureEditable}
              note={t('core:video_publisher.subtitles.not_saved')}
              onAddFiles={() => {}}
              onBurn={(burnSubtitleIndex) =>
                controller.updateItem(item.id, { burnSubtitleIndex })
              }
              onChange={() => {}}
              subtitles={item.subtitles}
            />
          ) : (
            <SubtitleList
              burnDisabled={!pictureEditable}
              burnIndex={item.burnSubtitleIndex}
              disabled={!subtitlesEditable}
              note={
                destination === 'qshare'
                  ? t('core:video_publisher.subtitles.qshare_files')
                  : undefined
              }
              onAddFiles={(files) =>
                void controller.addSubtitleFiles(item.id, files)
              }
              onBurn={(burnSubtitleIndex) =>
                controller.updateItem(item.id, { burnSubtitleIndex })
              }
              onChange={(key, change) =>
                controller.changeSubtitles(item.id, (subtitles) =>
                  subtitles.map((track) =>
                    track.key === key ? { ...track, ...change } : track
                  )
                )
              }
              subtitles={item.subtitles}
            />
          )}
        </Box>
      </Collapse>
    </Box>
  );
});
