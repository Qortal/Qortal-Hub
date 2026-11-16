import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useMemo,
} from 'react';
import { Box } from '@mui/material';
import { useAtomValue } from 'jotai';
import { AppCardEnhanced } from '../AppCard';
import { appCollectionMetrics } from './libraryLayout';
import { libraryFadeInSx } from './libraryStyles';
import { type LibraryView, libraryViewAtom } from './libraryView';
import { VirtualAppGrid } from './VirtualAppGrid';

interface AppCollectionProps {
  apps: any[];
  myName: string;
  /** The list's name for screen readers. */
  label: string;
  scrollElement?: HTMLElement | null;
  /** False while the collection is hidden but kept mounted. */
  active?: boolean;
  /** False renders every app, for a short list without a scroller. */
  virtualize?: boolean;
  isFromCategory?: boolean;
  /** Draws an app another way (the account's own apps get Update). */
  renderItem?: (app: any, view: LibraryView, index: number) => ReactNode;
}

const getAppKey = (app: any) => `${app?.service}-${app?.name}`;

/** Moves focus between the rows of a list with the up and down arrows. */
const handleRowKeys = (event: KeyboardEvent<HTMLElement>) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const target = event.target as HTMLElement | null;
  if (!target?.classList?.contains('libraryDetails')) return;
  const item = target.closest('[data-library-index]');
  const index = Number(item?.getAttribute('data-library-index'));
  if (!Number.isFinite(index)) return;
  const next = event.currentTarget.querySelector<HTMLElement>(
    `[data-library-index="${index + (event.key === 'ArrowDown' ? 1 : -1)}"] .libraryDetails`
  );
  if (!next) return;
  event.preventDefault();
  next.focus({ preventScroll: true });
  const row = next.closest('[data-library-row]') as HTMLElement | null;
  if (typeof row?.scrollIntoView === 'function') {
    row.scrollIntoView({ block: 'nearest' });
  }
};

/**
 * Apps and websites as a grid of cards or a list of rows, as chosen with the
 * library's grid/list toggle. A long collection is virtual in both views.
 */
export const AppCollection = ({
  apps,
  myName,
  label,
  scrollElement = null,
  active = true,
  virtualize = true,
  isFromCategory = false,
  renderItem,
}: AppCollectionProps) => {
  const view = useAtomValue(libraryViewAtom);
  const metrics = useMemo(() => appCollectionMetrics(view), [view]);
  const setSize = apps.length;

  const renderWrapped = useCallback(
    (app: any, index: number) => (
      <Box
        aria-posinset={index + 1}
        aria-setsize={setSize}
        data-library-index={index}
        role="listitem"
      >
        {renderItem ? (
          renderItem(app, view, index)
        ) : (
          <AppCardEnhanced
            app={app}
            isFromCategory={isFromCategory}
            myName={myName}
            view={view}
          />
        )}
      </Box>
    ),
    [isFromCategory, myName, renderItem, setSize, view]
  );

  return (
    <Box
      aria-label={label}
      key={view}
      onKeyDown={view === 'list' ? handleRowKeys : undefined}
      role="list"
      sx={{
        containerName: 'library',
        containerType: 'inline-size',
        width: '100%',
        ...libraryFadeInSx(),
      }}
    >
      <VirtualAppGrid
        active={active}
        columns={metrics.columns}
        gap={metrics.gap}
        getKey={getAppKey}
        items={apps}
        maxColumns={metrics.maxColumns}
        minColumnWidth={metrics.minColumnWidth}
        renderItem={renderWrapped}
        rowHeight={metrics.rowHeight}
        scrollElement={scrollElement}
        virtualize={virtualize}
      />
    </Box>
  );
};
