import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  alpha,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Tab,
  Tabs,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import { useTranslation } from 'react-i18next';
import LogoSelected from '../../../assets/svgs/LogoSelected.svg';
import { getBaseApiReact, QORTAL_APP_CONTEXT } from '../../../App';
import { getFee } from '../../../background/background';
import {
  limitQdnDescription,
  limitQdnTag,
  limitQdnTitle,
} from '../../../utils/qdnMetadataLimits';
import { formatBytes } from '../../../utils/numberFunctions';
import {
  APP_LINK_KINDS,
  APP_PAGE_LIMITS,
  AppPageData,
  EMPTY_APP_PAGE,
  isAppPageEmpty,
  normalizeAppLink,
  sameAppPage,
  SHOT_LIMITS,
  ShotsManifest,
  suggestNextVersion,
} from './appPageData';
import {
  appIconUrl,
  AppPageError,
  fetchShotsManifest,
  FilesProgress,
  findAppPageResources,
  publishAppIcon,
  publishAppPage,
  publishAppShots,
  republishAppDetails,
} from './appPageQdn';
import {
  checkShotsCurrent,
  draftsFromManifest,
  heldAfterPublish,
  sameShotDrafts,
  uploadsFromDrafts,
} from './appPageDrafts';
import { appPageErrorText } from './appPageErrors';
import type { CaptureSource } from './ScreenshotCaptureDialog';
import { ScreenshotsEditor, ShotDraft } from './ScreenshotsEditor';
import { encodeSquareIcon, MAX_IMAGE_FILE_BYTES } from './screenshotImage';
import { appTags } from './AppDetailsCard';
import { useLauncherTabDialog } from '../launcherTabs';

export type EditorTab = 'page' | 'screenshots' | 'icon' | 'listing';
type Part = 'listing' | 'page' | 'screenshots' | 'icon';
type PartState = 'waiting' | 'working' | 'done' | 'failed';

export interface EditorSaved {
  page?: AppPageData;
  shots?: ShotDraft[];
  iconUrl?: string;
  listing?: {
    title: string;
    description: string;
    category: string;
    tags: string[];
  };
  /** The app's new signature, after its listing was published again. */
  appSignature?: string;
}

interface Listing {
  title: string;
  description: string;
  category: string;
  tags: string[];
}

const listingOf = (app: any): Listing => {
  const tags = appTags(app).slice(0, 5);
  return {
    title: app?.metadata?.title || '',
    description: app?.metadata?.description || '',
    category: app?.metadata?.category || '',
    tags: [...tags, '', '', '', '', ''].slice(0, 5),
  };
};

const sameListing = (a: Listing, b: Listing) =>
  a.title.trim() === b.title.trim() &&
  a.description.trim() === b.description.trim() &&
  a.category === b.category &&
  a.tags.map((tag) => tag.trim()).join('\n') ===
    b.tags.map((tag) => tag.trim()).join('\n');

const signatureOf = (response: any): string =>
  typeof response?.signature === 'string' ? response.signature : '';

const isShotsChanged = (cause: unknown) =>
  (cause as AppPageError)?.code === 'SHOTS_CHANGED';

