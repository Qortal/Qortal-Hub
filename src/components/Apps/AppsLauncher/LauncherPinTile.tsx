import { type ComponentProps, useCallback, useRef } from 'react';
import LockIcon from '@mui/icons-material/Lock';
import { useTranslation } from 'react-i18next';
import { useHandlePrivateApps } from '../../../hooks/useHandlePrivateApps';
import { executeEvent } from '../../../utils/events';
import type { PinnedApp } from '../../../utils/pinnedAppsSettings';
import { launcherPinLabel } from './launcherPins';
import {
  LAUNCHER_ICON_SIZE_PX,
  LauncherAppIcon,
  LauncherTile,
} from './LauncherTile';

/**
 * Opens a pinned app in a tab. A private app is downloaded and decrypted
 * first; the promise tells whether it opened.
 */
export const useOpenLauncherPin = () => {
  const { openApp } = useHandlePrivateApps();
  // The hook hands out a new `openApp` on every render: keep the latest.
  const openAppRef = useRef(openApp);
  openAppRef.current = openApp;

  return useCallback(async (app: PinnedApp): Promise<boolean> => {
    if (!app.isPrivate) {
      executeEvent('addTab', { data: app });
      return true;
    }
    try {
      return !!(await openAppRef.current(
        app.privateAppProperties,
        false,
        undefined
      ));
    } catch (error) {
      console.error(error);
      return false;
    }
  }, []);
};

/** The picture of a pinned app: its thumbnail, a private app's logo or a lock. */
export const LauncherPinIcon = ({
  app,
  size = LAUNCHER_ICON_SIZE_PX,
}: {
  app: PinnedApp;
  /** How big the picture is; the launcher's tile size by default. */
  size?: number;
}) => {
  const privateLogo = app.privateAppProperties?.logo;
  // The lock and the mark in the corner keep their share of the picture.
  const lockSize = Math.round(size * 0.46);
  const badgeLockSize = Math.max(8, Math.round(size * 0.21));

  return (
    <LauncherAppIcon
      appName={app.isPrivate ? null : app.name}
      badge={
        app.isPrivate && privateLogo ? (
          <LockIcon sx={{ fontSize: badgeLockSize }} />
        ) : null
      }
      size={size}
      src={app.isPrivate ? privateLogo : null}
    >
      {app.isPrivate && !privateLogo ? (
        <LockIcon sx={{ fontSize: lockSize }} />
      ) : null}
    </LauncherAppIcon>
  );
};

/** The name under a pinned app's tile. */
export const usePinLabel = () => {
  const { t } = useTranslation(['core']);
  return useCallback(
    (app: PinnedApp) =>
      launcherPinLabel(
        app,
        t('core:app_private', { postProcess: 'capitalizeFirstChar' })
      ),
    [t]
  );
};

type LauncherPinTileProps = {
  app: PinnedApp;
  /** Called after the app was asked to open. */
  onOpened?: () => void;
} & Omit<ComponentProps<typeof LauncherTile>, 'icon' | 'label' | 'onClick'>;

/** A pinned app as a tile. A click opens it; a private app is decrypted first. */
export const LauncherPinTile = ({
  app,
  onOpened,
  ...tileProps
}: LauncherPinTileProps) => {
  const openPin = useOpenLauncherPin();
  const pinLabel = usePinLabel();

  return (
    <LauncherTile
      {...tileProps}
      icon={<LauncherPinIcon app={app} />}
      label={pinLabel(app)}
      onClick={async () => {
        if (await openPin(app)) onOpened?.();
      }}
    />
  );
};
