import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../App';
import { memberGroupsAtom } from '../../atoms/global';
import { useHandlePrivateApps } from '../../hooks/useHandlePrivateApps';
import {
  buildMyPrivateAppsSearchUrl,
  PublishedPrivateApp,
  toPublishedPrivateApps,
} from './privateAppMetadata';
import { LibraryActionButton } from './AppCard/libraryCardParts';
import { PRIVATE_SKELETON } from './AppsLibrary/libraryLayout';
import {
  LibraryEmptyState,
  LibrarySection,
  LibrarySkeleton,
} from './AppsLibrary/LibrarySection';
import { cap } from './AppsLibrary/libraryStyles';
import { libraryViewAtom } from './AppsLibrary/libraryView';
import { PrivateAppItem, PrivateAppList } from './AppsLibrary/PrivateAppItem';

interface PublishedPrivateAppsProps {
  myAddress: string;
  refreshKey?: number;
}

export const PublishedPrivateApps = ({
  myAddress,
  refreshKey = 0,
}: PublishedPrivateAppsProps) => {
  const { t } = useTranslation(['core', 'group']);
  const view = useAtomValue(libraryViewAtom);
  const { openApp } = useHandlePrivateApps();
  const memberGroups = useAtomValue(memberGroupsAtom);
  const [apps, setApps] = useState<PublishedPrivateApp[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const groupNames = useMemo(() => {
    const map = new Map<number, string>();
    (memberGroups ?? []).forEach((group) => {
      if (group?.groupId != null && group?.groupName) {
        map.set(Number(group.groupId), group.groupName);
      }
    });
    return map;
  }, [memberGroups]);

  // An error stays on screen until a load succeeds, so a retry that fails
  // again leaves the Retry button where it was, with focus on it.
  const loadApps = useCallback(async (): Promise<boolean> => {
    if (!myAddress) {
      setApps([]);
      setHasError(false);
      return true;
    }
    setIsLoading(true);
    try {
      const namesResponse = await fetch(
        `${getBaseApiReact()}/names/address/${myAddress}?limit=0`
      );
      const namesData = await namesResponse.json();
      const names: string[] = Array.isArray(namesData)
        ? namesData.map((item) => item?.name).filter(Boolean)
        : [];
      if (!names.length) {
        setApps([]);
        setHasError(false);
        return true;
      }
      const response = await fetch(
        buildMyPrivateAppsSearchUrl(getBaseApiReact(), names)
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setApps(toPublishedPrivateApps(await response.json()));
      setHasError(false);
      return true;
    } catch (error) {
      console.error(error);
      setHasError(true);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [myAddress]);

  const handleRetry = async () => {
    if (isLoading) return;
    // Retry goes once the apps are back: focus moves to the section's title
    // instead of falling back to the top of the page.
    if (await loadApps()) headingRef.current?.focus();
  };

  useEffect(() => {
    loadApps();
  }, [loadApps, refreshKey]);

  const title = t('core:private_apps.published_title', cap);
  // A reload keeps the apps on screen, dimmed, while the node answers.
  const isFirstLoad = isLoading && apps.length === 0;

  let content;
  if (hasError) {
    content = (
      <LibraryEmptyState
        action={
          <LibraryActionButton
            busy={isLoading}
            kind="secondary"
            onClick={handleRetry}
          >
            {t('core:retry', cap)}
          </LibraryActionButton>
        }
        compact
        icon={<ErrorOutlineRoundedIcon />}
        title={t('core:private_apps.load_error', cap)}
        tone="error"
      />
    );
  } else if (isFirstLoad) {
    content = <LibrarySkeleton {...PRIVATE_SKELETON} count={2} view={view} />;
  } else if (apps.length === 0) {
    content = (
      <LibraryEmptyState
        compact
        icon={<LockRoundedIcon />}
        title={t('core:private_apps.empty', cap)}
      />
    );
  } else {
    content = (
      <Box
        aria-busy={isLoading || undefined}
        sx={{
          opacity: isLoading ? 0.6 : 1,
          transition: 'opacity 160ms',
        }}
      >
        <PrivateAppList label={title} view={view}>
          {apps.map((app) => (
            <Box
              key={`${app.name}/${app.service}/${app.identifier}`}
              role="listitem"
              sx={{ minWidth: 0 }}
            >
              <PrivateAppItem
                app={app}
                groupName={
                  groupNames.get(app.groupId) ??
                  t('core:private_apps.group_id', { groupId: app.groupId })
                }
                onOpen={() =>
                  openApp(
                    {
                      name: app.name,
                      service: app.service,
                      identifier: app.identifier,
                      groupId: app.groupId,
                    },
                    true,
                    undefined
                  )
                }
                view={view}
              />
            </Box>
          ))}
        </PrivateAppList>
      </Box>
    );
  }

  return (
    <LibrarySection
      count={!isFirstLoad && !hasError ? apps.length : undefined}
      headingRef={headingRef}
      hint={t('core:private_apps.listing_hint', cap)}
      icon={<LockRoundedIcon />}
      title={title}
    >
      {content}
    </LibrarySection>
  );
};
