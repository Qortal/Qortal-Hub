import { type MouseEvent, memo, useCallback, useId } from 'react';
import { Box, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { executeEvent } from '../../../utils/events';
import { useWidgetOnHome } from '../../HomeWidgets/useWidgetOnHome';
import { FeaturedCardLayout } from './FeaturedAppBanner';
import { CategoryIcon } from '../config/categoryIconComponents';
import { APP_CARD_HEIGHT, APP_ROW_HEIGHT } from '../AppsLibrary/libraryLayout';
import { cap, cardSurfaceSx, libraryMuted } from '../AppsLibrary/libraryStyles';
import type { LibraryView } from '../AppsLibrary/libraryView';
import {
  type LibraryWidget,
  widgetRatingName,
} from '../AppsLibrary/widgetLibrary';
import {
  AppIconTile,
  DetailsButton,
  LibraryActionButton,
  LibraryChip,
} from './libraryCardParts';
import { LibraryRatingSummary } from './LibraryRatingSummary';

const ellipsisSx = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

/** Tells the user what Add to Home did, in the app's snackbar. */
export const announceWidgetOnHome = (
  change: 'added' | 'removed' | 'full' | 'unchanged',
  title: string,
  t: TFunction,
  limit: number
) => {
  if (change === 'unchanged') return;
  executeEvent('openGlobalSnackBar', {
    message:
      change === 'added'
        ? t('core:widgets.added_to_home', { title, ...cap })
        : change === 'removed'
          ? t('core:widgets.removed_from_home', { title, ...cap })
          : t('group:home_widgets.limit', { max: limit, ...cap }),
    type: change === 'full' ? 'info' : 'success',
  });
};

interface WidgetItemProps {
  widget: LibraryWidget;
  onHome: boolean;
  onOpenDetails: () => void;
  onAdd: (event: MouseEvent) => void;
}

/** Add to Home, or a quiet note once it is there (it is removed on Home). */
const HomeAction = ({
  onHome,
  onAdd,
  titleId,
  fullWidth = false,
}: Pick<WidgetItemProps, 'onAdd' | 'onHome'> & {
  titleId: string;
  /** Fills the card's width, as Open does in the Featured row. */
  fullWidth?: boolean;
}) => {
  const { t } = useTranslation(['core']);
  if (onHome) {
    return (
      <Box
        component="span"
        sx={(theme) => ({
          alignItems: 'center',
          color: libraryMuted(theme),
          display: fullWidth ? 'flex' : 'inline-flex',
          flexShrink: 0,
          fontSize: '13px',
          fontWeight: 600,
          gap: 0.5,
          height: 32,
          justifyContent: 'center',
          px: 0.5,
          whiteSpace: 'nowrap',
          '& .MuiSvgIcon-root': {
            color: theme.palette.success.main,
            fontSize: 16,
          },
        })}
      >
        <CheckRoundedIcon aria-hidden />
        {t('core:widgets.on_home', cap)}
      </Box>
    );
  }
  return (
    <LibraryActionButton
      describedBy={titleId}
      fullWidth={fullWidth}
      icon={<AddRoundedIcon />}
      kind="primary"
      onClick={onAdd}
    >
      {t('core:widgets.add_to_home', cap)}
    </LibraryActionButton>
  );
};

const CategoryLabel = ({ widget }: { widget: LibraryWidget }) =>
  widget.categoryName ? (
    <LibraryChip
      icon={<CategoryIcon id={widget.category} size={14} />}
      label={widget.categoryName}
      tone="accent"
    />
  ) : null;

/** A widget as a card of the grid. */
export const LibraryWidgetTile = ({
  widget,
  onHome,
  onOpenDetails,
  onAdd,
}: WidgetItemProps) => {
  const { t } = useTranslation(['core']);
  const titleId = useId();
  const tags = (widget.tags || []).slice(0, 3);

  return (
    <Box
      aria-labelledby={titleId}
      component="article"
      sx={(theme) => ({
        ...cardSurfaceSx(theme),
        display: 'flex',
        flexDirection: 'column',
        height: APP_CARD_HEIGHT,
        minWidth: 0,
        p: 2,
      })}
    >
      <Box sx={{ alignItems: 'flex-start', display: 'flex', gap: 1.5 }}>
        <AppIconTile app={widget} size={52} />
        <Box
          sx={{
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            gap: '2px',
            minWidth: 0,
          }}
        >
          <DetailsButton
            id={titleId}
            onClick={onOpenDetails}
            textSx={{ fontSize: '15px', fontWeight: 650, lineHeight: '21px' }}
          >
            {widget.title}
          </DetailsButton>
          <Typography
            component="span"
            sx={(theme) => ({
              ...ellipsisSx,
              color: libraryMuted(theme),
              fontSize: '12.5px',
              lineHeight: '18px',
            })}
          >
            {t('core:app_detail.by_developer', {
              developer: widget.name,
              ...cap,
            })}
          </Typography>
          <LibraryRatingSummary name={widgetRatingName(widget)} service="APP" />
        </Box>
      </Box>

      <Typography
        sx={(theme) => ({
          color: libraryMuted(theme),
          display: '-webkit-box',
          fontSize: '13px',
          height: 38,
          lineHeight: 1.45,
          mt: 1.5,
          overflow: 'hidden',
          overflowWrap: 'anywhere',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
        })}
      >
        {widget.description || t('core:message.generic.no_description', cap)}
      </Typography>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexWrap: 'nowrap',
          gap: 0.75,
          height: 22,
          minWidth: 0,
          mt: 1.25,
          overflow: 'hidden',
        }}
      >
        <CategoryLabel widget={widget} />
        {tags.map((tag, index) => (
          <LibraryChip key={`${tag}-${index}`} label={tag} tone="neutral" />
        ))}
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1,
          justifyContent: 'flex-end',
          minWidth: 0,
          mt: 'auto',
          pt: 1,
        }}
      >
        <HomeAction onAdd={onAdd} onHome={onHome} titleId={titleId} />
      </Box>
    </Box>
  );
};

