import { memo, useCallback } from 'react';
import { Box } from '@mui/material';
import { AppInfo } from './AppInfo';
import { AppPublish } from './AppPublish';
import { AppsCategoryDesktop } from './AppsCategoryDesktop';
import { AppsLauncher } from './AppsLauncher';
import {
  isAppInfoPage,
  isPublishPage,
  LauncherTabContext,
  LauncherTabShownContext,
  type LauncherTabState,
  type PublishEditTarget,
  showPublishPage,
} from './launcherTabs';

type LauncherTabViewProps = {
  tabId: string;
  state: LauncherTabState;
  /** On screen. A hidden tab stays mounted, as it was left. */
  isShown: boolean;
  availableQapps: any[];
  categories: any[];
  contentHeight: string;
  /** Reloads the list of apps and websites from the node. */
  getQapps: () => void | Promise<void>;
  myAddress: string;
  myApp: any;
  myName: string;
  myWebsite: any;
  /** Changes this tab's state, which AppsDesktop keeps. */
  onChange: (
    tabId: string,
    change: (state: LauncherTabState) => LauncherTabState
  ) => void;
  /** Whether the publish form holds input that is not published yet. */
  onUnsavedPublishChange: (tabId: string, hasUnsavedInput: boolean) => void;
};

/**
 * One launcher tab: the launcher and the pages opened from it. It stays
 * mounted while other tabs show, so its page, its search and what was typed
 * in its publish form are still there when it is shown again.
 */
export const LauncherTabView = memo(function LauncherTabView({
  tabId,
  state,
  isShown,
  availableQapps,
  categories,
  contentHeight,
  getQapps,
  myAddress,
  myApp,
  myName,
  myWebsite,
  onChange,
  onUnsavedPublishChange,
}: LauncherTabViewProps) {
  const { appInfo, category, page, publishEditTarget, request } = state;

  // My apps opens the publish pages through the launcher's setMode.
  const setMode = useCallback(
    (mode: string, editTarget: PublishEditTarget | null = null) =>
      onChange(tabId, (current) => showPublishPage(current, mode, editTarget)),
    [onChange, tabId]
  );
  const handleUnsavedChange = useCallback(
    (hasUnsavedInput: boolean) =>
      onUnsavedPublishChange(tabId, hasUnsavedInput),
    [onUnsavedPublishChange, tabId]
  );

  return (
    <LauncherTabContext.Provider value={tabId}>
      <LauncherTabShownContext.Provider value={isShown}>
        <Box
          data-launcher-tab-id={tabId}
          sx={{
            display: isShown ? 'flex' : 'none',
            flexDirection: 'column',
            height: '100%',
            minHeight: 0,
            overflow: 'hidden',
            position: 'relative',
            width: '100%',
          }}
        >
          <AppsLauncher
            availableQapps={availableQapps}
            categories={categories}
            contentHeight={contentHeight}
            getQapps={getQapps}
            isShow={isShown && page === 'launcher'}
            myAddress={myAddress}
            myApp={myApp}
            myName={myName}
            myWebsite={myWebsite}
            request={request}
            setMode={setMode}
          />

          {isAppInfoPage(page) ? (
            <Box
              sx={{ height: contentHeight, overflow: 'auto', width: '100%' }}
            >
              <AppInfo app={appInfo} myName={myName} />
            </Box>
          ) : null}

          {/* Kept under an app's details opened from it, for Back. */}
          {page === 'category' || page === 'appInfo-from-category' ? (
            <AppsCategoryDesktop
              availableQapps={availableQapps}
              category={category}
              contentHeight={contentHeight}
              isShow={page === 'category'}
              myName={myName}
            />
          ) : null}

          {isPublishPage(page) ? (
            <Box
              sx={{ height: contentHeight, overflow: 'auto', width: '100%' }}
            >
              <AppPublish
                key={
                  publishEditTarget
                    ? [
                        'update',
                        publishEditTarget.service,
                        publishEditTarget.name,
                        publishEditTarget.identifier ?? '',
                      ].join('\u0000')
                    : page
                }
                categories={categories}
                initialAppType={
                  publishEditTarget?.service ??
                  (page === 'publish-website' ? 'WEBSITE' : 'APP')
                }
                initialName={publishEditTarget?.name}
                isAppTypeLocked={
                  page === 'publish-app' ||
                  page === 'publish-website' ||
                  page === 'publish-widget' ||
                  !!publishEditTarget
                }
                isUpdate={!!publishEditTarget}
                myAddress={myAddress}
                myName={myName}
                onUnsavedChange={handleUnsavedChange}
                startAsWidget={page === 'publish-widget'}
                widgetToUpdate={publishEditTarget?.identifier}
              />
            </Box>
          ) : null}
        </Box>
      </LauncherTabShownContext.Provider>
    </LauncherTabContext.Provider>
  );
});
