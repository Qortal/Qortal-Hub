import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import AppsIcon from '@mui/icons-material/Apps';
import LanguageIcon from '@mui/icons-material/Language';
import WidgetsIcon from '@mui/icons-material/Widgets';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import BadgeRoundedIcon from '@mui/icons-material/BadgeRounded';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import { useAtomValue } from 'jotai';
import { userInfoAtom } from '../../../atoms/global';
import { getBaseApiReact } from '../../../App';
import { executeEvent } from '../../../utils/events';
import { AppsWidthLimiter } from '../Apps-styles';
import { PublishedAppCard } from '../AppCard';
import { LibraryActionButton } from '../AppCard/libraryCardParts';
import { WidgetCard } from '../AppCard/LibraryWidgetItem';
import type { PublishEditTarget } from '../launcherTabs';
import { AppCollection } from './AppCollection';
import { APP_SKELETON } from './libraryLayout';
import {
  LibraryEmptyState,
  LibrarySection,
  LibrarySkeleton,
} from './LibrarySection';
import { cap } from './libraryStyles';
import { type LibraryView, libraryViewAtom } from './libraryView';
import {
  PublishButton,
  PublishNewContainer,
  SectionContainer,
} from './LibraryTab-styles';
import type { OwnWidget } from './ownWidgets';
import { useOwnWidgets } from './useOwnWidgets';
import { type LibraryWidget, libraryWidgetKey } from './widgetLibrary';

interface MyAppsTabProps {
  myName: string;
  availableQapps: any[];
  /** Opens a publish page: Update passes the app or website it updates. */
  setMode: (mode: string, publishEditTarget?: PublishEditTarget | null) => void;
  searchValue?: string;
  /** Changes when the library's refresh button is pressed. */
  libraryRefreshKey?: number;
}

const serviceOf = (app: any): 'APP' | 'WEBSITE' =>
  app.service === 'WEBSITE' || app.service?.includes?.('WEBSITE')
    ? 'WEBSITE'
    : 'APP';

/**
 * What Update on a widget opens: the widget under its identifier, or the
 * name's own app when that app is the widget.
 */
const widgetUpdateTarget = (widget: {
  name: string;
  identifier: string | null;
}): PublishEditTarget =>
  widget.identifier
    ? { name: widget.name, service: 'APP', identifier: widget.identifier }
    : { name: widget.name, service: 'APP' };

const matchesSearch = (widget: OwnWidget, searchLower: string) =>
  widget.name.toLowerCase().includes(searchLower) ||
  widget.title.toLowerCase().includes(searchLower) ||
  widget.description.toLowerCase().includes(searchLower);

