import type { MouseEvent, ReactNode } from 'react';
import {
  Box,
  ButtonBase,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import { useTranslation } from 'react-i18next';
import {
  type FolderPicture,
  LauncherAppIcon,
  LauncherFolderIcon,
} from '../AppsLauncher/LauncherTile';

/** How big the pictures in the bookmarks menu are. */
export const BOOKMARK_ROW_ICON_PX = 34;

type RowProps = {
  /** The picture on the left of the row. */
  icon: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  /** Shown after the name, such as the chevron of a folder. */
  trailing?: ReactNode;
  hoverBackground: string;
  moreLabel: string;
  onClick: () => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onMore: (event: MouseEvent<HTMLElement>) => void;
};

/**
 * One row of the bookmarks menu: a picture, a name, a line saying where it
 * goes, and the button that opens its menu. A click opens the row.
 */
export const BookmarkListRow = ({
  icon,
  title,
  subtitle,
  trailing,
  hoverBackground,
  moreLabel,
  onClick,
  onContextMenu,
  onMore,
}: RowProps) => (
  <ButtonBase
    onClick={onClick}
    onContextMenu={onContextMenu}
    sx={{
      alignItems: 'center',
      borderRadius: '10px',
      display: 'flex',
      gap: 1.25,
      justifyContent: 'flex-start',
      minHeight: 52,
      px: 1,
      py: 0.75,
      textAlign: 'left',
      width: '100%',
      '&:hover': { backgroundColor: hoverBackground },
      '&:hover .bookmark-row-more, &.Mui-focusVisible .bookmark-row-more': {
        opacity: 1,
      },
    }}
  >
    {icon}
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography
        sx={{
          fontSize: 13.5,
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </Typography>
      <Typography
        sx={(theme) => ({
          color: theme.palette.text.secondary,
          fontSize: 11.5,
          lineHeight: 1.45,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        })}
      >
        {subtitle}
      </Typography>
    </Box>
    {trailing}
    <Tooltip title={moreLabel}>
      <IconButton
        aria-label={moreLabel}
        className="bookmark-row-more"
        component="span"
        onClick={(event) => {
          event.stopPropagation();
          onMore(event);
        }}
        size="small"
        sx={{ flexShrink: 0, opacity: 0.45, transition: 'opacity 120ms' }}
      >
        <MoreVertRoundedIcon sx={{ fontSize: 18 }} />
      </IconButton>
    </Tooltip>
  </ButtonBase>
);

/** A bookmark's row: the app's own picture, with the page under the name. */
export const BookmarkRow = ({
  appName,
  badge,
  name,
  subtitle,
  ...rowProps
}: {
  appName: string;
  badge?: ReactNode;
  name: string;
  subtitle: string;
} & Omit<RowProps, 'icon' | 'title' | 'subtitle'>) => (
  <BookmarkListRow
    {...rowProps}
    icon={
      <LauncherAppIcon
        appName={appName}
        badge={badge}
        size={BOOKMARK_ROW_ICON_PX}
      />
    }
    subtitle={subtitle}
    title={name}
  />
);

/** A folder's row: small pictures of what is inside, and how many there are. */
export const BookmarkFolderRow = ({
  name,
  pictures,
  subtitle,
  ...rowProps
}: {
  name: ReactNode;
  pictures: FolderPicture[];
  subtitle: string;
} & Omit<RowProps, 'icon' | 'title' | 'subtitle' | 'trailing'>) => {
  const { t } = useTranslation(['core']);
  return (
    <BookmarkListRow
      {...rowProps}
      icon={
        <LauncherFolderIcon pictures={pictures} size={BOOKMARK_ROW_ICON_PX} />
      }
      subtitle={subtitle}
      title={name}
      trailing={
        <ChevronRightRoundedIcon
          aria-label={t('core:bookmarks.open_folder')}
          role="img"
          sx={(theme) => ({
            color: theme.palette.text.secondary,
            flexShrink: 0,
            fontSize: 18,
          })}
        />
      }
    />
  );
};
