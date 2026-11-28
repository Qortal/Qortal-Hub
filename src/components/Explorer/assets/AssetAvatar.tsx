/**
 * A Q-Asset's avatar (from Q-Mintership+'s AssetAvatar). The image its
 * owner published as the Q-Assets app does (IMAGE
 * `asset<id>_<name>_aavatar`): under the owner's primary name, or another
 * name the owner holds (its names say so); anyone else's image for the
 * asset is never shown. It is looked for once the avatar nears the screen.
 * Until it loads, and for an asset without one, a coin in a colour of its
 * own (the theme's info blue turned to the asset's hue) with the name's
 * first letters, or its emoji. With `badge`, the owner's own picture sits
 * on its edge. Hidden from screen readers: the asset's name beside it says
 * it.
 */
import { useState } from 'react';
import { Avatar, Box } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { getBaseApiReact } from '../../../App';
import {
  assetAvatarIdentifier,
  assetInitials,
  avatarPublishers,
} from '../../../lib/explorer/assets';
import { assetAvatarsRead } from '../../../lib/explorer/assetReads';
import { seg } from '../../../lib/explorer/core';
import { namesOfRead, primaryNameRead } from '../../../lib/explorer/reads';
import { useExplorerRead, useNearScreen } from '../ExplorerContext';
import { ExplorerAvatar } from '../ExplorerSearchField';
import { assetAccent } from './assetLook';

export interface AvatarAsset {
  assetId: number;
  name: string | null;
  /** The asset's owner; without it, only the coin. */
  owner?: string | null;
}

/**
 * The name the asset's avatar is published under, once known; null: none
 * to load. Reads the one search of every asset avatar (kept for the
 * window's life), then, only for an asset that has one, the owner's
 * primary name, and the owner's names only when a candidate isn't the
 * primary one. Nothing until `near`.
 */
export function useAssetImage(
  asset: AvatarAsset,
  near: boolean
): string | null {
  const avatars = useExplorerRead(near ? assetAvatarsRead() : null);
  const resources =
    asset.name !== null ? (avatars.data?.get(asset.assetId) ?? []) : [];
  const owner = asset.owner ?? null;
  const primary = useExplorerRead(
    near && owner && resources.length ? primaryNameRead(owner) : null
  );
  const ownerName =
    primary.status === 'ready' ? (primary.data ?? null) : undefined;
  const publishers =
    ownerName === undefined || asset.name === null
      ? []
      : avatarPublishers(
          resources,
          { assetId: asset.assetId, name: asset.name },
          ownerName
        );
  const needNames =
    Boolean(owner) && publishers.length > 0 && publishers[0] !== ownerName;
  const names = useExplorerRead(needNames && owner ? namesOfRead(owner) : null);
  if (!publishers.length) return null;
  if (publishers[0] === ownerName) return ownerName;
  return publishers.find((p) => names.data?.names.includes(p)) ?? null;
}

/** Where the avatar's image is, or undefined. */
function imageUrl(publisher: string | null, identifier: string) {
  if (!publisher) return undefined;
  try {
    return `${getBaseApiReact()}/arbitrary/IMAGE/${seg(publisher)}/${seg(identifier)}?async=true`;
  } catch {
    return undefined;
  }
}

export function AssetAvatar({
  asset,
  size = 48,
  badge = false,
}: {
  asset: AvatarAsset;
  size?: number;
  /** The owner's picture on the coin's edge. */
  badge?: boolean;
}) {
  const theme = useTheme();
  const [node, setNode] = useState<HTMLElement | null>(null);
  const near = useNearScreen(node, '200px');
  const publisher = useAssetImage(asset, near);
  const identifier =
    asset.name !== null ? assetAvatarIdentifier(asset.assetId, asset.name) : '';
  const owner = badge ? (asset.owner ?? null) : null;
  const ownerName = useExplorerRead(
    near && owner ? primaryNameRead(owner) : null
  ).data;

  const dark = theme.palette.mode === 'dark';
  const accent = assetAccent(theme, asset.assetId);
  const letters =
    asset.name !== null ? assetInitials(asset.name) : `#${asset.assetId}`;
  const symbol = !/[\p{L}\p{N}]/u.test(letters);
  const length = [...letters].length;
  const scale = symbol
    ? 0.56
    : length <= 1
      ? 0.44
      : length === 2
        ? 0.38
        : length === 3
          ? 0.3
          : 0.26;
  const rim = Math.max(1.5, Math.round(size * 0.04 * 2) / 2);
  const badgeSize = Math.max(14, Math.round(size * 0.4));

  return (
    <Box
      component="span"
      ref={setNode}
      aria-hidden
      data-asset-avatar=""
      sx={{
        display: 'inline-flex',
        flexShrink: 0,
        height: size,
        position: 'relative',
        width: size,
      }}
    >
      <Avatar
        alt=""
        src={imageUrl(publisher, identifier)}
        slotProps={{ img: { loading: 'lazy', decoding: 'async' } }}
        sx={{
          backgroundColor: alpha(accent, dark ? 0.22 : 0.16),
          backgroundImage: `radial-gradient(circle at 32% 26%, ${alpha(
            theme.palette.common.white,
            dark ? 0.16 : 0.55
          )} 0, transparent 55%)`,
          border: `${rim}px solid ${alpha(accent, dark ? 0.6 : 0.5)}`,
          boxSizing: 'border-box',
          color: 'text.primary',
          fontSize: Math.max(10, Math.round(size * scale)),
          fontWeight: 800,
          height: size,
          letterSpacing: length >= 3 ? '-0.02em' : 0,
          lineHeight: 1,
          userSelect: 'none',
          width: size,
          '& img': { objectFit: 'cover' },
        }}
      >
        {letters}
      </Avatar>
      {owner && ownerName ? (
        <Box
          component="span"
          sx={(themed) => ({
            backgroundColor: themed.palette.background.surface,
            border: `2px solid ${themed.palette.background.surface}`,
            borderRadius: '50%',
            bottom: -Math.round(badgeSize * 0.15),
            display: 'inline-flex',
            position: 'absolute',
            right: -Math.round(badgeSize * 0.15),
          })}
        >
          <ExplorerAvatar name={ownerName} size={badgeSize} />
        </Box>
      ) : null}
    </Box>
  );
}
