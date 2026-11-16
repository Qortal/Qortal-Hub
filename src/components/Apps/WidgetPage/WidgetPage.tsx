import { useCallback, useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import { availableQappsAtom } from '../../../atoms/appsAtoms';
import { userInfoAtom } from '../../../atoms/global';
import { executeEvent } from '../../../utils/events';
import { useWidgetOnHome } from '../../HomeWidgets/useWidgetOnHome';
import { CustomizedSnackbars } from '../../Snackbar/Snackbar';
import { AppAboutSection } from '../AppPage/AppAboutSection';
import { useWidth, WIDE_PAGE } from '../AppPage/AppPage';
import { AppRatingsPanel } from '../AppPage/AppRatingsPanel';
import { AppReviewsSection } from '../AppPage/AppReviewsSection';
import { appIconUrl } from '../AppPage/appPageQdn';
import { useAppReviews, ReviewActionResult } from '../AppPage/useAppReviews';
import { ratingsByAddress } from '../AppPage/appVotes';
import { useAppVotes } from '../AppPage/useAppVotes';
import { useIconAccent } from '../AppPage/useIconAccent';
import type { LibraryWidget } from '../AppsLibrary/widgetLibrary';
import { WidgetDetailsCard } from './WidgetDetailsCard';
import { WidgetPageHero } from './WidgetPageHero';

type Snack = { type: string; message: string } | null;

const cap = { postProcess: 'capitalizeFirstChar' } as const;

/**
 * A widget's page in the library: what it is, Add to Home, its rating and its
 * reviews. The rating poll and the reviews are the app page's, kept under the
 * widget's own identifier (docs/app-pages.md); a widget published as its
 * name's default APP is that app, and shares the app's. Nothing of the widget
 * runs here: it runs once it is on Home.
 */
export const WidgetPage = ({
  widget,
  myName,
}: {
  widget: LibraryWidget;
  myName?: string;
}) => {
  const { t } = useTranslation(['core', 'group']);
  const { width, ref: containerRef } = useWidth();
  const wide = width >= WIDE_PAGE;
  const userInfo = useAtomValue(userInfoAtom);
  const myAddress: string | undefined = userInfo?.address;
  const base = getBaseApiReact();
  const ref = useMemo(
    () => ({
      service: 'APP',
      name: widget.name,
      identifier: widget.identifier,
    }),
    [widget.identifier, widget.name]
  );

  const votes = useAppVotes(ref, { address: myAddress, name: myName });
  const reviews = useAppReviews(ref, { name: myName });
  const home = useWidgetOnHome(widget);
  const iconUrl = appIconUrl(base, widget.name);
  const accent = useIconAccent(iconUrl);

  // The app the widget comes with: widgets keep what their app saved (a
  // place, a choice) only under the same name, so it is worth a look first.
  const availableQapps = useAtomValue(availableQappsAtom);
  const mainApp = useMemo(
    () =>
      widget.identifier
        ? (availableQapps || []).find(
            (app) =>
              app?.service === 'APP' &&
              String(app?.name || '').toLowerCase() ===
                widget.name.toLowerCase()
          ) || null
        : null,
    [availableQapps, widget.identifier, widget.name]
  );

  const [prompt, setPrompt] = useState<number | null>(null);
  const [snack, setSnack] = useState<Snack>(null);
  const [snackOpen, setSnackOpen] = useState(false);
  const notify = useCallback((type: string, message: string) => {
    setSnack({ type, message });
    setSnackOpen(true);
  }, []);

  const ratingByAddress = useMemo(
    () => ratingsByAddress(votes.voters),
    [votes.voters]
  );
  const myRating = votes.pending?.rating ?? votes.mine?.rating ?? null;

  const rate = async (rating: number) => {
    const result = await votes.vote(rating);
    if (result.ok === true) {
      notify('success', t('core:app_page.rating.sent', cap));
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

  const addToHome = () => {
    const change = home.add();
    if (change === 'added') {
      notify(
        'success',
        t('core:widgets.added_to_home', { title: widget.title, ...cap })
      );
    } else if (change === 'full') {
      notify(
        'info',
        t('group:home_widgets.limit', { max: home.limit, ...cap })
      );
    }
  };

  const removeFromHome = () => {
    if (home.remove() === 'removed') {
      notify(
        'success',
        t('core:widgets.removed_from_home', { title: widget.title, ...cap })
      );
    }
  };

  const about = (
    <AppAboutSection
      description={widget.description}
      loading={false}
      page={null}
      versionCurrent
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
      appName={widget.name}
      appTitle={widget.title}
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
  const details = <WidgetDetailsCard widget={widget} />;

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
      <WidgetPageHero
        accent={accent}
        homeFull={home.full}
        homeLimit={home.limit}
        iconUrl={iconUrl}
        onAdd={addToHome}
        onHome={home.onHome}
        onOpenApp={
          mainApp ? () => executeEvent('addTab', { data: mainApp }) : undefined
        }
        onRatingsClick={() =>
          document
            .getElementById('app-page-ratings-card')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
        onRemove={removeFromHome}
        summary={votes.summary}
        widget={widget}
      />

      <Box sx={{ maxWidth: '1080px', mx: 'auto', pb: 6, px: { xs: 2, sm: 3 } }}>
        {/* As on an app's page: the about card and the reviews keep their
            places in both layouts, so a review being typed stays. */}
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

      <CustomizedSnackbars
        info={snack}
        open={snackOpen}
        setInfo={setSnack}
        setOpen={setSnackOpen}
      />
    </Box>
  );
};
