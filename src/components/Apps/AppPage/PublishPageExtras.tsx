import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  alpha,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import {
  APP_PAGE_LIMITS,
  AppPageData,
  EMPTY_APP_PAGE,
  SHOT_LIMITS,
  ShotsManifest,
  suggestNextVersion,
} from './appPageData';
import {
  AppPageError,
  fetchAppPage,
  fetchShotsManifest,
  findAppPageResources,
  publishAppPage,
  publishAppShots,
  ShotUpload,
} from './appPageQdn';
import {
  checkShotsCurrent,
  draftsFromManifest,
  heldAfterPublish,
  manifestOfHeld,
  shotDraftsChanged,
  uploadsFromDrafts,
} from './appPageDrafts';
import { appPageErrorText } from './appPageErrors';
import { ScreenshotsEditor, ShotDraft } from './ScreenshotsEditor';
import type { CaptureSource } from './ScreenshotCaptureDialog';

/** For an app that has screenshots already: what to do with them. */
export type ShotsMode = 'keep' | 'change' | 'none';

/**
 * Where the app's current page part stands. Only 'loaded' and 'missing' (the
 * node lists none) are safe to publish over: while it loads, or when the node
 * lists one it couldn't read, publishing would replace what's there.
 */
export type PartLoad = 'idle' | 'loading' | 'loaded' | 'missing' | 'failed';

const isKnown = (load: PartLoad) => load === 'loaded' || load === 'missing';

/** What to publish with the app, after it. */
export interface PublishExtras {
  shots: ShotDraft[] | null;
  page: AppPageData | null;
  /** The form read the app's page when it opened (not: the node had none). */
  pageWasRead?: boolean;
}

/** A part of the app's page, as the form tells its input apart. */
export type PagePart = 'page' | 'shots';

/** The page parts that didn't go out, as prepare() gave them, and why. */
export interface PartsLeft {
  extras: PublishExtras;
  /** The page text's error when it failed, else the screenshots'. */
  error: unknown;
}

/** What became of the screenshots, for the form that holds them. */
export type ShotsOutcome = { app: { service: string; name: string } } & (
  | {
      /** Published: the list as it went out, and its pictures. */
      published: ShotDraft[];
      uploads: ShotUpload[];
    }
  | {
      /** Not published: the set they were read from was replaced since. */
      replaced: true;
    }
);

export interface PublishExtrasHandle {
  /** What to publish with the app, from what the form holds now. */
  prepare: () => PublishExtras;
  /** Tells the form what became of the screenshots it gave. */
  noteShots: (outcome: ShotsOutcome) => void;
  /**
   * Whether each part holds something of its own to publish, read or not:
   * a version or What's new typed, screenshots chosen or changed.
   */
  hasDrafts: () => Record<PagePart, boolean>;
}

/** What the form will publish with the app, for its summary and preview. */
export interface ExtrasSummary {
  pageText: boolean;
  /** New screenshots, taking them off, keeping the published ones, or none. */
  screenshots: 'chosen' | 'remove' | 'keep' | 'none';
  shotCount: number;
  /** Pictures to show in a preview, first ones first. */
  shotUrls: string[];
  version: string;
}

export const extrasPartCount = (extras: PublishExtras | null) =>
  (extras?.shots ? 1 : 0) + (extras?.page ? 1 : 0);

/**
 * The screenshots to publish with the app. Null leaves the page's screenshots
 * as they are; an empty list takes them off the page.
 */
export const screenshotsToPublish = (
  shots: ShotDraft[],
  existing: ShotsManifest | null,
  mode: ShotsMode
): ShotDraft[] | null => {
  if (!existing?.shots.length) return shots.length ? shots : null;
  if (mode === 'none') return [];
  if (mode === 'change' && shotDraftsChanged(shots, existing)) return shots;
  return null;
};

/**
 * The page as the node has it now; null when it lists none. Throws
 * PAGE_UNVERIFIED when the node can't say what the page has: its search
 * fails, it lists a page it can't read, or it lists none although the form
 * read one. The form's copy would then replace About and links saved since.
 */
