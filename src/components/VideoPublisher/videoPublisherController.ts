/**
 * Runs the Video publisher's queue outside React, so a run carries on while
 * Home is left (its state is in Jotai's default store, videoPublisherAtoms).
 *
 * One go: conversion and publishing are a pipeline. The engine converts one
 * video at a time; while it does, the video converted before it uploads, in
 * queue order: its VIDEO (or FILE), then its subtitles, then its listing. A
 * Subscreen series' playlist goes last, once its episodes are up. With
 * "Let me check each video first", a converted video waits for the user.
 */
import { getDefaultStore } from 'jotai';
import { userInfoAtom } from '../../atoms/global';
import type {
  VideoCodec,
  VideoJobSpec,
  VideoJobState,
  VideoJobSubtitle,
  VideoPickRequest,
  VideoSource,
  VideoToolBridge,
} from '../../../electron/src/video-tool-types';
import {
  MAX_SIZE_PUBLIC_NODE,
  MAX_SIZE_PUBLISH,
} from '../../constants/constants';
import {
  buildQshareVideo,
  buildQtubeVideo,
  buildRemovalSteps,
  buildSubscreenEpisode,
  buildSubscreenFilm,
  buildSubscreenPlaylist,
  buildTorqVideoPost,
  checkPublishBalance,
  type ConvertedVideo,
  createJobFileReference,
  estimatePublishFee,
  findSubscreenPerson,
  makeCover,
  makeExtracts,
  makeQshareThumbnail,
  normalizeLanguage,
  normalizePersonName,
  planSubscreenCredits,
  type PublishedRecord,
  type PublishStep,
  qtubeVideoLink,
  qtubeVideoTarget,
  runPublishSteps,
  type SubscreenCredit,
  type SubscreenCreditsPlan,
  type SubscreenEpisodePlan,
  type SubscreenPersonRef,
  type SubscreenSeriesInfo,
  type SubscreenTitleRef,
  type SubtitleTrack,
  sortEpisodes,
  subscreenSeriesRecord,
  videoFileName,
  videoToolBridge,
  waitForPublishSlot,
} from '../../lib/videoPublisher';
import { isRunningGateway } from '../../qortal/qortal-requests';
import {
  canDismissPublished,
  type PublishedEntry,
  type PublishedKind,
  readPublishedHistory,
  upsertEntry,
  writePublishedHistory,
} from './publishedHistory';
import {
  VIDEO_PUBLISHER_DEFAULT_SETTINGS,
  VIDEO_PUBLISHER_IDLE_RUN,
  videoEncoderAtom,
  videoNodeLimitAtom,
  videoPublishedAtom,
  videoPublisherSettingsAtom,
  videoQueueAtom,
  videoRunAtom,
} from './videoPublisherAtoms';
import { errorCodeOf } from './videoPublisherErrors';
import {
  type PublishApprovalRequest,
  requestPublishApproval,
} from './publishApproval';

/**
 * AV1 from this many logical processors up: with 16, SVT-AV1 (preset 8)
 * converted as fast as x264 (2026-11-16); with fewer it falls behind.
 */
export const AV1_MIN_THREADS = 8;
import { effectiveQuality, qualityOptions } from './qualityOptions';
import {
  chosenSubtitles,
  effectiveFields,
  folderOf,
  initialFields,
  isAudioFileName,
  isClearable,
  looksLikeSeries,
  matchSubtitleToVideo,
  missingFields,
  savedFileName,
  shortOutput,
  subtitleFromFile,
  subtitlesFromProbe,
  suggestedSeries,
} from './queueHelpers';
import type {
  CoverChoice,
  ItemError,
  ItemErrorStage,
  LeftOutFile,
  QueueItem,
  RunContext,
  SeriesFields,
  VideoDestination,
  VideoEncoderInfo,
  VideoPublisherSettings,
  VideoRunState,
} from './videoPublisherTypes';

type Store = ReturnType<typeof getDefaultStore>;

export type VideoPublisherDeps = {
  store: Store;
  /**
   * Hub's own approval (the window Q-Apps get), right before a video goes
   * up: its resources and fee; true when accepted.
   */
  requestApproval: (request: PublishApprovalRequest) => Promise<boolean>;
  bridge: () => VideoToolBridge | undefined;
  runPublishSteps: typeof runPublishSteps;
  waitForPublishSlot: typeof waitForPublishSlot;
  estimatePublishFee: typeof estimatePublishFee;
  checkPublishBalance: typeof checkPublishBalance;
  isPublicNode: () => Promise<boolean>;
  makeCover: typeof makeCover;
  makeExtracts: typeof makeExtracts;
  makeQshareThumbnail: typeof makeQshareThumbnail;
  /**
   * A person Subscreen already knows, by name (any publisher's), for a
   * title's cast & crew: pointed at, not published again. Null: a new one.
   */
  findSubscreenPerson: (
    displayName: string,
    signal?: AbortSignal
  ) => Promise<SubscreenPersonRef | null>;
};

/** The account a run publishes as. */
export type PublishAccount = {
  name: string | null;
  publicKey: string | null;
  /** The signed-in address: a run stops when another account signs in. */
  address?: string | null;
};

/** Save to this PC isn't held to the node's limit, only to this. */
export const SAVE_SIZE_LIMIT_BYTES = 64 * 1024 * 1024 * 1024;

/**
 * Converted videos waiting their turn to upload, at most: the next
 * conversion starts once the one before has begun uploading, so only a few
 * converted files are on disk at a time.
 */
const CONVERTED_AHEAD = 1;
/**
 * Converted videos not yet uploading (waiting for the user's check, or their
 * turn), at most: with "Let me check each video first" the next videos keep
 * converting while earlier ones wait, up to this many files on disk.
 */
export const MAX_CONVERTED_HELD = 3;
/** Frames offered as covers, and their width. */
const PICKER_FRAME_COUNT = 6;
const PICKER_FRAME_WIDTH = 480;
const COVER_FRAME_WIDTH = 1200;
const THUMBNAIL_WIDTH = 160;

const TERMINAL_JOB_PHASES = new Set(['done', 'failed', 'cancelled']);

/** Subtitle edits on a converted video are written once typing stops. */
const SUBTITLE_REWRITE_DELAY_MS = 400;

/**
 * The subtitles a video's job writes. Save to this PC keeps the MP4 alone
 * (saveOutput): text subtitles aren't written for it, only a burned-in
 * picture track stays.
 */
export function jobSubtitles(
  item: QueueItem,
  destination: VideoDestination
): VideoJobSubtitle[] {
  return (destination === 'save' ? [] : chosenSubtitles(item.subtitles)).map(
    (track) =>
      track.source === 'stream'
        ? {
            source: 'stream' as const,
            index: track.streamIndex,
            language: track.language,
            ...(track.label ? { label: track.label } : {}),
          }
        : {
            source: 'file' as const,
            sourceId: track.sourceId,
            language: track.language,
            ...(track.label ? { label: track.label } : {}),
          }
  );
}

/** One subtitle list as a comparable key. */
export const subtitlesKey = (subtitles: readonly VideoJobSubtitle[]) =>
  JSON.stringify(subtitles);

/** Converted, on disk, and not uploading yet: waiting for the user or its turn. */
const isHeldConverted = (item: QueueItem) =>
  item.phase === 'review' ||
  (item.phase === 'converted' && item.saved !== false);

/** In a run: converting, waiting its turn, waiting for the user, uploading. */
const isPending = (item: QueueItem) =>
  item.phase === 'waiting' ||
  item.phase === 'converting' ||
  item.phase === 'review' ||
  item.phase === 'publishing' ||
  item.phase === 'saving' ||
  (item.phase === 'converted' && item.saved !== false);

type ItemPlan = {
  steps: PublishStep[];
  record: PublishedRecord;
  /** Keys that went through: a retry skips them. */
  completed: Set<string>;
  episode?: SubscreenEpisodePlan;
  /** A Subscreen film's cast & crew: its new people, then its credits. */
  credits?: SubscreenCreditsPlan;
  /** The run it was built for: a retry publishes there again. */
  context: RunContext;
};

type SeriesRunState = {
  info?: SubscreenSeriesInfo;
  playlistIdentifier?: string;
  /** Publish the playlist without the episodes that failed. */
  allowPartial?: boolean;
  /** Stops the playlist's publish (an account switch). */
  abort?: AbortController;
  /**
   * The series' cast & crew, planned once (null: none), so a retry sends
   * the same people, not new ones.
   */
  credits?: SubscreenCreditsPlan | null;
  /** Its steps that went up (playlist, people, credits): a retry skips them. */
  sent?: Set<string>;
  /** The playlist as it went up: sent again only once it changes. */
  sentPlaylist?: string;
};

/** What an entry of the published list is, by the run's destination. */
const publishedKind = (destination: VideoDestination): PublishedKind => {
  switch (destination) {
    case 'subscreen-film':
      return 'film';
    case 'subscreen-series':
      return 'episode';
    case 'torq':
      return 'torq';
    case 'qshare':
      return 'qshare';
    default:
      return 'qtube';
  }
};

const itemEntryId = (itemId: string) => `item:${itemId}`;

/** Removal steps' keys come from the resources alone, wherever it starts. */
const REMOVAL_KEY = 'remove';

let nextItemId = 0;
const newItemId = () => `video-${Date.now().toString(36)}-${(nextItemId += 1)}`;

export class VideoPublisherController {
  private readonly deps: VideoPublisherDeps;
  private readonly plans = new Map<string, ItemPlan>();
  private readonly specs = new Map<string, VideoJobSpec>();
  /** Subtitles being written again, and edits waiting to be. */
  private readonly subtitleSyncs = new Map<string, Promise<void>>();
  private readonly subtitleTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly aborts = new Map<string, AbortController>();
  private readonly removalDone = new Map<string, Set<string>>();
  private readonly jobStates = new Map<string, VideoJobState>();
  private readonly jobWaiters = new Map<
    string,
    (state: VideoJobState) => void
  >();
  private series: SeriesRunState = {};
  /** The videos of the current run (a series' episodes). */
  private readonly runIds = new Set<string>();
  private unsubscribeJobs: (() => void) | null = null;
  private pumping = false;
  private wakers: (() => void)[] = [];
  /** Something changed since the pipeline last looked (it looks again). */
  private changed = false;
  /** A video was moved by hand: a suggested series doesn't sort them again. */
  private movedByHand = false;
  private runCount = 0;
  /** The signed-in address the queue belongs to. */
  private address: string | null;
  private readonly unsubscribeAccount: () => void;

  constructor(deps: Partial<VideoPublisherDeps> = {}) {
    this.deps = {
      store: getDefaultStore(),
      bridge: videoToolBridge,
      runPublishSteps,
      waitForPublishSlot,
      estimatePublishFee,
      checkPublishBalance,
      isPublicNode: isRunningGateway,
      makeCover,
      makeExtracts,
      makeQshareThumbnail,
      requestApproval: requestPublishApproval,
      findSubscreenPerson: (displayName, signal) =>
        findSubscreenPerson(displayName, { signal }),
      ...deps,
    };
    this.address = this.signedInAddress();
    this.loadHistory();
    // The queue, its run and its records are the signed-in account's: a
    // sign-out or another account ends them.
    this.unsubscribeAccount = this.deps.store.sub(userInfoAtom, () => {
      const address = this.signedInAddress();
      if (address === this.address) return;
      this.address = address;
      void this.resetForAccount();
    });
  }

