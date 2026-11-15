import {
  memo,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import { useTranslation } from 'react-i18next';
import { executeEvent } from '../../../utils/events';
import {
  FEATURED_CARD_HEIGHT,
  FEATURED_CARD_WIDTH,
  FEATURED_GAP,
  FEATURED_TRACK_PADDING,
} from '../AppsLibrary/libraryLayout';
import { LibrarySection } from '../AppsLibrary/LibrarySection';
import {
  cap,
  cardSurfaceSx,
  formatLibraryNumber,
  INSTANT_TOOLTIP,
  libraryFocusRing,
  libraryMuted,
  usePrefersReducedMotion,
} from '../AppsLibrary/libraryStyles';
import { AppIconTile, DetailsButton, OpenAppButton } from './libraryCardParts';
import { LibraryRatingSummary } from './LibraryRatingSummary';

/** A mouse drag shorter than this is still a click. */
const DRAG_THRESHOLD_PX = 6;

interface FeaturedAppBannerProps {
  featuredApps: any[];
  /**
   * 'official': official apps to start with, chosen for Qortal Hub.
   * 'top-rated': the best rated by the community, which the row says.
   */
  variant?: 'official' | 'top-rated';
  /** On a category's page: an app's page goes back to the category. */
  isFromCategory?: boolean;
  sx?: Record<string, any>;
  /** Tells the cards apart; by default an app's service and name. */
  getKey?: (item: any) => string;
  /** Draws a card for something else than an app (a widget). */
  renderItem?: (item: any) => ReactNode;
}

function featuredAppsAreEqual(
  prev: FeaturedAppBannerProps,
  next: FeaturedAppBannerProps
): boolean {
  if (
    prev.variant !== next.variant ||
    prev.isFromCategory !== next.isFromCategory ||
    prev.sx !== next.sx ||
    prev.getKey !== next.getKey ||
    prev.renderItem !== next.renderItem
  ) {
    return false;
  }
  if (prev.featuredApps === next.featuredApps) return true;
  const a = prev.featuredApps;
  const b = next.featuredApps;
  if (!a || !b || a.length !== b.length) return false;
  const keyOf = next.getKey;
  return a.every((app: any, i: number) =>
    keyOf
      ? keyOf(b[i]) === keyOf(app)
      : b[i]?.name === app?.name && b[i]?.service === app?.service
  );
}

type Edges = { overflow: boolean; canPrev: boolean; canNext: boolean };

/**
 * A card of the row: an icon, a title that opens the item's page, two lines
 * of description, the rating and one button. Apps get Open; a widget's card
 * (LibraryWidgetItem) gets Add to Home.
 */
export const FeaturedCardLayout = ({
  iconApp,
  title,
  description,
  ratingName,
  ratingService,
  onDetails,
  renderAction,
}: {
  /** What the icon is taken from: an app, or a widget's publisher. */
  iconApp: any;
  title: string;
  description: string;
  /** What the rating is kept under (an app's name, a widget's poll name). */
  ratingName?: string;
  ratingService?: string;
  onDetails: () => void;
  renderAction: (titleId: string) => ReactNode;
}) => {
  const titleId = useId();
  return (
    <Box
      aria-labelledby={titleId}
      component="article"
      sx={(theme) => ({
        ...cardSurfaceSx(theme, { shadow: 'compact' }),
        alignItems: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        height: FEATURED_CARD_HEIGHT,
        p: 1.75,
        textAlign: 'center',
        width: FEATURED_CARD_WIDTH,
      })}
    >
      <AppIconTile app={iconApp} size={60} />
      <DetailsButton
        align="center"
        id={titleId}
        onClick={onDetails}
        textSx={{ fontSize: '14.5px', fontWeight: 650, lineHeight: '20px' }}
      >
        {title}
      </DetailsButton>
      <Typography
        sx={(theme) => ({
          color: libraryMuted(theme),
          display: '-webkit-box',
          // Never squeezed: that would cut its second line.
          flexShrink: 0,
          fontSize: '12.5px',
          height: 35,
          lineHeight: 1.4,
          overflow: 'hidden',
          overflowWrap: 'anywhere',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
          width: '100%',
        })}
      >
        {description}
      </Typography>
      <LibraryRatingSummary
        align="center"
        name={ratingName}
        service={ratingService}
      />
      <Box sx={{ mt: 'auto', width: '100%' }}>{renderAction(titleId)}</Box>
    </Box>
  );
};

const FeaturedCard = ({
  app,
  onOpen,
  onDetails,
}: {
  app: any;
  onOpen: (app: any, event: React.MouseEvent) => void;
  onDetails: (app: any) => void;
}) => {
  const { t } = useTranslation(['core']);
  return (
    <FeaturedCardLayout
      description={
        app?.metadata?.description ||
        t('core:message.generic.no_description', cap)
      }
      iconApp={app}
      onDetails={() => onDetails(app)}
      ratingName={app?.name}
      ratingService={app?.service}
      renderAction={(titleId) => (
        <OpenAppButton
          describedBy={titleId}
          fullWidth
          installed={app?.status?.status === 'READY'}
          onClick={(event) => onOpen(app, event)}
        />
      )}
      title={app?.metadata?.title || app?.name}
    />
  );
};

/**
 * The official apps worth starting with, or the community's best rated, in a
 * row that scrolls sideways: by the arrows (a page at a time), a trackpad,
 * Shift and the wheel, a touch screen, or a mouse drag. It snaps to a card
 * and scrolls smoothly unless the system asks for less motion.
 */
const FeaturedAppBannerInner = ({
  featuredApps,
  variant = 'official',
  isFromCategory = false,
  sx,
  getKey,
  renderItem,
}: FeaturedAppBannerProps) => {
  const { t, i18n } = useTranslation(['core']);
  const reduce = usePrefersReducedMotion();
  const trackRef = useRef<HTMLUListElement | null>(null);
  const trackId = useId();
  const [edges, setEdges] = useState<Edges>({
    overflow: false,
    canPrev: false,
    canNext: false,
  });
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<{
    x: number;
    left: number;
    moved: boolean;
    id: number;
  } | null>(null);
  const suppressClickRef = useRef(false);

  // The hooks come before the early return below, in the same order every
  // render.
  const updateEdges = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const left = Math.abs(el.scrollLeft);
    setEdges((previous) => {
      const next = {
        overflow: max > 2,
        canPrev: left > 2,
        canNext: left < max - 2,
      };
      return previous.overflow === next.overflow &&
        previous.canPrev === next.canPrev &&
        previous.canNext === next.canNext
        ? previous
        : next;
    });
  }, []);

  useLayoutEffect(() => {
    updateEdges();
  }, [featuredApps, updateEdges]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => updateEdges());
    observer.observe(el);
    return () => observer.disconnect();
  }, [featuredApps?.length, updateEdges]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  const handleTrackScroll = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      updateEdges();
    });
  }, [updateEdges]);

  const scrollPage = useCallback(
    (direction: 1 | -1) => {
      const el = trackRef.current;
      if (!el) return;
      const stride = FEATURED_CARD_WIDTH + FEATURED_GAP;
      const left =
        direction *
        Math.max(1, Math.floor((el.clientWidth + FEATURED_GAP) / stride)) *
        stride;
      if (typeof el.scrollBy === 'function') {
        el.scrollBy({ left, behavior: reduce ? 'auto' : 'smooth' });
      } else {
        el.scrollLeft += left;
      }
    },
    [reduce]
  );

  const handlePrev = useCallback(() => {
    if (edges.canPrev) scrollPage(-1);
  }, [edges.canPrev, scrollPage]);

  const handleNext = useCallback(() => {
    if (edges.canNext) scrollPage(1);
  }, [edges.canNext, scrollPage]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const el = trackRef.current;
    if (!el) return;
    dragRef.current = {
      x: event.clientX,
      left: el.scrollLeft,
      moved: false,
      id: event.pointerId,
    };
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const el = trackRef.current;
    if (!drag || !el || event.pointerId !== drag.id) return;
    // The button came up outside the row, where no pointerup reached it: a
    // later hover is no drag.
    if ((event.buttons & 1) === 0) {
      dragRef.current = null;
      delete el.dataset.dragging;
      return;
    }
    const dx = event.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) <= DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      try {
        el.setPointerCapture?.(event.pointerId);
      } catch {
        // The pointer may already be gone.
      }
      el.dataset.dragging = 'true';
    }
    el.scrollLeft = drag.left - dx;
  }, []);

  const endDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const el = trackRef.current;
    if (!drag || event.pointerId !== drag.id) return;
    dragRef.current = null;
    if (!el) return;
    // Snapping comes back, and settles the row on a card.
    delete el.dataset.dragging;
    if (!drag.moved) return;
    // The click that ends a drag opens nothing. It comes straight after
    // this event, if at all, so a later click is never held back.
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    try {
      el.releasePointerCapture?.(event.pointerId);
    } catch {
      // Already released.
    }
  }, []);

  const handleClickCapture = useCallback((event: React.MouseEvent) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleTrackKeys = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const target = event.target as HTMLElement | null;
      if (!target?.classList?.contains('libraryDetails')) return;
      const slot = target.closest('li');
      const sibling = (
        event.key === 'ArrowRight'
          ? slot?.nextElementSibling
          : slot?.previousElementSibling
      ) as HTMLElement | null;
      const next = sibling?.querySelector<HTMLElement>('.libraryDetails');
      if (!next) return;
      event.preventDefault();
      next.focus({ preventScroll: true });
      const card = next.closest('li') as HTMLElement | null;
      if (typeof card?.scrollIntoView === 'function') {
        card.scrollIntoView({
          behavior: reduce ? 'auto' : 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
      }
    },
    [reduce]
  );

  const handleOpenApp = useCallback((app: any, e: React.MouseEvent) => {
    e.stopPropagation();
    executeEvent('addTab', { data: app });
  }, []);

  const handleViewDetails = useCallback(
    (app: any) => {
      executeEvent(
        isFromCategory ? 'selectedAppInfoCategory' : 'selectedAppInfo',
        { data: app }
      );
    },
    [isFromCategory]
  );

  if (!featuredApps || featuredApps.length === 0) {
    return null;
  }

  const arrow = (direction: 'prev' | 'next') => {
    const enabled = direction === 'prev' ? edges.canPrev : edges.canNext;
    const label =
      direction === 'prev'
        ? t('core:launcher.library.featured_previous', cap)
        : t('core:launcher.library.featured_next', cap);
    return (
      <Tooltip {...INSTANT_TOOLTIP} title={label}>
        <IconButton
          aria-controls={trackId}
          aria-disabled={!enabled}
          aria-label={label}
          disableRipple
          onClick={direction === 'prev' ? handlePrev : handleNext}
          sx={(theme) => ({
            backgroundColor: alpha(theme.palette.text.primary, 0.06),
            color: theme.palette.text.primary,
            cursor: enabled ? 'pointer' : 'default',
            height: 32,
            opacity: enabled ? 1 : 0.38,
            transition: 'background-color 160ms, opacity 160ms',
            width: 32,
            '&:hover': {
              backgroundColor: enabled
                ? alpha(theme.palette.text.primary, 0.1)
                : alpha(theme.palette.text.primary, 0.06),
            },
            '&.Mui-focusVisible': libraryFocusRing(theme, 2),
          })}
        >
          {direction === 'prev' ? (
            <ChevronLeftRoundedIcon sx={{ fontSize: 20 }} />
          ) : (
            <ChevronRightRoundedIcon sx={{ fontSize: 20 }} />
          )}
        </IconButton>
      </Tooltip>
    );
  };

  return (
    <LibrarySection
      action={
        edges.overflow ? (
          <>
            {arrow('prev')}
            {arrow('next')}
          </>
        ) : null
      }
      hint={
        variant === 'top-rated'
          ? t('core:launcher.library.top_rated_hint', {
              number: formatLibraryNumber(featuredApps.length, i18n?.language),
              postProcess: 'capitalizeFirstChar',
            })
          : t('core:launcher.library.featured_hint', cap)
      }
      icon={
        variant === 'top-rated' ? (
          <StarRoundedIcon />
        ) : (
          <AutoAwesomeRoundedIcon />
        )
      }
      sx={sx}
      title={t('core:official_apps.featured', cap)}
    >
      <Box
        component="ul"
        id={trackId}
        onClickCapture={handleClickCapture}
        onKeyDown={handleTrackKeys}
        onLostPointerCapture={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onScroll={handleTrackScroll}
        ref={trackRef}
        role="list"
        style={
          {
            '--fade-start': edges.canPrev ? '32px' : '0px',
            '--fade-end': edges.canNext ? '32px' : '0px',
          } as React.CSSProperties
        }
        sx={{
          display: 'flex',
          gap: `${FEATURED_GAP}px`,
          listStyle: 'none',
          // The row clips what goes past it: the padding keeps a hovered
          // card's lift and shadow inside, the margin keeps the cards in line.
          m: `-${FEATURED_TRACK_PADDING.block}px -${FEATURED_TRACK_PADDING.inline}px -${FEATURED_TRACK_PADDING.bottom}px`,
          maskImage:
            'linear-gradient(to right, transparent 0, black var(--fade-start), black calc(100% - var(--fade-end)), transparent 100%)',
          overflowX: 'auto',
          overflowY: 'hidden',
          overscrollBehaviorX: 'contain',
          p: `${FEATURED_TRACK_PADDING.block}px ${FEATURED_TRACK_PADDING.inline}px ${FEATURED_TRACK_PADDING.bottom}px`,
          scrollBehavior: reduce ? 'auto' : 'smooth',
          scrollPaddingInline: `${FEATURED_TRACK_PADDING.inline}px`,
          scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none',
          WebkitMaskImage:
            'linear-gradient(to right, transparent 0, black var(--fade-start), black calc(100% - var(--fade-end)), transparent 100%)',
          '&::-webkit-scrollbar': { display: 'none' },
          '&[data-dragging="true"]': {
            cursor: 'grabbing',
            scrollBehavior: 'auto',
            scrollSnapType: 'none',
            userSelect: 'none',
          },
        }}
      >
        {featuredApps.map((app) => (
          <Box
            component="li"
            key={getKey ? getKey(app) : `${app?.service}-${app?.name}`}
            sx={{
              flex: `0 0 ${FEATURED_CARD_WIDTH}px`,
              scrollMarginInline: '32px',
              scrollSnapAlign: 'start',
            }}
          >
            {renderItem ? (
              renderItem(app)
            ) : (
              <FeaturedCard
                app={app}
                onDetails={handleViewDetails}
                onOpen={handleOpenApp}
              />
            )}
          </Box>
        ))}
      </Box>
    </LibrarySection>
  );
};

FeaturedAppBannerInner.displayName = 'FeaturedAppBanner';

export const FeaturedAppBanner = memo(
  FeaturedAppBannerInner,
  featuredAppsAreEqual
);
