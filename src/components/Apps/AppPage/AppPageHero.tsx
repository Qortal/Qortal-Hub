import { useState } from 'react';
import {
  alpha,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import ShareRoundedIcon from '@mui/icons-material/ShareRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import { useTranslation } from 'react-i18next';
import LogoSelected from '../../../assets/svgs/LogoSelected.svg';
import { executeEvent } from '../../../utils/events';
import { formatLongDate, formatRelative } from './AppPageParts';
import { buildAppOpenLink, buildAppPageLink } from './appPageLink';
import type { RatingSummary } from './appVotes';
import { useLauncherTabDialog } from '../launcherTabs';

interface AppPageHeroProps {
  app: any;
  iconUrl: string;
  accent: string | null;
  summary: RatingSummary;
  version: string;
  versionCurrent: boolean;
  isInstalled: boolean;
  isPinned: boolean;
  isPublisher: boolean;
  /** The page is still loading: editing would start from an empty one. */
  editLoading?: boolean;
  /** Whether its publisher hid it from the library (appHidden.ts). */
  hiddenState?: { hidden: boolean; replaced: boolean } | null;
  /** Hiding or showing it is being published. */
  hideBusy?: boolean;
  /**
   * The node has said whether it is hidden and what its page has. Until
   * then the button is off: it would hide what is hidden already.
   */
  hideReady?: boolean;
  /** The node couldn't say: Retry asks it again. */
  hideFailed?: boolean;
  onRetryHide?: () => void;
  onOpen: () => void;
  onTogglePin: () => void;
  onEdit: () => void;
  onCopied: () => void;
  /** The publisher's hide button, and show button once it is hidden. */
  onHide?: () => void;
  onShowAgain?: () => void;
  onRatingsClick: () => void;
}

export const AppPageHero = ({
  app,
  iconUrl,
  accent,
  summary,
  version,
  versionCurrent,
  isInstalled,
  isPinned,
  isPublisher,
  editLoading = false,
  hiddenState = null,
  hideBusy = false,
  hideReady = true,
  hideFailed = false,
  onRetryHide,
  onOpen,
  onTogglePin,
  onEdit,
  onCopied,
  onHide,
  onShowAgain,
  onRatingsClick,
}: AppPageHeroProps) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const [iconFailed, setIconFailed] = useState(false);
  const [shareAnchor, setShareAnchor] = useState<HTMLElement | null>(null);
  // In a hidden launcher tab the menu steps aside, and comes back with it.
  const shareMenuShown = useLauncherTabDialog(!!shareAnchor);
  const glow = accent || theme.palette.primary.main;
  const isWebsite = app?.service === 'WEBSITE';
  const title = app?.metadata?.title || app?.name;
  const category = app?.metadata?.categoryName;
  const updated = app?.updated || app?.created || 0;
  const isHidden = !!hiddenState?.hidden;
  const hiddenNote = !isHidden
    ? ''
    : isPublisher
      ? hiddenState?.replaced
        ? t('core:app_page.hide.note_publisher_replaced')
        : t('core:app_page.hide.note_publisher_hidden')
      : hiddenState?.replaced
        ? t('core:app_page.hide.note_replaced')
        : t('core:app_page.hide.note_hidden');
  const hideLabel = isHidden
    ? t('core:app_page.hide.button_show', {
        postProcess: 'capitalizeFirstChar',
      })
    : t('core:app_page.hide.button_hide', {
        postProcess: 'capitalizeFirstChar',
      });

  const copy = async (text: string) => {
    setShareAnchor(null);
    try {
      await navigator.clipboard.writeText(text);
      onCopied();
    } catch {
      // The clipboard can refuse; nothing else to do.
    }
  };

  return (
    <Box
      component="header"
      sx={{
        overflow: 'hidden',
        position: 'relative',
        pt: { xs: 3, sm: 5 },
        pb: { xs: 3, sm: 4 },
      }}
    >
      <Box
        aria-hidden
        sx={{
          background: `radial-gradient(120% 140% at 12% 0%, ${alpha(glow, 0.34)} 0%, ${alpha(glow, 0.1)} 45%, transparent 75%)`,
          inset: 0,
          pointerEvents: 'none',
          position: 'absolute',
          transition: 'background 400ms ease',
        }}
      />
      <Box
        sx={{
          alignItems: { xs: 'flex-start', sm: 'center' },
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          gap: { xs: 2, sm: 3 },
          maxWidth: '1080px',
          mx: 'auto',
          position: 'relative',
          px: { xs: 2, sm: 3 },
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
            borderRadius: '28px',
            boxShadow: `0 14px 40px ${alpha(glow, 0.28)}, 0 2px 8px ${alpha(theme.palette.common.black, 0.25)}`,
            display: 'flex',
            flexShrink: 0,
            height: { xs: 88, sm: 116 },
            justifyContent: 'center',
            overflow: 'hidden',
            width: { xs: 88, sm: 116 },
          }}
        >
          {iconFailed ? (
            <img alt="" src={LogoSelected} style={{ width: '52%' }} />
          ) : (
            <img
              alt={t('core:app_page.hero.icon_alt', {
                name: title,
                postProcess: 'capitalizeFirstChar',
              })}
              onError={() => setIconFailed(true)}
              src={iconUrl}
              style={{ height: '100%', objectFit: 'cover', width: '100%' }}
            />
          )}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            component="h1"
            sx={{
              fontSize: { xs: '26px', sm: '32px' },
              fontWeight: 750,
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
              overflowWrap: 'anywhere',
            }}
          >
            {title}
          </Typography>

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
              mt: 1,
            }}
          >
            <Button
              onClick={() =>
                executeEvent('openUserLookupDrawer', {
                  addressOrName: app?.name,
                })
              }
              size="small"
              sx={{
                color:
                  theme.palette.mode === 'dark'
                    ? theme.palette.primary.light
                    : theme.palette.primary.dark,
                fontSize: '14px',
                fontWeight: 600,
                minWidth: 0,
                px: 0.5,
                textTransform: 'none',
              }}
            >
              {t('core:app_detail.by_developer', {
                developer: app?.name,
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
            <Chip
              icon={<AppsRoundedIcon sx={{ fontSize: 16 }} />}
              label={
                isWebsite
                  ? t('core:app_page.hero.type_website', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('core:app_page.hero.type_app')
              }
              size="small"
              sx={{ backgroundColor: alpha(glow, 0.16), fontWeight: 600 }}
            />
            {category && (
              <Chip
                label={category}
                size="small"
                sx={{
                  backgroundColor: alpha(theme.palette.text.primary, 0.07),
                }}
              />
            )}
          </Box>

          <Box
            sx={{
              alignItems: 'center',
              color: 'text.secondary',
              columnGap: 1.5,
              display: 'flex',
              flexWrap: 'wrap',
              fontSize: '13.5px',
              mt: 1.25,
              rowGap: 0.5,
            }}
          >
            <Button
              onClick={onRatingsClick}
              size="small"
              startIcon={
                <StarRoundedIcon sx={{ color: theme.palette.warning.main }} />
              }
              sx={{
                color: 'text.primary',
                fontWeight: 650,
                minWidth: 0,
                px: 0.75,
                textTransform: 'none',
              }}
            >
              {summary.total > 0
                ? t('core:app_page.hero.rating_summary', {
                    average: summary.average.toFixed(1),
                    count: summary.total,
                  })
                : t('core:app_page.hero.no_ratings', {
                    postProcess: 'capitalizeFirstChar',
                  })}
            </Button>
            {updated > 0 && (
              <Tooltip title={formatLongDate(updated, i18n.language)}>
                <Typography
                  component="time"
                  dateTime={new Date(updated).toISOString()}
                  sx={{ fontSize: 'inherit' }}
                >
                  {t('core:app_page.hero.updated_time', {
                    time: formatRelative(updated, i18n.language),
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Tooltip>
            )}
            {version && (
              <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.5 }}>
                <Typography sx={{ fontSize: 'inherit' }}>
                  {t('core:app_page.hero.version', {
                    version,
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
                {!versionCurrent && (
                  // A button, so keyboard and touch can open the note too.
                  <Tooltip
                    enterTouchDelay={0}
                    title={t('core:app_page.version_older', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  >
                    <IconButton
                      aria-label={t('core:app_page.version_older', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                      size="small"
                      sx={{ color: 'inherit', p: 0.25 }}
                    >
                      <InfoOutlinedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            )}
          </Box>

          {hiddenNote && (
            <Box
              role="note"
              sx={{
                alignItems: 'flex-start',
                backgroundColor: alpha(theme.palette.warning.main, 0.1),
                border: `1px solid ${alpha(theme.palette.warning.main, 0.35)}`,
                borderRadius: '12px',
                color: 'text.primary',
                display: 'flex',
                fontSize: '13.5px',
                gap: 1,
                maxWidth: '640px',
                mt: 1.5,
                px: 1.5,
                py: 1,
              }}
            >
              <VisibilityOffRoundedIcon
                sx={{ color: 'warning.main', fontSize: 18, mt: '1px' }}
              />
              <Typography sx={{ fontSize: 'inherit' }}>{hiddenNote}</Typography>
            </Box>
          )}

          {isPublisher && hideFailed && (
            <Box
              role="alert"
              sx={{
                alignItems: 'center',
                color: 'text.secondary',
                display: 'flex',
                flexWrap: 'wrap',
                fontSize: '12.5px',
                gap: 1,
                mt: 1.5,
              }}
            >
              {t('core:app_page.hide.load_failed', {
                postProcess: 'capitalizeFirstChar',
              })}
              <Button
                onClick={onRetryHide}
                size="small"
                sx={{ minWidth: 0, textTransform: 'none' }}
              >
                {t('core:retry', { postProcess: 'capitalizeFirstChar' })}
              </Button>
            </Box>
          )}

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1.25,
              mt: 2.25,
            }}
          >
            <Button
              disableElevation
              onClick={onOpen}
              size="large"
              startIcon={
                isInstalled ? <OpenInNewRoundedIcon /> : <DownloadRoundedIcon />
              }
              sx={{
                borderRadius: '14px',
                fontWeight: 700,
                minWidth: '150px',
                px: 3,
                textTransform: 'none',
              }}
              variant="contained"
            >
              {isInstalled
                ? t('core:action.open', { postProcess: 'capitalizeFirstChar' })
                : t('core:action.download', {
                    postProcess: 'capitalizeFirstChar',
                  })}
            </Button>
            <Button
              aria-pressed={isPinned}
              onClick={onTogglePin}
              size="large"
              startIcon={
                isPinned ? <PushPinRoundedIcon /> : <PushPinOutlinedIcon />
              }
              sx={{
                backgroundColor: isPinned
                  ? alpha(theme.palette.primary.main, 0.14)
                  : 'transparent',
                borderRadius: '14px',
                color: 'text.primary',
                textTransform: 'none',
              }}
              variant="outlined"
            >
              {isPinned
                ? t('core:action.unpin_from_dashboard', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('core:action.pin_to_dashboard', {
                    postProcess: 'capitalizeFirstChar',
                  })}
            </Button>
            <Tooltip
              title={t('core:app_page.share.title', {
                postProcess: 'capitalizeFirstChar',
              })}
            >
              <IconButton
                aria-haspopup="menu"
                aria-label={t('core:app_page.share.title', {
                  postProcess: 'capitalizeFirstChar',
                })}
                onClick={(event) => setShareAnchor(event.currentTarget)}
                sx={{
                  border: `1px solid ${alpha(theme.palette.text.primary, 0.18)}`,
                  borderRadius: '14px',
                  height: 44,
                  width: 44,
                }}
              >
                <ShareRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {isPublisher && (
              <Button
                disabled={editLoading}
                onClick={onEdit}
                size="large"
                startIcon={
                  editLoading ? (
                    <CircularProgress color="inherit" size={18} />
                  ) : (
                    <EditRoundedIcon />
                  )
                }
                sx={{ borderRadius: '14px', textTransform: 'none' }}
                variant="text"
              >
                {t('core:app_page.edit.open', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Button>
            )}
            {isPublisher && (onHide || onShowAgain) && (
              <Tooltip describeChild title={hideLabel}>
                <span>
                  <IconButton
                    aria-label={hideLabel}
                    disabled={hideBusy || !hideReady}
                    onClick={isHidden ? onShowAgain : onHide}
                    sx={{
                      border: `1px solid ${alpha(theme.palette.text.primary, 0.18)}`,
                      borderRadius: '14px',
                      height: 44,
                      width: 44,
                    }}
                  >
                    {hideBusy ? (
                      <CircularProgress color="inherit" size={18} />
                    ) : isHidden ? (
                      <VisibilityRoundedIcon fontSize="small" />
                    ) : (
                      <VisibilityOffRoundedIcon fontSize="small" />
                    )}
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Box>
        </Box>
      </Box>

      <Menu
        anchorEl={shareAnchor}
        onClose={() => setShareAnchor(null)}
        {...shareMenuShown}
      >
        <MenuItem
          onClick={() => copy(buildAppOpenLink(app?.service, app?.name))}
        >
          <ListItemIcon>
            <LinkRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={t('core:app_page.share.copy_app_link', {
              postProcess: 'capitalizeFirstChar',
            })}
            secondary={buildAppOpenLink(app?.service, app?.name)}
          />
        </MenuItem>
        <MenuItem
          onClick={() => copy(buildAppPageLink(app?.service, app?.name))}
        >
          <ListItemIcon>
            <AppsRoundedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={t('core:app_page.share.copy_page_link', {
              postProcess: 'capitalizeFirstChar',
            })}
            secondary={buildAppPageLink(app?.service, app?.name)}
          />
        </MenuItem>
      </Menu>
    </Box>
  );
};
