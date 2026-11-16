import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import {
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
  userInfoAtom,
} from '../../../atoms/global';
import { shownAppPageAtom } from '../../../atoms/appsAtoms';
import { executeEvent } from '../../../utils/events';
import { CustomizedSnackbars } from '../../Snackbar/Snackbar';
import { saveToLocalStorage } from '../AppsNavBarDesktop';
import { AppPageHero } from './AppPageHero';
import { AppScreenshots, GalleryShot } from './AppScreenshots';
import { AppAboutSection } from './AppAboutSection';
import { AppRatingsPanel } from './AppRatingsPanel';
import { AppReviewsSection } from './AppReviewsSection';
import { AppDetailsCard } from './AppDetailsCard';
import {
  AppPageEditorDialog,
  EditorSaved,
  EditorTab,
} from './AppPageEditorDialog';
import {
  inLauncherTab,
  LauncherTabShownContext,
  useLauncherTabId,
} from '../launcherTabs';
import { appIconUrl, shotImageUrl } from './appPageQdn';
import { AppPageData, isVersionCurrent } from './appPageData';
import type { ShotDraft } from './ScreenshotsEditor';
import { normalizeAppService } from './appPageIds';
import { useAppListing, useAppPageData, useOwnedNames } from './useAppPage';
import { ratingsByAddress } from './appVotes';
import { useAppVotes } from './useAppVotes';
import { useAppReviews, ReviewActionResult } from './useAppReviews';
import { useIconAccent } from './useIconAccent';

type Snack = { type: string; message: string } | null;

/** What the publisher saved from here, each part with when it was saved. */
interface SavedParts {
  page?: AppPageData;
  pageAt?: number;
  shots?: ShotDraft[];
  shotsAt?: number;
  iconUrl?: string;
  listing?: EditorSaved['listing'];
  appSignature?: string;
}

/** Two columns from this page width on. */
export const WIDE_PAGE = 920;

/**
 * The page's width. A hidden or collapsed container (display: none) measures
 * 0: the page keeps the width it last had, so it is laid out as it was when it
 * shows again.
 */