  private signedInAddress(): string | null {
    const address = this.deps.store.get(userInfoAtom)?.address;
    return typeof address === 'string' && address ? address : null;
  }

  /** The run an item went into (else the current one). */
  private contextOf(item: QueueItem | undefined): RunContext | null {
    return item?.context ?? this.run.context;
  }

  private inCurrentRun(item: QueueItem | undefined): boolean {
    const current = this.run.context;
    return Boolean(item && current && item.context?.id === current.id);
  }

  /** Nothing is published as an account other than the run's own. */
  private accountMatches(context: RunContext | null): boolean {
    return !context?.address || context.address === this.signedInAddress();
  }

  /**
   * A done or partly published episode the series' playlist still has to
   * take in: it stays on the list (and keeps its own Remove) until then.
   */
  isHeldBySeries(item: QueueItem): boolean {
    const { series } = this.run;
    return Boolean(
      series &&
      series.phase !== 'done' &&
      this.runIds.has(item.id) &&
      // Removed from the app: the playlist won't take it in.
      item.removal !== 'removed' &&
      (item.phase === 'done' || item.record)
    );
  }

  /**
   * Whether the run's series still has work in hand: an episode converting,
   * waiting or going up, or its playlist going up.
   */
  seriesBusy(): boolean {
    const { context, series } = this.run;
    if (context?.destination !== 'subscreen-series' || !series) return false;
    return (
      series.phase === 'publishing' ||
      this.items.some((item) => this.runIds.has(item.id) && isPending(item))
    );
  }

  /**
   * Whether the run's series still owes its playlist to an episode that went
   * up. Another run would drop the series, so none starts until its playlist
   * is published or its card is closed.
   */
  seriesOwesPlaylist(): boolean {
    const { context, series } = this.run;
    if (context?.destination !== 'subscreen-series' || !series) return false;
    if (series.phase === 'done' || series.removal) return false;
    return this.items.some(
      (item) =>
        this.runIds.has(item.id) && item.phase === 'done' && !item.removal
    );
  }

  /**
   * Another account signed in (or none): what was running stops, and the
   * queue, the run and the settings start afresh. Jobs and sources go.
   */
  private async resetForAccount(): Promise<void> {
    const items = this.items;
    this.aborts.forEach((abort) => abort.abort());
    this.aborts.clear();
    this.series.abort?.abort();
    this.plans.clear();
    this.specs.clear();
    this.runIds.clear();
    this.removalDone.clear();
    this.series = {};
    this.movedByHand = false;
    this.deps.store.set(videoQueueAtom, []);
    this.deps.store.set(videoRunAtom, VIDEO_PUBLISHER_IDLE_RUN);
    this.deps.store.set(
      videoPublisherSettingsAtom,
      VIDEO_PUBLISHER_DEFAULT_SETTINGS
    );
    // The published list is the new account's own.
    this.loadHistory();
    // Conversions waiting on their job's end stop waiting.
    const waiters = [...this.jobWaiters.entries()];
    this.jobWaiters.clear();
    waiters.forEach(([jobId, wake]) =>
      wake({ jobId, phase: 'cancelled' } as VideoJobState)
    );
    this.notify();
    const bridge = this.deps.bridge();
    if (!bridge) return;
    for (const item of items) {
      if (item.jobId) {
        await bridge.cancelJob(item.jobId).catch(() => {});
        await bridge.releaseJob(item.jobId).catch(() => {});
      }
      await bridge.forgetSource(item.source.id).catch(() => {});
      for (const track of item.subtitles) {
        if (track.sourceId) {
          await bridge.forgetSource(track.sourceId).catch(() => {});
        }
      }
    }
  }

  // --- State ---------------------------------------------------------------

  get items(): QueueItem[] {
    return this.deps.store.get(videoQueueAtom);
  }

  get settings(): VideoPublisherSettings {
    return this.deps.store.get(videoPublisherSettingsAtom);
  }

  get run(): VideoRunState {
    return this.deps.store.get(videoRunAtom);
  }

  /** This account's published videos, newest first. */
  get published(): PublishedEntry[] {
    return this.deps.store.get(videoPublishedAtom);
  }

  private loadHistory() {
    this.deps.store.set(videoPublishedAtom, readPublishedHistory(this.address));
  }

  /**
   * Changes `address`'s list (the signed-in account's by default). Another
   * account's is changed where it's kept: a run's uploads are written under
   * the account that ran it, even after a switch.
   */
  private changeHistory(
    change: (entries: PublishedEntry[]) => PublishedEntry[],
    address: string | null = this.address
  ) {
    if (address !== this.address) {
      writePublishedHistory(address, change(readPublishedHistory(address)));
      return;
    }
    const next = change(this.published);
    this.deps.store.set(videoPublishedAtom, next);
    writePublishedHistory(address, next);
  }

  /** The account whose list a run's uploads go on. */
  private historyAddress(context: RunContext): string | null {
    return context.address || this.address;
  }

  /**
   * Changes an entry of `address`'s list (the signed-in account's by
   * default): a removal that ends after a switch is kept on its own account.
   */
  private setEntry(
    entryId: string | undefined,
    change: Partial<PublishedEntry>,
    address: string | null = this.address
  ) {
    if (!entryId) return;
    if (
      address === this.address &&
      !this.published.some((entry) => entry.id === entryId)
    ) {
      return;
    }
    this.changeHistory(
      (entries) =>
        entries.map((entry) =>
          entry.id === entryId ? { ...entry, ...change } : entry
        ),
      address
    );
  }

  /**
   * What a video put on QDN (all of it, or `partial`ly) goes on the list of
   * the account that ran it, whoever is signed in now.
   */
  private remember(
    itemId: string,
    record: PublishedRecord,
    context: RunContext,
    partial = false
  ) {
    this.changeHistory(
      (entries) =>
        upsertEntry(entries, {
          id: itemEntryId(itemId),
          itemId,
          kind: publishedKind(context.destination),
          record,
          publishedAt: Date.now(),
          ...(partial ? { partial: true } : {}),
        }),
      this.historyAddress(context)
    );
  }

  item(id: string): QueueItem | undefined {
    return this.items.find((entry) => entry.id === id);
  }

