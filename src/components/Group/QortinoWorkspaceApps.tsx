import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import {
  Avatar,
  Box,
  ButtonBase,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { getBaseApiReact } from '../../App';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';

/** A Q-App or website in one of the Workspace's slots. */
export type WorkspaceApp = {
  appName: string;
  description: string;
  label: string;
  service: 'APP' | 'WEBSITE';
};

export const getHotkeyAppThumbnailUrl = (appName: string) =>
  `${getBaseApiReact()}/arbitrary/THUMBNAIL/${appName}/qortal_avatar?async=true`;

/**
 * An app's picture, the Qortal logo until it loads or when it has none.
 * `size` and `radius` are px, or CSS lengths.
 */
export const HotkeyAppAvatar = ({
  appName,
  radius = 12,
  size = 36,
}: {
  appName: string;
  radius?: number | string;
  size?: number | string;
}) => {
  const theme = useTheme();
  const length = (value: number | string) =>
    typeof value === 'number' ? `${value}px` : value;
  return (
    <Avatar
      alt={appName}
      imgProps={{ loading: 'lazy' }}
      src={getHotkeyAppThumbnailUrl(appName)}
      sx={{
        background: alpha(theme.palette.primary.light, 0.06),
        borderRadius: length(radius),
        boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.light, 0.08)}`,
        height: length(size),
        width: length(size),
        '& img': {
          objectFit: 'fill',
        },
      }}
    >
      <Box
        alt=""
        component="img"
        src={LogoSelected}
        sx={{
          height: 'auto',
          width: '68%',
        }}
      />
    </Avatar>
  );
};

/** In a window at least 5 / 2 as wide as tall the slots make one row. */
const WINDOW_WIDE = '@container home-window (min-aspect-ratio: 5 / 2)';
/** In one taller than wide, two columns. */
const WINDOW_TALL = '@container home-window (max-aspect-ratio: 4 / 5)';
/** Each slot is a container ("workspace-app"): what it shows follows it. */
const SLOT_SHORT = '@container workspace-app (height < 58px)';
const SLOT_ROOMY =
  '@container workspace-app (min-width: 150px) and (min-height: 132px)';

type Props = {
  /** The slots, in order: an app, or null for an empty one. */
  apps: readonly (WorkspaceApp | null)[];
  labels: {
    /** An empty slot's name. */
    add: string;
    /** The button that closes the apps (the Workspace offers its modules). */
    close: string;
    /** The button that picks the apps. */
    edit: string;
    title: string;
  };
  onAdd: (slot: number) => void;
  onClose: () => void;
  onEdit: () => void;
  onOpen: (slot: number) => void;
};

/**
 * The Workspace's apps (its Hotkeys module): six slots that fill the
 * window, in 3 columns and 2 rows, one row in a wide window or two columns
 * in a tall one. An app's picture and name grow with its slot, and a big
 * slot shows the app's description too.
 */
export const QortinoWorkspaceApps = ({
  apps,
  labels,
  onAdd,
  onClose,
  onEdit,
  onOpen,
}: Props) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const accent = isDark
    ? theme.palette.primary.light
    : theme.palette.primary.main;
  const { common, text } = theme.palette;

  const headerButtonSx = {
    borderRadius: '9px',
    color: alpha(text.secondary, 0.84),
    height: '30px',
    width: '30px',
    '&:hover': { background: alpha(accent, 0.12), color: accent },
  };
  const slotSx = {
    alignItems: 'center',
    borderRadius: '16px',
    containerName: 'workspace-app',
    containerType: 'size',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
    position: 'relative',
    transition:
      'transform 140ms ease, box-shadow 160ms ease, border-color 160ms ease, background-color 160ms ease, color 160ms ease',
    '&.Mui-focusVisible': {
      boxShadow: `0 0 0 2px ${alpha(accent, 0.65)}`,
    },
  } as const;

  return (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        gap: '10px',
        height: '100%',
        minHeight: 0,
      }}
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: '8px' }}>
        <Box
          sx={{
            alignItems: 'center',
            background: alpha(accent, isDark ? 0.16 : 0.12),
            borderRadius: '8px',
            color: accent,
            display: 'flex',
            flexShrink: 0,
            height: '24px',
            justifyContent: 'center',
            width: '24px',
          }}
        >
          <AppsRoundedIcon sx={{ fontSize: '16px' }} />
        </Box>
        <Typography
          noWrap
          sx={{
            color: alpha(text.secondary, 0.86),
            flex: 1,
            fontSize: '0.66rem',
            fontWeight: 700,
            letterSpacing: '0.11em',
            minWidth: 0,
            textTransform: 'uppercase',
          }}
        >
          {labels.title}
        </Typography>
        <Tooltip title={labels.edit}>
          <IconButton
            aria-label={labels.edit}
            onClick={onEdit}
            size="small"
            sx={headerButtonSx}
          >
            <TuneRoundedIcon sx={{ fontSize: '18px' }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={labels.close}>
          <IconButton
            aria-label={labels.close}
            onClick={onClose}
            size="small"
            sx={headerButtonSx}
          >
            <CloseRoundedIcon sx={{ fontSize: '18px' }} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box
        sx={{
          display: 'grid',
          flex: 1,
          gap: '8px',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
          minHeight: 0,
          [WINDOW_WIDE]: {
            gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
            gridTemplateRows: 'minmax(0, 1fr)',
          },
          [WINDOW_TALL]: {
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gridTemplateRows: 'repeat(3, minmax(0, 1fr))',
          },
        }}
      >
        {apps.map((app, index) =>
          app ? (
            <Tooltip
              enterDelay={500}
              key={`slot-${index}`}
              placement="top"
              title={app.description || app.label}
            >
              <ButtonBase
                aria-label={app.label}
                onClick={() => onOpen(index)}
                sx={{
                  ...slotSx,
                  background: isDark
                    ? alpha(common.white, 0.045)
                    : alpha(common.white, 0.72),
                  border: `1px solid ${alpha(
                    isDark ? common.white : text.primary,
                    isDark ? 0.07 : 0.08
                  )}`,
                  gap: '6px',
                  p: '6px',
                  '&:hover': {
                    background: isDark
                      ? alpha(common.white, 0.075)
                      : alpha(common.white, 0.95),
                    borderColor: alpha(accent, 0.45),
                    boxShadow: `0 10px 22px ${alpha(common.black, isDark ? 0.34 : 0.12)}`,
                    transform: 'translateY(-2px)',
                    '& .workspace-app-icon': { transform: 'scale(1.05)' },
                  },
                  '&:active': { transform: 'translateY(0) scale(0.98)' },
                  [SLOT_SHORT]: {
                    '& .workspace-app-name': { display: 'none' },
                  },
                  [SLOT_ROOMY]: {
                    gap: '8px',
                    '& .workspace-app-name': {
                      fontSize: '0.82rem',
                      whiteSpace: 'normal',
                      WebkitLineClamp: 2,
                    },
                    '& .workspace-app-description': {
                      display: '-webkit-box',
                    },
                  },
                }}
              >
                <Box
                  className="workspace-app-icon"
                  sx={{
                    flexShrink: 0,
                    height: 'clamp(24px, 46cqmin, 72px)',
                    transition: 'transform 160ms ease',
                    width: 'clamp(24px, 46cqmin, 72px)',
                  }}
                >
                  <HotkeyAppAvatar
                    appName={app.appName}
                    radius="28%"
                    size="100%"
                  />
                </Box>
                <Typography
                  className="workspace-app-name"
                  sx={{
                    color: alpha(text.primary, 0.92),
                    display: '-webkit-box',
                    fontSize: 'clamp(0.6rem, 10cqw, 0.76rem)',
                    fontWeight: 700,
                    lineHeight: 1.18,
                    maxWidth: '100%',
                    overflow: 'hidden',
                    overflowWrap: 'anywhere',
                    textAlign: 'center',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 1,
                  }}
                >
                  {app.label}
                </Typography>
                {app.description ? (
                  <Typography
                    className="workspace-app-description"
                    sx={{
                      color: alpha(text.secondary, 0.78),
                      display: 'none',
                      fontSize: '0.66rem',
                      lineHeight: 1.3,
                      maxWidth: '100%',
                      overflow: 'hidden',
                      px: '4px',
                      textAlign: 'center',
                      WebkitBoxOrient: 'vertical',
                      WebkitLineClamp: 2,
                    }}
                  >
                    {app.description}
                  </Typography>
                ) : null}
              </ButtonBase>
            </Tooltip>
          ) : (
            <Tooltip key={`slot-${index}`} placement="top" title={labels.add}>
              <ButtonBase
                aria-label={labels.add}
                onClick={() => onAdd(index)}
                sx={{
                  ...slotSx,
                  border: `1.5px dashed ${alpha(text.secondary, isDark ? 0.22 : 0.28)}`,
                  color: alpha(text.secondary, 0.55),
                  '&:hover': {
                    background: alpha(accent, 0.07),
                    borderColor: alpha(accent, 0.6),
                    color: accent,
                  },
                }}
              >
                <AddRoundedIcon
                  sx={{ fontSize: 'clamp(16px, 26cqmin, 28px)' }}
                />
              </ButtonBase>
            </Tooltip>
          )
        )}
      </Box>
    </Box>
  );
};