export const AppPageEditorDialog = ({
  open,
  initialTab,
  app,
  page,
  shots,
  shotsVersion,
  savedShots = null,
  pageUnreadable = false,
  shotsUnreadable = false,
  pageLoading = false,
  shotsLoading = false,
  onClose,
  onSaved,
}: {
  open: boolean;
  initialTab: EditorTab;
  app: any;
  page: AppPageData | null;
  shots: ShotsManifest | null;
  shotsVersion?: string;
  /** Screenshots just published from here, newer than what the node lists. */
  savedShots?: ShotDraft[] | null;
  /** The node lists a page text it couldn't read: editing it would wipe it. */
  pageUnreadable?: boolean;
  /** The same for the screenshots. */
  shotsUnreadable?: boolean;
  /**
   * The page text is still loading: it can't be edited or published yet,
   * or what the empty fields hold would replace it.
   */
  pageLoading?: boolean;
  /** The same for the screenshots. */
  shotsLoading?: boolean;
  onClose: () => void;
  onSaved: (saved: EditorSaved) => void;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const ref = useMemo(
    () => ({ service: app?.service || 'APP', name: app?.name || '' }),
    [app?.service, app?.name]
  );
  // The same object across renders: a new one starts the capture over, and
  // the screenshots taken so far are lost.
  const captureSource: CaptureSource = useMemo(
    () => ({ kind: 'published', service: ref.service, name: ref.name }),
    [ref]
  );
  const [tab, setTab] = useState<EditorTab>(initialTab);
  const [pageDraft, setPageDraftState] = useState<AppPageData>(
    page || EMPTY_APP_PAGE
  );
  // The screenshots read again here, after they were replaced on the node.
  const [freshShots, setFreshShots] = useState<{
    manifest: ShotsManifest | null;
    version: string;
  } | null>(null);
  const [reloadingShots, setReloadingShots] = useState(false);
  const [shotsReplaced, setShotsReplaced] = useState(false);
  // What the screenshots are now: the ones read again, the ones just saved,
  // or the node's.
  const baseShots = useMemo(
    () =>
      freshShots
        ? draftsFromManifest(
            getBaseApiReact(),
            ref,
            freshShots.manifest,
            freshShots.version
          )
        : savedShots ||
          draftsFromManifest(getBaseApiReact(), ref, shots, shotsVersion),
    [freshShots, ref, savedShots, shots, shotsVersion]
  );
  const [shotDrafts, setShotDraftsState] = useState<ShotDraft[]>(baseShots);
  // Parts the user changed since opening: the rest follow late-loading data.
  const pageTouched = useRef(false);
  const shotsTouched = useRef(false);
  const setPageDraft: typeof setPageDraftState = (value) => {
    pageTouched.current = true;
    setPageDraftState(value);
  };
  const setShotDrafts = (value: ShotDraft[]) => {
    shotsTouched.current = true;
    setShotDraftsState(value);
  };
  const [icon, setIcon] = useState<{ blob: Blob; url: string } | null>(null);
  const [iconFailed, setIconFailed] = useState(false);
  const [listing, setListing] = useState<Listing>(listingOf(app));
  const [categories, setCategories] = useState<{ id: string; name: string }[]>(
    []
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<Partial<Record<Part, PartState>>>(
    {}
  );
  const [filesProgress, setFilesProgress] = useState<FilesProgress | null>(
    null
  );
  const iconInput = useRef<HTMLInputElement>(null);
  // The check before the fee is running: Publish waits for it.
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);
  // Counts openings and closings: work started before one changes nothing.
  const sessionRef = useRef(0);

  // A fresh start each time the dialog opens.
  useEffect(() => {
    sessionRef.current += 1;
    checkingRef.current = false;
    setChecking(false);
    setReloadingShots(false);
    if (!open) return;
    pageTouched.current = false;
    shotsTouched.current = false;
    setTab(initialTab);
    setPageDraftState(page || EMPTY_APP_PAGE);
    setFreshShots(null);
    setShotsReplaced(false);
    // The node's or the saved ones: what was read again last time is gone.
    setShotDraftsState(
      savedShots ||
        draftsFromManifest(getBaseApiReact(), ref, shots, shotsVersion)
    );
    setIcon(null);
    setIconFailed(false);
    setListing(listingOf(app));
    setError('');
    setProgress({});
    setFilesProgress(null);
    setSaving(false);
    // Only on opening: later prop changes must not wipe the edits.
  }, [open]);

  // The page or screenshots arrived after opening: start from them, unless
  // the user already changed that part.
  useEffect(() => {
    if (open && !pageTouched.current) setPageDraftState(page || EMPTY_APP_PAGE);
  }, [open, page]);
  useEffect(() => {
    if (open && !shotsTouched.current) setShotDraftsState(baseShots);
  }, [open, baseShots]);

  useEffect(() => {
    if (!open || categories.length) return;
    fetch(`${getBaseApiReact()}/arbitrary/categories`)
      .then((response) => (response.ok ? response.json() : []))
      .then((list) => Array.isArray(list) && setCategories(list))
      .catch(() => undefined);
  }, [open, categories.length]);

  const linkErrors = APP_LINK_KINDS.filter(
    (kind) =>
      pageDraft.links[kind]?.trim() && !normalizeAppLink(pageDraft.links[kind])
  );
  // A part the node couldn't read, or hasn't sent yet, is never published:
  // it would replace the real one with what the empty editor holds.
  const pageChanged =
    !pageUnreadable && !pageLoading && !sameAppPage(pageDraft, page);
  const shotsBusy = shotsLoading || reloadingShots;
  const shotsChanged =
    !shotsUnreadable && !shotsBusy && !sameShotDrafts(shotDrafts, baseShots);
  const listingChanged = !sameListing(listing, listingOf(app));
  const versionPartChanged =
    pageDraft.version.trim() !== (page?.version || '').trim() ||
    pageDraft.whatsNew.trim() !== (page?.whatsNew || '').trim();
  // A new upload of the app makes the page's version refer to it again.
  const pageNeedsResign =
    !pageUnreadable &&
    !pageLoading &&
    listingChanged &&
    !!(page?.version || page?.whatsNew) &&
    !pageChanged;

  const parts: Part[] = [
    ...(listingChanged ? (['listing'] as Part[]) : []),
    ...(pageChanged || pageNeedsResign ? (['page'] as Part[]) : []),
    ...(shotsChanged ? (['screenshots'] as Part[]) : []),
    ...(icon ? (['icon'] as Part[]) : []),
  ];

  const partLabel = (part: Part) =>
    t(`core:app_page.edit.part_${part}`, {
      postProcess: 'capitalizeFirstChar',
    });

  const errorText = (cause: unknown) => appPageErrorText(t, cause);

  const save = async () => {
    if (parts.length === 0 || linkErrors.length || checkingRef.current) return;
    // Closed and opened again while this waits: that opening is over.
    const session = sessionRef.current;
    setError('');
    setShotsReplaced(false);
    // Before the fee: screenshots read back from a set replaced since, or
    // that the node can't confirm, stop it.
    if (parts.includes('screenshots')) {
      checkingRef.current = true;
      setChecking(true);
      let current = true;
      let failure: unknown = null;
      try {
        await checkShotsCurrent(getBaseApiReact(), ref, shotDrafts);
      } catch (cause) {
        current = false;
        failure = cause;
      }
      if (session !== sessionRef.current) return;
      checkingRef.current = false;
      setChecking(false);
      if (!current) {
        setShotsReplaced(isShotsChanged(failure));
        setError(errorText(failure));
        return;
      }
    }
    let fee: { fee: string };
    try {
      fee = await getFee('ARBITRARY');
    } catch (cause) {
      // The node can't be reached: say so, rather than act as if cancelled.
      if (session === sessionRef.current) setError(errorText(cause));
      return;
    }
    if (session !== sessionRef.current) return;
    try {
      await show({
        message: t('core:app_page.edit.confirm', {
          parts: parts.map(partLabel).join(', '),
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: `${(Number(fee.fee) * parts.length).toFixed(2)} QORT`,
      });
    } catch {
      return;
    }
    setSaving(true);
    setProgress(Object.fromEntries(parts.map((part) => [part, 'waiting'])));
    const saved: EditorSaved = {};
    let appSignature = app?.latestSignature || page?.appSignature || '';
    let failed = false;

    const step = async (part: Part, run: () => Promise<void>) => {
      if (failed) return;
      setProgress((value) => ({ ...value, [part]: 'working' }));
      try {
        await run();
        setProgress((value) => ({ ...value, [part]: 'done' }));
      } catch (cause) {
        failed = true;
        setProgress((value) => ({ ...value, [part]: 'failed' }));
        setError(errorText(cause));
        setShotsReplaced(part === 'screenshots' && isShotsChanged(cause));
      }
    };

    if (parts.includes('listing')) {
      await step('listing', async () => {
        const details = {
          title: limitQdnTitle(listing.title.trim()),
          description: limitQdnDescription(listing.description.trim()),
          category: listing.category,
          tags: listing.tags
            .map((tag) => limitQdnTag(tag.trim()))
            .filter(Boolean),
        };
        const response = await republishAppDetails(
          getBaseApiReact(),
          ref,
          details,
          {
            onProgress: setFilesProgress,
          }
        );
        appSignature = signatureOf(response) || appSignature;
        saved.listing = details;
        if (signatureOf(response)) saved.appSignature = appSignature;
      });
    }
    if (parts.includes('page')) {
      await step('page', async () => {
        const next: AppPageData = {
          ...pageDraft,
          appSignature:
            versionPartChanged || pageNeedsResign || saved.listing
              ? appSignature
              : page?.appSignature || appSignature,
        };
        await publishAppPage(ref, next);
        saved.page = { ...next, updated: Date.now() };
      });
    }
    if (parts.includes('screenshots')) {
      await step('screenshots', async () => {
        // Checked again: the set may have been replaced since the fee.
        const uploads = await uploadsFromDrafts(
          getBaseApiReact(),
          ref,
          shotDrafts
        );
        await publishAppShots(ref, uploads);
        // Held as pictures under their new files: a second change, or a
        // retry of a later part, reads none of them back by an old name.
        const { held, move } = heldAfterPublish(shotDrafts, uploads);
        saved.shots = held;
        setFreshShots(null);
        setShotDraftsState(move);
      });
    }
    if (parts.includes('icon') && icon) {
      await step('icon', async () => {
        await publishAppIcon(ref, icon.blob);
        saved.iconUrl = icon.url;
      });
    }
    setSaving(false);
    if (Object.keys(saved).length) onSaved(saved);
    if (!failed) onClose();
  };

  // Reads the screenshots again; the pictures added here stay, after them.
  // Dropped when the dialog was closed meanwhile.
  const reloadShots = async () => {
    const session = sessionRef.current;
    setError('');
    setShotsReplaced(false);
    setReloadingShots(true);
    try {
      const base = getBaseApiReact();
      const resources = await findAppPageResources(base, ref);
      const manifest = resources.shots
        ? await fetchShotsManifest(base, ref)
        : null;
      if (session !== sessionRef.current) return;
      if (resources.shots && !manifest) {
        throw new AppPageError('SHOT_UNAVAILABLE');
      }
      const version = resources.shots?.signature || '';
      const added = shotDrafts.filter(
        (shot) => !shot.id.startsWith('existing-')
      );
      const published = draftsFromManifest(base, ref, manifest, version);
      setFreshShots({ manifest, version });
      // Published ones make way for the added ones over the limit.
      setShotDraftsState([
        ...published.slice(0, Math.max(0, SHOT_LIMITS.count - added.length)),
        ...added.slice(0, SHOT_LIMITS.count),
      ]);
      shotsTouched.current = added.length > 0;
    } catch (cause) {
      if (session !== sessionRef.current) return;
      setShotsReplaced(true);
      setError(errorText(cause));
    } finally {
      if (session === sessionRef.current) setReloadingShots(false);
    }
  };

  const pickIcon = async (file: File | undefined) => {
    if (!file) return;
    if (
      !/^image\/(png|jpeg|webp)$/.test(file.type) ||
      file.size > MAX_IMAGE_FILE_BYTES
    ) {
      setError(
        t('core:app_page.screenshots.not_an_image', {
          name: file.name,
          postProcess: 'capitalizeFirstChar',
        })
      );
      return;
    }
    try {
      const blob = await encodeSquareIcon(file);
      if (icon) URL.revokeObjectURL(icon.url);
      setIcon({ blob, url: URL.createObjectURL(blob) });
      setError('');
    } catch {
      setError(
        t('core:app_page.screenshots.not_an_image', {
          name: file.name,
          postProcess: 'capitalizeFirstChar',
        })
      );
    }
  };

  const counter = (value: string, limit: number) =>
    t('core:app_page.reviews.characters', { length: value.length, limit });

  const field = (
    key: 'about' | 'whatsNew',
    label: string,
    limit: number,
    rows: number
  ) => (
    <TextField
      fullWidth
      helperText={counter(pageDraft[key], limit)}
      inputProps={{ maxLength: limit }}
      label={label}
      minRows={rows}
      multiline
      onChange={(event) =>
        setPageDraft((value) => ({
          ...value,
          [key]: event.target.value.slice(0, limit),
        }))
      }
      value={pageDraft[key]}
    />
  );

  // Put away, the drafts kept, while its launcher tab is hidden.
  const dialogShown = useLauncherTabDialog(open);

  // In place of a part's fields while the node's copy of it is on its way.
  const loadingNote = (
    <Box
      role="status"
      sx={{ alignItems: 'center', display: 'flex', gap: 1.5, pt: 2 }}
    >
      <CircularProgress size={18} />
      <Typography sx={{ color: 'text.secondary', fontSize: '13.5px' }}>
        {t('core:message.generic.loading', {
          postProcess: 'capitalizeFirstChar',
        })}
      </Typography>
    </Box>
  );

  return (
    <Dialog
      PaperProps={{ sx: { borderRadius: '18px' } }}
      aria-describedby="app-page-editor-hint"
      fullWidth
      maxWidth="md"
      onClose={saving ? undefined : onClose}
      {...dialogShown}
    >
      {/* The title names the dialog: the hint and Close stay out of it. */}
      <DialogTitle sx={{ pb: 0.5, pr: 6 }}>
        {t('core:app_page.edit.title', {
          name: app?.metadata?.title || app?.name,
          postProcess: 'capitalizeFirstChar',
        })}
      </DialogTitle>
      <IconButton
        aria-label={t('core:action.close', {
          postProcess: 'capitalizeFirstChar',
        })}
        disabled={saving}
        onClick={onClose}
        sx={{ position: 'absolute', right: 12, top: 12 }}
      >
        <CloseRoundedIcon />
      </IconButton>
      <Typography
        id="app-page-editor-hint"
        sx={{ color: 'text.secondary', fontSize: '13px', pb: 1.5, px: 3 }}
      >
        {t('core:app_page.edit.hint', { postProcess: 'capitalizeFirstChar' })}
      </Typography>
      <Tabs
        onChange={(_, value) => setTab(value)}
        sx={{ borderBottom: `1px solid ${theme.palette.divider}`, px: 2 }}
        value={tab}
        variant="scrollable"
      >
        {(['page', 'screenshots', 'icon', 'listing'] as EditorTab[]).map(
          (value) => (
            <Tab
              key={value}
              label={t(`core:app_page.edit.tab_${value}`, {
                postProcess: 'capitalizeFirstChar',
              })}
              sx={{ textTransform: 'none' }}
              value={value}
            />
          )
        )}
      </Tabs>
      <DialogContent sx={{ minHeight: 360 }}>
        {tab === 'page' && pageUnreadable && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {t('core:app_page.edit.page_unreadable', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Alert>
        )}
        {tab === 'page' && pageLoading && loadingNote}
        {tab === 'page' && !pageUnreadable && !pageLoading && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {field(
              'about',
              t('core:app_page.edit.about', {
                postProcess: 'capitalizeFirstChar',
              }),
              APP_PAGE_LIMITS.about,
              5
            )}
            <Box sx={{ alignItems: 'flex-start', display: 'flex', gap: 1 }}>
              <TextField
                helperText={t('core:app_page.edit.version_hint', {
                  postProcess: 'capitalizeFirstChar',
                })}
                inputProps={{ maxLength: APP_PAGE_LIMITS.version }}
                label={t('core:app_page.details.version', {
                  postProcess: 'capitalizeFirstChar',
                })}
                onChange={(event) =>
                  setPageDraft((value) => ({
                    ...value,
                    version: event.target.value,
                  }))
                }
                placeholder="1.0.0"
                sx={{ maxWidth: 220 }}
                value={pageDraft.version}
              />
              {page?.version &&
                pageDraft.version.trim() === page.version.trim() && (
                  <Button
                    onClick={() =>
                      setPageDraft((value) => ({
                        ...value,
                        version: suggestNextVersion(value.version),
                      }))
                    }
                    sx={{ mt: 1, textTransform: 'none' }}
                  >
                    {t('core:app_page.edit.next_version', {
                      version: suggestNextVersion(page.version),
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Button>
                )}
            </Box>
            {field(
              'whatsNew',
              t('core:app_page.whats_new.title', {
                postProcess: 'capitalizeFirstChar',
              }),
              APP_PAGE_LIMITS.whatsNew,
              3
            )}
            <Typography sx={{ fontSize: '14px', fontWeight: 650 }}>
              {t('core:app_page.edit.links', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
            {APP_LINK_KINDS.map((kind) => (
              <TextField
                error={linkErrors.includes(kind)}
                helperText={
                  linkErrors.includes(kind)
                    ? t('core:app_page.edit.link_invalid', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    : undefined
                }
                inputProps={{ maxLength: APP_PAGE_LIMITS.link }}
                key={kind}
                label={t(`core:app_page.links.${kind}`, {
                  postProcess: 'capitalizeFirstChar',
                })}
                onChange={(event) =>
                  setPageDraft((value) => ({
                    ...value,
                    links: { ...value.links, [kind]: event.target.value },
                  }))
                }
                placeholder={kind === 'support' ? 'qortal://…' : 'https://…'}
                size="small"
                value={pageDraft.links[kind] || ''}
              />
            ))}
          </Box>
        )}

        {tab === 'screenshots' && shotsUnreadable && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {t('core:app_page.edit.shots_unreadable', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Alert>
        )}
        {tab === 'screenshots' && shotsBusy && loadingNote}
        {tab === 'screenshots' && !shotsUnreadable && !shotsBusy && (
          <Box sx={{ pt: 1 }}>
            <Typography
              sx={{ color: 'text.secondary', fontSize: '13.5px', mb: 2 }}
            >
              {t('core:app_page.edit.screenshots_hint', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
            <ScreenshotsEditor
              captureSource={captureSource}
              onChange={setShotDrafts}
              onError={setError}
              shots={shotDrafts}
            />
            {shotDrafts.length === 0 && baseShots.length > 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                {t('core:app_page.edit.screenshots_removed', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Alert>
            )}
          </Box>
        )}

        {tab === 'icon' && (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              pt: 2,
            }}
          >
            <Box
              sx={{
                border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
                borderRadius: '28px',
                height: 128,
                overflow: 'hidden',
                width: 128,
              }}
            >
              {iconFailed && !icon ? (
                // The name has no picture yet: show Qortal's, as the hero does.
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    height: '100%',
                    justifyContent: 'center',
                  }}
                >
                  <img alt="" src={LogoSelected} style={{ width: '52%' }} />
                </Box>
              ) : (
                <img
                  alt={t('core:app_page.hero.icon_alt', {
                    name: app?.metadata?.title || app?.name,
                    postProcess: 'capitalizeFirstChar',
                  })}
                  onError={() => setIconFailed(true)}
                  src={icon?.url || appIconUrl(getBaseApiReact(), ref.name)}
                  style={{ height: '100%', objectFit: 'cover', width: '100%' }}
                />
              )}
            </Box>
            <Button
              onClick={() => iconInput.current?.click()}
              startIcon={<ImageRoundedIcon />}
              sx={{ borderRadius: '12px', textTransform: 'none' }}
              variant="outlined"
            >
              {t('core:app_page.edit.choose_icon', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
            <input
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => {
                void pickIcon(event.target.files?.[0]);
                event.target.value = '';
              }}
              ref={iconInput}
              type="file"
            />
            <Alert severity="info" sx={{ maxWidth: 520 }}>
              {t('core:app_page.edit.icon_hint', {
                name: ref.name,
                postProcess: 'capitalizeFirstChar',
              })}
            </Alert>
          </Box>
        )}

        {tab === 'listing' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Alert severity="warning">
              {t('core:app_page.edit.listing_hint', {
                size: app?.size ? formatBytes(app.size) : '?',
                postProcess: 'capitalizeFirstChar',
              })}
            </Alert>
            <TextField
              label={t('core:app_page.edit.listing_title', {
                postProcess: 'capitalizeFirstChar',
              })}
              onChange={(event) =>
                setListing((value) => ({
                  ...value,
                  title: limitQdnTitle(event.target.value),
                }))
              }
              value={listing.title}
            />
            <TextField
              label={t('core:app_page.edit.listing_description', {
                postProcess: 'capitalizeFirstChar',
              })}
              minRows={2}
              multiline
              onChange={(event) =>
                setListing((value) => ({
                  ...value,
                  description: limitQdnDescription(event.target.value),
                }))
              }
              value={listing.description}
            />
            <TextField
              label={t('core:category', { postProcess: 'capitalizeFirstChar' })}
              onChange={(event) =>
                setListing((value) => ({
                  ...value,
                  category: event.target.value,
                }))
              }
              select
              value={listing.category}
            >
              {categories.map((category) => (
                <MenuItem key={category.id} value={category.id}>
                  {category.name}
                </MenuItem>
              ))}
            </TextField>
            <Box
              sx={{
                display: 'grid',
                gap: 1,
                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              }}
            >
              {listing.tags.map((tag, index) => (
                <TextField
                  key={index}
                  label={t('core:tag_number', {
                    number: index + 1,
                    postProcess: 'capitalizeFirstChar',
                  })}
                  onChange={(event) =>
                    setListing((value) => {
                      const tags = [...value.tags];
                      tags[index] = limitQdnTag(event.target.value);
                      return { ...value, tags };
                    })
                  }
                  size="small"
                  value={tag}
                />
              ))}
            </Box>
            {filesProgress && (
              <Typography sx={{ color: 'text.secondary', fontSize: '13px' }}>
                {t('core:app_page.edit.files_progress', {
                  done: filesProgress.done,
                  total: filesProgress.total,
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            )}
          </Box>
        )}

        {error && (
          <Alert
            action={
              shotsReplaced ? (
                <Button
                  color="inherit"
                  disabled={saving || reloadingShots}
                  onClick={() => void reloadShots()}
                  size="small"
                  sx={{ textTransform: 'none' }}
                >
                  {t('core:action.refresh', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
              ) : undefined
            }
            severity="error"
            sx={{ mt: 2 }}
          >
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions
        sx={{
          alignItems: 'center',
          borderTop: `1px solid ${theme.palette.divider}`,
          flexWrap: 'wrap',
          gap: 1,
          justifyContent: 'space-between',
          px: 3,
          py: 1.5,
        }}
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {parts.length === 0 ? (
            <Typography sx={{ color: 'text.secondary', fontSize: '13px' }}>
              {t('core:app_page.edit.no_changes', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          ) : (
            parts.map((part) => {
              const state = progress[part];
              return (
                <Chip
                  icon={
                    state === 'working' ? (
                      <CircularProgress size={12} />
                    ) : state === 'done' ? (
                      <CheckCircleRoundedIcon color="success" />
                    ) : state === 'failed' ? (
                      <ErrorOutlineRoundedIcon color="error" />
                    ) : undefined
                  }
                  key={part}
                  label={partLabel(part)}
                  size="small"
                  variant="outlined"
                />
              );
            })
          )}
          {pageChanged &&
            isAppPageEmpty(pageDraft) &&
            !isAppPageEmpty(page) && (
              <Typography sx={{ color: 'text.secondary', fontSize: '12px' }}>
                {t('core:app_page.edit.page_cleared', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            disabled={saving}
            onClick={onClose}
            sx={{ textTransform: 'none' }}
          >
            {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
          </Button>
          <Button
            disableElevation
            disabled={
              saving || checking || parts.length === 0 || linkErrors.length > 0
            }
            onClick={() => void save()}
            startIcon={
              saving ? <CircularProgress color="inherit" size={14} /> : null
            }
            sx={{ borderRadius: '12px', textTransform: 'none' }}
            variant="contained"
          >
            {t('core:app_page.edit.publish', {
              count: parts.length,
              postProcess: 'capitalizeFirstChar',
            })}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};