export const MyAppsTab = ({
  myName,
  availableQapps,
  setMode,
  searchValue = '',
  libraryRefreshKey = 0,
}: MyAppsTabProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group']);
  const view = useAtomValue(libraryViewAtom);
  const userInfo = useAtomValue(userInfoAtom);
  const myAddress = userInfo?.address ?? null;
  const [myNames, setMyNames] = useState<string[]>([]);
  const [namesLoaded, setNamesLoaded] = useState(false);

  const getNames = useCallback(async () => {
    if (!myAddress) {
      setMyNames([]);
      setNamesLoaded(true);
      return;
    }
    try {
      const res = await fetch(
        `${getBaseApiReact()}/names/address/${myAddress}?limit=0`
      );
      const data = await res.json();
      setMyNames(data?.map((item: { name: string }) => item.name) ?? []);
    } catch (error) {
      console.error(error);
    } finally {
      setNamesLoaded(true);
    }
  }, [myAddress]);

  useEffect(() => {
    setNamesLoaded(false);
    getNames();
  }, [getNames]);

  // The refresh button reloads the names too, without the placeholders: the
  // apps stay on screen while the node answers.
  const lastRefreshRef = useRef(libraryRefreshKey);
  useEffect(() => {
    if (lastRefreshRef.current === libraryRefreshKey) return;
    lastRefreshRef.current = libraryRefreshKey;
    getNames();
  }, [getNames, libraryRefreshKey]);

  // Find user's published apps and websites (all names), applying search filter
  const myApps = useMemo(() => {
    if (!myNames.length || !availableQapps) return [];
    const nameSet = new Set(myNames);
    let result = availableQapps.filter(
      (app) =>
        nameSet.has(app.name) &&
        (app.service === 'APP' || app.service?.includes('APP'))
    );
    if (searchValue) {
      const searchLower = searchValue.toLowerCase();
      result = result.filter(
        (app) =>
          app.name.toLowerCase().includes(searchLower) ||
          (app?.metadata?.title &&
            app.metadata.title.toLowerCase().includes(searchLower)) ||
          (app?.metadata?.description &&
            app.metadata.description.toLowerCase().includes(searchLower))
      );
    }
    return result;
  }, [myNames, availableQapps, searchValue]);

  const myWebsites = useMemo(() => {
    if (!myNames.length || !availableQapps) return [];
    const nameSet = new Set(myNames);
    let result = availableQapps.filter(
      (app) =>
        nameSet.has(app.name) &&
        (app.service === 'WEBSITE' || app.service?.includes('WEBSITE'))
    );
    if (searchValue) {
      const searchLower = searchValue.toLowerCase();
      result = result.filter(
        (app) =>
          app.name.toLowerCase().includes(searchLower) ||
          (app?.metadata?.title &&
            app.metadata.title.toLowerCase().includes(searchLower)) ||
          (app?.metadata?.description &&
            app.metadata.description.toLowerCase().includes(searchLower))
      );
    }
    return result;
  }, [myNames, availableQapps, searchValue]);

  // The names' widgets: a section of their own, loaded beside the apps.
  const ownWidgets = useOwnWidgets(myNames, libraryRefreshKey);
  const myWidgets = useMemo(() => {
    if (!searchValue) return ownWidgets.widgets;
    const searchLower = searchValue.toLowerCase();
    return ownWidgets.widgets.filter((widget) =>
      matchesSearch(widget, searchLower)
    );
  }, [ownWidgets.widgets, searchValue]);

  const updateWidget = useCallback(
    (widget: LibraryWidget) => setMode('publish', widgetUpdateTarget(widget)),
    [setMode]
  );

  const isLoadingNames = myAddress != null && !namesLoaded;
  const hasNoNames = myAddress != null && namesLoaded && myNames.length === 0;

  const appsTitle = t('core:developer.your_published_apps', cap);
  const sitesTitle = t('core:developer.your_published_websites', cap);
  const widgetsTitle = t('core:developer.your_published_widgets', cap);

  if (isLoadingNames) {
    return (
      <AppsWidthLimiter sx={{ alignItems: 'stretch', gap: '16px' }}>
        <LibrarySection icon={<AppsRoundedIcon />} title={appsTitle}>
          <LibrarySkeleton {...APP_SKELETON} count={2} view={view} />
        </LibrarySection>
      </AppsWidthLimiter>
    );
  }

  if (!myAddress || hasNoNames) {
    return (
      <AppsWidthLimiter sx={{ alignItems: 'stretch', gap: '16px' }}>
        <LibrarySection
          icon={<AppsRoundedIcon />}
          title={t('core:tabs.my_apps', cap)}
        >
          <LibraryEmptyState
            action={
              <LibraryActionButton
                kind="primary"
                onClick={() => executeEvent('openRegisterName', {})}
              >
                {t('core:action.register_name', cap)}
              </LibraryActionButton>
            }
            icon={<BadgeRoundedIcon />}
            text={t('core:launcher.library.no_name_text', cap)}
            title={t('core:message.generic.name_publish', cap)}
          />
        </LibrarySection>
      </AppsWidthLimiter>
    );
  }

  const renderOwn = (app: any, itemView: 'grid' | 'list') => (
    <PublishedAppCard
      app={app}
      myName={myName}
      onUpdate={() => {
        setMode('publish', { name: app.name, service: serviceOf(app) });
      }}
      view={itemView}
    />
  );

  const renderOwnWidget = (widget: OwnWidget, itemView: LibraryView) => (
    <WidgetCard
      notListed={!widget.listed}
      onUpdate={updateWidget}
      view={itemView}
      widget={widget}
    />
  );

  let widgetsContent;
  if (ownWidgets.phase === 'loading') {
    widgetsContent = (
      <LibrarySkeleton {...APP_SKELETON} count={1} view={view} />
    );
  } else if (ownWidgets.phase === 'error') {
    widgetsContent = (
      <LibraryEmptyState
        action={
          <LibraryActionButton kind="secondary" onClick={ownWidgets.retry}>
            {t('core:retry', cap)}
          </LibraryActionButton>
        }
        compact
        icon={<CloudOffRoundedIcon />}
        title={t('group:home_widgets.picker_error', cap)}
        tone="error"
      />
    );
  } else if (myWidgets.length > 0) {
    widgetsContent = (
      <AppCollection
        apps={myWidgets}
        getKey={libraryWidgetKey}
        label={widgetsTitle}
        myName={myName}
        renderItem={renderOwnWidget}
        virtualize={false}
      />
    );
  } else {
    widgetsContent = (
      <LibraryEmptyState
        compact
        icon={<WidgetsRoundedIcon />}
        title={t('core:developer.no_widgets_yet', cap)}
      />
    );
  }

  return (
    <AppsWidthLimiter sx={{ alignItems: 'stretch' }}>
      <SectionContainer>
        {/* Published Apps Section */}
        <LibrarySection
          count={myApps.length}
          hint={t('core:launcher.library.my_apps_hint', cap)}
          icon={<AppsRoundedIcon />}
          title={appsTitle}
        >
          {myApps.length > 0 ? (
            <AppCollection
              apps={myApps}
              label={appsTitle}
              myName={myName}
              renderItem={renderOwn}
              virtualize={false}
            />
          ) : (
            <LibraryEmptyState
              compact
              icon={<AppsRoundedIcon />}
              title={t('core:developer.no_apps_yet', cap)}
            />
          )}
        </LibrarySection>

        {/* Published Websites Section */}
        <LibrarySection
          count={myWebsites.length}
          hint={t('core:launcher.library.my_apps_hint', cap)}
          icon={<LanguageRoundedIcon />}
          title={sitesTitle}
        >
          {myWebsites.length > 0 ? (
            <AppCollection
              apps={myWebsites}
              label={sitesTitle}
              myName={myName}
              renderItem={renderOwn}
              virtualize={false}
            />
          ) : (
            <LibraryEmptyState
              compact
              icon={<LanguageRoundedIcon />}
              title={t('core:developer.no_sites_yet', cap)}
            />
          )}
        </LibrarySection>

        {/* Published Widgets Section */}
        <LibrarySection
          count={ownWidgets.phase === 'ready' ? myWidgets.length : undefined}
          hint={t('core:launcher.library.my_widgets_hint', cap)}
          icon={<WidgetsRoundedIcon />}
          title={widgetsTitle}
        >
          {widgetsContent}
        </LibrarySection>

        {/* Publish New Section */}
        <LibrarySection
          hint={t('core:message.generic.one_app_per_name', cap)}
          icon={<AddRoundedIcon />}
          title={t('core:developer.publish_new', cap)}
        >
          <PublishNewContainer>
            <PublishButton
              onClick={() => {
                // A new app or website: nothing is locked.
                setMode('publish-app');
              }}
            >
              <AppsIcon
                sx={{ fontSize: '32px', color: theme.palette.primary.main }}
              />
              <Typography
                sx={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: theme.palette.text.primary,
                }}
              >
                {t('core:developer.publish_app', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </PublishButton>
            <PublishButton
              onClick={() => {
                // A new app or website: nothing is locked.
                setMode('publish-website');
              }}
            >
              <LanguageIcon
                sx={{ fontSize: '32px', color: theme.palette.secondary.main }}
              />
              <Typography
                sx={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: theme.palette.text.primary,
                }}
              >
                {t('core:developer.publish_site', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </PublishButton>
            <PublishButton
              onClick={() => {
                // A new widget: the form opens on Widget.
                setMode('publish-widget');
              }}
            >
              <WidgetsIcon
                sx={{ fontSize: '32px', color: theme.palette.primary.main }}
              />
              <Typography
                sx={{
                  fontSize: '14px',
                  fontWeight: 500,
                  color: theme.palette.text.primary,
                }}
              >
                {t('core:developer.publish_widget', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </PublishButton>
          </PublishNewContainer>
        </LibrarySection>
      </SectionContainer>
    </AppsWidthLimiter>
  );
};
