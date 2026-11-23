import SaveAltRoundedIcon from '@mui/icons-material/SaveAltRounded';
import {
  Box,
  ButtonBase,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  QSHARE_APP_NAME,
  QTUBE_APP_NAME,
  SUBSCREEN_APP_NAME,
  TORQ_APP_NAME,
} from '../../lib/videoPublisher';
import { SidePanelAppIcon } from '../Desktop/SidePanelAppIcon';
import { SectionHeading } from './FormParts';
import { avatarSocketSx, destinationTileSx } from './publisherTheme';
import type { VideoDestination } from './videoPublisherTypes';

type App = 'qtube' | 'subscreen' | 'torq' | 'qshare' | 'save';

/**
 * The app's own picture (its QDN avatar, else the Qortal logo), on a round
 * backdrop of its own so it shows on the blue picked pill too.
 */
const AppAvatar = ({ name }: { name: string }) => {
  const theme = useTheme();
  return (
    <Box data-testid="video-publisher-app-avatar" sx={avatarSocketSx(theme)}>
      <SidePanelAppIcon name={name} size={22} />
    </Box>
  );
};

const appOf = (destination: VideoDestination): App =>
  destination === 'subscreen-film' || destination === 'subscreen-series'
    ? 'subscreen'
    : destination;

/** The app a destination publishes to, as its name (not translated). */
export const destinationAppName = (destination: VideoDestination) => {
  switch (appOf(destination)) {
    case 'qtube':
      return QTUBE_APP_NAME;
    case 'subscreen':
      return SUBSCREEN_APP_NAME;
    case 'torq':
      return TORQ_APP_NAME;
    case 'qshare':
      return QSHARE_APP_NAME;
    default:
      return '';
  }
};

/**
 * A small tag of where a video goes: the app's picture and name (and Film or
 * TV series for Subscreen), or Save to this PC.
 */
export const DestinationTag = ({
  destination,
}: {
  destination: VideoDestination;
}) => {
  const { t } = useTranslation(['core']);
  const app = destinationAppName(destination);
  const label =
    destination === 'save'
      ? t('core:video_publisher.destination.save')
      : destination === 'subscreen-film'
        ? `${app} · ${t('core:video_publisher.destination.film')}`
        : destination === 'subscreen-series'
          ? `${app} · ${t('core:video_publisher.destination.series')}`
          : app;
  return (
    <Box
      component="span"
      data-testid="video-publisher-destination-tag"
      sx={{
        alignItems: 'center',
        display: 'inline-flex',
        gap: 0.5,
        mr: 0.75,
        verticalAlign: 'middle',
      }}
    >
      {destination === 'save' ? (
        <SaveAltRoundedIcon sx={{ fontSize: '1rem' }} />
      ) : (
        <SidePanelAppIcon name={app} size={16} />
      )}
      <Box component="span" sx={{ fontWeight: 650 }}>
        {label}
      </Box>
      <Box aria-hidden component="span">
        ·
      </Box>
    </Box>
  );
};

const DESCRIPTION_KEYS: Record<VideoDestination, string> = {
  qtube: 'core:video_publisher.destination.qtube_desc',
  'subscreen-film': 'core:video_publisher.destination.subscreen_film_desc',
  'subscreen-series': 'core:video_publisher.destination.subscreen_series_desc',
  torq: 'core:video_publisher.destination.torq_desc',
  qshare: 'core:video_publisher.destination.qshare_desc',
  save: 'core:video_publisher.destination.save_desc',
};

export const DestinationPicker = ({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (destination: VideoDestination) => void;
  value: VideoDestination;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const current = appOf(value);
  const apps: { app: App; label: string; to: VideoDestination }[] = [
    { app: 'qtube', label: QTUBE_APP_NAME, to: 'qtube' },
    {
      app: 'subscreen',
      label: SUBSCREEN_APP_NAME,
      to: current === 'subscreen' ? value : 'subscreen-film',
    },
    { app: 'torq', label: TORQ_APP_NAME, to: 'torq' },
    { app: 'qshare', label: QSHARE_APP_NAME, to: 'qshare' },
    {
      app: 'save',
      label: t('core:video_publisher.destination.save'),
      to: 'save',
    },
  ];

  return (
    <Box
      aria-labelledby="video-publisher-destination"
      role="group"
      sx={{ display: 'grid', gap: 1 }}
    >
      <SectionHeading id="video-publisher-destination">
        {t('core:video_publisher.destination.heading')}
      </SectionHeading>
      {/* One row, however narrow the column: five equal tiles. */}
      <Box
        sx={{
          containerType: 'inline-size',
          display: 'grid',
          gap: 0.75,
          gridTemplateColumns: `repeat(${apps.length}, minmax(0, 1fr))`,
          '@container (max-width: 440px)': { gap: 0.5 },
        }}
      >
        {apps.map(({ app, label, to }) => {
          const selected = current === app;
          return (
            <ButtonBase
              aria-pressed={selected}
              disabled={disabled}
              key={app}
              onClick={() => onChange(to)}
              sx={destinationTileSx(theme, selected)}
            >
              {app === 'save' ? (
                <Box sx={{ ...avatarSocketSx(theme), color: 'inherit' }}>
                  <SaveAltRoundedIcon
                    sx={{
                      color: theme.palette.text.primary,
                      fontSize: '1.05rem',
                    }}
                  />
                </Box>
              ) : (
                <AppAvatar name={label} />
              )}
              <Box
                component="span"
                sx={{ maxWidth: '100%', overflowWrap: 'break-word' }}
              >
                {label}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>
      {current === 'subscreen' ? (
        <ToggleButtonGroup
          aria-label={SUBSCREEN_APP_NAME}
          disabled={disabled}
          exclusive
          onChange={(_event, next: VideoDestination | null) =>
            next && onChange(next)
          }
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          value={value}
        >
          <ToggleButton sx={{ px: 2 }} value="subscreen-film">
            {t('core:video_publisher.destination.film')}
          </ToggleButton>
          <ToggleButton sx={{ px: 2 }} value="subscreen-series">
            {t('core:video_publisher.destination.series')}
          </ToggleButton>
        </ToggleButtonGroup>
      ) : null}
      <Typography
        sx={{ color: theme.palette.text.secondary, fontSize: '0.78rem' }}
      >
        {t(DESCRIPTION_KEYS[value])}
      </Typography>
    </Box>
  );
};
