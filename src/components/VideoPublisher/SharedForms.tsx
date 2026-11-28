import SortRoundedIcon from '@mui/icons-material/SortRounded';
import { Box, Button, Typography, useTheme } from '@mui/material';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FILM_GENRES,
  QSHARE_VIDEO_SUBCATEGORIES,
  SERIES_GENRES,
  SUBSCREEN_TITLE_MAX_LENGTH,
} from '../../lib/videoPublisher';
import { CoverPicker } from './CoverPicker';
import { CreditsEditor } from './CreditsEditor';
import {
  CategorySelect,
  LimitedTextField,
  NumberField,
  SectionHeading,
} from './FormParts';
import { QtubeCategoryFields } from './ItemFieldsForm';
import type { MissingField } from './queueHelpers';
import type { VideoPublisherController } from './videoPublisherController';
import type {
  QueueItem,
  SeriesFields,
  SharedFields,
  VideoDestination,
} from './videoPublisherTypes';

/**
 * "Same for all videos": the fields videos share, used by every video that
 * doesn't set its own (category, genre, description, post text).
 */
export const SharedFieldsForm = ({
  destination,
  disabled = false,
  missing,
  onChange,
  shared,
}: {
  destination: VideoDestination;
  /** During a run: its values are fixed when it starts. */
  disabled?: boolean;
  /** What some video still lacks and could take from here. */
  missing: readonly MissingField[];
  onChange: (change: Partial<SharedFields>) => void;
  shared: SharedFields;
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  if (destination === 'save' || destination === 'subscreen-series') return null;
  const description = (
    <LimitedTextField
      disabled={disabled}
      label={t('core:video_publisher.fields.description')}
      multiline
      onChange={(next) => onChange({ description: next })}
      value={shared.description ?? ''}
    />
  );
  return (
    <Box
      aria-labelledby="video-publisher-shared"
      role="group"
      sx={{ display: 'grid', gap: 1.25 }}
    >
      <Box>
        <SectionHeading id="video-publisher-shared">
          {t('core:video_publisher.shared.heading')}
        </SectionHeading>
        <Typography
          sx={{ color: theme.palette.text.secondary, fontSize: '0.74rem' }}
        >
          {t('core:video_publisher.shared.desc')}
        </Typography>
      </Box>
      {destination === 'qtube' || destination === 'torq' ? (
        <QtubeCategoryFields
          category={shared.category}
          disabled={disabled}
          missing={missing}
          onChange={onChange}
          subcategory={shared.subcategory}
        />
      ) : null}
      {destination === 'subscreen-film' ? (
        <CategorySelect
          disabled={disabled}
          error={missing.includes('genre')}
          label={t('core:video_publisher.fields.genre')}
          onChange={(genre) => onChange({ genre })}
          options={FILM_GENRES}
          value={shared.genre}
        />
      ) : null}
      {destination === 'qshare' ? (
        <CategorySelect
          disabled={disabled}
          error={missing.includes('subcategory')}
          label={t('core:video_publisher.fields.category')}
          onChange={(qshareSubcategory) => onChange({ qshareSubcategory })}
          options={QSHARE_VIDEO_SUBCATEGORIES}
          value={shared.qshareSubcategory}
        />
      ) : null}
      {destination === 'torq' ? (
        <LimitedTextField
          disabled={disabled}
          label={t('core:video_publisher.fields.post_text')}
          multiline
          onChange={(postText) => onChange({ postText })}
          placeholder={t('core:video_publisher.fields.post_text_placeholder')}
          value={shared.postText ?? ''}
        />
      ) : null}
      {destination !== 'torq' ? description : null}
    </Box>
  );
};

/** A Subscreen series: one form for all its episodes, and its poster. */
export const SeriesForm = ({
  controller,
  disabled,
  firstEpisode,
  missing,
  series,
}: {
  controller: VideoPublisherController;
  disabled: boolean;
  /** Where the poster's frames come from. */
  firstEpisode: QueueItem | undefined;
  missing: readonly MissingField[];
  series: SeriesFields;
}) => {
  const { t } = useTranslation(['core']);
  const change = useCallback(
    (next: Partial<SeriesFields>) =>
      controller.updateSettings((current) => ({
        series: { ...current.series, ...next },
      })),
    [controller]
  );
  const loadFrames = useCallback(() => {
    if (firstEpisode) void controller.loadFrames(firstEpisode.id);
  }, [controller, firstEpisode]);

  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      <SectionHeading
        end={
          <Button
            disabled={disabled}
            onClick={() => controller.sortEpisodes()}
            size="small"
            startIcon={<SortRoundedIcon />}
            sx={{ textTransform: 'none' }}
          >
            {t('core:video_publisher.series.sort')}
          </Button>
        }
      >
        {t('core:video_publisher.series.heading')}
      </SectionHeading>
      <LimitedTextField
        disabled={disabled}
        error={
          missing.includes('series_title') ||
          missing.includes('series_title_too_long')
        }
        label={t('core:video_publisher.series.title')}
        max={SUBSCREEN_TITLE_MAX_LENGTH}
        onChange={(title) => change({ title })}
        value={series.title}
      />
      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: '96px minmax(0, 1fr)',
        }}
      >
        <NumberField
          disabled={disabled}
          label={t('core:video_publisher.fields.year')}
          max={new Date().getFullYear() + 1}
          min={1888}
          onChange={(year) => change({ year })}
          value={series.year}
        />
        <CategorySelect
          disabled={disabled}
          error={missing.includes('series_genre')}
          label={t('core:video_publisher.fields.genre')}
          onChange={(genre) => change({ genre })}
          options={SERIES_GENRES}
          value={series.genre}
        />
      </Box>
      <LimitedTextField
        disabled={disabled}
        label={t('core:video_publisher.fields.description')}
        multiline
        onChange={(description) => change({ description })}
        value={series.description}
      />
      {/* The series' own cast & crew (Subscreen lists it on the series). */}
      <CreditsEditor
        credits={series.credits}
        disabled={disabled}
        onChange={(credits) => change({ credits })}
      />
      {firstEpisode ? (
        <CoverPicker
          askPoster={t('core:video_publisher.cover.poster_prompt_subscreen')}
          disabled={disabled}
          frames={firstEpisode.frames}
          framesState={firstEpisode.framesState}
          heading={t('core:video_publisher.series.poster')}
          onChange={(poster) => change({ poster })}
          onLoadFrames={loadFrames}
          poster
          sourceId={firstEpisode.source.id}
          value={series.poster}
        />
      ) : null}
    </Box>
  );
};
