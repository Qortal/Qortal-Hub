import { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import { fetchHomeWidgets } from '../../HomeWidgets/fetchHomeWidgets';
import { WidgetCard } from '../AppCard/LibraryWidgetItem';
import { AppsWidthLimiter } from '../Apps-styles';
import type { SortOption } from '../Filters/SortDropdown';
import { AppCollection } from './AppCollection';
import { APP_SKELETON } from './libraryLayout';
import {
  LibraryEmptyState,
  LibrarySection,
  LibrarySkeleton,
} from './LibrarySection';
import {
  cap,
  libraryAccent,
  libraryFocusRing,
  libraryMuted,
} from './libraryStyles';
import { type LibraryView, libraryViewAtom } from './libraryView';
import { TopRatedWidgetsBanner } from './TopRatedWidgetsBanner';
import { useRatingsForSort } from './useRatingsForSort';
import {
  type LibraryWidget,
  libraryWidgetKey,
  sortWidgets,
  toLibraryWidget,
} from './widgetLibrary';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; widgets: LibraryWidget[] };

interface WidgetsTabProps {
  sortValue: SortOption;
  /** False while the tab is hidden but kept mounted. */
  isActive?: boolean;
  scrollParent?: HTMLElement | null;
  /** Bumped by the library's refresh button: ask the node again. */
  libraryRefreshKey?: number;
}

const renderWidget = (widget: LibraryWidget, view: LibraryView) => (
  <WidgetCard view={view} widget={widget} />
);

/** A line under the list: what widgets may do, and how to publish one. */
const Note = ({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) => (
  <Box
    sx={(theme) => ({
      alignItems: 'flex-start',
      color: libraryMuted(theme),
      display: 'flex',
      gap: 1,
      '& .MuiSvgIcon-root': {
        color: libraryAccent(theme),
        flexShrink: 0,
        fontSize: 18,
        mt: '1px',
      },
    })}
  >
    {icon}
    <Typography sx={{ color: 'inherit', fontSize: '13px', lineHeight: 1.5 }}>
      {children}
    </Typography>
  </Box>
);

/**
 * The widgets published on QDN (APPs tagged go-widget, see
 * docs/home-widgets.md), to browse, rate and review on their pages, and to add
 * to Home, with a Featured row of the best rated above them, as on Community.
 * The list is Home's widget picker's, kept for a few minutes; the library's
 * refresh asks the node again. Nothing of a widget runs here.
 */
export const WidgetsTab = ({
  sortValue,
  isActive = true,
  scrollParent = null,
  libraryRefreshKey = 0,
}: WidgetsTabProps) => {
  const { t } = useTranslation(['core', 'group']);
  const view = useAtomValue(libraryViewAtom);
  const ratings = useRatingsForSort(sortValue);
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchHomeWidgets(getBaseApiReact(), {
      fresh: attempt > 0 || libraryRefreshKey > 0,
      signal: controller.signal,
    })
      .then((list) => {
        if (controller.signal.aborted) return;
        setState({ phase: 'ready', widgets: list.map(toLibraryWidget) });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // A failed refresh keeps the list it had.
        setState((previous) =>
          previous.phase === 'ready' ? previous : { phase: 'error' }
        );
      });
    return () => controller.abort();
  }, [attempt, libraryRefreshKey]);

  const retry = useCallback(() => {
    setState({ phase: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  const widgets = useMemo(
    () =>
      state.phase === 'ready'
        ? sortWidgets(state.widgets, sortValue, ratings)
        : [],
    [ratings, sortValue, state]
  );

  const title = t('core:tabs.widgets', cap);

  let content;
  if (state.phase === 'loading') {
    content = <LibrarySkeleton {...APP_SKELETON} count={4} view={view} />;
  } else if (state.phase === 'error') {
    content = (
      <LibraryEmptyState
        action={
          <Button
            disableRipple
            onClick={retry}
            sx={(theme) => ({
              borderRadius: '12px',
              color: libraryAccent(theme),
              fontWeight: 600,
              textTransform: 'none',
              '&.Mui-focusVisible': libraryFocusRing(theme, 2),
            })}
            variant="text"
          >
            {t('core:retry', cap)}
          </Button>
        }
        icon={<CloudOffRoundedIcon />}
        title={t('group:home_widgets.picker_error', cap)}
        tone="error"
      />
    );
  } else if (widgets.length === 0) {
    content = (
      <LibraryEmptyState
        icon={<WidgetsRoundedIcon />}
        title={t('group:home_widgets.picker_empty', cap)}
      />
    );
  } else {
    content = (
      <AppCollection
        active={isActive}
        apps={widgets}
        getKey={libraryWidgetKey}
        label={title}
        myName=""
        renderItem={renderWidget}
        scrollElement={scrollParent}
      />
    );
  }

  return (
    <AppsWidthLimiter sx={{ alignItems: 'stretch', flex: 1, gap: '16px' }}>
      {state.phase === 'ready' ? (
        <TopRatedWidgetsBanner widgets={state.widgets} />
      ) : null}
      <LibrarySection
        count={widgets.length > 0 ? widgets.length : undefined}
        hint={t('core:launcher.library.widgets_hint', cap)}
        icon={<WidgetsRoundedIcon />}
        title={title}
      >
        {content}
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
            mt: 2.5,
          }}
        >
          <Note icon={<ShieldOutlinedIcon />}>
            {t('group:home_widgets.picker_note', cap)}
          </Note>
          <Note icon={<CodeRoundedIcon />}>
            {t('group:home_widgets.picker_developers', cap)}
          </Note>
        </Box>
      </LibrarySection>
    </AppsWidthLimiter>
  );
};
