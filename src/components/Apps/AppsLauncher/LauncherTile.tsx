import {
  type ComponentProps,
  type ReactNode,
  type Ref,
  useEffect,
  useState,
} from 'react';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import LockIcon from '@mui/icons-material/Lock';
import { Box, ButtonBase, Typography } from '@mui/material';
import { useAtomValue } from 'jotai';
import { getBaseApiReact } from '../../../App';
import { selectedNodeInfoAtom } from '../../../atoms/global';
import LogoSelected from '../../../assets/svgs/LogoSelected.svg';

export const LAUNCHER_TILE_WIDTH_PX = 96;
export const LAUNCHER_ICON_SIZE_PX = 56;

/** How long to wait before asking the node for a picture again. */
const PICTURE_RETRY_DELAYS_MS = [2_000, 6_000, 15_000];

interface LauncherAppIconProps {
  /** A picture that is already here, such as a private app's logo. */
  src?: string | null;
  /** Or the name whose picture the node serves. */
  appName?: string | null;
  /** Shown in place of the picture, e.g. a lock for a private app. */
  children?: ReactNode;
  /** A small mark in the corner of the icon. */
  badge?: ReactNode;
  /** How big the icon is; the launcher's tile size by default. */
  size?: number;
}

/** A picture as it is being asked for: what it is of, where from, how far. */
type PictureRequest = {
  appName: string | null | undefined;
  src: string | null | undefined;
  /** The node in use when the picture was asked for. */
  nodeUrl: string | undefined;
  /** Where it is asked from: `src`, or the thumbnail the node serves. */
  address: string | null;
  /** How many times it was asked for again after a failure. */
  attempt: number;
  status: 'loading' | 'loaded' | 'failed';
  /** True once a try has failed: the logo stands in until a picture shows. */
  hasFailed: boolean;
};

