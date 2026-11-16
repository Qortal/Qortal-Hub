import type { MouseEvent, ReactNode } from 'react';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  IconButton,
  Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded';
import { useTranslation } from 'react-i18next';
import { getBaseApiReact } from '../../../App';
import LogoSelected from '../../../assets/svgs/LogoSelected.svg';
import {
  cap,
  INSTANT_TOOLTIP,
  isDark,
  libraryAccent,
  libraryFocusRing,
  libraryHairline,
  libraryHoverBorder,
  libraryMuted,
} from '../AppsLibrary/libraryStyles';

const ICON_SIZES = {
  44: { avatar: 30, radius: 12 },
  52: { avatar: 36, radius: 14 },
  60: { avatar: 44, radius: 16 },
} as const;

/** An app's icon on a soft square, with the Qortal logo when it has none. */
export const AppIconTile = ({
  app,
  size,
}: {
  app: any;
  size: 44 | 52 | 60;
}) => {
  const { avatar, radius } = ICON_SIZES[size];
  return (
    <Box
      sx={(theme) => ({
        alignItems: 'center',
        backgroundColor: alpha(theme.palette.text.primary, 0.06),
        borderRadius: `${radius}px`,
        display: 'flex',
        flexShrink: 0,
        height: size,
        justifyContent: 'center',
        width: size,
      })}
    >
      <Avatar
        alt=""
        slotProps={{ img: { draggable: false } }}
        src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${app?.name}/qortal_avatar?async=true`}
        sx={{
          backgroundColor: 'transparent',
          borderRadius: '10px',
          height: avatar,
          width: avatar,
          '& img': { objectFit: 'fill' },
        }}
        variant="rounded"
      >
        <img
          alt=""
          draggable={false}
          src={LogoSelected}
          style={{ width: '70%' }}
        />
      </Avatar>
    </Box>
  );
};

/**
 * The card's title, as the button that opens the app's page. Its `::after`
 * covers the whole card, so a click anywhere on the card that is not another
 * button opens the page too, and the focus ring goes round the whole card.
 */
export const DetailsButton = ({
  id,
  onClick,
  align = 'left',
  overlayRadius = 16,
  textSx,
  children,
}: {
  id?: string;
  onClick: () => void;
  align?: 'left' | 'center';
  overlayRadius?: number;
  textSx?: Record<string, any>;
  children: ReactNode;
}) => (
  <ButtonBase
    className="libraryDetails"
    disableRipple
    id={id}
    onClick={onClick}
    sx={(theme) => ({
      color: theme.palette.text.primary,
      display: 'block',
      font: 'inherit',
      maxWidth: '100%',
      minWidth: 0,
      position: 'static',
      textAlign: align,
      '&::after': {
        borderRadius: `${overlayRadius}px`,
        content: '""',
        cursor: 'pointer',
        inset: 0,
        position: 'absolute',
      },
      '&.Mui-focusVisible': { outline: 'none' },
      '&.Mui-focusVisible::after': libraryFocusRing(theme, 2),
    })}
  >
    <Box
      component="span"
      sx={{
        display: 'block',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        ...textSx,
      }}
    >
      {children}
    </Box>
  </ButtonBase>
);

/**
 * A category or tag label. A plain span, never a MUI Chip: a clickable Chip
 * takes its hover colour from `action.selected`, which made the category
 * unreadable in the dark theme.
 */
export const LibraryChip = ({
  label,
  icon,
  tone,
}: {
  label: string;
  icon?: ReactNode;
  tone: 'accent' | 'neutral';
}) => (
  <Box
    component="span"
    sx={(theme) => ({
      alignItems: 'center',
      borderRadius: '8px',
      boxSizing: 'border-box',
      display: 'inline-flex',
      flexShrink: 0,
      gap: 0.5,
      height: 22,
      minWidth: 0,
      overflow: 'hidden',
      px: 1,
      whiteSpace: 'nowrap',
      ...(tone === 'accent'
        ? {
            backgroundColor: alpha(
              theme.palette.primary.main,
              isDark(theme) ? 0.16 : 0.14
            ),
            color: libraryAccent(theme),
            fontSize: '12px',
            fontWeight: 600,
            maxWidth: '60%',
          }
        : {
            backgroundColor: alpha(theme.palette.text.primary, 0.06),
            color: libraryMuted(theme),
            fontSize: '11.5px',
            fontWeight: 500,
            maxWidth: 110,
          }),
      '& .MuiSvgIcon-root': { color: 'currentColor', fontSize: 14 },
    })}
  >
    {icon}
    <Box
      component="span"
      sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
    >
      {label}
    </Box>
  </Box>
);

interface LibraryActionButtonProps {
  kind: 'primary' | 'secondary';
  icon?: ReactNode;
  children: ReactNode;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Says which app the button is for; its name stays the visible text. */
  describedBy?: string;
  fullWidth?: boolean;
  /** May get narrower, its text cut short, when the row is too tight. */
  shrink?: boolean;
  /** Its action is running: it stays in place and does nothing more. */
  busy?: boolean;
}

/** A small button on a card: Open, Download or Update. */
export const LibraryActionButton = ({
  kind,
  icon,
  children,
  onClick,
  describedBy,
  fullWidth,
  shrink = false,
  busy = false,
}: LibraryActionButtonProps) => (
  <Button
    aria-describedby={describedBy}
    aria-disabled={busy || undefined}
    color="primary"
    disableRipple
    fullWidth={fullWidth}
    onClick={busy ? undefined : onClick}
    size="small"
    startIcon={icon}
    sx={(theme) => ({
      borderRadius: '12px',
      cursor: busy ? 'progress' : undefined,
      flexShrink: shrink ? 1 : 0,
      opacity: busy ? 0.6 : 1,
      fontSize: '13px',
      fontWeight: 600,
      height: 32,
      lineHeight: 1,
      minWidth: 0,
      position: 'relative',
      px: 1.5,
      textTransform: 'none',
      whiteSpace: 'nowrap',
      zIndex: 1,
      '& .MuiButton-startIcon': { ml: 0, mr: 0.5 },
      '& .MuiButton-startIcon .MuiSvgIcon-root': { fontSize: 16 },
      ...(kind === 'secondary' && {
        borderColor: libraryHairline(theme, 0.2),
        color: theme.palette.text.primary,
        '&:hover': {
          backgroundColor: theme.palette.action.hover,
          borderColor: libraryHoverBorder(theme),
        },
      }),
      '&.Mui-focusVisible': libraryFocusRing(theme, 2),
    })}
    variant={kind === 'primary' ? 'contained' : 'outlined'}
  >
    <Box
      component="span"
      sx={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}
    >
      {children}
    </Box>
  </Button>
);

/** Open when the app is on this node, Download otherwise. */
export const OpenAppButton = ({
  installed,
  onClick,
  describedBy,
  fullWidth,
}: {
  installed: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  describedBy?: string;
  fullWidth?: boolean;
}) => {
  const { t } = useTranslation(['core']);
  return installed ? (
    <LibraryActionButton
      describedBy={describedBy}
      fullWidth={fullWidth}
      kind="primary"
      onClick={onClick}
    >
      {t('core:action.open', cap)}
    </LibraryActionButton>
  ) : (
    <LibraryActionButton
      describedBy={describedBy}
      fullWidth={fullWidth}
      icon={<DownloadRoundedIcon />}
      kind="secondary"
      onClick={onClick}
    >
      {t('core:action.download', cap)}
    </LibraryActionButton>
  );
};

/** Pins the app to the launcher, or takes it off. */
export const PinToggleButton = ({
  pinned,
  onClick,
  describedBy,
}: {
  pinned: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  describedBy?: string;
}) => {
  const { t } = useTranslation(['core']);
  return (
    <Tooltip
      {...INSTANT_TOOLTIP}
      title={pinned ? t('core:action.unpin', cap) : t('core:action.pin', cap)}
    >
      <IconButton
        aria-describedby={describedBy}
        aria-label={t('core:action.pin', cap)}
        aria-pressed={pinned}
        disableRipple
        onClick={onClick}
        sx={(theme) => ({
          borderRadius: '10px',
          color: pinned ? libraryAccent(theme) : libraryMuted(theme),
          flexShrink: 0,
          height: 32,
          position: 'relative',
          width: 32,
          zIndex: 1,
          ...(pinned && {
            backgroundColor: alpha(theme.palette.primary.main, 0.14),
          }),
          '&:hover': {
            backgroundColor: pinned
              ? alpha(theme.palette.primary.main, 0.2)
              : alpha(theme.palette.text.primary, 0.06),
            color: pinned ? libraryAccent(theme) : theme.palette.text.primary,
          },
          '&.Mui-focusVisible': libraryFocusRing(theme, 2),
        })}
      >
        {pinned ? (
          <PushPinRoundedIcon sx={{ fontSize: 18 }} />
        ) : (
          <PushPinOutlinedIcon sx={{ fontSize: 18 }} />
        )}
      </IconButton>
    </Tooltip>
  );
};

/** Marks a website, so it can be told from a Q-App of the same name. */
export const WebsiteLabel = () => {
  const { t } = useTranslation(['core']);
  return (
    <Box
      component="span"
      sx={(theme) => ({
        alignItems: 'center',
        color: libraryMuted(theme),
        display: 'inline-flex',
        flexShrink: 0,
        fontSize: '12px',
        gap: 0.5,
        whiteSpace: 'nowrap',
        '& .MuiSvgIcon-root': { fontSize: 14 },
      })}
    >
      <LanguageRoundedIcon aria-hidden />
      {t('core:website', cap)}
    </Box>
  );
};

export const isWebsiteApp = (app: any) =>
  app?.service === 'WEBSITE' || !!app?.service?.includes?.('WEBSITE');
