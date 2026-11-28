import {
  Box,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type {
  VideoCodec,
  VideoJobQuality,
} from '../../../electron/src/video-tool-types';
import { SectionHeading } from './FormParts';
import type { WindowQuality, WindowQualityChoice } from './qualityOptions';

export const qualityLabel = (t: TFunction, id: VideoJobQuality): string =>
  id === 'original'
    ? t('core:video_publisher.quality.original')
    : id === 'keep'
      ? t('core:video_publisher.quality.keep')
      : t('core:video_publisher.quality.step', { lines: id });

/**
 * The quality, the one place it's chosen: the steps, greyed when they're
 * above every video's own size (they'd only make the file bigger), Original
 * quality, and Keep as is when a video could keep its file. No choice makes
 * a file bigger than its original.
 */
export const QualitySteps = ({
  choices,
  disabled,
  onChange,
  steppedDownCount,
  value,
}: {
  choices: readonly WindowQualityChoice[];
  disabled: boolean;
  onChange: (quality: WindowQuality) => void;
  /** Videos too long for it under the limit, which get a lower one. */
  steppedDownCount: number;
  /** The choice shown as picked (shownWindowQuality). */
  value: WindowQuality | null;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const steps = choices.filter(
    (choice) => choice.id !== 'keep' && choice.id !== 'original'
  );
  const original = choices.find((choice) => choice.id === 'original');
  const keep = choices.find((choice) => choice.id === 'keep');
  const greyed = steps.some((choice) => !choice.available);
  const largest = steps.find((choice) => choice.available);
  const change = (_event: unknown, next: WindowQuality | null) =>
    next && onChange(next);
  const buttonSx = {
    fontWeight: 600,
    textTransform: 'none',
    '&.Mui-disabled': { opacity: 0.45 },
  } as const;
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <SectionHeading id="video-publisher-quality">
        {t('core:video_publisher.quality.heading')}
      </SectionHeading>
      <ToggleButtonGroup
        aria-labelledby="video-publisher-quality"
        disabled={disabled}
        exclusive
        fullWidth
        onChange={change}
        size="small"
        value={value}
      >
        {steps.map((choice) => (
          <ToggleButton
            disabled={disabled || !choice.available}
            key={choice.id}
            sx={buttonSx}
            value={choice.id}
          >
            {qualityLabel(t, choice.id)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {original || keep ? (
        <ToggleButtonGroup
          aria-labelledby="video-publisher-quality"
          disabled={disabled}
          exclusive
          fullWidth
          onChange={change}
          size="small"
          value={value}
        >
          {[original, keep].filter(Boolean).map((choice) => (
            <ToggleButton
              disabled={disabled || !choice.available}
              key={choice.id}
              sx={{ ...buttonSx, display: 'grid', gap: 0.1 }}
              value={choice.id}
            >
              <span>{qualityLabel(t, choice.id)}</span>
              <Box
                component="span"
                sx={{ fontSize: '0.7rem', fontWeight: 400, opacity: 0.8 }}
              >
                {choice.id === 'keep'
                  ? t('core:video_publisher.quality.keep_desc')
                  : t('core:video_publisher.quality.original_desc')}
              </Box>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      ) : null}
      <Typography
        sx={{ color: theme.palette.text.secondary, fontSize: '0.75rem' }}
      >
        {[
          greyed && largest
            ? t('core:video_publisher.quality.greyed', {
                quality: qualityLabel(t, largest.id),
              })
            : '',
          steppedDownCount
            ? t('core:video_publisher.quality.stepped_down_count', {
                count: steppedDownCount,
              })
            : t('core:video_publisher.quality.hint'),
          t('core:video_publisher.quality.never_bigger'),
        ]
          .filter(Boolean)
          .join(' ')}
      </Typography>
    </Box>
  );
};

/**
 * The picture format: AV1 (smaller files) or H.264 (faster to convert,
 * plays everywhere). AV1 is greyed when this Hub can't write it.
 */
export const FormatSteps = ({
  av1,
  disabled,
  onChange,
  slowPcThreads,
  value,
}: {
  /** This Hub's converter writes AV1. */
  av1: boolean;
  disabled: boolean;
  onChange: (codec: VideoCodec) => void;
  /** H.264 was picked for this PC's few threads (none chosen by hand). */
  slowPcThreads: number | null;
  value: VideoCodec;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const buttonSx = {
    display: 'grid',
    fontWeight: 600,
    gap: 0.1,
    textTransform: 'none',
    '&.Mui-disabled': { opacity: 0.45 },
  } as const;
  const choices: { id: VideoCodec; enabled: boolean }[] = [
    { id: 'av1', enabled: av1 },
    { id: 'h264', enabled: true },
  ];
  const hint = !av1
    ? t('core:video_publisher.format.no_av1')
    : value === 'av1'
      ? t('core:video_publisher.format.hint_av1')
      : slowPcThreads !== null
        ? t('core:video_publisher.format.slow_pc', { threads: slowPcThreads })
        : t('core:video_publisher.format.hint_h264');
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <SectionHeading id="video-publisher-format">
        {t('core:video_publisher.format.heading')}
      </SectionHeading>
      <ToggleButtonGroup
        aria-labelledby="video-publisher-format"
        disabled={disabled}
        exclusive
        fullWidth
        onChange={(_event, next: VideoCodec | null) => next && onChange(next)}
        size="small"
        value={value}
      >
        {choices.map((choice) => (
          <ToggleButton
            disabled={disabled || !choice.enabled}
            key={choice.id}
            sx={buttonSx}
            value={choice.id}
          >
            <span>{t(`core:video_publisher.format.${choice.id}`)}</span>
            <Box
              component="span"
              sx={{ fontSize: '0.7rem', fontWeight: 400, opacity: 0.8 }}
            >
              {t(`core:video_publisher.format.${choice.id}_desc`)}
            </Box>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography
        sx={{ color: theme.palette.text.secondary, fontSize: '0.75rem' }}
      >
        {hint}
      </Typography>
    </Box>
  );
};