const askForPicture = (
  appName: string | null | undefined,
  src: string | null | undefined,
  nodeUrl: string | undefined,
  attempt = 0,
  hasFailed = false
): PictureRequest => ({
  appName,
  src,
  nodeUrl,
  // The address is built for each try: the node in use may have changed.
  address:
    src ||
    (appName
      ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${appName}/qortal_avatar?async=true${
          attempt ? `&retry=${attempt}` : ''
        }`
      : null),
  attempt,
  status: 'loading',
  hasFailed,
});

/**
 * The rounded square that holds an app's picture. A node that is busy can
 * fail to answer at first, so its pictures are asked for again a few times,
 * and again when the node changes. The Qortal logo stands in meanwhile, and
 * for good when there is no picture. A picture that is showing is kept.
 */
export const LauncherAppIcon = ({
  src,
  appName,
  children,
  badge,
  size = LAUNCHER_ICON_SIZE_PX,
}: LauncherAppIconProps) => {
  const nodeUrl = useAtomValue(selectedNodeInfoAtom)?.url;
  const [request, setRequest] = useState(() =>
    askForPicture(appName, src, nodeUrl)
  );

  // Another app starts over, and so does another node for a picture that is
  // not showing: that node may have what this one did not. This is decided
  // while rendering, not in an effect. A picture the browser already holds
  // in memory loads before the effects run, and an effect that set it back
  // to "loading" then would leave it hidden for good.
  const isAnotherApp =
    (request.appName ?? null) !== (appName ?? null) ||
    (request.src ?? null) !== (src ?? null);
  const isAnotherNode =
    request.nodeUrl !== nodeUrl && request.status !== 'loaded';
  if (isAnotherApp || isAnotherNode) {
    const next = askForPicture(
      appName,
      src,
      nodeUrl,
      0,
      isAnotherApp ? false : request.hasFailed
    );
    // The same address is the same picture on the page: it does not load
    // again, so one that is showing stays as it is.
    setRequest(
      next.address === request.address && request.status === 'loaded'
        ? { ...next, status: 'loaded' }
        : next
    );
  }

  useEffect(() => {
    if (request.status !== 'failed' || request.src || !request.appName) return;
    if (request.attempt >= PICTURE_RETRY_DELAYS_MS.length) return;
    const timer = setTimeout(() => {
      setRequest((current) =>
        current === request
          ? askForPicture(
              current.appName,
              current.src,
              current.nodeUrl,
              current.attempt + 1,
              true
            )
          : current
      );
    }, PICTURE_RETRY_DELAYS_MS[request.attempt]);
    return () => clearTimeout(timer);
  }, [request]);

  const { address, status } = request;
  /** What became of the picture at this address; an older one is ignored. */
  const settle = (outcome: 'loaded' | 'failed') =>
    setRequest((current) =>
      current.address === address
        ? {
            ...current,
            status: outcome,
            hasFailed: current.hasFailed || outcome === 'failed',
          }
        : current
    );
  const badgeSize = Math.max(12, Math.round(size * 0.36));
  const showPicture = !!address && status !== 'failed' && !children;
  const showLogo =
    !children && status !== 'loaded' && (!address || request.hasFailed);

  return (
    <Box
      sx={{
        flexShrink: 0,
        height: size,
        position: 'relative',
        width: size,
      }}
    >
      <Box
        sx={(theme) => ({
          alignItems: 'center',
          backgroundColor: theme.palette.background.paper,
          border: `1px solid ${theme.palette.divider}`,
          // Rounded in step with the icon, so a small one is not a circle.
          borderRadius: `${Math.max(6, Math.round(size * 0.29))}px`,
          color: theme.palette.text.secondary,
          display: 'flex',
          height: '100%',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
          width: '100%',
        })}
      >
        {children}
        {showLogo ? (
          <Box
            alt=""
            component="img"
            draggable={false}
            src={LogoSelected}
            sx={{ height: 'auto', width: '52%' }}
          />
        ) : null}
        {showPicture ? (
          <Box
            alt=""
            component="img"
            draggable={false}
            key={address}
            onError={() => settle('failed')}
            onLoad={() => settle('loaded')}
            src={address}
            sx={{
              height: '100%',
              inset: 0,
              objectFit: 'cover',
              opacity: status === 'loaded' ? 1 : 0,
              position: 'absolute',
              width: '100%',
            }}
          />
        ) : null}
      </Box>
      {badge ? (
        <Box
          sx={(theme) => ({
            alignItems: 'center',
            backgroundColor: theme.palette.background.default,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '50%',
            bottom: -4,
            color: theme.palette.text.secondary,
            display: 'flex',
            height: badgeSize,
            justifyContent: 'center',
            position: 'absolute',
            right: -4,
            width: badgeSize,
          })}
        >
          {badge}
        </Box>
      ) : null}
    </Box>
  );
};

/** One of the small pictures on a folder's icon. */
export type FolderPicture = {
  key: string;
  /** A picture that is already here, such as a private app's logo. */
  src?: string | null;
  /** Or the name whose picture the node serves. */
  appName?: string | null;
};

const FOLDER_PICTURES_MAX = 9;

/**
 * A folder's icon: small pictures of what is inside, four of them, or nine
 * when it holds more than four. An empty folder shows a folder outline.
 */
export const LauncherFolderIcon = ({
  pictures,
  size: iconSize = LAUNCHER_ICON_SIZE_PX,
}: {
  pictures: FolderPicture[];
  /** How big the icon is; the launcher's tile size by default. */
  size?: number;
}) => {
  const perRow = pictures.length > 4 ? 3 : 2;
  const gap = Math.max(2, Math.round(iconSize * (perRow === 3 ? 0.054 : 0.07)));
  const size = Math.floor((iconSize * 0.79 - gap * (perRow - 1)) / perRow);
  return (
    <Box
      sx={(theme) => ({
        alignContent: 'center',
        backgroundColor: theme.palette.background.paper,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: `${Math.max(6, Math.round(iconSize * 0.29))}px`,
        color: theme.palette.text.secondary,
        display: 'grid',
        flexShrink: 0,
        gap: `${gap}px`,
        gridTemplateColumns: `repeat(${perRow}, ${size}px)`,
        height: iconSize,
        justifyContent: 'center',
        width: iconSize,
      })}
    >
      {pictures.length === 0 ? (
        <FolderOutlinedIcon
          sx={{ fontSize: iconSize * 0.46, gridColumn: '1 / -1' }}
        />
      ) : (
        pictures.slice(0, FOLDER_PICTURES_MAX).map((picture) => {
          const src =
            picture.src ||
            (picture.appName
              ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${picture.appName}/qortal_avatar?async=true`
              : null);
          return src ? (
            <Box
              alt=""
              component="img"
              draggable={false}
              key={picture.key}
              onError={(event) => {
                event.currentTarget.style.visibility = 'hidden';
              }}
              src={src}
              sx={{
                borderRadius: `${Math.max(2, Math.round(size * 0.3))}px`,
                height: size,
                objectFit: 'cover',
                width: size,
              }}
            />
          ) : (
            <LockIcon key={picture.key} sx={{ fontSize: size }} />
          );
        })
      )}
    </Box>
  );
};

type LauncherTileProps = {
  label: string;
  icon: ReactNode;
  /** Set on the tile's button, for drag and drop. */
  buttonRef?: Ref<HTMLButtonElement>;
} & Omit<ComponentProps<typeof ButtonBase>, 'children' | 'ref'>;

/** One item of the launcher: an icon with its name underneath. */
export const LauncherTile = ({
  label,
  icon,
  buttonRef,
  sx,
  ...buttonProps
}: LauncherTileProps) => (
  <ButtonBase
    focusRipple
    ref={buttonRef}
    title={label}
    {...buttonProps}
    sx={[
      (theme) => ({
        alignItems: 'center',
        borderRadius: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        justifyContent: 'flex-start',
        padding: '10px 4px 8px',
        transition: 'background-color 140ms ease',
        width: LAUNCHER_TILE_WIDTH_PX,
        '&:hover': {
          backgroundColor: theme.palette.action.hover,
        },
        '&.Mui-focusVisible': {
          backgroundColor: theme.palette.action.hover,
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: '-2px',
        },
      }),
      ...(Array.isArray(sx) ? sx : [sx]),
    ]}
  >
    {icon}
    <Typography
      component="span"
      sx={(theme) => ({
        color: theme.palette.text.primary,
        display: '-webkit-box',
        fontSize: '12.5px',
        fontWeight: 500,
        lineHeight: 1.25,
        maxWidth: '100%',
        minHeight: '2.5em',
        overflow: 'hidden',
        overflowWrap: 'anywhere',
        textAlign: 'center',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: 2,
      })}
    >
      {label}
    </Typography>
  </ButtonBase>
);