/** A widget as a row of the list. */
export const LibraryWidgetRow = ({
  widget,
  onHome,
  onOpenDetails,
  onAdd,
}: WidgetItemProps) => {
  const { t } = useTranslation(['core']);
  const titleId = useId();

  return (
    <Box
      aria-labelledby={titleId}
      component="article"
      data-library-row
      sx={(theme) => ({
        ...cardSurfaceSx(theme, { lift: 1 }),
        alignItems: 'center',
        borderRadius: '14px',
        columnGap: 1.75,
        display: 'grid',
        gridTemplateColumns: '44px minmax(0, 1fr) auto',
        height: APP_ROW_HEIGHT,
        minWidth: 0,
        px: 1.75,
        scrollMarginBottom: '16px',
        scrollMarginTop: 'var(--library-sticky-offset, 0px)',
      })}
    >
      <AppIconTile app={widget} size={44} />

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          minWidth: 0,
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            columnGap: 1,
            display: 'flex',
            flexWrap: 'wrap',
            height: 22,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flex: '0 1 auto',
              gap: 1,
              minWidth: 0,
            }}
          >
            <DetailsButton
              id={titleId}
              onClick={onOpenDetails}
              overlayRadius={14}
              textSx={{
                fontSize: '14.5px',
                fontWeight: 650,
                lineHeight: '20px',
              }}
            >
              {widget.title}
            </DetailsButton>
            <Box sx={{ flexShrink: 0 }}>
              <LibraryRatingSummary
                name={widgetRatingName(widget)}
                service="APP"
              />
            </Box>
          </Box>
          <CategoryLabel widget={widget} />
        </Box>

        <Box
          sx={{ alignItems: 'center', display: 'flex', gap: 0.75, minWidth: 0 }}
        >
          <Typography
            component="span"
            sx={(theme) => ({
              ...ellipsisSx,
              color: libraryMuted(theme),
              flex: '0 1 auto',
              fontSize: '12.5px',
              lineHeight: '18px',
              maxWidth: '45%',
            })}
          >
            {t('core:app_detail.by_developer', {
              developer: widget.name,
              ...cap,
            })}
          </Typography>
          {widget.description ? (
            <>
              <Box
                aria-hidden
                component="span"
                sx={(theme) => ({
                  color: libraryMuted(theme),
                  flexShrink: 0,
                  fontSize: '12.5px',
                  lineHeight: '18px',
                })}
              >
                ·
              </Box>
              <Typography
                component="span"
                sx={(theme) => ({
                  ...ellipsisSx,
                  color: libraryMuted(theme),
                  flex: '1 1 0%',
                  fontSize: '12.5px',
                  lineHeight: '18px',
                })}
              >
                {widget.description}
              </Typography>
            </>
          ) : null}
        </Box>
      </Box>

      <Box sx={{ alignItems: 'center', display: 'flex', gap: 1 }}>
        <HomeAction onAdd={onAdd} onHome={onHome} titleId={titleId} />
      </Box>
    </Box>
  );
};

/**
 * A widget of the library. Its title (or a click anywhere else on the card)
 * opens its page, with its ratings and reviews; Add to Home puts it on Home's
 * Widgets window. Nothing of the widget runs here.
 */
const WidgetCardInner = ({
  widget,
  view = 'grid',
}: {
  widget: LibraryWidget;
  view?: LibraryView;
}) => {
  const { t } = useTranslation(['core', 'group']);
  const { onHome, add, limit } = useWidgetOnHome(widget);

  const openDetails = useCallback(() => {
    executeEvent('selectedAppInfo', { data: widget });
  }, [widget]);

  const handleAdd = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      announceWidgetOnHome(add(), widget.title, t, limit);
    },
    [add, limit, t, widget.title]
  );

  const props: WidgetItemProps = {
    widget,
    onHome,
    onOpenDetails: openDetails,
    onAdd: handleAdd,
  };
  return view === 'list' ? (
    <LibraryWidgetRow {...props} />
  ) : (
    <LibraryWidgetTile {...props} />
  );
};

export const WidgetCard = memo(WidgetCardInner);

/**
 * A widget in the Featured row: the row's card, with Add to Home in place of
 * Open. Its title opens the widget's page, as from the list.
 */
const FeaturedWidgetCardInner = ({ widget }: { widget: LibraryWidget }) => {
  const { t } = useTranslation(['core', 'group']);
  const { onHome, add, limit } = useWidgetOnHome(widget);

  const openDetails = useCallback(() => {
    executeEvent('selectedAppInfo', { data: widget });
  }, [widget]);

  const handleAdd = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      announceWidgetOnHome(add(), widget.title, t, limit);
    },
    [add, limit, t, widget.title]
  );

  return (
    <FeaturedCardLayout
      description={
        widget.description || t('core:message.generic.no_description', cap)
      }
      iconApp={widget}
      onDetails={openDetails}
      ratingName={widgetRatingName(widget)}
      ratingService="APP"
      renderAction={(titleId) => (
        <HomeAction
          fullWidth
          onAdd={handleAdd}
          onHome={onHome}
          titleId={titleId}
        />
      )}
      title={widget.title}
    />
  );
};

export const FeaturedWidgetCard = memo(FeaturedWidgetCardInner);
