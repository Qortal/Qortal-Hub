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
}

/**
 * The rounded square that holds an app's picture. A node that is busy can
 * fail to answer at first, so its pictures are asked for again a few times,
 * and again when the node changes. The Qortal logo stands in meanwhile, and
 * for good when there is no picture.
 */
export const LauncherAppIcon = ({
  src,
  appName,
  children,
  badge,
}: LauncherAppIconProps) => {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>(
    'loading'
  );

  const nodeUrl = useAtomValue(selectedNodeInfoAtom)?.url;

  useEffect(() => {
    setAttempt(0);
    setStatus('loading');
  }, [appName, src]);

  // Another node may have the picture this one did not.
  useEffect(() => {
    setAttempt(0);
    setStatus((current) => (current === 'loaded' ? current : 'loading'));
  }, [nodeUrl]);

  useEffect(() => {
    if (status !== 'failed' || src || !appName) return;
    if (attempt >= PICTURE_RETRY_DELAYS_MS.length) return;
    const timer = setTimeout(() => {
      setAttempt((current) => current + 1);
      setStatus('loading');
    }, PICTURE_RETRY_DELAYS_MS[attempt]);
    return () => clearTimeout(timer);
  }, [appName, attempt, src, status]);

  // The address is built for each try: the node in use may have changed.
  const picture =
    src ||
    (appName
      ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${appName}/qortal_avatar?async=true${
          attempt ? `&retry=${attempt}` : ''
        }`
      : null);
  const showPicture = !!picture && status !== 'failed' && !children;
  const showLogo =
    !children &&
    status !== 'loaded' &&
    (!picture || status === 'failed' || attempt > 0);

  return (
    <Box
      sx={{
        flexShrink: 0,
        height: LAUNCHER_ICON_SIZE_PX,
        position: 'relative',
        width: LAUNCHER_ICON_SIZE_PX,
      }}
    >
      <Box
        sx={(theme) => ({
          alignItems: 'center',
          backgroundColor: theme.palette.background.paper,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '16px',
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
            key={picture}
            onError={() => setStatus('failed')}
            onLoad={() => setStatus('loaded')}
            src={picture}
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
            height: 20,
            justifyContent: 'center',
            position: 'absolute',
            right: -4,
            width: 20,
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
}: {
  pictures: FolderPicture[];
}) => {
  const perRow = pictures.length > 4 ? 3 : 2;
  const size = perRow === 3 ? 13 : 20;
  return (
    <Box
      sx={(theme) => ({
        alignContent: 'center',
        backgroundColor: theme.palette.background.paper,
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '16px',
        color: theme.palette.text.secondary,
        display: 'grid',
        flexShrink: 0,
        gap: perRow === 3 ? '3px' : '4px',
        gridTemplateColumns: `repeat(${perRow}, ${size}px)`,
        height: LAUNCHER_ICON_SIZE_PX,
        justifyContent: 'center',
        width: LAUNCHER_ICON_SIZE_PX,
      })}
    >
      {pictures.length === 0 ? (
        <FolderOutlinedIcon sx={{ fontSize: 26, gridColumn: '1 / -1' }} />
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
                borderRadius: perRow === 3 ? '4px' : '6px',
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
