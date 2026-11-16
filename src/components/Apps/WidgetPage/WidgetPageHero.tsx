import { useState } from 'react';
import {
  alpha,
  Box,
  Button,
  Chip,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import WidgetsRoundedIcon from '@mui/icons-material/WidgetsRounded';
import { useTranslation } from 'react-i18next';
import LogoSelected from '../../../assets/svgs/LogoSelected.svg';
import { executeEvent } from '../../../utils/events';
import { formatLongDate, formatRelative } from '../AppPage/AppPageParts';
import type { RatingSummary } from '../AppPage/appVotes';
import type { LibraryWidget } from '../AppsLibrary/widgetLibrary';

const cap = { postProcess: 'capitalizeFirstChar' } as const;

interface WidgetPageHeroProps {
  widget: LibraryWidget;
  iconUrl: string;
  accent: string | null;
  summary: RatingSummary;
  onHome: boolean;
  /** Home has as many widgets as it takes. */
  homeFull: boolean;
  homeLimit: number;
  onAdd: () => void;
  onRemove: () => void;
  /** Opens the app the widget comes with, when its name has one. */
  onOpenApp?: () => void;
  onRatingsClick: () => void;
}

/** The top of a widget's page: what it is, its rating, and Add to Home. */
export const WidgetPageHero = ({
  widget,
  iconUrl,
  accent,
  summary,
  onHome,
  homeFull,
  homeLimit,
  onAdd,
  onRemove,
  onOpenApp,
  onRatingsClick,
}: WidgetPageHeroProps) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core', 'group']);
  const [iconFailed, setIconFailed] = useState(false);
  const glow = accent || theme.palette.primary.main;
  const updated = widget.updated || widget.created || 0;
  const accentText =
    theme.palette.mode === 'dark'
      ? theme.palette.primary.light
      : theme.palette.primary.dark;

  const addButton = (
    <Button
      aria-disabled={homeFull || undefined}
      disableElevation
      onClick={onAdd}
      size="large"
      startIcon={<AddRoundedIcon />}
      sx={{
        borderRadius: '14px',
        fontWeight: 700,
        minWidth: '150px',
        opacity: homeFull ? 0.6 : 1,
        px: 3,
        textTransform: 'none',
      }}
      variant="contained"
    >
      {t('core:widgets.add_to_home', cap)}
    </Button>
  );

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
                name: widget.title,
                ...cap,
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
            {widget.title}
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
                  addressOrName: widget.name,
                })
              }
              size="small"
              sx={{
                color: accentText,
                fontSize: '14px',
                fontWeight: 600,
                minWidth: 0,
                px: 0.5,
                textTransform: 'none',
              }}
            >
              {t('core:app_detail.by_developer', {
                developer: widget.name,
                ...cap,
              })}
            </Button>
            <Chip
              icon={<WidgetsRoundedIcon sx={{ fontSize: 16 }} />}
              label={t('core:widgets.type', cap)}
              size="small"
              sx={{ backgroundColor: alpha(glow, 0.16), fontWeight: 600 }}
            />
            {widget.categoryName && (
              <Chip
                label={widget.categoryName}
                size="small"
                sx={{
                  backgroundColor: alpha(theme.palette.text.primary, 0.07),
                }}
              />
            )}
            {onHome && (
              <Chip
                icon={<CheckRoundedIcon sx={{ fontSize: 16 }} />}
                label={t('core:widgets.on_home', cap)}
                size="small"
                sx={{
                  backgroundColor: alpha(theme.palette.success.main, 0.16),
                  fontWeight: 600,
                  '& .MuiChip-icon': { color: theme.palette.success.main },
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
                : t('core:app_page.hero.no_ratings', cap)}
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
                    ...cap,
                  })}
                </Typography>
              </Tooltip>
            )}
          </Box>

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1.25,
              mt: 2.25,
            }}
          >
            {onHome ? (
              <Button
                onClick={onRemove}
                size="large"
                startIcon={<RemoveRoundedIcon />}
                sx={{
                  borderRadius: '14px',
                  color: 'text.primary',
                  textTransform: 'none',
                }}
                variant="outlined"
              >
                {t('core:widgets.remove_from_home', cap)}
              </Button>
            ) : homeFull ? (
              // Says why, on hover and to screen readers; a press says it too.
              <Tooltip
                enterTouchDelay={0}
                title={t('group:home_widgets.limit', {
                  max: homeLimit,
                  ...cap,
                })}
              >
                {addButton}
              </Tooltip>
            ) : (
              addButton
            )}
            {onOpenApp && (
              <Button
                onClick={onOpenApp}
                size="large"
                startIcon={<OpenInNewRoundedIcon />}
                sx={{
                  borderRadius: '14px',
                  color: 'text.primary',
                  textTransform: 'none',
                }}
                variant="outlined"
              >
                {t('group:home_widgets.open_app', {
                  name: widget.name,
                  ...cap,
                })}
              </Button>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
