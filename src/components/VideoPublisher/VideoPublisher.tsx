import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded';
import MovieFilterRoundedIcon from '@mui/icons-material/MovieFilterRounded';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import PlaylistAddRoundedIcon from '@mui/icons-material/PlaylistAddRounded';
import VideoLibraryRoundedIcon from '@mui/icons-material/VideoLibraryRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha, ThemeProvider } from '@mui/material/styles';
import { useAtom } from 'jotai';
import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { homeWindowWiderThan } from '../Group/HomeDesktop/homeWindows';
import { DestinationPicker, destinationAppName } from './DestinationPicker';
import { itemStatusText } from './itemStatus';
import { filesFromDrop, isFileDrag } from './dropFiles';
import { SectionHeading, WINDOW_ALERT_SX } from './FormParts';
import { formatBytes, leftOutText } from './format';
import { PublishedList } from './PublishedList';
import { calloutSx, paneSx, paneTint, publisherTheme } from './publisherTheme';
import { PublishedActions } from './ResultActions';
import { FormatSteps, QualitySteps } from './QualityPicker';
import { QueueItemCard } from './QueueItemCard';
import {
  effectiveQuality,
  qualityOptions,
  shownWindowQuality,
  windowQualityChoices,
} from './qualityOptions';
import {
  isClearable,
  looksLikeSeries,
  type MissingField,
  missingFields,
  missingSeriesFields,
} from './queueHelpers';
import { SeriesForm, SharedFieldsForm } from './SharedForms';
import { useVideoPublisher } from './useVideoPublisher';
import { videoExpandedAtom } from './videoPublisherAtoms';
import { AV1_MIN_THREADS } from './videoPublisherController';
import { errorCodeOf, errorMessageKey } from './videoPublisherErrors';
import type {
  LeftOutFile,
  QueueItem,
  VideoDestination,
} from './videoPublisherTypes';

/** Phases a screen reader hears about (not each percent of the way). */
const ANNOUNCED_PHASES = new Set<QueueItem['phase']>([
  'converted',
  'review',
  'done',
  'failed',
  'cancelled',
]);

const VIDEO_INPUT_ACCEPT =
  'video/*,.mkv,.avi,.wmv,.flv,.ts,.m2ts,.mts,.vob,.mpg,.mpeg,.mxf,.divx,.xvid,.srt,.vtt,.ass,.ssa';