const readCurrentPage = async (
  app: { service: string; name: string },
  formReadOne: boolean
) => {
  const base = getBaseApiReact();
  const resources = await findAppPageResources(base, app).catch(() => null);
  if (!resources) throw new AppPageError('PAGE_UNVERIFIED');
  if (!resources.page) {
    if (formReadOne) throw new AppPageError('PAGE_UNVERIFIED');
    return null;
  }
  const page = await fetchAppPage(base, app).catch(() => null);
  if (!page) throw new AppPageError('PAGE_UNVERIFIED');
  return page;
};

const isShotsChanged = (cause: unknown) =>
  (cause as AppPageError)?.code === 'SHOTS_CHANGED';

/**
 * Before the fee: the screenshots to publish come from the node's current set
 * (see checkShotsCurrent). Throws why not, and tells `onShots` when the set
 * was replaced, so the form offers to load the current one.
 */
export const checkPageExtras = async (
  app: { service: string; name: string },
  extras: PublishExtras | null,
  onShots?: (outcome: ShotsOutcome) => void
): Promise<void> => {
  try {
    await checkShotsCurrent(getBaseApiReact(), app, extras?.shots ?? null);
  } catch (cause) {
    if (isShotsChanged(cause)) onShots?.({ app, replaced: true });
    throw cause;
  }
};

/**
 * Publishes the page parts after the app. `appSignature` is the app's new
 * signature, so the version and What's new describe this upload. Each part
 * goes out on its own; the ones that failed come back, so they can be tried
 * again without the app. Null when every part went out. `onShots` hears what
 * became of the screenshots: the form holds them as published, or offers to
 * load the current ones.
 */
export const publishPageExtras = async (
  app: { service: string; name: string },
  extras: PublishExtras | null,
  appSignature: string,
  onShots?: (outcome: ShotsOutcome) => void
): Promise<PartsLeft | null> => {
  if (!extras) return null;
  const left: PublishExtras = { ...extras, page: null, shots: null };
  let error: unknown = null;
  if (extras.page) {
    try {
      // About and links saved since the form read the page (on the app's
      // page, or on another device) stay: only the version and What's new are
      // new.
      const current = await readCurrentPage(app, !!extras.pageWasRead);
      await publishAppPage(app, {
        ...(current || extras.page),
        version: extras.page.version,
        whatsNew: extras.page.whatsNew,
        appSignature,
      });
    } catch (cause) {
      left.page = extras.page;
      error = cause;
    }
  }
  if (extras.shots) {
    let outcome: ShotsOutcome | null = null;
    try {
      // Checked again: the set may have been replaced since the fee.
      const uploads = await uploadsFromDrafts(
        getBaseApiReact(),
        app,
        extras.shots
      );
      await publishAppShots(app, uploads);
      outcome = { app, published: extras.shots, uploads };
    } catch (cause) {
      left.shots = extras.shots;
      if (!left.page) error = cause;
      if (isShotsChanged(cause)) outcome = { app, replaced: true };
    }
    if (outcome) onShots?.(outcome);
  }
  return left.page || left.shots ? { extras: left, error } : null;
};

export const PublishPageExtras = forwardRef<
  PublishExtrasHandle,
  {
    service: string;
    name: string;
    file: Blob | null;
    /** Inside a form section that shows the title itself. */
    bare?: boolean;
    /** Told when the user changes a part here (not when it loads). */
    onInput?: (part: PagePart) => void;
    onSummaryChange?: (summary: ExtrasSummary) => void;
  }