export const useWidth = () => {
  const [width, setWidth] = useState(0);
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!element) return;
    const measure = () => {
      const next = element.clientWidth;
      if (next > 0) setWidth(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { width, ref: setElement };
};

export const AppPage = ({
  app: initialApp,
  myName,
}: {
  app: any;
  myName?: string;
}) => {
  const { t } = useTranslation(['core']);
  const { width, ref: containerRef } = useWidth();
  const wide = width >= WIDE_PAGE;
  const userInfo = useAtomValue(userInfoAtom);
  const myAddress: string | undefined = userInfo?.address;
  const { listing: app, reload: reloadListing } = useAppListing(initialApp);
  const service = normalizeAppService(app?.service);
  const ref = useMemo(
    () => ({ service, name: app?.name || '' }),
    [service, app?.name]
  );
  const base = getBaseApiReact();
  const launcherTabId = useLauncherTabId();

  // On screen: the top bar shows this page's link. A page in a launcher tab
  // that is hidden behind another tab is not.
  const isTabShown = useContext(LauncherTabShownContext);
  const setShownAppPage = useSetAtom(shownAppPageAtom);
  useEffect(() => {
    if (!ref.name || !isTabShown) return;
    setShownAppPage(ref);
    return () =>
      setShownAppPage((current) => (current === ref ? null : current));
  }, [isTabShown, ref, setShownAppPage]);

  const pageData = useAppPageData(ref);
  const votes = useAppVotes(ref, { address: myAddress, name: myName });
  const reviews = useAppReviews(ref, { name: myName });
  const ownedNames = useOwnedNames(myAddress);
  const isPublisher = ownedNames.some(
    (name) => name.toLowerCase() === ref.name.toLowerCase()
  );

  // Every part saved so far: saving one part keeps the others shown.
  const [saved, setSaved] = useState<SavedParts>({});
  const [editor, setEditor] = useState<{ open: boolean; tab: EditorTab }>({
    open: false,
    tab: 'page',
  });
  const [prompt, setPrompt] = useState<number | null>(null);
  const [snack, setSnack] = useState<Snack>(null);
  const [snackOpen, setSnackOpen] = useState(false);
  const notify = useCallback((type: string, message: string) => {
    setSnack({ type, message });
    setSnackOpen(true);
  }, []);

  // What the publisher just saved shows until the node has the new version.
  const savedPageNewer =
    !!saved.page && saved.pageAt > (pageData.page?.updated || 0) - 60_000;
  const page = savedPageNewer ? saved.page : pageData.page;
  const savedShots =
    saved.shots && saved.shotsAt > (pageData.shots?.updated || 0) - 60_000
      ? saved.shots
      : null;
  const shotsSignature = pageData.resources?.shots?.signature;
  const gallery: GalleryShot[] = useMemo(() => {
    if (savedShots) {
      return savedShots.map((shot) => ({
        url: shot.url,
        caption: shot.caption,
        width: shot.width,
        height: shot.height,
      }));
    }
    return (pageData.shots?.shots || []).map((shot) => ({
      url: shotImageUrl(base, ref, shot.file, shotsSignature),
      caption: shot.caption,
      width: shot.width,
      height: shot.height,
    }));
  }, [base, pageData.shots, ref, savedShots, shotsSignature]);

  const listingApp = useMemo(
    () =>
      saved.listing
        ? {
            ...app,
            ...(saved.appSignature
              ? { latestSignature: saved.appSignature }
              : {}),
            metadata: {
              ...app?.metadata,
              title: saved.listing.title,
              description: saved.listing.description,
              category: saved.listing.category,
              tags: saved.listing.tags,
            },
          }
        : app,
    [app, saved.appSignature, saved.listing]
  );

  // A part the node lists but couldn't read can't be edited: the editor
  // would publish its empty fields over it.
  const pageUnreadable =
    !pageData.loading &&
    !savedPageNewer &&
    (!pageData.resources || (!!pageData.resources.page && !pageData.page));
  const shotsUnreadable =
    !pageData.loading &&
    !pageData.shotsLoading &&
    !savedShots &&
    (!pageData.resources || (!!pageData.resources.shots && !pageData.shots));

  const iconUrl = saved.iconUrl || appIconUrl(base, ref.name);
  const accent = useIconAccent(appIconUrl(base, ref.name));
  const versionCurrent = isVersionCurrent(page, listingApp?.latestSignature);
  const isInstalled = app?.status?.status === 'READY';

  const [pinnedApps, setPinnedApps] = useAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);
  const isPinned = !!pinnedApps?.find(
    (item) => item?.name === app?.name && item?.service === app?.service
  );
  const togglePin = () => {
    setPinnedApps((previous) => {
      const next = isPinned
        ? previous.filter(
            (item) =>
              !(item?.name === app?.name && item?.service === app?.service)
          )
        : [...previous, { name: app?.name, service: app?.service }];
      saveToLocalStorage('ext_saved_settings', 'sortablePinnedApps', next);
      return next;
    });
    setSettingsLocalLastUpdated(Date.now());
  };

  const ratingByAddress = useMemo(
    () => ratingsByAddress(votes.voters),
    [votes.voters]
  );
  const myRating = votes.pending?.rating ?? votes.mine?.rating ?? null;

  const rate = async (rating: number) => {
    const result = await votes.vote(rating);
    if (result.ok === true) {
      notify(
        'success',
        t('core:app_page.rating.sent', { postProcess: 'capitalizeFirstChar' })
      );
      setPrompt(rating);
    } else if (!result.cancelled && result.message) {
      notify('error', result.message);
    }
  };

  const onReviewResult = (result: ReviewActionResult, success: string) => {
    if (result.ok === true) notify('success', success);
    else if (!result.cancelled && result.message)
      notify('error', result.message);
  };

  // The editor starts from the page text and screenshots the node has: it
  // opens only once both have loaded, from Edit and from Add screenshots,
  // or its empty fields could be published over them.
  const editorLoading = pageData.loading || pageData.shotsLoading;
  const openEditor = (tab: EditorTab) => {
    if (editorLoading) return;
    setEditor({ open: true, tab });
  };
  const title = listingApp?.metadata?.title || app?.name || '';

  const about = (
    <AppAboutSection
      description={listingApp?.metadata?.description || ''}
      loading={pageData.loading}
      page={page}
      versionCurrent={versionCurrent}
    />
  );
  const ratings = (
    <AppRatingsPanel
      canRate={!!myName}
      loading={votes.loading}
      mine={votes.mine}
      myAddress={myAddress}
      onRate={rate}
      onRetry={votes.reload}
      pending={votes.pending}
      pollExists={votes.pollExists}
      pollStatus={votes.pollStatus}
      summary={votes.summary}
      voters={votes.voters}
    />
  );
  const reviewsSection = (
    <AppReviewsSection
      appName={ref.name}
      appTitle={title}
      failed={reviews.failed}
      hasMore={reviews.hasMore}
      loading={reviews.loading}
      myName={myName}
      myRating={myRating}
      myReview={reviews.myReview}
      onDismissPrompt={() => setPrompt(null)}
      onLoadMore={reviews.loadMore}
      onResult={onReviewResult}
      onRetry={reviews.reload}
      prompt={prompt}
      ratingByAddress={ratingByAddress}
      removeItem={reviews.removeItem}
      submitReply={reviews.submitReply}
      submitReview={reviews.submitReview}
      threads={reviews.threads}
    />
  );
  const details = (
    <AppDetailsCard app={listingApp} version={page?.version || ''} />
  );

  return (
    <Box
      ref={containerRef}
      sx={{
        height: '100%',
        overflowX: 'hidden',
        overflowY: 'auto',
        width: '100%',
      }}
    >
      <AppPageHero
        accent={accent}
        app={listingApp}
        iconUrl={iconUrl}
        isInstalled={isInstalled}
        isPinned={isPinned}
        editLoading={editorLoading}
        isPublisher={isPublisher}
        onCopied={() =>
          notify(
            'success',
            t('core:message.generic.link_copied', {
              postProcess: 'capitalizeFirstChar',
            })
          )
        }
        onEdit={() => openEditor('page')}
        onOpen={() =>
          executeEvent('addTab', { data: inLauncherTab(app, launcherTabId) })
        }
        onRatingsClick={() =>
          document
            .getElementById('app-page-ratings-card')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
        onTogglePin={togglePin}
        summary={votes.summary}
        version={page?.version || ''}
        versionCurrent={versionCurrent}
      />

      <Box sx={{ maxWidth: '1080px', mx: 'auto', pb: 6, px: { xs: 2, sm: 3 } }}>
        <AppScreenshots
          appTitle={title}
          isPublisher={isPublisher}
          addLoading={editorLoading}
          loading={pageData.shotsLoading}
          onAdd={() => openEditor('screenshots')}
          shots={gallery}
        />

        {/* The about card and the reviews keep their places in the tree in
            both layouts (the slots between them are empty when wide), so
            what is typed in them is kept when the page gets wider or
            narrower. Only the ratings and details move. */}
        <Box
          sx={
            wide
              ? {
                  alignItems: 'start',
                  display: 'grid',
                  gap: 2,
                  gridTemplateColumns: 'minmax(0, 1fr) 340px',
                }
              : undefined
          }
        >
          <Box sx={{ minWidth: 0 }}>
            {about}
            {!wide && ratings}
            {reviewsSection}
            {!wide && details}
          </Box>
          {wide && (
            <Box sx={{ minWidth: 0, position: 'sticky', top: 16 }}>
              {ratings}
              {details}
            </Box>
          )}
        </Box>
      </Box>

      {isPublisher && (
        <AppPageEditorDialog
          // What the page shows now, saved parts included, so a second edit
          // starts from the first one rather than from the node's old copy.
          app={listingApp}
          initialTab={editor.tab}
          onClose={() => setEditor((value) => ({ ...value, open: false }))}
          onSaved={(result) => {
            const at = Date.now();
            setSaved((previous) => ({
              ...previous,
              ...(result.page ? { page: result.page, pageAt: at } : {}),
              ...(result.shots ? { shots: result.shots, shotsAt: at } : {}),
              ...(result.iconUrl ? { iconUrl: result.iconUrl } : {}),
              ...(result.listing ? { listing: result.listing } : {}),
              ...(result.appSignature
                ? { appSignature: result.appSignature }
                : {}),
            }));
            notify(
              'success',
              t('core:app_page.edit.saved', {
                postProcess: 'capitalizeFirstChar',
              })
            );
            // The node lists the new versions after the next block.
            setTimeout(() => {
              pageData.reload();
              reloadListing();
            }, 90_000);
          }}
          open={editor.open}
          page={page}
          pageLoading={pageData.loading}
          pageUnreadable={pageUnreadable}
          savedShots={savedShots}
          shots={pageData.shots}
          shotsLoading={pageData.shotsLoading}
          shotsUnreadable={shotsUnreadable}
          shotsVersion={shotsSignature}
        />
      )}

      <CustomizedSnackbars
        info={snack}
        open={snackOpen}
        setInfo={setSnack}
        setOpen={setSnackOpen}
      />
    </Box>
  );
};
