import { useTheme } from '@mui/material';
import { useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  isAppPinnedAtomFamily,
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../../atoms/global';
import { executeEvent } from '../../../utils/events';
import { saveToLocalStorage } from '../AppsNavBarDesktop';
import { inLauncherTab, useLauncherTabId } from '../launcherTabs';
import type { LibraryView } from '../AppsLibrary/libraryView';
import { LibraryAppRow, LibraryAppTile } from './LibraryAppItem';

const PINNED_KEY_SEP = '\0';

interface AppCardEnhancedProps {
  app: any;
  myName: string;
  isFromCategory?: boolean;
  /** A card of the grid, or a row of the list. */
  view?: LibraryView;
  /** Set on the account's own apps: shows Update. */
  onUpdate?: () => void;
}

/**
 * An app or website of the library. Its title opens the app's page (a click
 * anywhere else on the card does too), Open starts it in a tab, and the pin
 * keeps it on the launcher.
 */
const AppCardEnhancedInner = ({
  app,
  myName,
  isFromCategory = false,
  view = 'grid',
  onUpdate,
}: AppCardEnhancedProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const launcherTabId = useLauncherTabId();
  const isInstalled = app?.status?.status === 'READY';

  const pinnedKey = useMemo(
    () => `${app?.service ?? ''}${PINNED_KEY_SEP}${app?.name ?? ''}`,
    [app?.name, app?.service]
  );
  const isSelectedAppPinned = useAtomValue(isAppPinnedAtomFamily(pinnedKey));
  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);

  const handleCardClick = useCallback(() => {
    if (isFromCategory) {
      executeEvent('selectedAppInfoCategory', { data: app });
    } else {
      executeEvent('selectedAppInfo', { data: app });
    }
  }, [app, isFromCategory]);

  const handlePinClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const name = app?.name;
      const service = app?.service;
      setSortablePinnedApps((prev) => {
        const isPinned = !!prev?.find(
          (item) => item?.name === name && item?.service === service
        );
        const updatedApps = isPinned
          ? prev.filter(
              (item) => !(item?.name === name && item?.service === service)
            )
          : [...(prev ?? []), { name, service }];
        saveToLocalStorage(
          'ext_saved_settings',
          'sortablePinnedApps',
          updatedApps
        );
        return updatedApps;
      });
      setSettingsLocalLastUpdated(Date.now());
    },
    [
      app?.name,
      app?.service,
      setSortablePinnedApps,
      setSettingsLocalLastUpdated,
    ]
  );

  const handleOpenClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      executeEvent('addTab', { data: inLauncherTab(app, launcherTabId) });
    },
    [app, launcherTabId]
  );

  const truncatedDescription = useMemo(() => {
    const desc = app?.metadata?.description;
    if (!desc)
      return t('core:message.generic.no_description', {
        postProcess: 'capitalizeFirstChar',
      });
    return desc.length > 100 ? `${desc.substring(0, 100)}...` : desc;
  }, [app?.metadata?.description, t]);

  const tags = useMemo((): string[] => {
    const rawTags = app?.metadata?.tags;
    if (!rawTags) return [];
    if (typeof rawTags === 'string')
      return rawTags
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
        .slice(0, 3);
    return Array.isArray(rawTags) ? rawTags.slice(0, 3) : [];
  }, [app?.metadata?.tags]);

  const handleUpdateClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onUpdate?.();
    },
    [onUpdate]
  );

  const itemProps = {
    app,
    title: app?.metadata?.title || app?.name,
    developerLine: t('core:app_detail.by_developer', {
      developer: app?.name,
      postProcess: 'capitalizeFirstChar',
    }),
    description: truncatedDescription,
    categoryId: app?.metadata?.category,
    categoryName: app?.metadata?.categoryName,
    tags,
    isInstalled,
    isPinned: isSelectedAppPinned,
    onOpenDetails: handleCardClick,
    onTogglePin: handlePinClick,
    onOpen: handleOpenClick,
    onUpdate: onUpdate ? handleUpdateClick : undefined,
  };

  return view === 'list' ? (
    <LibraryAppRow {...itemProps} />
  ) : (
    <LibraryAppTile {...itemProps} />
  );
};

export const AppCardEnhanced = memo(AppCardEnhancedInner);
