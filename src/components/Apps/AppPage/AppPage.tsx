import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact, QORTAL_APP_CONTEXT } from '../../../App';
import {
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
  userInfoAtom,
} from '../../../atoms/global';
import { shownAppPageAtom } from '../../../atoms/appsAtoms';
import { getFee } from '../../../background/background';
import { TIME_MINUTES_1_IN_MILLISECONDS } from '../../../constants/constants';
import { useAppRating } from '../../../hooks/useAppRatings';
import { executeEvent } from '../../../utils/events';
import { CustomizedSnackbars } from '../../Snackbar/Snackbar';
import { AppRatingBreakdown } from '../AppInfo/AppRatingBreakdown';
import { saveToLocalStorage } from '../AppsNavBarDesktop';
import { AppPageHero } from './AppPageHero';
import { AppScreenshots, GalleryShot } from './AppScreenshots';
import { AppAboutSection } from './AppAboutSection';
import { AppDetailsCard } from './AppDetailsCard';
import {
  AppPageEditorDialog,
  EditorSaved,
  EditorTab,
} from './AppPageEditorDialog';
import { SectionCard, SectionTitle } from './AppPageParts';
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
const WIDE_PAGE = 920;

/**
 * The page's width. A hidden or collapsed container (display: none) measures
 * 0: the page keeps the width it last had, so it is laid out as it was when it
 * shows again.
 */
const useWidth = () => {
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
  const { show } = useContext(QORTAL_APP_CONTEXT);
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

  // The app's rating poll, from the ratings store the library's cards use.
  const { rating: appRating, refresh: refreshRating } = useAppRating(
    app?.name,
    app?.service
  );
  const hasPublishedRating = appRating?.hasPublishedRating ?? null;
  const pollInfo = appRating?.pollInfo ?? null;

  // The first rating creates the app's poll, later ones vote on it.
  const handleRate = async (rating: number) => {
    try {
      if (!myName) {
        throw new Error(
          t('core:message.generic.name_rate', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
      if (!app?.name) return;

      const fee = await getFee('CREATE_POLL');

      await show({
        message: t('core:message.question.rate_app', {
          rate: rating,
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });

      if (hasPublishedRating === false) {
        const pollName = `app-library-${app.service}-rating-${app.name}`;
        const pollOptions = [`1, 2, 3, 4, 5, initialValue-${rating}`];
        const pollDescription = t('core:message.generic.rating', {
          name: app.name,
          service: app.service,
          postProcess: 'capitalizeFirstChar',
        });

        await new Promise((res, rej) => {
          window
            .sendMessage(
              'createPoll',
              {
                pollName: pollName,
                pollDescription: pollDescription,
                pollOptions: pollOptions,
                pollOwnerAddress: myName,
              },
              TIME_MINUTES_1_IN_MILLISECONDS
            )
            .then((response: any) => {
              if (response.error) {
                rej(response?.message);
                return;
              } else {
                res(response);
                notify(
                  'success',
                  t('core:message.success.rated_app', {
                    postProcess: 'capitalizeFirstChar',
                  })
                );
                refreshRating();
              }
            })
            .catch((error: any) => {
              rej(error);
            });
        });
      } else {
        const pollName = `app-library-${app.service}-rating-${app.name}`;

        const optionIndex = pollInfo?.pollOptions.findIndex(
          (option: any) => +option.optionName === +rating
        );
        if (isNaN(optionIndex) || optionIndex === -1) {
          throw new Error(
            t('core:message.error.rating_option', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        }

        await new Promise((res, rej) => {
          window
            .sendMessage(
              'voteOnPoll',
              {
                pollName: pollName,
                optionIndex,
              },
              TIME_MINUTES_1_IN_MILLISECONDS
            )
            .then((response: any) => {
              if (response.error) {
                rej(response?.message);
                return;
              } else {
                res(response);
                notify(
                  'success',
                  t('core:message.success.rated_app', {
                    postProcess: 'capitalizeFirstChar',
                  })
                );
                refreshRating();
              }
            })
            .catch((error: any) => {
              rej(error);
            });
        });
      }
    } catch (error: any) {
      const errorMessage =
        typeof error === 'string' ? error : error?.message || '';
      let snackMessage: string;
      if (errorMessage.includes('ALREADY_VOTED_FOR_THAT_OPTION')) {
        snackMessage = t('core:message.error.app_already_voted', {
          postProcess: 'capitalizeFirstChar',
        });
      } else {
        snackMessage =
          errorMessage ||
          t('core:message.error.rate', {
            postProcess: 'capitalizeFirstChar',
          });
      }
      notify('error', snackMessage);
    }
  };

  const openEditor = (tab: EditorTab) => setEditor({ open: true, tab });
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
    <SectionCard
      aria-labelledby="app-page-ratings"
      component="section"
      id="app-page-ratings-card"
      sx={{ mb: 2 }}
    >
      <SectionTitle id="app-page-ratings">
        {t('core:app_detail.ratings', { postProcess: 'capitalizeFirstChar' })}
      </SectionTitle>
      <AppRatingBreakdown app={app} myName={myName} onRate={handleRate} />
    </SectionCard>
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
        editLoading={pageData.loading || pageData.shotsLoading}
        isPublisher={isPublisher}
        myName={myName}
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
        onTogglePin={togglePin}
        version={page?.version || ''}
        versionCurrent={versionCurrent}
      />

      <Box sx={{ maxWidth: '1080px', mx: 'auto', pb: 6, px: { xs: 2, sm: 3 } }}>
        <AppScreenshots
          appTitle={title}
          isPublisher={isPublisher}
          loading={pageData.shotsLoading}
          onAdd={() => openEditor('screenshots')}
          shots={gallery}
        />

        {/* The about card keeps its place in the tree in both layouts, so
            it stays as it was (read more included) when the page gets wider
            or narrower. Only the ratings and details move. */}
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
          pageUnreadable={pageUnreadable}
          savedShots={savedShots}
          shots={pageData.shots}
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