  updateItem(
    id: string,
    change: Partial<QueueItem> | ((item: QueueItem) => Partial<QueueItem>)
  ) {
    this.deps.store.set(videoQueueAtom, (items) =>
      items.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              ...(typeof change === 'function' ? change(entry) : change),
            }
          : entry
      )
    );
    this.notify();
  }

  updateSettings(
    change:
      | Partial<VideoPublisherSettings>
      | ((current: VideoPublisherSettings) => Partial<VideoPublisherSettings>)
  ) {
    this.deps.store.set(videoPublisherSettingsAtom, (current) => ({
      ...current,
      ...(typeof change === 'function' ? change(current) : change),
    }));
  }

  private setRun(change: Partial<VideoRunState>) {
    this.deps.store.set(videoRunAtom, (current) => ({ ...current, ...change }));
    this.notify();
  }

  /** Changes the run's series; a run without one is left as it is. */
  private setSeries(change: Partial<NonNullable<VideoRunState['series']>>) {
    this.deps.store.set(videoRunAtom, (current) =>
      current.series
        ? { ...current, series: { ...current.series, ...change } }
        : current
    );
    this.notify();
  }

  private fail(id: string, code: string, stage: ItemErrorStage) {
    const error: ItemError = { code, stage };
    this.updateItem(id, {
      phase: 'failed',
      error,
      publish: undefined,
      waitingForSlot: undefined,
    });
  }

  /** Wakes the pipeline: something changed. */
  private notify() {
    this.changed = true;
    const wakers = this.wakers;
    this.wakers = [];
    wakers.forEach((wake) => wake());
  }

  private nextChange(): Promise<void> {
    return new Promise((resolve) => this.wakers.push(resolve));
  }

  // --- The node's limit ----------------------------------------------------

  async loadNodeLimit(): Promise<void> {
    let publicNode = true;
    try {
      publicNode = await this.deps.isPublicNode();
    } catch {
      // Counted as a public node: the smaller limit is the safe one.
    }
    this.deps.store.set(videoNodeLimitAtom, {
      bytes: publicNode ? MAX_SIZE_PUBLIC_NODE : MAX_SIZE_PUBLISH,
      publicNode,
    });
  }

  /** What the converter can do (its status): AV1, and the PC's threads. */
  setEncoderInfo(info: VideoEncoderInfo | null): void {
    this.deps.store.set(videoEncoderAtom, info);
  }

  /**
   * The picture format new conversions use: the user's choice, else AV1 on
   * a PC with AV1_MIN_THREADS or more (it converts as fast as H.264 there),
   * else H.264. Never AV1 when this Hub can't write it.
   */
  codec(): VideoCodec {
    const encoder = this.deps.store.get(videoEncoderAtom);
    if (!encoder?.av1) return 'h264';
    return (
      this.settings.codec ??
      (encoder.cpuThreads >= AV1_MIN_THREADS ? 'av1' : 'h264')
    );
  }

  sizeLimitFor(destination: VideoDestination): number {
    if (destination === 'save') return SAVE_SIZE_LIMIT_BYTES;
    return (
      this.deps.store.get(videoNodeLimitAtom)?.bytes ?? MAX_SIZE_PUBLIC_NODE
    );
  }

  // --- Adding videos -------------------------------------------------------

  /**
   * Files from a drop, the file picker or a folder: videos become queue
   * items, subtitle files go with the video they're named after. Returns
   * what was neither, with why (`skipped` counts them). `relativePaths`:
   * where each file sat in a dropped folder (filesFromDrop).
   */
  async addFiles(
    files: File[],
    relativePaths?: (string | undefined)[]
  ): Promise<{ added: number; skipped: number; leftOut: LeftOutFile[] }> {
    const bridge = this.deps.bridge();
    if (!bridge || !files.length) return { added: 0, skipped: 0, leftOut: [] };
    const sources = await bridge.addFiles(files, relativePaths);
    return this.takeSources(
      sources,
      files.map((file) => file.name)
    );
  }

  /** Hub's own open dialog (videos, or a folder), then as addFiles. */
  async pickFiles(
    request: VideoPickRequest
  ): Promise<{ added: number; skipped: number; leftOut: LeftOutFile[] }> {
    const bridge = this.deps.bridge();
    if (!bridge?.pickFiles) return { added: 0, skipped: 0, leftOut: [] };
    return this.takeSources(await bridge.pickFiles(request), null);
  }

  /** Whether Hub's own open dialog is there (an older main lacks it). */
  canPickFiles(): boolean {
    return Boolean(this.deps.bridge()?.pickFiles);
  }

  /**
   * Sources main took: videos queued, subtitles matched to them, the rest
   * left out. `picked` names the files asked for, so those main didn't take
   * are named too (none for main's own dialog: it took all it found).
   */
  private async takeSources(
    sources: VideoSource[],
    picked: string[] | null
  ): Promise<{ added: number; skipped: number; leftOut: LeftOutFile[] }> {
    const bridge = this.deps.bridge();
    if (!bridge) return { added: 0, skipped: 0, leftOut: [] };
    const videos = sources.filter((source) => source.kind === 'video');
    const subtitles = sources.filter((source) => source.kind === 'subtitle');
    const others = sources.filter((source) => source.kind === 'other');
    const otherReason = (name: string): LeftOutFile =>
      isAudioFileName(name)
        ? { name, reason: 'audio' }
        : { name, reason: 'other' };
    const leftOut: LeftOutFile[] = others.map((source) =>
      otherReason(source.name)
    );
    // Files the bridge didn't take (no path on disk): named all the same.
    const returned = sources.map((source) => source.name);
    for (const name of picked ?? []) {
      const at = returned.indexOf(name);
      if (at >= 0) returned.splice(at, 1);
      else leftOut.push(otherReason(name));
    }
    others.forEach(
      (source) => void bridge.forgetSource(source.id).catch(() => {})
    );

    const added: QueueItem[] = videos.map((source) => ({
      id: newItemId(),
      source,
      subtitles: [],
      fields: initialFields(source),
      phase: 'probing',
    }));
    // A subtitle goes with the video it's named after, added with it or
    // already queued (those added win a tie). A queued video can still take
    // one only before its run: a video in a run was planned without it.
    const takers = this.items.filter(
      (item) => item.phase === 'ready' || item.phase === 'probing'
    );
    const takes = new Set([...added, ...takers].map((item) => item.id));
    const candidates = [...added, ...this.items].map((item) => ({
      id: item.id,
      name: item.source.name,
      folder: folderOf(item.source.relativePath),
    }));
    // Named after none: the one video added with it (or, for subtitles
    // alone, the one queued video that can take it).
    const lone = added.length ? added : takers;
    const attached = new Map<string, VideoSource[]>();
    for (const subtitle of subtitles) {
      const target =
        matchSubtitleToVideo(
          subtitle.name,
          candidates,
          folderOf(subtitle.relativePath),
          false
        ) ?? (lone.length === 1 ? lone[0].id : null);
      if (!target || !takes.has(target)) {
        leftOut.push({ name: subtitle.name, reason: 'subtitle' });
        void bridge.forgetSource(subtitle.id).catch(() => {});
        continue;
      }
      attached.set(target, [...(attached.get(target) ?? []), subtitle]);
    }
    this.deps.store.set(videoQueueAtom, (items) => [
      ...items.map((item) =>
        attached.has(item.id)
          ? {
              ...item,
              subtitles: [
                ...item.subtitles,
                ...attached.get(item.id).map(subtitleFromFile),
              ],
            }
          : item
      ),
      ...added.map((item) => ({
        ...item,
        subtitles: (attached.get(item.id) ?? []).map(subtitleFromFile),
      })),
    ]);
    if (added.length) this.suggestDestination();

    await Promise.all(added.map((item) => this.probe(item.id)));
    return { added: added.length, skipped: leftOut.length, leftOut };
  }

  /** Subtitle files picked for one video. */
  async addSubtitleFiles(itemId: string, files: File[]): Promise<number> {
    const bridge = this.deps.bridge();
    if (!bridge || !files.length) return 0;
    const sources = await bridge.addFiles(files);
    const subtitles = sources.filter((source) => source.kind === 'subtitle');
    sources
      .filter((source) => source.kind !== 'subtitle')
      .forEach((source) => void bridge.forgetSource(source.id).catch(() => {}));
    this.updateItem(itemId, (item) => ({
      subtitles: [
        ...item.subtitles,
        ...subtitles
          .filter(
            (source) =>
              !item.subtitles.some((track) => track.sourceId === source.id)
          )
          .map(subtitleFromFile),
      ],
    }));
    if (subtitles.length) this.subtitlesChanged(itemId);
    return subtitles.length;
  }

  private async probe(id: string) {
    const item = this.item(id);
    const bridge = this.deps.bridge();
    if (!item || !bridge) return;
    this.updateItem(id, { phase: 'probing', error: undefined });
    try {
      const probe = await bridge.probe(item.source.id);
      this.updateItem(id, (current) => ({
        probe,
        phase: 'ready',
        subtitles: [
          ...subtitlesFromProbe(probe),
          ...current.subtitles.filter((track) => track.source === 'file'),
        ],
      }));
      void this.loadThumbnail(id);
    } catch (error) {
      this.updateItem(id, {
        phase: 'unusable',
        error: { code: errorCodeOf(error), stage: 'probe' },
      });
    }
  }

  /** One small frame for the card; the card keeps its icon without it. */
  private async loadThumbnail(id: string) {
    const item = this.item(id);
    const bridge = this.deps.bridge();
    if (!item || !bridge) return;
    try {
      const [frame] = await bridge.frames(
        { sourceId: item.source.id },
        { count: 1, width: THUMBNAIL_WIDTH }
      );
      if (frame?.dataUrl) this.updateItem(id, { thumbnail: frame.dataUrl });
    } catch {
      // A frame can't be taken (an odd file): the icon stays.
    }
  }

  /** Episodes picked together suggest a Subscreen series. */
  private suggestDestination() {
    const sources = this.items.map((item) => item.source);
    const { destinationChosen, series } = this.settings;
    if (destinationChosen || !looksLikeSeries(sources)) return;
    this.updateSettings({
      destination: 'subscreen-series',
      series: { ...series, ...this.seriesPrefill(series) },
    });
    // An order set by hand stays (the series form's Sort sorts again).
    if (!this.movedByHand) this.sortEpisodes();
  }

  private seriesPrefill(series: SeriesFields): Partial<SeriesFields> {
    const suggested = suggestedSeries(this.items.map((item) => item.source));
    return {
      ...(series.title.trim() || !suggested.title
        ? {}
        : { title: suggested.title }),
      ...(series.year == null && suggested.year
        ? { year: suggested.year }
        : {}),
    };
  }

  /** The destination the user picked. A series sorts its episodes. */
  setDestination(destination: VideoDestination) {
    this.updateSettings((current) => ({
      destination,
      destinationChosen: true,
      ...(destination === 'subscreen-series'
        ? {
            series: {
              ...current.series,
              ...this.seriesPrefill(current.series),
            },
          }
        : {}),
    }));
    if (destination === 'subscreen-series') this.sortEpisodes();
  }

  /** Episodes in watching order: by season, then episode, then file name. */
  sortEpisodes() {
    this.movedByHand = false;
    this.deps.store.set(videoQueueAtom, (items) =>
      sortEpisodes(
        items.map((item) => ({
          item,
          season: item.fields.season,
          episode: item.fields.episode,
          fileName: item.source.relativePath || item.source.name,
        }))
      ).map((entry) => entry.item)
    );
  }

  moveItem(id: string, offset: -1 | 1) {
    this.deps.store.set(videoQueueAtom, (items) => {
      const from = items.findIndex((item) => item.id === id);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= items.length) return items;
      const next = [...items];
      [next[from], next[to]] = [next[to], next[from]];
      this.movedByHand = true;
      return next;
    });
  }

  /** Moments of the video to pick a cover from. */
  async loadFrames(id: string): Promise<void> {
    const item = this.item(id);
    const bridge = this.deps.bridge();
    if (!item || !bridge || item.framesState === 'loading') return;
    if (item.framesState === 'ready') return;
    this.updateItem(id, { framesState: 'loading' });
    try {
      const frames = await bridge.frames(
        { sourceId: item.source.id },
        { count: PICKER_FRAME_COUNT, width: PICKER_FRAME_WIDTH }
      );
      this.updateItem(id, { frames, framesState: 'ready' });
    } catch {
      this.updateItem(id, { framesState: 'failed' });
    }
  }

  /**
   * Takes a video off the queue, stopping what it's doing. An episode the
   * series' playlist still has to list stays (isHeldBySeries).
   */
  async removeItem(id: string): Promise<void> {
    const item = this.item(id);
    if (!item || this.isHeldBySeries(item)) return;
    await this.cancelItem(id);
    const bridge = this.deps.bridge();
    if (bridge) {
      if (item.jobId) await bridge.releaseJob(item.jobId).catch(() => {});
      await bridge.forgetSource(item.source.id).catch(() => {});
      for (const track of item.subtitles) {
        if (track.sourceId) {
          await bridge.forgetSource(track.sourceId).catch(() => {});
        }
      }
    }
    const wasInRun = this.runIds.has(id);
    this.plans.delete(id);
    this.specs.delete(id);
    this.runIds.delete(id);
    this.removalDone.delete(id);
    this.deps.store.set(videoQueueAtom, (items) =>
      items.filter((entry) => entry.id !== id)
    );
    if (!this.items.length) this.movedByHand = false;
    this.notify();
    // A series that waited for this episode: its card goes with its last
    // episode, else its playlist may go now (as with "Publish the series
    // without them": the run goes on, no longer stopped).
    if (wasInRun && this.run.series?.phase === 'waiting') {
      if (!this.items.some((entry) => this.runIds.has(entry.id))) {
        this.dismissSeries();
      } else if (this.seriesReady(this.items)) {
        this.setRun({ active: true, stoppedBy: undefined });
        void this.pump();
      }
    }
  }

  /**
   * Takes the finished videos off the list (what they published stays on
   * QDN), but not a cancelled one Retry would still publish (isClearable). A
   * published series keeps its card, for Open and Remove.
   */
  async clearFinished(): Promise<void> {
    const finished = this.items.filter(
      (item) => isClearable(item) && !this.isHeldBySeries(item)
    );
    for (const item of finished) await this.removeItem(item.id);
    const { series } = this.run;
    if (series && series.phase !== 'done' && !this.items.length) {
      this.dismissSeries();
    }
  }

  /**
   * Whether the series' card can be closed: not while an episode of it can
   * still be retried, or is on its way after a Retry (its playlist has to
   * take that episode in).
   */
  canDismissSeries(): boolean {
    return !this.items.some(
      (item) =>
        this.runIds.has(item.id) && (isPending(item) || this.canRetry(item))
    );
  }

  /** The series' card off the list. */
  dismissSeries() {
    if (!this.canDismissSeries()) return;
    this.series = {};
    this.setRun({ series: undefined });
  }

  // --- Fees ------------------------------------------------------------------

  /**
   * The fee for `count` resources and whether the balance covers it, less
   * the fees of the account's unconfirmed transactions (with its key).
   */
  async quote(
    count: number,
    address: string | null,
    publicKey?: string | null
  ): Promise<{
    unitFee: number;
    total: number;
    balance: number | null;
    enough: boolean | null;
  }> {
    const fee = await this.deps.estimatePublishFee(count);
    if (!address) {
      return {
        unitFee: fee.unitFee,
        total: fee.total,
        balance: null,
        enough: null,
      };
    }
    // As for a publish: a balance the node can't check (it can't list the
    // account's unconfirmed transactions, say) pays nothing, so this rejects.
    const { balance, enough } = await this.deps.checkPublishBalance(
      address,
      fee.total,
      publicKey
    );
    return { unitFee: fee.unitFee, total: fee.total, balance, enough };
  }

  // --- A run -----------------------------------------------------------------

  /** The engine's job for a video, with the quality it converts at. */
  private specFor(item: QueueItem, context: RunContext): VideoJobSpec | null {
    const codec = this.codec();
    const options = qualityOptions(
      item.probe,
      context.sizeLimitBytes,
      item.audioIndex,
      codec
    );
    const { quality } = effectiveQuality(
      options,
      this.settings.quality,
      item.quality
    );
    if (!quality) return null;
    return {
      sourceId: item.source.id,
      quality,
      codec,
      ...(item.audioIndex !== undefined ? { audioIndex: item.audioIndex } : {}),
      ...(item.burnSubtitleIndex != null
        ? { burnSubtitleIndex: item.burnSubtitleIndex }
        : {}),
      subtitles: jobSubtitles(item, context.destination),
      sizeLimitBytes: context.sizeLimitBytes,
    };
  }

  // --- Subtitles after the conversion started --------------------------------

  /**
   * The subtitles changed (added, taken out, another language): a video
   * whose job already wrote its files gets them written again, without
   * converting the picture. One still converting gets them when it's done;
   * publishing waits for them either way.
   */
  subtitlesChanged(id: string) {
    const item = this.item(id);
    if (!item?.jobId || !item.output) return;
    clearTimeout(this.subtitleTimers.get(id));
    this.subtitleTimers.set(
      id,
      setTimeout(() => {
        this.subtitleTimers.delete(id);
        void this.syncSubtitles(id).catch(() => {});
      }, SUBTITLE_REWRITE_DELAY_MS)
    );
  }

  /** Changes a video's subtitle choices (and writes them again if needed). */
  changeSubtitles(
    id: string,
    change: (subtitles: QueueItem['subtitles']) => QueueItem['subtitles']
  ) {
    this.updateItem(id, (item) => ({ subtitles: change(item.subtitles) }));
    this.subtitlesChanged(id);
  }

  /**
   * Writes the job's subtitles again until they're the chosen ones (they may
   * change again meanwhile). Rejects when main couldn't write them.
   */
  private syncSubtitles(id: string): Promise<void> {
    const running = this.subtitleSyncs.get(id);
    if (running) return running;
    const sync = (async () => {
      for (;;) {
        const item = this.item(id);
        const bridge = this.deps.bridge();
        if (!item?.jobId || !item.output || !bridge) return;
        const destination =
          this.contextOf(item)?.destination ?? this.settings.destination;
        const wanted = jobSubtitles(item, destination);
        const key = subtitlesKey(wanted);
        if (key === item.madeSubtitles) return;
        this.updateItem(id, { subtitlesBusy: true });
        try {
          const state = await bridge.remakeSubtitles(item.jobId, wanted);
          this.updateItem(id, (current) => ({
            output: state.output ?? current.output,
            madeSubtitles: key,
            failedSubtitles: state.output?.failedSubtitles?.length || undefined,
          }));
        } finally {
          this.updateItem(id, { subtitlesBusy: undefined });
        }
      }
    })().finally(() => this.subtitleSyncs.delete(id));
    this.subtitleSyncs.set(id, sync);
    return sync;
  }

  // --- Pausing a conversion ----------------------------------------------------

  /** Whether this Hub can pause a conversion (not on Windows). */
  canPause(): boolean {
    return Boolean(this.deps.store.get(videoEncoderAtom)?.canPause);
  }

  /**
   * Stops a video's conversion where it is, so the PC gets its power back;
   * resumeItem goes on from there. Nothing else converts meanwhile.
   */
  async pauseItem(id: string): Promise<void> {
    const item = this.item(id);
    const bridge = this.deps.bridge();
    if (item?.phase !== 'converting' || !item.jobId || !bridge) return;
    try {
      const state = await bridge.pauseJob(item.jobId);
      if (this.item(id)?.phase === 'converting') {
        this.updateItem(id, {
          paused: Boolean(state?.paused),
          etaSec: undefined,
        });
      }
    } catch {
      // Finished or cancelled meanwhile: nothing to pause.
    }
  }

  async resumeItem(id: string): Promise<void> {
    const item = this.item(id);
    const bridge = this.deps.bridge();
    if (!item?.jobId || !bridge) return;
    try {
      await bridge.resumeJob(item.jobId);
    } catch {
      // Gone meanwhile.
    }
    if (this.item(id)?.paused) this.updateItem(id, { paused: undefined });
  }

  /**
   * An untitled episode's number, as its card shows it and as it's
   * published: its place among its series' episodes (its run's), or, not in
   * a run yet, among the ready videos the next Publish takes.
   */
  episodeIndex(item: QueueItem): number {
    if (
      item.phase !== 'ready' &&
      item.context?.destination === 'subscreen-series' &&
      item.episodePlace != null
    ) {
      return item.episodePlace;
    }
    const together =
      item.phase !== 'ready' && item.context?.destination === 'subscreen-series'
        ? this.items.filter((entry) => entry.context?.id === item.context.id)
        : this.items.filter(
            (entry) =>
              entry.phase === 'ready' &&
              (!entry.unticked || entry.id === item.id)
          );
    return Math.max(
      0,
      together.findIndex((entry) => entry.id === item.id)
    );
  }

  /** Ready videos the next Publish takes: the ticked ones. */
  publishableIds(): string[] {
    return this.items
      .filter((item) => item.phase === 'ready' && !item.unticked)
      .map((item) => item.id);
  }

  /** Ticks a ready video in or out of the next Publish. */
  setTicked(id: string, ticked: boolean) {
    this.updateItem(id, { unticked: ticked ? undefined : true });
  }

  /** What videos published now go with: the window's choices, as `account`. */
  private contextFor(account: PublishAccount, id: number): RunContext {
    const { destination, reviewFirst, shared, series } = this.settings;
    const address = account.address ?? this.signedInAddress();
    return {
      id,
      destination,
      name: account.name?.trim() || null,
      publicKey: account.publicKey || null,
      address: address || null,
      sizeLimitBytes: this.sizeLimitFor(destination),
      reviewFirst,
      shared: { ...shared },
      series: { ...series },
    };
  }

  /**
   * Publish (or save) the ticked ready videos (or `ids`), as `account`, to
   * the destination chosen now. While a run goes they join it, each keeping
   * its own app. The window has checked the fields; each video asks for
   * approval, with its fee, right before it goes up.
   */
  start(account: PublishAccount, ids?: readonly string[]): void {
    if (this.run.active) {
      this.joinRun(ids ?? this.publishableIds(), account);
      return;
    }
    // A new run would drop a series still owing its playlist.
    if (this.seriesOwesPlaylist()) return;
    const context = this.contextFor(account, (this.runCount += 1));
    const { destination } = context;
    if (destination !== 'save' && !context.name) return;
    const wanted = new Set(ids ?? this.publishableIds());
    const ready = this.items.filter(
      (item) => item.phase === 'ready' && wanted.has(item.id)
    );
    if (!ready.length) return;
    // Videos of earlier runs keep their plans (and so their Retry and
    // Remove); only the ones starting now begin afresh.
    this.runIds.clear();
    this.series = {};
    // Nothing is approved yet: each video asks right before it goes up.
    for (const [place, item] of ready.entries()) {
      this.plans.delete(item.id);
      this.specs.delete(item.id);
      this.removalDone.delete(item.id);
      this.runIds.add(item.id);
      this.updateItem(item.id, {
        context,
        episodePlace: destination === 'subscreen-series' ? place : undefined,
      });
      const spec = this.specFor(item, context);
      if (!spec) {
        this.fail(item.id, 'no-quality-fits', 'convert');
        continue;
      }
      this.specs.set(item.id, spec);
      this.updateItem(item.id, {
        phase: 'waiting',
        error: undefined,
        record: undefined,
        link: undefined,
        removal: undefined,
        saved: undefined,
        savedFile: undefined,
        savedFileError: undefined,
        approved: undefined,
        unticked: undefined,
      });
    }
    this.deps.store.set(videoRunAtom, {
      active: true,
      context,
      itemIds: [...this.runIds],
      ...(destination === 'subscreen-series'
        ? { series: { phase: 'waiting' } }
        : {}),
    });
    void this.pump();
  }

  /**
   * Ready videos that can go into the run going now, unless
   * that run or the destination chosen now is a series (its playlist is
   * planned from the start).
   */
  joinableIds(): string[] {
    const { active, context } = this.run;
    if (
      !active ||
      !context ||
      context.destination === 'subscreen-series' ||
      this.settings.destination === 'subscreen-series'
    ) {
      return [];
    }
    if (!this.accountMatches(context)) return [];
    // Ticks pick among them: the window passes the ones it shows ticked.
    return this.items
      .filter((item) => item.phase === 'ready' && !this.runIds.has(item.id))
      .map((item) => item.id);
  }

  /**
   * These go in the run going now, to the destination, quality and shared
   * fields chosen now (another app than the run's first videos is fine).
   * Each asks for approval right before it goes up.
   */
  joinRun(ids: readonly string[], account?: PublishAccount): number {
    const current = this.run.context;
    const joinable = new Set(this.joinableIds());
    if (!current) return 0;
    const context = this.contextFor(
      account ?? {
        address: current.address,
        name: current.name,
        publicKey: current.publicKey,
      },
      current.id
    );
    // Nothing goes up as another account than the run's.
    if (current.address && context.address !== current.address) return 0;
    if (context.destination !== 'save' && !context.name) return 0;
    let joined = 0;
    for (const id of ids) {
      const item = this.item(id);
      if (!item || !joinable.has(id)) continue;
      this.plans.delete(id);
      this.removalDone.delete(id);
      this.updateItem(id, { context });
      const spec = this.specFor(item, context);
      if (!spec) {
        this.fail(id, 'no-quality-fits', 'convert');
        continue;
      }
      this.specs.set(id, spec);
      this.runIds.add(id);
      this.updateItem(id, {
        phase: 'waiting',
        error: undefined,
        record: undefined,
        link: undefined,
        removal: undefined,
        saved: undefined,
        savedFile: undefined,
        savedFileError: undefined,
        approved: undefined,
        unticked: undefined,
      });
      joined += 1;
    }
    if (joined) {
      this.setRun({ itemIds: [...this.runIds] });
      void this.pump();
    }
    return joined;
  }

  /**
   * The next video to upload: the first converted one, in queue order. One
   * waiting for the user's check, or still to convert (a retry further up),
   * doesn't hold the ones after it: they go when ready, in any order (a
   * series' playlist still goes last).
   */
  private nextToPublish(items: QueueItem[]): QueueItem | undefined {
    return items.find(
      (item) => item.phase === 'converted' && item.saved !== false
    );
  }

  private seriesReady(items: QueueItem[]): boolean {
    const { context, series } = this.run;
    if (context?.destination !== 'subscreen-series' || !series) return false;
    // A series being (or already) removed isn't published again.
    if (series.removal) return false;
    if (series.phase !== 'waiting' || items.some(isPending)) return false;
    // Episodes the user discarded or took off the list aren't waited for.
    const episodes = items.filter(
      (item) =>
        this.runIds.has(item.id) && item.phase !== 'discarded' && !item.removal
    );
    if (!episodes.some((item) => item.phase === 'done')) return false;
    const missing = episodes.some((item) => item.phase !== 'done');
    return !missing || Boolean(this.series.allowPartial);
  }

  private async pump(): Promise<void> {
    if (this.pumping) {
      this.notify();
      return;
    }
    this.pumping = true;
    this.subscribeJobs();
    let converting: Promise<void> | null = null;
    let publishing: Promise<void> | null = null;
    try {
      for (;;) {
        this.changed = false;
        const items = this.items;
        if (!converting) {
          const next = items.find((item) => item.phase === 'waiting');
          // Only converted videos before it wait their turn ahead of it: one
          // retried further up still converts (else nothing would move).
          // Those waiting for the user's check don't count: the next ones
          // convert meanwhile, up to MAX_CONVERTED_HELD files on disk.
          const ahead = next
            ? items
                .slice(0, items.indexOf(next))
                .filter(
                  (item) => item.phase === 'converted' && item.saved !== false
                ).length
            : 0;
          const held = items.filter(isHeldConverted).length;
          const full = Boolean(next) && held >= MAX_CONVERTED_HELD;
          if (next && ahead < CONVERTED_AHEAD && !full) {
            converting = this.convert(next.id).finally(() => {
              converting = null;
              this.notify();
            });
          }
          // Said in the window only when it happens.
          const waitingForChecks =
            full && items.some((item) => item.phase === 'review');
          if (Boolean(this.run.waitingForChecks) !== waitingForChecks) {
            this.setRun({ waitingForChecks: waitingForChecks || undefined });
          }
        }
        if (!publishing) {
          const next = this.nextToPublish(items);
          const task = next
            ? this.publishItem(next.id)
            : this.seriesReady(items)
              ? this.publishSeries()
              : null;
          if (task) {
            publishing = task.finally(() => {
              publishing = null;
              this.notify();
            });
          }
        }
        // Nothing to start and nothing running: done, unless a video waits
        // for the user (review) or a cancelled job's last event.
        if (!converting && !publishing && !this.items.some(isPending)) break;
        // A change while it looked (a task starting moves its video on) is
        // looked at again rather than waited for.
        if (!this.changed) await this.nextChange();
      }
    } finally {
      this.pumping = false;
      this.unsubscribe();
      this.setRun({ active: false, waitingForChecks: undefined });
    }
  }

  // --- Conversion --------------------------------------------------------------

  private subscribeJobs() {
    const bridge = this.deps.bridge();
    if (this.unsubscribeJobs || !bridge) return;
    this.unsubscribeJobs = bridge.onJobEvent((event) => {
      if (event?.type === 'state' && event.state?.jobId) {
        this.onJobState(event.state);
      }
    });
  }

  private unsubscribe() {
    this.unsubscribeJobs?.();
    this.unsubscribeJobs = null;
  }

  /** Stops listening (tests; Hub keeps one controller for the page). */
  dispose() {
    this.unsubscribe();
    this.unsubscribeAccount();
    this.aborts.forEach((abort) => abort.abort());
    this.subtitleTimers.forEach((timer) => clearTimeout(timer));
    this.subtitleTimers.clear();
    this.notify();
  }

  private onJobState(state: VideoJobState) {
    this.jobStates.set(state.jobId, state);
    const item = this.items.find((entry) => entry.jobId === state.jobId);
    if (item?.phase === 'converting') {
      this.updateItem(item.id, {
        percent: Math.max(0, Math.min(100, state.percent ?? 0)),
        // No time left while it stands still.
        etaSec: state.paused ? undefined : state.etaSec,
        speed: state.speed,
        paused: state.paused || undefined,
      });
    }
    if (TERMINAL_JOB_PHASES.has(state.phase)) {
      const waiter = this.jobWaiters.get(state.jobId);
      this.jobWaiters.delete(state.jobId);
      waiter?.(state);
    }
  }

  private waitForJob(state: VideoJobState): Promise<VideoJobState> {
    const known = this.jobStates.get(state.jobId) ?? state;
    if (TERMINAL_JOB_PHASES.has(known.phase)) return Promise.resolve(known);
    return new Promise((resolve) => this.jobWaiters.set(state.jobId, resolve));
  }

  private async convert(id: string): Promise<void> {
    const bridge = this.deps.bridge();
    const cached = this.specs.get(id);
    const item = this.item(id);
    const context = this.contextOf(item);
    if (!bridge || !cached || !context || !item) {
      this.fail(id, 'bridge-missing', 'convert');
      return;
    }
    // Subtitles chosen while it waited its turn go in with it.
    const spec: VideoJobSpec = {
      ...cached,
      subtitles: jobSubtitles(item, context.destination),
    };
    this.specs.set(id, spec);
    this.updateItem(id, {
      phase: 'converting',
      percent: 0,
      etaSec: undefined,
      speed: undefined,
      paused: undefined,
      error: undefined,
    });
    let started: VideoJobState;
    try {
      started = await bridge.startJob(spec);
    } catch (error) {
      this.fail(id, errorCodeOf(error), 'convert');
      return;
    }
    this.updateItem(id, { jobId: started.jobId });
    if (this.item(id)?.phase !== 'converting') {
      // Cancelled (or removed) while the job was being started.
      await bridge.cancelJob(started.jobId).catch(() => {});
    }
    const final = await this.waitForJob(started);
    this.jobStates.delete(started.jobId);
    if (!this.item(id)) {
      await bridge.releaseJob(started.jobId).catch(() => {});
      return;
    }
    if (final.phase === 'done' && final.output) {
      this.updateItem(id, (item) => ({
        // One that came out shorter than its original (a file cut off) waits
        // to be checked, even when its run didn't ask for that.
        phase:
          item.phase !== 'converting'
            ? item.phase
            : context.reviewFirst ||
                shortOutput({ probe: item.probe, output: final.output })
              ? 'review'
              : 'converted',
        percent: 100,
        etaSec: undefined,
        paused: undefined,
        output: final.output,
        madeSubtitles: subtitlesKey(spec.subtitles),
        failedSubtitles: final.output.failedSubtitles?.length || undefined,
      }));
      // Subtitles added or changed while it converted: written now.
      void this.syncSubtitles(id).catch(() => {});
    } else if (final.phase === 'cancelled') {
      // Retried before its cancelled job ended: it waits to convert again.
      this.updateItem(id, (item) => ({
        phase: item.phase === 'waiting' ? item.phase : 'cancelled',
        jobId: undefined,
        percent: undefined,
        etaSec: undefined,
        paused: undefined,
      }));
    } else {
      this.updateItem(id, { jobId: undefined, paused: undefined });
      this.fail(id, final.errorCode ?? 'ffmpeg-failed', 'convert');
    }
  }

  // --- Publishing --------------------------------------------------------------

  /** The WebVTT tracks the job wrote, one per language. */
  private async readSubtitles(snapshot: QueueItem): Promise<SubtitleTrack[]> {
    // Chosen after its job wrote them (added during the conversion, say):
    // written again first, so what goes up is what the card shows.
    await this.syncSubtitles(snapshot.id);
    const item = this.item(snapshot.id) ?? snapshot;
    const bridge = this.deps.bridge();
    const tracks: SubtitleTrack[] = [];
    for (const written of item.output?.subtitles ?? []) {
      const language = normalizeLanguage(written.language);
      if (!language || tracks.some((track) => track.language === language)) {
        continue;
      }
      // Main takes the subtitle's id from the job's output, not a path.
      const vtt = await bridge.readText(item.jobId, written.id);
      tracks.push({ language, vtt });
    }
    return tracks;
  }

  private async frameAt(choice: CoverChoice): Promise<string> {
    if (choice.kind === 'image') return choice.dataUrl;
    try {
      const [frame] = await this.deps
        .bridge()
        .frames(
          { sourceId: choice.sourceId },
          { times: [choice.timeSec], width: COVER_FRAME_WIDTH }
        );
      return frame?.dataUrl ?? choice.preview;
    } catch {
      // Its video can't be read any more (taken off the queue, the file
      // moved): the frame as it was picked.
      return choice.preview;
    }
  }

  /** The cover's picture and four hover frames, from the converted video. */
  private async pictures(item: QueueItem, cover: CoverChoice | null) {
    const frames = await this.deps
      .bridge()
      .frames({ jobId: item.jobId }, { count: 4, width: COVER_FRAME_WIDTH });
    const urls = frames.map((frame) => frame.dataUrl);
    const coverSource = cover
      ? await this.frameAt(cover)
      : (urls[1] ?? urls[0]);
    return {
      coverSource,
      extracts: urls.length ? await this.deps.makeExtracts(urls) : [],
    };
  }

  private async seriesInfo(
    context: RunContext,
    firstEpisode: QueueItem
  ): Promise<SubscreenSeriesInfo> {
    const { name } = context;
    if (this.series.info && this.inCurrentRun(firstEpisode)) {
      return this.series.info;
    }
    // As the form was at Publish: edits during the run don't half-apply.
    const series = context.series ?? this.settings.series;
    let posterSource: string | undefined;
    if (series.poster) posterSource = await this.frameAt(series.poster);
    else {
      const [frame] = await this.deps
        .bridge()
        .frames(
          { jobId: firstEpisode.jobId },
          { count: 1, width: COVER_FRAME_WIDTH }
        );
      posterSource = frame?.dataUrl;
    }
    const info: SubscreenSeriesInfo = {
      name,
      title: series.title.trim(),
      description: series.description,
      genre: series.genre,
      year: series.year,
      poster: posterSource
        ? await this.deps.makeCover(posterSource, { poster: true })
        : null,
    };
    if (this.inCurrentRun(firstEpisode)) this.series.info = info;
    return info;
  }

  private async buildPlan(
    item: QueueItem,
    context: RunContext
  ): Promise<ItemPlan> {
    const bridge = this.deps.bridge();
    const name = context.name;
    const fields = effectiveFields(
      item,
      context.shared ?? this.settings.shared
    );
    const title = (fields.title || '').trim();
    const output = item.output;
    const video: ConvertedVideo = {
      data: createJobFileReference({
        jobId: item.jobId,
        file: 'video',
        size: output.size,
        name: videoFileName(title || item.source.name),
        type: output.mimeType || 'video/mp4',
        bridge,
        onNodeBuild: (building) =>
          this.updateItem(item.id, (current) =>
            current.publish
              ? {
                  publish: {
                    ...current.publish,
                    onNode: building || undefined,
                  },
                }
              : {}
          ),
      }),
      size: output.size,
      durationSec: output.durationSec,
      width: output.width,
      height: output.height,
      mimeType: output.mimeType || 'video/mp4',
    };
    const subtitles = await this.readSubtitles(item);
    const key = `item-${item.id}`;
    const plan = (steps: PublishStep[], record: PublishedRecord): ItemPlan => ({
      steps,
      record,
      completed: new Set(),
      context,
    });

    switch (context.destination) {
      case 'qtube':
      case 'torq': {
        const { coverSource, extracts } = await this.pictures(
          item,
          fields.cover ?? null
        );
        const input = {
          key,
          name,
          title,
          // Torq's form has no description (as Torq's own): one typed for
          // another app stays out.
          description: context.destination === 'torq' ? '' : fields.description,
          category: fields.category,
          subcategory: fields.subcategory ?? null,
          cover: await this.deps.makeCover(coverSource),
          extracts,
          video,
          subtitles,
        };
        const built =
          context.destination === 'torq'
            ? await buildTorqVideoPost({ ...input, text: fields.postText })
            : await buildQtubeVideo(input);
        return plan(built.steps, built.record);
      }
      case 'subscreen-film': {
        const { coverSource, extracts } = await this.pictures(
          item,
          fields.cover ?? null
        );
        const built = await buildSubscreenFilm({
          key,
          name,
          title,
          description: fields.description,
          genre: fields.genre,
          year: fields.year ?? null,
          cover: await this.deps.makeCover(coverSource, { poster: true }),
          extracts,
          video,
          subtitles,
        });
        // Its cast & crew after the film's own resources: people Subscreen
        // doesn't know yet, then the credits (looked up before the
        // approval, which lists them all with their fee).
        const credits = await this.planCredits({
          key,
          context,
          titleRef: {
            name: built.record.name,
            identifier: built.metadataIdentifier,
            service: 'DOCUMENT',
          },
          dependsOn: [built.metadataStepKey],
          credits: fields.credits,
          signal: this.aborts.get(item.id)?.signal,
        });
        if (!credits) return plan(built.steps, built.record);
        return {
          ...plan([...built.steps, ...credits.steps], {
            ...built.record,
            // Remove replaces the credits too; never a person (shared).
            resources: [...built.record.resources, credits.resource],
          }),
          credits,
        };
      }
      case 'subscreen-series': {
        const info = await this.seriesInfo(context, item);
        const { extracts } = await this.pictures(item, null);
        // Its place among its series' episodes in the queue's order, however
        // they were approved (an untitled episode's fallback title): those
        // of its run, not an earlier series' still on the list.
        const episodes = this.items.filter(
          (entry) => entry.id === item.id || entry.context?.id === context.id
        );
        const episode = await buildSubscreenEpisode(
          info,
          {
            key,
            title: (fields.episodeTitle || '').trim(),
            season: fields.season ?? null,
            episode: fields.episode ?? null,
            episodeKind: fields.episodeKind,
            video,
            cover: fields.cover
              ? await this.deps.makeCover(await this.frameAt(fields.cover), {
                  poster: true,
                })
              : null,
            extracts,
            subtitles,
          },
          item.episodePlace ??
            Math.max(
              0,
              episodes.findIndex((entry) => entry.id === item.id)
            )
        );
        return {
          ...plan(episode.steps, {
            app: 'subscreen',
            name,
            title: episode.title,
            link: qtubeVideoLink(name, episode.metadataIdentifier),
            open: qtubeVideoTarget(name, episode.metadataIdentifier),
            resources: episode.resources,
          }),
          episode,
        };
      }
      case 'qshare': {
        const { coverSource } = await this.pictures(item, fields.cover ?? null);
        let thumbnail: string | null = null;
        try {
          thumbnail = await this.deps.makeQshareThumbnail(coverSource);
        } catch {
          // A share can go without its thumbnail.
        }
        const built = await buildQshareVideo({
          key,
          name,
          title,
          description: fields.description,
          subcategory: fields.qshareSubcategory,
          video,
          fileName: savedFileName(item.source.name),
          thumbnail,
          subtitles,
        });
        return plan(built.steps, built.record);
      }
      default:
        throw new Error(`No plan for ${context.destination}`);
    }
  }

  /**
   * A person this Hub published in this session, by name: the node may not
   * list it yet, and a second title naming them points at it rather than
   * publishing them again.
   */
  private publishedPerson(displayName: string): SubscreenPersonRef | null {
    const wanted = normalizePersonName(displayName);
    const plans: {
      credits?: SubscreenCreditsPlan | null;
      sent: ReadonlySet<string>;
    }[] = [
      ...[...this.plans.values()].map((plan) => ({
        credits: plan.credits,
        sent: plan.completed,
      })),
      { credits: this.series.credits, sent: this.series.sent ?? new Set() },
    ];
    for (const { credits, sent } of plans) {
      for (const person of credits?.people ?? []) {
        if (
          sent.has(person.step.key) &&
          normalizePersonName(person.document.displayName) === wanted
        ) {
          return person.ref;
        }
      }
    }
    return null;
  }

  /**
   * A Subscreen title's cast & crew, as the run's form had it: the people
   * it names (known ones pointed at, new ones published first) and its
   * credits DOCUMENT, both after `dependsOn`. Null without a name.
   */
  private planCredits({
    key,
    context,
    titleRef,
    dependsOn,
    credits,
    signal,
  }: {
    key: string;
    context: RunContext;
    titleRef: SubscreenTitleRef;
    dependsOn: string[];
    credits: readonly SubscreenCredit[] | undefined;
    signal?: AbortSignal;
  }): Promise<SubscreenCreditsPlan | null> {
    return planSubscreenCredits({
      key,
      name: context.name ?? '',
      titleRef,
      credits,
      dependsOn,
      signal,
      findPerson: async (displayName, lookupSignal) =>
        this.publishedPerson(displayName) ??
        (await this.deps.findSubscreenPerson(displayName, lookupSignal)),
    });
  }

  /** What went up of a plan that stopped half way. */
  private partialRecord(plan: ItemPlan): PublishedRecord | undefined {
    const published = new Set(
      plan.steps
        .filter((step) => plan.completed.has(step.key))
        .map((step) => `${step.service}:${step.identifier}`)
    );
    const resources = plan.record.resources.filter((resource) =>
      published.has(`${resource.service}:${resource.identifier}`)
    );
    return resources.length ? { ...plan.record, resources } : undefined;
  }

  /**
   * What went up of a retried video before (Retry takes it off its card
   * until it finishes): back on the card, with Remove, when it stops short.
   */
  private wentUp(id: string): PublishedRecord | undefined {
    const plan = this.plans.get(id);
    return plan ? this.partialRecord(plan) : undefined;
  }

  /**
   * Hub's approval for these steps, with their fee: true when accepted,
   * false when declined (or not answered in time), 'fee-unknown' when the
   * node didn't say the fee (or the balance), 'balance' when the balance
   * doesn't cover it all (nothing is asked).
   */
  private async askApproval(
    context: RunContext,
    steps: readonly PublishStep[],
    waiting: (waiting: boolean) => void,
    signal?: AbortSignal
  ): Promise<boolean | 'fee-unknown' | 'balance'> {
    let fee: number;
    try {
      fee = (await this.deps.estimatePublishFee(steps.length)).total;
      // Each publish checks only its own fee, and the node takes them all
      // while the earlier ones are unconfirmed: the whole of it is checked
      // here, or the last ones (the listing) would never confirm.
      if (context.address) {
        const { enough } = await this.deps.checkPublishBalance(
          context.address,
          fee,
          context.publicKey
        );
        if (!enough) return 'balance';
      }
    } catch {
      return 'fee-unknown';
    }
    // Cancelled meanwhile: nothing to ask.
    if (signal?.aborted) return false;
    waiting(true);
    try {
      return await this.deps.requestApproval({
        resources: steps.map((step) => ({
          service: step.service,
          name: context.name ?? '',
          identifier: step.identifier,
          ...(step.filename ? { filename: step.filename } : {}),
        })),
        fee,
      });
    } catch {
      return false;
    } finally {
      waiting(false);
    }
  }

  private async publishItem(id: string): Promise<void> {
    const item = this.item(id);
    // A retried video goes where its plan was made for, never to the run
    // started since.
    const context = this.plans.get(id)?.context ?? this.contextOf(item);
    if (!context || !item) return;
    if (!this.accountMatches(context)) {
      this.updateItem(id, { phase: 'cancelled' });
      return;
    }
    if (context.destination === 'save') {
      await this.saveItem(id, { automatic: true });
      return;
    }
    // Its fields were changed since Publish and no longer fit the app (a
    // title over its limit would be cut without a word): it waits to be
    // checked, where its card says what it needs.
    if (
      !this.plans.has(id) &&
      missingFields(
        context.destination,
        item,
        context.shared ?? this.settings.shared
      ).length
    ) {
      this.updateItem(id, { phase: 'review', approved: undefined });
      return;
    }
    this.updateItem(id, { phase: 'publishing', error: undefined });
    // Cancel works while the cover and frames are made, too.
    const abort = new AbortController();
    this.aborts.set(id, abort);
    let plan = this.plans.get(id);
    if (!plan) {
      try {
        plan = await this.buildPlan(item, context);
      } catch (error) {
        this.aborts.delete(id);
        // Cancelled while it was prepared (its pictures, Subscreen's people
        // looked up): cancelled, not failed.
        if (abort.signal.aborted) {
          this.updateItem(id, { phase: 'cancelled', publish: undefined });
          return;
        }
        this.fail(id, errorCodeOf(error), 'publish');
        return;
      }
      this.plans.set(id, plan);
    }
    // Cancelled while it was prepared or its approval was open: nothing is
    // asked or sent, and it ends as cancelled, its file kept for Retry.
    const cancelled = () => {
      if (!abort.signal.aborted) return false;
      this.aborts.delete(id);
      this.updateItem(id, {
        phase: 'cancelled',
        publish: undefined,
        waitingForSlot: undefined,
        awaitingApproval: undefined,
        record: this.partialRecord(plan),
      });
      return true;
    };
    if (cancelled()) return;
    // Hub's own approval, right before it goes up: what's left of it, with
    // the fee. Declined, or no answer within the minute it waits: "Not
    // published", with its converted file kept for Retry.
    const left = plan.steps.filter((step) => !plan.completed.has(step.key));
    if (left.length) {
      const approved = await this.askApproval(
        context,
        left,
        (waiting) =>
          this.updateItem(id, { awaitingApproval: waiting || undefined }),
        abort.signal
      );
      if (cancelled()) return;
      if (approved !== true) {
        this.aborts.delete(id);
        this.fail(
          id,
          approved === false ? 'approval-declined' : approved,
          'publish'
        );
        // What went up before (a retry) stays on its card, with Remove.
        this.updateItem(id, { record: this.partialRecord(plan) });
        // Short of QORT, the next videos would convert only to fail the same
        // way: the run stops, as after the node's refusal.
        if (approved === 'balance') this.stopRun(approved);
        return;
      }
    }
    const stepCount = plan.steps.length;
    // The bar follows the bytes: the video is nearly all of an upload, its
    // thumbnail and listing a sliver.
    const weightOf = (step: { bytes: number }) => Math.max(1, step.bytes || 0);
    const bytesTotal = plan.steps.reduce(
      (sum, step) => sum + weightOf(step),
      0
    );
    const result = await this.deps.runPublishSteps(plan.steps, {
      name: context.name,
      signal: abort.signal,
      completed: plan.completed,
      onStepStart: (step, index) =>
        this.updateItem(id, {
          publish: {
            stepIndex: index,
            stepCount,
            kind: step.kind,
            done: 0,
            total: 1,
            bytesBefore: plan.steps
              .filter((entry) => plan.completed.has(entry.key))
              .reduce((sum, entry) => sum + weightOf(entry), 0),
            stepBytes: weightOf(step),
            bytesTotal,
          },
          waitingForSlot: undefined,
        }),
      onProgress: (_key, done, total) =>
        this.updateItem(id, (current) =>
          current.publish
            ? { publish: { ...current.publish, done, total } }
            : {}
        ),
      onStepDone: (outcome) => {
        if (outcome.status !== 'published') return;
        plan.completed.add(outcome.key);
        // Kept as each part goes up, so a close of Hub mid-upload leaves
        // what went through removable from the list.
        if (plan.completed.size < stepCount) {
          const partial = this.partialRecord(plan);
          if (partial) this.remember(id, partial, context, true);
        }
      },
      ...(context.publicKey
        ? {
            waitForSlot: () =>
              this.deps.waitForPublishSlot(context.publicKey, {
                signal: abort.signal,
                onWait: (count) =>
                  this.updateItem(id, { waitingForSlot: count }),
              }),
          }
        : {}),
    });
    this.aborts.delete(id);
    // On the run's account's list even when the video left the queue
    // meanwhile (an account switch, a removal): an upload that started
    // can't be stopped, and what went up stays removable.
    const partial = result.ok ? undefined : this.partialRecord(plan);
    if (result.ok) this.remember(id, plan.record, context);
    else if (partial) this.remember(id, partial, context, true);
    if (!this.item(id)) return;

    if (result.ok) {
      // An episode keeps its own record (Remove) until the series' playlist
      // takes it in.
      this.updateItem(id, {
        phase: 'done',
        publish: undefined,
        waitingForSlot: undefined,
        record: plan.record,
        link: plan.record.link,
      });
      const { series } = this.run;
      if (
        plan.episode &&
        this.runIds.has(id) &&
        series?.phase === 'done' &&
        !series.removal
      ) {
        // Done after the playlist went up (a retry): it's published again,
        // with this episode in it.
        this.setSeries({ phase: 'waiting', error: undefined });
      }
      if (item.jobId) {
        await this.deps
          .bridge()
          ?.releaseJob(item.jobId)
          .catch(() => {});
      }
      return;
    }
    const failed = result.outcomes.find(
      (outcome) => outcome.status === 'failed'
    );
    const code = (failed?.error ?? result.stoppedBy)?.code ?? 'publish-failed';
    // What went up stays removable (on the list above), an episode's too.
    if (code === 'cancelled') {
      this.updateItem(id, {
        phase: 'cancelled',
        publish: undefined,
        waitingForSlot: undefined,
        record: partial,
      });
      return;
    }
    this.fail(id, code, 'publish');
    this.updateItem(id, { record: partial });
    if (result.stoppedBy) this.stopRun(code);
  }

  /**
   * After a refusal (or the balance, a missing API key…) the next publish
   * would most likely fail the same way, and each try can cost a fee: the
   * run stops. Converted videos keep their files for Retry. Videos saved to
   * this PC go on.
   */
  private stopRun(code: string) {
    const bridge = this.deps.bridge();
    for (const item of this.items) {
      // Saved to this PC: nothing published, nothing the refusal concerns.
      if (item.context?.destination === 'save') continue;
      if (item.phase === 'waiting') {
        this.specs.delete(item.id);
        if (item.context?.destination === 'subscreen-series') {
          // A series' episode stays in its series, for Retry: as a ready
          // video it could only start another series.
          this.fail(item.id, 'stopped', 'publish');
        } else {
          // Ready again and out of the run: the main button sends it on.
          this.runIds.delete(item.id);
          this.updateItem(item.id, { phase: 'ready' });
        }
      } else if (item.phase === 'converting') {
        this.updateItem(item.id, { phase: 'cancelled' });
        if (item.jobId) void bridge?.cancelJob(item.jobId).catch(() => {});
      } else if (item.phase === 'converted' || item.phase === 'review') {
        this.fail(item.id, 'stopped', 'publish');
        this.updateItem(item.id, { record: this.wentUp(item.id) });
      }
    }
    this.setRun({ stoppedBy: code, itemIds: [...this.runIds] });
  }

  private async publishSeries(): Promise<void> {
    const context = this.run.context;
    const included = this.items.filter(
      (item) =>
        item.phase === 'done' &&
        !item.removal &&
        this.runIds.has(item.id) &&
        this.plans.get(item.id)?.episode
    );
    const episodes = included.map((item) => this.plans.get(item.id).episode);
    const info = this.series.info;
    if (!context || !episodes.length || !info) {
      this.setSeries({
        phase: 'failed',
        error: { code: 'episodes-required', stage: 'publish' },
      });
      return;
    }
    this.setSeries({ phase: 'publishing', error: undefined });
    let built: ReturnType<typeof buildSubscreenPlaylist>;
    try {
      built = buildSubscreenPlaylist({
        key: 'series',
        series: info,
        episodes,
        identifier: this.series.playlistIdentifier,
      });
    } catch (error) {
      this.setSeries({
        phase: 'failed',
        error: { code: errorCodeOf(error), stage: 'publish' },
      });
      return;
    }
    this.series.playlistIdentifier = built.identifier;
    const abort = new AbortController();
    this.series.abort = abort;
    // Another account signed in meanwhile (it reset the series): nothing to
    // say. Cancel all: it ends there, with Retry.
    const reset = () => this.series.abort !== abort;
    const stopped = () => {
      if (!abort.signal.aborted) return false;
      if (reset()) return true;
      this.series.abort = undefined;
      this.setSeries({
        phase: 'failed',
        error: { code: 'cancelled', stage: 'publish' },
        awaitingApproval: undefined,
      });
      return true;
    };
    // Its cast & crew, after the playlist: planned once, with its people
    // looked up before the approval, so a retry sends the same people.
    let credits = this.series.credits;
    if (credits === undefined) {
      try {
        credits = await this.planCredits({
          key: 'series',
          context,
          titleRef: {
            name: info.name.trim(),
            identifier: built.identifier,
            service: 'PLAYLIST',
          },
          dependsOn: [built.step.key],
          credits: (context.series ?? this.settings.series).credits,
          signal: abort.signal,
        });
      } catch (error) {
        if (stopped()) return;
        this.series.abort = undefined;
        this.setSeries({
          phase: 'failed',
          error: { code: errorCodeOf(error), stage: 'publish' },
        });
        return;
      }
      if (stopped()) return;
      this.series.credits = credits;
    }
    const sent = (this.series.sent ??= new Set<string>());
    const playlistData =
      'base64' in built.step.data ? built.step.data.base64 : undefined;
    const steps = [built.step, ...(credits?.steps ?? [])];
    // What went up isn't sent again: the episodes it lists (in their own
    // runs), its people and credits, and the playlist until it changes (an
    // episode added since).
    const completed = new Set<string>([
      ...(built.step.dependsOn ?? []),
      ...steps
        .filter((step) => step !== built.step && sent.has(step.key))
        .map((step) => step.key),
      ...(playlistData && this.series.sentPlaylist === playlistData
        ? [built.step.key]
        : []),
    ]);
    const left = steps.filter((step) => !completed.has(step.key));
    if (left.length) {
      const approved = await this.askApproval(
        context,
        left,
        (waiting) => {
          // Another account signed in meanwhile: its window has no series.
          if (abort.signal.aborted) return;
          this.setSeries({ awaitingApproval: waiting || undefined });
        },
        abort.signal
      );
      if (stopped()) return;
      if (approved !== true) {
        this.series.abort = undefined;
        this.setSeries({
          phase: 'failed',
          error: {
            code: approved === false ? 'approval-declined' : approved,
            stage: 'publish',
          },
        });
        return;
      }
    }
    const result = await this.deps.runPublishSteps(steps, {
      name: context.name,
      signal: abort.signal,
      completed,
      onStepDone: (outcome) => {
        if (outcome.status !== 'published') return;
        sent.add(outcome.key);
        if (outcome.key === built.step.key) {
          this.series.sentPlaylist = playlistData;
        }
      },
      ...(context.publicKey
        ? {
            // Cancel all stops it while it waits for its turn, too.
            waitForSlot: () =>
              this.deps.waitForPublishSlot(context.publicKey, {
                signal: abort.signal,
              }),
          }
        : {}),
    });
    const wentUp = (key: string) =>
      result.outcomes.some(
        (outcome) => outcome?.key === key && outcome.status === 'published'
      );
    // Once the playlist is up the series is, with its credits if they are.
    const listed = wentUp(built.step.key)
      ? subscreenSeriesRecord(info, episodes, built)
      : undefined;
    const record =
      listed && credits && wentUp(credits.creditsStepKey)
        ? { ...listed, resources: [...listed.resources, credits.resource] }
        : listed;
    const historyId = `series:${built.identifier}`;
    if (record) {
      // On the run's account's list, even after a switch stopped the run
      // (a playlist that started going up can't be stopped).
      const covered = new Set(included.map((item) => itemEntryId(item.id)));
      this.changeHistory(
        (entries) =>
          upsertEntry(
            entries.filter((entry) => !covered.has(entry.id)),
            {
              id: historyId,
              kind: 'series',
              record,
              publishedAt: Date.now(),
              // Its cast & crew isn't all up: Retry sends the rest.
              ...(result.ok ? {} : { partial: true }),
            }
          ),
        this.historyAddress(context)
      );
    }
    // After a Cancel all it ends as below: up when its upload had started,
    // else failed (cancelled), with Retry.
    if (reset()) return;
    if (record) {
      // The series' record covers them now: its Remove takes them along.
      for (const item of included) {
        this.updateItem(item.id, { record: undefined });
      }
    }
    if (result.ok) {
      this.setSeries({ phase: 'done', record, historyId });
    } else {
      // The playlist up without all of its cast & crew is failed too, with
      // what went up removable and Retry for the rest.
      const failed = result.outcomes.find(
        (outcome) => outcome?.status === 'failed'
      );
      this.setSeries({
        phase: 'failed',
        error: {
          code: (failed?.error ?? result.stoppedBy)?.code ?? 'publish-failed',
          stage: 'publish',
        },
        ...(record ? { record, historyId } : {}),
      });
    }
  }

  /** The playlist goes again (it asks for approval right before). */
  private resumeSeries(allowPartial: boolean): boolean {
    const { context, series } = this.run;
    if (context?.destination !== 'subscreen-series' || !series) return false;
    if (!this.accountMatches(context)) return false;
    // Once a Remove started, what went up is gone or going: the playlist
    // would list replaced episodes, its cast & crew a removed playlist.
    if (series.removal) return false;
    if (allowPartial) this.series.allowPartial = true;
    this.setSeries({ phase: 'waiting', error: undefined });
    this.setRun({ active: true, stoppedBy: undefined });
    void this.pump();
    return true;
  }

  /**
   * Publishes the series' playlist without the episodes that didn't go up;
   * returns whether it went.
   */
  publishSeriesWithoutFailed(): boolean {
    return this.resumeSeries(true);
  }

  /** The playlist again; returns whether it went. */
  retrySeries(): boolean {
    return this.resumeSeries(false);
  }

  // --- Saving ------------------------------------------------------------------

  /** Save to this PC: the system's save dialog, then the job's files go. */
  async saveItem(
    id: string,
    { automatic = false }: { automatic?: boolean } = {}
  ): Promise<void> {
    const item = this.item(id);
    const bridge = this.deps.bridge();
    if (!item?.jobId || !bridge) return;
    this.updateItem(id, { phase: 'saving', error: undefined });
    try {
      const result = await bridge.saveOutput(
        item.jobId,
        savedFileName(item.source.name)
      );
      if (!result.saved) {
        this.updateItem(id, { phase: 'converted', saved: false });
        return;
      }
      this.updateItem(id, {
        phase: 'done',
        saved: true,
        // An older main answers without them: then nothing to open.
        savedFile:
          result.savedId && result.filePath
            ? { id: result.savedId, path: result.filePath }
            : undefined,
      });
      await bridge.releaseJob(item.jobId).catch(() => {});
      this.updateItem(id, { jobId: undefined });
    } catch (error) {
      this.fail(id, automatic ? 'save-failed' : errorCodeOf(error), 'save');
    }
  }

  /** Plays a saved video in the system's player, or shows its folder. */
  async openSaved(id: string, how: 'open' | 'folder'): Promise<void> {
    const file = this.item(id)?.savedFile;
    const bridge = this.deps.bridge();
    if (!file || !bridge?.openSaved) return;
    try {
      await bridge.openSaved(file.id, how);
      this.updateItem(id, { savedFileError: undefined });
    } catch (error) {
      this.updateItem(id, { savedFileError: errorCodeOf(error) });
    }
  }

  // --- The user's choices during a run -------------------------------------------

  /** "Let me check each video first": this one may go. */
  approve(id: string) {
    if (this.item(id)?.phase !== 'review') return;
    this.updateItem(id, { phase: 'converted', approved: true });
  }

  /** Not this one after all: its converted file goes. */
  async discard(id: string): Promise<void> {
    const item = this.item(id);
    if (!item) return;
    if (item.jobId) {
      await this.deps
        .bridge()
        ?.releaseJob(item.jobId)
        .catch(() => {});
    }
    this.updateItem(id, {
      phase: 'discarded',
      jobId: undefined,
      output: undefined,
    });
  }

  async cancelItem(id: string): Promise<void> {
    const item = this.item(id);
    if (!item) return;
    switch (item.phase) {
      case 'waiting':
      case 'converted':
      case 'review':
        this.updateItem(id, { phase: 'cancelled', record: this.wentUp(id) });
        break;
      case 'converting':
        this.updateItem(id, { phase: 'cancelled' });
        if (item.jobId) {
          await this.deps
            .bridge()
            ?.cancelJob(item.jobId)
            .catch(() => {});
        }
        break;
      case 'publishing':
        // Takes effect between uploads: one that started can't be stopped.
        this.aborts.get(id)?.abort();
        break;
      default:
        break;
    }
  }

  async cancelAll(): Promise<void> {
    for (const item of this.items) {
      if (isPending(item)) await this.cancelItem(item.id);
    }
    // The series' playlist isn't a queue item: it stops too, unless its
    // upload started.
    if (this.run.series?.phase === 'publishing') this.series.abort?.abort();
  }

  /** Whether Retry can do anything for this video (retry's own checks). */
  canRetry(item: QueueItem): boolean {
    if (item.phase === 'unusable') return true;
    if (item.phase !== 'failed' && item.phase !== 'cancelled') return false;
    if (item.removal || this.removalDone.get(item.id)?.size) return false;
    const converted = Boolean(item.output && item.jobId);
    return !(converted && !this.plans.has(item.id) && item.record);
  }

  /**
   * Again: the upload where it stopped, or the conversion; the upload asks
   * for approval again right before it goes. Returns whether it went.
   */
  retry(id: string) {
    const item = this.item(id);
    if (!item) return false;
    if (item.phase === 'unusable') {
      void this.probe(id);
      return true;
    }
    if (item.phase !== 'failed' && item.phase !== 'cancelled') return false;
    // Once a Remove started, what went up is gone or going: a retry would
    // list replaced resources.
    if (item.removal || this.removalDone.get(id)?.size) return false;
    let plan = this.plans.get(id);
    const context = plan?.context ?? this.contextOf(item);
    if (!context) {
      this.updateItem(id, { phase: 'ready', error: undefined });
      return true;
    }
    if (!this.accountMatches(context)) return false;
    // Nothing went up: built again, with the fields as they are now.
    if (plan && !plan.completed.size) {
      this.plans.delete(id);
      plan = undefined;
    }
    const converted = Boolean(item.output && item.jobId);
    // Something went up but its plan is gone: a retry would publish it all
    // again under new names. The record keeps it removable instead.
    if (converted && !plan && item.record) return false;
    // Not converted yet: built again with its choices as they are now (the
    // quality and format chosen now, or the subtitles, sound or burned-in
    // track changed after a Cancel). One that doesn't fit says to pick a
    // lower quality.
    if (!converted) {
      this.specs.delete(id);
      const spec = this.specFor(item, context);
      if (!spec) {
        this.fail(id, 'no-quality-fits', 'convert');
        return false;
      }
      this.specs.set(id, spec);
    }
    // Counted by the run it goes on in, an older run's video too. Not in a
    // series' run: its videos are the series' episodes.
    if (
      this.inCurrentRun(item) ||
      this.run.context?.destination !== 'subscreen-series'
    ) {
      this.runIds.add(id);
    }
    this.updateItem(id, {
      // A converted video the user hasn't checked yet (its run asked for
      // that, or it came out short) goes back to be checked, not straight up.
      phase: converted
        ? (context.reviewFirst || shortOutput(item)) && !item.approved
          ? 'review'
          : 'converted'
        : 'waiting',
      error: undefined,
      saved: undefined,
      savedFile: undefined,
      savedFileError: undefined,
      // What went up before is in the plan; the retry finishes it.
      record: undefined,
      removal: undefined,
      context,
    });
    this.setRun({
      active: true,
      stoppedBy: undefined,
      itemIds: [...this.runIds],
    });
    void this.pump();
    return true;
  }

  // --- Removing what was published -------------------------------------------------

  /** The resources a Remove would replace (one fee each). */
  removalCount(record: PublishedRecord | undefined): number {
    try {
      return record ? buildRemovalSteps(record).length : 0;
    } catch {
      return 0;
    }
  }

  /** What a Remove went through before (this session, or kept with its entry). */
  private removalDoneFor(key: string, entryId: string | undefined) {
    const entry = entryId
      ? this.published.find((current) => current.id === entryId)
      : undefined;
    return (
      this.removalDone.get(key) ?? new Set<string>(entry?.removedKeys ?? [])
    );
  }

  /** The resources a Remove still has to replace (one fee each). */
  private removalLeft(
    record: PublishedRecord | undefined,
    key: string,
    entryId: string | undefined
  ): number {
    if (!record) return 0;
    try {
      const done = this.removalDoneFor(key, entryId);
      return buildRemovalSteps(record, { key: REMOVAL_KEY }).filter(
        (step) => !done.has(step.key)
      ).length;
    } catch {
      return 0;
    }
  }

  /**
   * What Remove on an item's card (id "series": the series' card) still has
   * to replace: one that stopped half way skips what it did.
   */
  removalLeftOf(id: string): number {
    const isSeries = id === 'series';
    return this.removalLeft(
      isSeries ? this.run.series?.record : this.item(id)?.record,
      id,
      isSeries ? this.run.series?.historyId : itemEntryId(id)
    );
  }

  /** The same, for Remove from the published list (as removeSaved goes). */
  savedRemovalLeft(entryId: string): number {
    const entry = this.published.find((current) => current.id === entryId);
    if (!entry) return 0;
    if (entry.itemId && this.item(entry.itemId)?.record) {
      return this.removalLeftOf(entry.itemId);
    }
    if (this.run.series?.historyId === entryId && this.run.series.record) {
      return this.removalLeftOf('series');
    }
    return this.removalLeft(entry.record, entryId, entryId);
  }

  /**
   * While the series' playlist goes up, neither it (id "series") nor an
   * episode it takes in can be removed: the playlist would list what was
   * just replaced, or the series would be published again over its removal.
   */
  removalBlocked(id: string): boolean {
    if (this.run.series?.phase !== 'publishing') return false;
    if (id === 'series') return true;
    // The episodes it lists: done, not being removed.
    const item = this.item(id);
    return Boolean(
      item &&
      item.phase === 'done' &&
      !item.removal &&
      this.isHeldBySeries(item)
    );
  }

  /** Replaces what an item (or the series, id "series") published. */
  async removePublished(id: string, account: PublishAccount): Promise<void> {
    const isSeries = id === 'series';
    await this.runRemoval(
      {
        key: id,
        record: isSeries ? this.run.series?.record : this.item(id)?.record,
        entryId: isSeries ? this.run.series?.historyId : itemEntryId(id),
        target: isSeries ? 'series' : 'item',
      },
      account
    );
  }

  /**
   * Whether an entry of the published list can be removed from there: not
   * while its video is still on the queue without a record (a retry going
   * on, or a series that took it in).
   */
  canRemoveSaved(entry: PublishedEntry): boolean {
    if (entry.removal === 'removed' || entry.removal === 'removing') {
      return false;
    }
    if (entry.itemId) {
      const item = this.item(entry.itemId);
      if (item && !item.record) return false;
      if (item && this.removalBlocked(item.id)) return false;
    }
    if (
      this.run.series?.historyId === entry.id &&
      this.removalBlocked('series')
    ) {
      return false;
    }
    return this.removalCount(entry.record) > 0;
  }

  /**
   * Remove from the published list. A video still on the queue goes through
   * its card's own removal, so both show the same.
   */
  async removeSaved(entryId: string, account: PublishAccount): Promise<void> {
    const entry = this.published.find((current) => current.id === entryId);
    if (!entry || !this.canRemoveSaved(entry)) return;
    if (entry.itemId && this.item(entry.itemId)?.record) {
      await this.removePublished(entry.itemId, account);
      return;
    }
    if (this.run.series?.historyId === entryId && this.run.series.record) {
      await this.removePublished('series', account);
      return;
    }
    await this.runRemoval(
      { key: entryId, record: entry.record, entryId, target: 'entry' },
      account
    );
  }

  /**
   * Off the published list: a removed one, or one still published, which
   * stays published (only this list forgets it).
   */
  dismissSaved(entryId: string) {
    const entry = this.published.find((current) => current.id === entryId);
    if (!entry || !canDismissPublished(entry)) return;
    this.changeHistory((entries) =>
      entries.filter((current) => current.id !== entryId)
    );
  }

  private async runRemoval(
    {
      key,
      record,
      entryId,
      target,
    }: {
      key: string;
      record: PublishedRecord | undefined;
      entryId: string | undefined;
      target: 'item' | 'series' | 'entry';
    },
    account: PublishAccount
  ): Promise<void> {
    // Already being removed (Remove confirmed twice): once is enough.
    if (this.aborts.has(`remove:${key}`)) return;
    // The series' playlist is going up (its confirmation was open meanwhile).
    if (target !== 'entry' && this.removalBlocked(key)) return;
    const name = account.name?.trim();
    // Its list: what it replaces stays recorded there after a switch.
    const owner = this.address;
    const set = (change: {
      removal?: QueueItem['removal'];
      removalError?: string;
    }) => {
      // Only on the series it started for: a run started since (a removal
      // takes a while) has its own, or none.
      if (target === 'series') {
        if (this.run.series?.historyId === entryId) this.setSeries(change);
      } else if (target === 'item') this.updateItem(key, change);
      this.setEntry(entryId, change as Partial<PublishedEntry>, owner);
    };
    const otherAccount =
      Boolean(account.address) && account.address !== this.signedInAddress();
    if (!record || !name || name !== record.name || otherAccount) {
      set({ removal: 'failed', removalError: 'nothing-to-remove' });
      return;
    }
    let steps: PublishStep[];
    try {
      steps = buildRemovalSteps(record, { key: REMOVAL_KEY });
    } catch (error) {
      set({ removal: 'failed', removalError: errorCodeOf(error) });
      return;
    }
    set({ removal: 'removing', removalError: undefined });
    // What went through before (this session, or kept with the entry).
    const done = this.removalDoneFor(key, entryId);
    this.removalDone.set(key, done);
    const abort = new AbortController();
    this.aborts.set(`remove:${key}`, abort);
    const result = await this.deps.runPublishSteps(steps, {
      name,
      signal: abort.signal,
      completed: done,
      onStepDone: (outcome) => {
        if (outcome.status !== 'published') return;
        done.add(outcome.key);
        this.setEntry(entryId, { removedKeys: [...done] }, owner);
      },
      ...(account.publicKey
        ? {
            waitForSlot: () => this.deps.waitForPublishSlot(account.publicKey),
          }
        : {}),
    });
    if (this.aborts.get(`remove:${key}`) === abort) {
      this.aborts.delete(`remove:${key}`);
    }
    // The account changed meanwhile: the queue has gone. A replacement
    // already signed went through all the same: its list says so (else it
    // reads as interrupted, and what went through is skipped next time).
    if (abort.signal.aborted) {
      if (result.ok) this.setEntry(entryId, { removal: 'removed' }, owner);
      return;
    }
    if (result.ok) {
      set({ removal: 'removed' });
      return;
    }
    const failed = result.outcomes.find(
      (outcome) => outcome.status === 'failed'
    );
    set({
      removal: 'failed',
      removalError:
        (failed?.error ?? result.stoppedBy)?.code ?? 'publish-failed',
    });
  }
}

let shared: VideoPublisherController | null = null;

/** Hub's one controller (the queue outlives the window). */
export const videoPublisherController = (): VideoPublisherController => {
  shared ??= new VideoPublisherController();
  return shared;
};

/** Tests: a controller with fakes, or back to a fresh default one. */
export const setVideoPublisherControllerForTests = (
  controller: VideoPublisherController | null
) => {
  shared?.dispose();
  shared = controller;
};