/** The Video publisher: Home's window for converting and publishing videos. */
export const VideoPublisher = () => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const {
    controller,
    items,
    settings,
    run,
    nodeLimit,
    account,
    published,
    encoder,
  } = useVideoPublisher();
  // AV1 unless chosen otherwise, the PC is slow for it, or this Hub can't
  // write it (read with the settings and the encoder info just above).
  const codec = controller.codec();
  const locale = i18n.language;
  const isDark = theme.palette.mode === 'dark';
  // Hub's pills, segmented choices and fields for everything inside.
  const windowTheme = useMemo(() => publisherTheme(theme), [theme]);
  const videosInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [leftOut, setLeftOut] = useState<LeftOutFile[]>([]);
  // In the store: a window that's rebuilt keeps the cards it had open.
  const [expandedState, setExpandedState] = useAtom(videoExpandedAtom);
  const expanded = useMemo(
    () => new Set(expandedState.open),
    [expandedState.open]
  );
  const [seriesHintDismissed, setSeriesHintDismissed] = useState(false);
  const [toolProblem, setToolProblem] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    window.videoTool
      ?.status()
      .then((status) => {
        if (live) {
          setToolProblem(status.available === false ? 'missing-binary' : null);
          controller.setEncoderInfo(
            status.available
              ? {
                  av1: status.av1 === true,
                  cpuThreads: status.cpuThreads ?? 0,
                  canPause: status.canPause === true,
                }
              : null
          );
        }
      })
      .catch(() => live && setToolProblem('missing-binary'));
    return () => {
      live = false;
    };
  }, [controller]);

  // Where the next Publish sends the ticked videos. A run going doesn't
  // fix it: videos published during it can go to another app.
  const destination: VideoDestination = settings.destination;
  const limitBytes = controller.sizeLimitFor(destination);
  // nodeLimit is read so the limit follows the node in use.
  const nodeLimitBytes = nodeLimit?.bytes ?? limitBytes;
  const isSeries = destination === 'subscreen-series';
  const isSave = destination === 'save';
  // A series' run: nothing joins it (its playlist is planned when it starts).
  const seriesRun =
    run.active && run.context?.destination === 'subscreen-series';
  // While it has its episodes or playlist in hand, nothing changes. A series
  // that's done doesn't hold the window while an older video is retried.
  const seriesRunning = seriesRun && controller.seriesBusy();
  const locked = seriesRunning;
  const appName = destinationAppName(destination);

  const allReady = items.filter((item) => item.phase === 'ready');
  // With several, each has a tick: the next Publish takes the ticked ones.
  const tickable = allReady.length > 1;
  const ready = allReady.filter((item) => !tickable || !item.unticked);
  const readyIds = ready.map((item) => item.id);
  const readyOptions = ready.map((item) =>
    qualityOptions(item.probe, limitBytes, item.audioIndex, codec)
  );
  // Every one goes up as its file is (Keep as is): nothing is converted.
  const allKept =
    readyOptions.length > 0 &&
    readyOptions.every(
      (options, index) =>
        effectiveQuality(options, settings.quality, ready[index].quality)
          .quality === 'keep'
    );
  // The main button converts; previewed videos are published (or saved) later
  // from their own card, the others right after converting. Kept as they
  // are, they're only prepared (repackaged in seconds).
  const readyCount = ready.length;
  const startLabel = settings.reviewFirst
    ? isSave
      ? t(
          allKept
            ? 'core:video_publisher.actions.prepare'
            : 'core:video_publisher.actions.convert',
          { count: readyCount }
        )
      : isSeries
        ? t(
            allKept
              ? 'core:video_publisher.actions.prepare_series'
              : 'core:video_publisher.actions.convert_series',
            { count: readyCount }
          )
        : t(
            allKept
              ? 'core:video_publisher.actions.prepare_for'
              : 'core:video_publisher.actions.convert_for',
            { app: appName, count: readyCount }
          )
    : isSave
      ? t(
          allKept
            ? 'core:video_publisher.actions.save_as_is'
            : 'core:video_publisher.actions.save',
          { count: readyCount }
        )
      : isSeries
        ? t(
            allKept
              ? 'core:video_publisher.actions.publish_series'
              : 'core:video_publisher.actions.convert_and_publish_series',
            { count: readyCount }
          )
        : t(
            allKept
              ? 'core:video_publisher.actions.publish_to'
              : 'core:video_publisher.actions.convert_and_publish_to',
            { app: appName, count: readyCount }
          );
  const itemMissing = new Map(
    items.map((item) => [
      item.id,
      item.probe ? missingFields(destination, item, settings.shared) : [],
    ])
  );
  const seriesMissing = isSeries ? missingSeriesFields(settings.series) : [];
  const readyMissing = ready.filter(
    (item) => (itemMissing.get(item.id) ?? []).length
  );
  // What the shared fields could fill in for the videos that lack it.
  const sharedMissing = [
    ...new Set(readyMissing.flatMap((item) => itemMissing.get(item.id))),
  ] as MissingField[];
  const needsName = !isSave && !account.name;
  // During a run they go in it; a series waits for the run to end.
  const cannotJoin = run.active && (isSeries || seriesRun);
  // A series still owing its playlist would be dropped by a new run.
  const seriesOwed = !run.active && controller.seriesOwesPlaylist();
  const canPublish =
    ready.length > 0 &&
    !needsName &&
    !readyMissing.length &&
    !seriesMissing.length &&
    !toolProblem &&
    !cannotJoin &&
    !seriesOwed;
  // Greyed by the videos the next Publish takes (else all not yet sent).
  const qualityChoices = windowQualityChoices(
    readyOptions.length
      ? readyOptions
      : allReady.map((item) =>
          qualityOptions(item.probe, limitBytes, item.audioIndex, codec)
        )
  );
  const steppedDownCount = readyOptions.filter(
    (options) => effectiveQuality(options, settings.quality).steppedDown
  ).length;
  // This run's videos only: those of an earlier one aren't counted.
  const runIds = useMemo(() => new Set(run.itemIds ?? []), [run.itemIds]);
  const inRun = items.filter((item) => runIds.has(item.id));
  // Converted: everything past its conversion, done included, and what
  // failed or was cancelled after it (its converted file is kept).
  const convertedCount = inRun.filter(
    (item) =>
      item.phase === 'converted' ||
      item.phase === 'review' ||
      item.phase === 'publishing' ||
      item.phase === 'saving' ||
      item.phase === 'done' ||
      ((item.phase === 'failed' || item.phase === 'cancelled') &&
        Boolean(item.output))
  ).length;
  const checkCount = inRun.filter((item) => item.phase === 'review').length;
  // A run's videos may go to different apps: saved ones count apart.
  const savedInRun = inRun.filter(
    (item) => item.context?.destination === 'save'
  );
  const publishedInRun = inRun.filter(
    (item) => item.context?.destination !== 'save'
  );
  const doneOf = (list: QueueItem[]) =>
    list.filter((item) => item.phase === 'done').length;
  // The series' poster comes from an episode of the series it goes with:
  // the running one's, else one the next Publish takes, else one not
  // finished (not an earlier series' still on the list).
  const posterEpisode =
    (seriesRunning ? inRun : ready).find((item) => item.probe) ??
    items.find(
      (item) =>
        item.probe &&
        !['done', 'discarded', 'cancelled', 'unusable'].includes(item.phase)
    ) ??
    items.find((item) => item.probe);
  // What Clear finished takes: not an episode its series still holds.
  const finishedCount = items.filter(
    (item) => isClearable(item) && !controller.isHeldBySeries(item)
  ).length;
  const suggestSeries =
    !isSeries &&
    !locked &&
    !seriesHintDismissed &&
    looksLikeSeries(items.map((item) => item.source));

  // A single video opens its details (once): its fields are what's left
  // to do.
  const onlyId = items.length === 1 ? items[0].id : null;
  useEffect(() => {
    if (!onlyId) return;
    setExpandedState((current) =>
      current.autoOpened.includes(onlyId)
        ? current
        : {
            open: [...current.open.filter((id) => id !== onlyId), onlyId],
            autoOpened: [...current.autoOpened, onlyId],
          }
    );
  }, [onlyId, setExpandedState]);
  // Cards gone from the list are forgotten.
  const itemIdsKey = items.map((item) => item.id).join('\n');
  useEffect(() => {
    const ids = new Set(itemIdsKey ? itemIdsKey.split('\n') : []);
    setExpandedState((current) => {
      const open = current.open.filter((id) => ids.has(id));
      const autoOpened = current.autoOpened.filter((id) => ids.has(id));
      return open.length === current.open.length &&
        autoOpened.length === current.autoOpened.length
        ? current
        : { open, autoOpened };
    });
  }, [itemIdsKey, setExpandedState]);

  const toggle = useCallback(
    (id: string) =>
      setExpandedState((current) => ({
        ...current,
        open: current.open.includes(id)
          ? current.open.filter((entry) => entry !== id)
          : [...current.open, id],
      })),
    [setExpandedState]
  );

  // Files left out of a filled queue: their note sits under the cards, so
  // it's brought into view (else a drop seems to do nothing).
  const leftOutRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!leftOut.length) return;
    leftOutRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [leftOut]);

  const addFiles = useCallback(
    async (files: File[], relativePaths?: (string | undefined)[]) => {
      if (!files.length) return;
      setAdding(true);
      try {
        const result = await controller.addFiles(files, relativePaths);
        setLeftOut(result.leftOut);
      } finally {
        setAdding(false);
      }
    },
    [controller]
  );
  // Hub's own open dialog, worded for Qortal (Chromium's says "Upload");
  // the hidden inputs stay for an older main without it.
  const pick = async (folder: boolean) => {
    if (!controller.canPickFiles()) {
      (folder ? folderInput : videosInput).current?.click();
      return;
    }
    setAdding(true);
    try {
      const result = await controller.pickFiles({
        folder,
        title: folder
          ? t('core:video_publisher.drop.choose_folder')
          : t('core:video_publisher.drop.choose_videos'),
        buttonLabel:
          destination === 'save'
            ? t('core:video_publisher.pick.button_save')
            : t('core:video_publisher.pick.button_publish'),
        filterName: t('core:video_publisher.pick.filter'),
      });
      if (result.added || result.leftOut.length) setLeftOut(result.leftOut);
    } catch (error) {
      setToolProblem(null);
      setLeftOut([]);
      setPickError(errorCodeOf(error));
    } finally {
      setAdding(false);
    }
  };

  const onDragEnter = (event: DragEvent) => {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (event: DragEvent) => {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (event: DragEvent) => {
    if (!isFileDrag(event.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  };
  const onDrop = async (event: DragEvent) => {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setDragging(false);
    const dropped = await filesFromDrop(event.dataTransfer);
    await addFiles(dropped.files, dropped.relativePaths);
  };

  const limitLine = nodeLimit?.publicNode
    ? t('core:video_publisher.limit.public_node', {
        size: formatBytes(nodeLimitBytes, locale),
      })
    : t('core:video_publisher.limit.own_node', {
        size: formatBytes(nodeLimitBytes, locale),
      });

  const inputs = (
    <>
      <input
        accept={VIDEO_INPUT_ACCEPT}
        data-testid="video-publisher-files"
        hidden
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void addFiles(files);
        }}
        ref={videosInput}
        type="file"
      />
      <input
        data-testid="video-publisher-folder"
        hidden
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void addFiles(files);
        }}
        ref={(node) => {
          folderInput.current = node;
          // React doesn't know the folder attribute; set it on the element.
          node?.setAttribute('webkitdirectory', '');
        }}
        type="file"
      />
    </>
  );
  const chooseButtons = (compact: boolean) => (
    <>
      <Button
        disabled={adding || Boolean(toolProblem)}
        onClick={() => void pick(false)}
        size={compact ? 'small' : 'medium'}
        startIcon={<VideoLibraryRoundedIcon />}
        sx={{ textTransform: 'none' }}
        variant={compact ? 'text' : 'contained'}
      >
        {compact
          ? t('core:video_publisher.drop.add_videos')
          : t('core:video_publisher.drop.choose_videos')}
      </Button>
      <Button
        disabled={adding || Boolean(toolProblem)}
        onClick={() => void pick(true)}
        size={compact ? 'small' : 'medium'}
        startIcon={<CreateNewFolderRoundedIcon />}
        sx={{ textTransform: 'none' }}
        variant={compact ? 'text' : 'outlined'}
      >
        {compact
          ? t('core:video_publisher.drop.add_folder')
          : t('core:video_publisher.drop.choose_folder')}
      </Button>
    </>
  );

  const dropOverlay = dragging ? (
    <Box
      aria-hidden
      sx={{
        alignItems: 'center',
        bgcolor: alpha(theme.palette.primary.main, isDark ? 0.18 : 0.1),
        border: `2px dashed ${theme.palette.primary.main}`,
        borderRadius: '10px',
        color: theme.palette.primary.main,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        inset: 0,
        justifyContent: 'center',
        pointerEvents: 'none',
        position: 'absolute',
        zIndex: 2,
      }}
    >
      <CloudUploadRoundedIcon sx={{ fontSize: '2.4rem' }} />
      <Typography sx={{ fontWeight: 700 }}>
        {t('core:video_publisher.drop.release')}
      </Typography>
    </Box>
  ) : null;

  const quote = useCallback(
    (count: number) =>
      controller.quote(count, account.address, account.publicKey),
    [controller, account.address, account.publicKey]
  );

  const series = run.series;
  const seriesMissingEpisodes =
    series?.phase === 'waiting' && !run.active
      ? inRun.filter(
          (item) => item.phase === 'failed' || item.phase === 'cancelled'
        ).length
      : 0;
  const seriesTitle =
    series?.record?.title ||
    run.context?.series?.title ||
    settings.series.title;

  // One polite announcement per thing that happened: a video converted,
  // published, failed…, and the run stopping.
  const [announcement, setAnnouncement] = useState('');
  const lastPhases = useRef(new Map<string, QueueItem['phase']>());
  useEffect(() => {
    const seen = lastPhases.current;
    let latest = '';
    for (const item of items) {
      const before = seen.get(item.id);
      seen.set(item.id, item.phase);
      if (before && before !== item.phase && ANNOUNCED_PHASES.has(item.phase)) {
        latest = t('core:video_publisher.announce.item', {
          status: itemStatusText(
            t,
            item,
            item.context?.destination ?? destination
          ),
          title:
            item.fields.title || item.fields.episodeTitle || item.source.name,
        });
      }
    }
    for (const id of [...seen.keys()]) {
      if (!items.some((item) => item.id === id)) seen.delete(id);
    }
    if (latest) setAnnouncement(latest);
  }, [items, t, destination]);
  useEffect(() => {
    if (run.stoppedBy && !run.active) {
      setAnnouncement(t('core:video_publisher.run.stopped'));
    }
  }, [run.stoppedBy, run.active, t]);

  const orderSensitive = items.length > 1;
  const cards = useMemo(
    () =>
      items.map((item, index) => (
        <QueueItemCard
          account={account}
          canMoveDown={
            orderSensitive && index < items.length - 1 && !run.active
          }
          canMoveUp={orderSensitive && index > 0 && !run.active}
          codec={codec}
          controller={controller}
          destination={destination}
          expanded={expanded.has(item.id)}
          held={controller.isHeldBySeries(item)}
          index={controller.episodeIndex(item)}
          item={item}
          key={item.id}
          limitBytes={limitBytes}
          onToggle={toggle}
          removalBlocked={controller.removalBlocked(item.id)}
          settings={settings}
          tickable={tickable}
        />
      )),
    [
      account,
      codec,
      controller,
      destination,
      expanded,
      items,
      limitBytes,
      locked,
      orderSensitive,
      // Whether a card can move, and whether a series holds it, follow the
      // run.
      run,
      settings,
      tickable,
      toggle,
    ]
  );

  // Each column is a pane of its own, so the videos and what's done with
  // them read apart.
  const panelSx = {
    ...paneSx(theme),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 1.25,
    minHeight: 0,
    minWidth: 0,
    p: 1.75,
  };
  // Wide: the videos on the left, the settings and their bar on the right,
  // each column scrolling on its own. Wide but short: the whole window
  // scrolls instead, so neither column is squeezed under the bar. Narrow (a
  // tall, slim window too): one column, the videos over the settings,
  // scrolling together, the bar with the main button kept in view at the
  // bottom while the window is tall enough for it to leave room.
  const wide = homeWindowWiderThan(860);
  const wideButShort =
    '@container home-window (min-width: 860px) and (height < 560px)';
  const tallEnough = '@container home-window (min-height: 640px)';
  const queuePaneSx = {
    ...panelSx,
    // Its cards size their parts by the pane's own width.
    containerName: 'vp-queue',
    containerType: 'inline-size',
    [wide]: {
      gridColumn: '1',
      gridRow: '1 / span 2',
      overflow: 'auto',
      pr: 0.5,
    },
    // Its own full height (spanning a flexible row, it would otherwise be
    // allowed to shrink to the settings' rows).
    [wideButShort]: {
      gridRow: '1 / span 3',
      minHeight: 'min-content',
      overflow: 'visible',
    },
  };
  const settingsPaneSx = {
    ...panelSx,
    alignContent: 'start',
    display: 'grid',
    gap: 2,
    [wide]: {
      borderBottom: 0,
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
      gridColumn: '2',
      gridRow: '1',
      overflow: 'auto',
      pb: 1.5,
      pr: 0.5,
    },
    [wideButShort]: { minHeight: 'auto', overflow: 'visible' },
  };
  const actionsSx = {
    ...paneSx(theme),
    display: 'grid',
    gap: 1,
    px: 1.75,
    py: 1.5,
    [tallEnough]: {
      // Opaque: what scrolls under it doesn't show through.
      backgroundColor: theme.palette.background.paper,
      backgroundImage: `linear-gradient(${paneTint(theme)}, ${paneTint(theme)})`,
      bottom: 0,
      boxShadow: `0 -10px 24px ${alpha(theme.palette.common.black, isDark ? 0.38 : 0.1)}`,
      position: 'sticky',
      zIndex: 2,
    },
    // The settings pane's foot, under a line.
    [wide]: {
      backgroundColor: paneTint(theme),
      backgroundImage: 'none',
      borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.1)}`,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
      boxShadow: 'none',
      gridColumn: '2',
      gridRow: '2',
      position: 'static',
      pt: 1.25,
    },
  };

  return (
    <ThemeProvider theme={windowTheme}>
      <Box
        data-testid="video-publisher"
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={(event) => void onDrop(event)}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          position: 'relative',
          width: '100%',
        }}
      >
        {inputs}
        {dropOverlay}
        <Box
          aria-live="polite"
          role="status"
          sx={{
            clip: 'rect(0 0 0 0)',
            // In px: in sx, 1 would be 100 % of the window.
            height: '1px',
            overflow: 'hidden',
            position: 'absolute',
            whiteSpace: 'nowrap',
            width: '1px',
          }}
        >
          {announcement}
        </Box>
        {toolProblem ? (
          <Alert severity="error" sx={{ ...WINDOW_ALERT_SX, mb: 1 }}>
            {t(errorMessageKey(toolProblem))}
          </Alert>
        ) : null}
        {pickError ? (
          <Alert
            onClose={() => setPickError(null)}
            severity="error"
            sx={{ ...WINDOW_ALERT_SX, mb: 1 }}
          >
            {t(errorMessageKey(pickError))}
          </Alert>
        ) : null}

        {!items.length ? (
          <>
            <Box
              sx={{
                alignItems: 'center',
                border: `2px dashed ${alpha(theme.palette.text.primary, isDark ? 0.18 : 0.16)}`,
                borderRadius: '12px',
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                gap: 1.25,
                justifyContent: 'center',
                minHeight: 0,
                overflow: 'auto',
                p: 3,
                textAlign: 'center',
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  bgcolor: alpha(theme.palette.primary.main, 0.12),
                  borderRadius: '50%',
                  color: theme.palette.primary.main,
                  display: 'flex',
                  height: 64,
                  justifyContent: 'center',
                  width: 64,
                }}
              >
                <MovieFilterRoundedIcon sx={{ fontSize: '2rem' }} />
              </Box>
              <Typography
                component="h3"
                sx={{ fontSize: '1.05rem', fontWeight: 700 }}
              >
                {t('core:video_publisher.drop.title')}
              </Typography>
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '0.84rem',
                  maxWidth: '56ch',
                }}
              >
                {t('core:video_publisher.drop.body')}
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 1,
                  justifyContent: 'center',
                  mt: 0.5,
                }}
              >
                {chooseButtons(false)}
              </Box>
              {adding ? (
                <LinearProgress sx={{ maxWidth: 240, width: '100%' }} />
              ) : null}
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '0.76rem',
                }}
              >
                {limitLine}
              </Typography>
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '0.72rem',
                }}
              >
                {t('core:video_publisher.drop.subtitles_hint')}
              </Typography>
              {leftOut.length ? (
                <Alert
                  onClose={() => setLeftOut([])}
                  severity="info"
                  sx={{ ...WINDOW_ALERT_SX, textAlign: 'start' }}
                >
                  {leftOutText(t, locale, leftOut)}
                </Alert>
              ) : null}
            </Box>
            {published.length ? (
              // Scrolls on its own, so the drop zone and its buttons keep
              // most of the window however long the list is.
              <Box
                data-testid="video-publisher-published-empty"
                sx={{
                  flexShrink: 0,
                  maxHeight: '45%',
                  minHeight: 0,
                  mt: 1.25,
                  overflow: 'auto',
                }}
              >
                <PublishedList
                  account={account}
                  controller={controller}
                  entries={published}
                />
              </Box>
            ) : null}
          </>
        ) : (
          <Box
            sx={{
              columnGap: 2,
              display: 'grid',
              flex: 1,
              gridAutoRows: 'max-content',
              gridTemplateColumns: 'minmax(0, 1fr)',
              minHeight: 0,
              overflow: 'auto',
              rowGap: 1.5,
              [wide]: {
                gridTemplateColumns: 'minmax(0, 1.45fr) minmax(300px, 1fr)',
                gridTemplateRows: 'minmax(0, 1fr) auto',
                overflow: 'hidden',
                rowGap: 0,
              },
              // Rows at their content's height, never squeezed to the window's:
              // the settings, their bar, then what the videos need beyond.
              [wideButShort]: {
                alignContent: 'start',
                gridTemplateRows: 'max-content max-content 1fr',
                overflow: 'auto',
              },
            }}
          >
            <Box data-column="queue" sx={queuePaneSx}>
              <SectionHeading
                end={
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.25 }}>
                    {chooseButtons(true)}
                    {finishedCount ? (
                      <Button
                        color="inherit"
                        disabled={locked}
                        onClick={() => void controller.clearFinished()}
                        size="small"
                        sx={{ textTransform: 'none' }}
                      >
                        {t('core:video_publisher.queue.clear_finished')}
                      </Button>
                    ) : null}
                  </Box>
                }
              >
                {t('core:video_publisher.queue.heading', {
                  count: items.length,
                })}
              </SectionHeading>
              {/* A slot of its own: the cards don't move when adding ends. */}
              <Box aria-hidden={!adding} sx={{ flexShrink: 0, height: 4 }}>
                {adding ? <LinearProgress sx={{ height: 4 }} /> : null}
              </Box>
              {suggestSeries ? (
                <Alert
                  action={
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Button
                        color="inherit"
                        onClick={() =>
                          controller.setDestination('subscreen-series')
                        }
                        size="small"
                        sx={{ textTransform: 'none' }}
                      >
                        {t(
                          'core:video_publisher.destination.series_suggestion_action'
                        )}
                      </Button>
                      <IconButton
                        aria-label={t('core:video_publisher.actions.dismiss')}
                        color="inherit"
                        onClick={() => setSeriesHintDismissed(true)}
                        size="small"
                      >
                        <CloseRoundedIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  }
                  severity="info"
                  sx={WINDOW_ALERT_SX}
                >
                  {t('core:video_publisher.destination.series_suggestion')}
                </Alert>
              ) : null}
              {series ? (
                <Box
                  aria-label={t('core:video_publisher.series_result.heading', {
                    title: seriesTitle,
                  })}
                  role="region"
                  sx={{
                    bgcolor: alpha(
                      theme.palette.primary.main,
                      isDark ? 0.12 : 0.06
                    ),
                    border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
                    borderRadius: '10px',
                    display: 'grid',
                    gap: 0.75,
                    p: 1.25,
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: 1,
                      justifyContent: 'space-between',
                    }}
                  >
                    <Typography sx={{ fontSize: '0.86rem', fontWeight: 700 }}>
                      {t('core:video_publisher.series_result.heading', {
                        title: seriesTitle,
                      })}
                    </Typography>
                    {/* Not while an episode can still be retried: the
                    playlist has to take it in. */}
                    {(series.phase === 'done' || series.phase === 'failed') &&
                    controller.canDismissSeries() ? (
                      <IconButton
                        aria-label={t('core:video_publisher.actions.dismiss')}
                        disabled={series.removal === 'removing'}
                        onClick={() => controller.dismissSeries()}
                        size="small"
                      >
                        <CloseRoundedIcon fontSize="small" />
                      </IconButton>
                    ) : null}
                  </Box>
                  <Typography
                    sx={{
                      color:
                        series.phase === 'failed'
                          ? theme.palette.error.main
                          : theme.palette.text.secondary,
                      fontSize: '0.78rem',
                    }}
                  >
                    {series.phase === 'failed'
                      ? t(errorMessageKey(series.error?.code))
                      : series.awaitingApproval
                        ? t('core:video_publisher.status.awaiting_approval')
                        : t(
                            `core:video_publisher.series_result.${series.phase}`
                          )}
                  </Typography>
                  {seriesMissingEpisodes ? (
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 1,
                      }}
                    >
                      <Typography
                        sx={{
                          color: theme.palette.warning.main,
                          fontSize: '0.76rem',
                        }}
                      >
                        {t('core:video_publisher.series_result.missing', {
                          count: seriesMissingEpisodes,
                        })}
                      </Typography>
                      {/* Only with an episode up (and not removed since):
                      else there's no series yet. */}
                      {inRun.some(
                        (item) => item.phase === 'done' && !item.removal
                      ) ? (
                        <Button
                          onClick={() =>
                            controller.publishSeriesWithoutFailed()
                          }
                          size="small"
                          sx={{ textTransform: 'none' }}
                          variant="outlined"
                        >
                          {t(
                            'core:video_publisher.series_result.publish_without'
                          )}
                        </Button>
                      ) : null}
                    </Box>
                  ) : null}
                  {/* Not once a Remove started: it would list what went. */}
                  {series.phase === 'failed' && !series.removal ? (
                    <Button
                      onClick={() => controller.retrySeries()}
                      size="small"
                      startIcon={<ReplayRoundedIcon />}
                      sx={{ justifySelf: 'start', textTransform: 'none' }}
                      variant="outlined"
                    >
                      {t('core:video_publisher.actions.retry')}
                    </Button>
                  ) : null}
                  {series.record ? (
                    <PublishedActions
                      canRemove={
                        account.name === series.record.name &&
                        !controller.removalBlocked('series')
                      }
                      onRemove={() =>
                        void controller.removePublished('series', account)
                      }
                      quote={quote}
                      record={series.record}
                      removal={series.removal}
                      removalCount={controller.removalCount(series.record)}
                      removalLeft={controller.removalLeftOf('series')}
                      removalError={series.removalError}
                    />
                  ) : null}
                </Box>
              ) : null}
              <Box
                aria-label={t('core:video_publisher.queue.list')}
                component="ul"
                sx={{ display: 'grid', gap: 0.75, m: 0, p: 0 }}
              >
                {cards}
              </Box>
              {/* Under the list, so the cards don't move when it shows. */}
              {leftOut.length ? (
                <Alert
                  onClose={() => setLeftOut([])}
                  ref={leftOutRef}
                  severity="info"
                  sx={WINDOW_ALERT_SX}
                >
                  {leftOutText(t, locale, leftOut)}
                </Alert>
              ) : null}
              <PublishedList
                account={account}
                controller={controller}
                entries={published}
              />
            </Box>

            <Box data-column="settings" sx={settingsPaneSx}>
              <DestinationPicker
                disabled={locked}
                onChange={(next) => controller.setDestination(next)}
                value={destination}
              />
              <FormatSteps
                av1={encoder?.av1 === true}
                disabled={locked}
                onChange={(next) => controller.updateSettings({ codec: next })}
                slowPcThreads={
                  encoder?.av1 &&
                  settings.codec === null &&
                  encoder.cpuThreads < AV1_MIN_THREADS
                    ? encoder.cpuThreads
                    : null
                }
                value={codec}
              />
              <QualitySteps
                choices={qualityChoices}
                disabled={locked}
                onChange={(quality) => controller.updateSettings({ quality })}
                steppedDownCount={steppedDownCount}
                value={shownWindowQuality(qualityChoices, settings.quality)}
              />
              {isSeries ? (
                <SeriesForm
                  controller={controller}
                  disabled={locked}
                  firstEpisode={posterEpisode}
                  missing={seriesMissing}
                  series={settings.series}
                />
              ) : items.length > 1 ? (
                <SharedFieldsForm
                  destination={destination}
                  disabled={locked}
                  missing={sharedMissing}
                  onChange={(change) =>
                    controller.updateSettings((current) => ({
                      shared: { ...current.shared, ...change },
                    }))
                  }
                  shared={settings.shared}
                />
              ) : null}
            </Box>

            <Box data-column="actions" sx={actionsSx}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={settings.reviewFirst}
                    disabled={locked}
                    onChange={(_event, reviewFirst) =>
                      controller.updateSettings({ reviewFirst })
                    }
                    size="small"
                  />
                }
                label={
                  <Box>
                    <Typography sx={{ fontSize: '0.82rem', fontWeight: 600 }}>
                      {t('core:video_publisher.review.check_first')}
                    </Typography>
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '0.72rem',
                      }}
                    >
                      {t('core:video_publisher.review.check_first_desc')}
                    </Typography>
                  </Box>
                }
                sx={{
                  alignItems: 'flex-start',
                  m: 0,
                  '& .MuiCheckbox-root': { mt: -0.5 },
                }}
              />
              {run.stoppedBy && !run.active ? (
                <Alert severity="error" sx={WINDOW_ALERT_SX}>
                  <strong>{t('core:video_publisher.run.stopped')}</strong>{' '}
                  {t(errorMessageKey(run.stoppedBy))}
                </Alert>
              ) : null}
              {needsName && ready.length ? (
                <Alert severity="warning" sx={WINDOW_ALERT_SX}>
                  {t('core:video_publisher.run.needs_name')}
                </Alert>
              ) : null}
              {!needsName && (readyMissing.length || seriesMissing.length) ? (
                <Typography
                  sx={{
                    ...calloutSx(theme, theme.palette.warning.main),
                    fontSize: '0.76rem',
                    lineHeight: 1.45,
                  }}
                >
                  <WarningAmberRoundedIcon
                    aria-hidden
                    sx={{
                      color: theme.palette.warning.main,
                      flexShrink: 0,
                      fontSize: '1rem',
                      mt: '1px',
                    }}
                  />
                  <span>{t('core:video_publisher.run.needs_fields')}</span>
                </Typography>
              ) : null}
              {run.active ? (
                <Box
                  aria-label={t('core:video_publisher.run.progress_label')}
                  role="group"
                  sx={{ display: 'grid', gap: 0.75 }}
                >
                  {/* Counts only: each video's % and time left are on its
                      card, the one place they show. */}
                  <Box
                    sx={{
                      columnGap: 1.5,
                      display: 'flex',
                      flexWrap: 'wrap',
                      fontSize: '0.84rem',
                      fontWeight: 600,
                    }}
                  >
                    <span>
                      {t('core:video_publisher.run.converted', {
                        done: convertedCount,
                        total: inRun.length,
                      })}
                    </span>
                    {publishedInRun.length ? (
                      <span>
                        {t('core:video_publisher.run.published', {
                          done: doneOf(publishedInRun),
                          total: publishedInRun.length,
                        })}
                      </span>
                    ) : null}
                    {savedInRun.length ? (
                      <span>
                        {t('core:video_publisher.run.saved', {
                          done: doneOf(savedInRun),
                          total: savedInRun.length,
                        })}
                      </span>
                    ) : null}
                  </Box>
                  {checkCount ? (
                    <Typography
                      sx={{
                        color: theme.palette.primary.main,
                        fontSize: '0.78rem',
                        fontWeight: 600,
                      }}
                    >
                      {t('core:video_publisher.run.waiting_check', {
                        n: checkCount,
                      })}
                    </Typography>
                  ) : null}
                  {run.waitingForChecks ? (
                    <Typography
                      role="status"
                      sx={{
                        color: theme.palette.warning.main,
                        fontSize: '0.74rem',
                      }}
                    >
                      {t('core:video_publisher.review.waiting_converted')}
                    </Typography>
                  ) : null}
                  {publishedInRun.length ? (
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '0.72rem',
                      }}
                    >
                      {t('core:video_publisher.run.keep_running')}
                    </Typography>
                  ) : null}
                  <Button
                    color="inherit"
                    onClick={() => void controller.cancelAll()}
                    size="small"
                    sx={{ justifySelf: 'start', textTransform: 'none' }}
                    variant="outlined"
                  >
                    {t('core:video_publisher.actions.cancel_all')}
                  </Button>
                </Box>
              ) : null}
              {/* Always there: during a run, what's published now goes in
                  it, to the app chosen now. */}
              {allReady.length || !run.active ? (
                <Tooltip
                  title={
                    !canPublish && ready.length
                      ? needsName
                        ? t('core:video_publisher.run.needs_name')
                        : cannotJoin
                          ? t('core:video_publisher.run.series_after')
                          : seriesOwed
                            ? t('core:video_publisher.run.series_first')
                            : t('core:video_publisher.run.needs_fields')
                      : ''
                  }
                >
                  <span>
                    <Button
                      disabled={!canPublish}
                      fullWidth
                      // Converting starts now; each video asks for approval,
                      // with its fee, right before it goes up.
                      onClick={(event) => {
                        // The second click of a double click isn't another
                        // Publish: by then the button stands for the videos
                        // left, an unticked one among them.
                        if (event.detail > 1) return;
                        controller.start(account, readyIds);
                      }}
                      size="large"
                      startIcon={
                        run.active ? (
                          <PlaylistAddRoundedIcon />
                        ) : settings.reviewFirst ? (
                          <MovieFilterRoundedIcon />
                        ) : (
                          <CloudUploadRoundedIcon />
                        )
                      }
                      sx={{ fontWeight: 700, textTransform: 'none' }}
                      variant="contained"
                    >
                      {startLabel}
                    </Button>
                  </span>
                </Tooltip>
              ) : null}
              {tickable ? (
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: '0.72rem',
                  }}
                >
                  {t('core:video_publisher.run.ticked', {
                    n: ready.length,
                    total: allReady.length,
                  })}
                </Typography>
              ) : null}
              {run.active && allReady.length && !cannotJoin ? (
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: '0.72rem',
                  }}
                >
                  {t('core:video_publisher.run.join_hint')}
                </Typography>
              ) : null}
              {/* Save to this PC says what it does under its button up top. */}
              {isSave ? null : (
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: '0.72rem',
                  }}
                >
                  {`${limitLine} ${t('core:video_publisher.run.approval_note')}`}
                </Typography>
              )}
            </Box>
          </Box>
        )}
      </Box>
    </ThemeProvider>
  );
};