>(({ service, name, file, bare = false, onInput, onSummaryChange }, ref) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [existingPage, setExistingPage] = useState<AppPageData | null>(null);
  const [existingShots, setExistingShots] = useState<ShotsManifest | null>(
    null
  );
  const [shotsVersion, setShotsVersion] = useState('');
  const [mode, setMode] = useState<ShotsMode>('keep');
  const [shots, setShots] = useState<ShotDraft[]>([]);
  const shotsRef = useRef<ShotDraft[]>([]);
  shotsRef.current = shots;
  const [version, setVersion] = useState('');
  const [whatsNew, setWhatsNew] = useState('');
  const [error, setError] = useState('');
  const [pageLoad, setPageLoad] = useState<PartLoad>('idle');
  const [shotsLoad, setShotsLoad] = useState<PartLoad>('idle');
  // Counts the Retry presses after a failed read.
  const [retry, setRetry] = useState(0);
  const retryReadRef = useRef(0);
  // The screenshots were replaced on the node since the form read them.
  const [shotsReplaced, setShotsReplaced] = useState(false);
  // Refresh is reading the current ones; each press or reset counts.
  const [reloadingShots, setReloadingShots] = useState(false);
  const reloadRunRef = useRef(0);
  // The screenshots this form just published, holding their pictures, until
  // the form reads the node's again.
  const [ownShots, setOwnShots] = useState<ShotDraft[] | null>(null);
  const shotsTitleId = useId();

  // What the app's page has now, for an update.
  useEffect(() => {
    // A retry reads the parts not known yet (it cuts off one still loading),
    // and keeps what the form holds.
    const again = retryReadRef.current !== retry;
    retryReadRef.current = retry;
    const readPage = !again || !isKnown(pageLoad);
    const readShots = !again || !isKnown(shotsLoad);
    if (!again) {
      setExistingPage(null);
      setExistingShots(null);
      setShotsVersion('');
      setShots([]);
      shotsRef.current = [];
      setVersion('');
      setWhatsNew('');
      setMode('keep');
      setError('');
      setShotsReplaced(false);
      setOwnShots(null);
      reloadRunRef.current += 1;
      setReloadingShots(false);
    }
    if (!name || !service) {
      setPageLoad('idle');
      setShotsLoad('idle');
      return;
    }
    if (readPage) setPageLoad('loading');
    if (readShots) setShotsLoad('loading');
    const controller = new AbortController();
    const { signal } = controller;
    const base = getBaseApiReact();
    const app = { service, name };
    const loadPage = async (listed: boolean) => {
      if (!listed) {
        setPageLoad('missing');
        return;
      }
      const page = await fetchAppPage(base, app, signal).catch((cause) => {
        if (cause?.name === 'AbortError') throw cause;
        return null;
      });
      if (signal.aborted) return;
      setExistingPage(page);
      setPageLoad(page ? 'loaded' : 'failed');
    };
    const loadShots = async (resource: { signature: string } | null) => {
      if (!resource) {
        setShotsLoad('missing');
        return;
      }
      const manifest = await fetchShotsManifest(base, app, signal).catch(
        (cause) => {
          if (cause?.name === 'AbortError') throw cause;
          return null;
        }
      );
      if (signal.aborted) return;
      if (!manifest) {
        setShotsLoad('failed');
        return;
      }
      setExistingShots(manifest);
      setShotsVersion(resource.signature);
      setShotsLoad('loaded');
      if (manifest.shots.length) {
        // A change starts from the published ones.
        setShots(
          draftsFromManifest(base, app, manifest, resource.signature).slice(
            0,
            SHOT_LIMITS.count
          )
        );
        setMode('keep');
      }
    };
    (async () => {
      try {
        const resources = await findAppPageResources(base, app, signal);
        await Promise.all([
          readPage && loadPage(!!resources.page),
          readShots && loadShots(resources.shots),
        ]);
      } catch (cause) {
        if ((cause as Error)?.name === 'AbortError' || signal.aborted) return;
        // The node couldn't say what the page has: publish none of it.
        setPageLoad((value) => (value === 'loading' ? 'failed' : value));
        setShotsLoad((value) => (value === 'loading' ? 'failed' : value));
      }
    })();
    return () => controller.abort();
  }, [name, service, retry]);

  const captureSource: CaptureSource | null = useMemo(
    () => (file && name ? { kind: 'zip', service, name, file } : null),
    [file, name, service]
  );

  const pageExtras = (): AppPageData | null => {
    // Only over a page that was read, or when there's none: else this would
    // publish empty About and links in place of the real ones.
    if (!isKnown(pageLoad)) return null;
    if (!version.trim() && !whatsNew.trim()) return null;
    return {
      ...(existingPage || EMPTY_APP_PAGE),
      version: version.trim(),
      whatsNew: whatsNew.trim(),
    };
  };

  useImperativeHandle(ref, () => ({
    prepare: () => ({
      shots: isKnown(shotsLoad)
        ? screenshotsToPublish(shots, existingShots, mode)
        : null,
      page: pageExtras(),
      pageWasRead: pageLoad === 'loaded',
    }),
    noteShots: (outcome) => {
      // For another app's screenshots, or ones read again since: too late.
      if (outcome.app.service !== service || outcome.app.name !== name) return;
      if (!isKnown(shotsLoad)) return;
      if ('replaced' in outcome) {
        setShotsReplaced(true);
        return;
      }
      // The published list is what the node has now; edits made meanwhile
      // stay, on top of it.
      const { held, move } = heldAfterPublish(
        outcome.published,
        outcome.uploads
      );
      setOwnShots(held);
      setExistingShots(manifestOfHeld(held));
      setShotsVersion('');
      if (held.length) {
        setShots((current) => move(current));
      } else {
        // Taken off: what the form held was set aside, and stays off.
        setShots([]);
        setMode('keep');
      }
      setShotsReplaced(false);
    },
    hasDrafts: () => ({
      page: !!(version.trim() || whatsNew.trim()),
      shots: screenshotsToPublish(shots, existingShots, mode) !== null,
    }),
  }));

  // Reads the screenshots again, after they were replaced on the node: the
  // pictures added here stay, after the current ones, which make way for
  // them over the limit. The rest of the form stays as it is. Until it ends,
  // the form holds the old ones, so a publish meanwhile stops as replaced.
  const reloadShots = async () => {
    const run = ++reloadRunRef.current;
    const base = getBaseApiReact();
    const app = { service, name };
    setReloadingShots(true);
    setError('');
    try {
      const resources = await findAppPageResources(base, app);
      const manifest = resources.shots
        ? await fetchShotsManifest(base, app)
        : null;
      if (run !== reloadRunRef.current) return;
      if (resources.shots && !manifest) {
        throw new AppPageError('SHOT_UNAVAILABLE');
      }
      const signature = resources.shots?.signature || '';
      const current = draftsFromManifest(base, app, manifest, signature);
      const added = shotsRef.current.filter(
        (shot) => !shot.id.startsWith('existing-')
      );
      setExistingShots(manifest);
      setShotsVersion(signature);
      setShotsLoad(resources.shots ? 'loaded' : 'missing');
      setOwnShots(null);
      setShots([
        ...current.slice(0, Math.max(0, SHOT_LIMITS.count - added.length)),
        ...added.slice(0, SHOT_LIMITS.count),
      ]);
      setMode(added.length ? 'change' : 'keep');
      setShotsReplaced(false);
    } catch (cause) {
      // The warning and its Refresh stay, to try again.
      if (run === reloadRunRef.current) setError(appPageErrorText(t, cause));
    } finally {
      if (run === reloadRunRef.current) setReloadingShots(false);
    }
  };

  const suggestion = existingPage?.version
    ? suggestNextVersion(existingPage.version)
    : '';
  const existingDrafts = useMemo(
    () =>
      ownShots ||
      draftsFromManifest(
        getBaseApiReact(),
        { service, name },
        existingShots,
        shotsVersion
      ),
    [existingShots, name, ownShots, service, shotsVersion]
  );
  // Said while what would be published reads pictures back from that set.
  const showShotsReplaced =
    shotsReplaced &&
    !reloadingShots &&
    isKnown(shotsLoad) &&
    !!screenshotsToPublish(shots, existingShots, mode)?.some(
      (shot) => !shot.blob
    );

  const hasExisting = !!existingShots?.shots.length;
  // With no name yet there's no page to read; typing ahead is fine.
  const pageReady = isKnown(pageLoad) || pageLoad === 'idle';
  // The same as prepare(): nothing of a part whose current state isn't known.
  const summary: ExtrasSummary = useMemo(() => {
    const toPublish = isKnown(shotsLoad)
      ? screenshotsToPublish(shots, existingShots, mode)
      : null;
    // What the page will show: the new list, or the published one kept.
    const list = toPublish ?? (hasExisting ? existingDrafts : []);
    let screenshots: ExtrasSummary['screenshots'] = hasExisting
      ? 'keep'
      : 'none';
    if (toPublish) screenshots = toPublish.length ? 'chosen' : 'remove';
    return {
      pageText: isKnown(pageLoad) && !!(version.trim() || whatsNew.trim()),
      screenshots,
      shotCount: list.length,
      shotUrls: list.slice(0, 3).map((shot) => shot.url),
      version: isKnown(pageLoad) ? version.trim() : '',
    };
  }, [
    existingDrafts,
    existingShots,
    hasExisting,
    mode,
    pageLoad,
    shots,
    shotsLoad,
    version,
    whatsNew,
  ]);
  const summaryRef = useRef(onSummaryChange);
  summaryRef.current = onSummaryChange;
  // What the user changes, as against what was read from the node.
  const changeShots = (next: ShotDraft[]) => {
    onInput?.('shots');
    setShots(next);
  };
  const changeVersion = (next: string) => {
    onInput?.('page');
    setVersion(next);
  };
  useEffect(() => {
    summaryRef.current?.(summary);
  }, [summary]);

  const options: { value: ShotsMode; label: string; hint: string }[] = [
    {
      value: 'keep',
      label: t('core:app_page.publish.shots_keep', {
        count: existingShots?.shots.length || 0,
        postProcess: 'capitalizeFirstChar',
      }),
      hint: '',
    },
    {
      value: 'change',
      label: t('core:app_page.publish.shots_change', {
        postProcess: 'capitalizeFirstChar',
      }),
      hint: t('core:app_page.publish.shots_change_hint', {
        postProcess: 'capitalizeFirstChar',
      }),
    },
    {
      value: 'none',
      label: t('core:app_page.publish.shots_none', {
        postProcess: 'capitalizeFirstChar',
      }),
      hint: t('core:app_page.publish.shots_none_removes', {
        postProcess: 'capitalizeFirstChar',
      }),
    },
  ];

  return (
    <Box
      sx={
        bare
          ? { width: '100%' }
          : {
              border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
              borderRadius: '14px',
              mt: 2,
              p: 2,
              width: '100%',
            }
      }
    >
      {!bare && (
        <>
          <Typography sx={{ fontSize: '15px', fontWeight: 650 }}>
            {t('core:app_page.publish.title', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
          <Typography
            sx={{ color: 'text.secondary', fontSize: '12.5px', mb: 1.5 }}
          >
            {t('core:app_page.publish.hint', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
        </>
      )}

      {(pageLoad === 'loading' ||
        shotsLoad === 'loading' ||
        reloadingShots) && (
        <Box
          aria-live="polite"
          sx={{
            alignItems: 'center',
            color: 'text.secondary',
            display: 'flex',
            fontSize: '12.5px',
            gap: 1,
            mb: 1.5,
          }}
        >
          <CircularProgress size={12} />
          {t('core:app_page.publish.page_loading', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Box>
      )}
      {(pageLoad === 'failed' || shotsLoad === 'failed') && (
        <Alert
          action={
            <Button
              color="inherit"
              onClick={() => setRetry((value) => value + 1)}
              size="small"
              sx={{ textTransform: 'none' }}
            >
              {t('core:retry', { postProcess: 'capitalizeFirstChar' })}
            </Button>
          }
          severity="warning"
          sx={{ mb: 1.5 }}
        >
          {t('core:app_page.publish.page_unreadable', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Alert>
      )}
      {showShotsReplaced && (
        <Alert
          action={
            <Button
              color="inherit"
              onClick={() => void reloadShots()}
              size="small"
              sx={{ textTransform: 'none' }}
            >
              {t('core:action.refresh', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          }
          severity="warning"
          sx={{ mb: 1.5 }}
        >
          {appPageErrorText(t, new AppPageError('SHOTS_CHANGED'))}
        </Alert>
      )}

      <Typography
        id={shotsTitleId}
        sx={{ fontSize: '13.5px', fontWeight: 600 }}
      >
        {t('core:app_page.screenshots.title', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Typography>
      {reloadingShots ||
      (!isKnown(shotsLoad) && shotsLoad !== 'idle') ? null : hasExisting ? (
        <RadioGroup
          aria-labelledby={shotsTitleId}
          onChange={(event) => {
            onInput?.('shots');
            setMode(event.target.value as ShotsMode);
          }}
          value={mode}
        >
          {options.map((option) => (
            <FormControlLabel
              control={<Radio size="small" />}
              key={option.value}
              label={
                <Box>
                  <Typography sx={{ fontSize: '14px' }}>
                    {option.label}
                  </Typography>
                  {option.hint && (
                    <Typography
                      sx={{ color: 'text.secondary', fontSize: '12px' }}
                    >
                      {option.hint}
                    </Typography>
                  )}
                </Box>
              }
              sx={{
                alignItems: 'flex-start',
                my: 0.25,
                '& .MuiRadio-root': { pt: 0.5 },
              }}
              value={option.value}
            />
          ))}
        </RadioGroup>
      ) : (
        <Typography sx={{ color: 'text.secondary', fontSize: '12.5px', mb: 1 }}>
          {t('core:app_page.publish.shots_optional', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>
      )}

      {!reloadingShots &&
        hasExisting &&
        mode === 'keep' &&
        existingDrafts.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, mt: 1, overflowX: 'auto' }}>
            {existingDrafts.map((shot, index) => (
              <Box
                alt={t('core:app_page.screenshots.alt_editor', {
                  index: index + 1,
                  postProcess: 'capitalizeFirstChar',
                })}
                component="img"
                key={shot.id}
                src={shot.url}
                sx={{
                  borderRadius: '8px',
                  height: 72,
                  objectFit: 'cover',
                  width: 116,
                }}
              />
            ))}
          </Box>
        )}
      {!reloadingShots &&
        (isKnown(shotsLoad) || shotsLoad === 'idle') &&
        (!hasExisting || mode === 'change') && (
          <Box sx={{ mt: 1 }}>
            <ScreenshotsEditor
              captureSource={captureSource}
              captureUnavailableReason={
                name
                  ? t('core:app_page.publish.choose_file_first', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('core:app_page.publish.choose_name_first', {
                      postProcess: 'capitalizeFirstChar',
                    })
              }
              onChange={changeShots}
              onError={setError}
              shots={shots}
            />
            {hasExisting && shots.length === 0 && (
              <Alert severity="info" sx={{ mt: 1.5 }}>
                {t('core:app_page.edit.screenshots_removed', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Alert>
            )}
          </Box>
        )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 2.5 }}>
        <TextField
          disabled={!pageReady}
          helperText={
            existingPage?.version
              ? t('core:app_page.publish.version_last', {
                  version: existingPage.version,
                  postProcess: 'capitalizeFirstChar',
                })
              : t('core:app_page.edit.version_hint', {
                  postProcess: 'capitalizeFirstChar',
                })
          }
          inputProps={{ maxLength: APP_PAGE_LIMITS.version }}
          label={t('core:app_page.details.version', {
            postProcess: 'capitalizeFirstChar',
          })}
          onChange={(event) => changeVersion(event.target.value)}
          placeholder={suggestion || '1.0.0'}
          size="small"
          sx={{ width: 220 }}
          value={version}
        />
        {pageReady && suggestion && !version && (
          <Button
            onClick={() => changeVersion(suggestion)}
            size="small"
            sx={{ alignSelf: 'flex-start', mt: 0.5, textTransform: 'none' }}
          >
            {t('core:app_page.edit.next_version', {
              version: suggestion,
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        )}
      </Box>
      <TextField
        disabled={!pageReady}
        fullWidth
        helperText={t('core:app_page.reviews.characters', {
          length: whatsNew.length,
          limit: APP_PAGE_LIMITS.whatsNew,
        })}
        inputProps={{ maxLength: APP_PAGE_LIMITS.whatsNew }}
        label={t('core:app_page.whats_new.title', {
          postProcess: 'capitalizeFirstChar',
        })}
        minRows={2}
        multiline
        onChange={(event) => {
          onInput?.('page');
          setWhatsNew(event.target.value.slice(0, APP_PAGE_LIMITS.whatsNew));
        }}
        placeholder={t('core:app_page.publish.whats_new_placeholder', {
          postProcess: 'capitalizeFirstChar',
        })}
        size="small"
        sx={{ mt: 1.5 }}
        value={whatsNew}
      />
      {error && (
        <Typography
          sx={{ color: theme.palette.error.main, fontSize: '12.5px', mt: 1 }}
        >
          {error}
        </Typography>
      )}
    </Box>
  );
});

PublishPageExtras.displayName = 'PublishPageExtras';
