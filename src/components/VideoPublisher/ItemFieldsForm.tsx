import { Box } from '@mui/material';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FILM_GENRES,
  QSHARE_VIDEO_SUBCATEGORIES,
  QTUBE_CATEGORIES,
  qshareTitle,
  qtubeSubcategories,
  subscreenEpisodeTitle,
} from '../../lib/videoPublisher';
import { CreditsEditor } from './CreditsEditor';
import { CategorySelect, LimitedTextField, NumberField } from './FormParts';
import { type MissingField, titleMaxLength } from './queueHelpers';
import type { ItemFields, VideoDestination } from './videoPublisherTypes';

/** A Q-Tube category, with its subcategory when it has any. */
export const QtubeCategoryFields = ({
  category,
  disabled = false,
  missing,
  onChange,
  subcategory,
}: {
  category: number | null | undefined;
  disabled?: boolean;
  missing: readonly MissingField[];
  onChange: (change: Pick<ItemFields, 'category' | 'subcategory'>) => void;
  subcategory: number | null | undefined;
}) => {
  const { t } = useTranslation(['core']);
  const subcategories = qtubeSubcategories(category);
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 1,
        gridTemplateColumns: subcategories.length
          ? 'repeat(auto-fit, minmax(160px, 1fr))'
          : '1fr',
      }}
    >
      <CategorySelect
        disabled={disabled}
        error={missing.includes('category')}
        label={t('core:video_publisher.fields.category')}
        onChange={(next) => onChange({ category: next, subcategory: null })}
        options={QTUBE_CATEGORIES}
        value={category}
      />
      {subcategories.length ? (
        <CategorySelect
          allowNone
          disabled={disabled}
          error={missing.includes('subcategory')}
          label={t('core:video_publisher.fields.subcategory')}
          onChange={(next) => onChange({ subcategory: next })}
          options={subcategories}
          value={subcategory}
        />
      ) : null}
    </Box>
  );
};

/**
 * The chosen app's fields for one video, prefilled from its file name.
 * Values it leaves alone come from "Same for all videos".
 */
export const ItemFieldsForm = ({
  destination,
  disabled = false,
  fields,
  index,
  missing,
  onChange,
  seriesTitle,
}: {
  destination: VideoDestination;
  /** Once publishing started: shown, not editable. */
  disabled?: boolean;
  /** The values in effect (its own, else the shared ones). */
  fields: ItemFields;
  /** Its place among the episodes, for the default episode title. */
  index: number;
  missing: readonly MissingField[];
  onChange: (change: Partial<ItemFields>) => void;
  seriesTitle: string;
}) => {
  const { t } = useTranslation(['core']);
  if (destination === 'save') return null;
  const title = fields.title ?? '';
  const titleField = (
    <LimitedTextField
      disabled={disabled}
      error={missing.includes('title') || missing.includes('title_too_long')}
      helperText={
        destination === 'qshare' && title && qshareTitle(title) !== title.trim()
          ? t('core:video_publisher.fields.qshare_title_preview', {
              title: qshareTitle(title),
            })
          : undefined
      }
      label={t('core:video_publisher.fields.title')}
      max={titleMaxLength(destination)}
      onChange={(next) => onChange({ title: next })}
      value={title}
    />
  );
  const description = (
    <LimitedTextField
      disabled={disabled}
      label={t('core:video_publisher.fields.description')}
      multiline
      onChange={(next) => onChange({ description: next })}
      value={fields.description ?? ''}
    />
  );
  const grid = (children: ReactNode) => (
    <Box sx={{ display: 'grid', gap: 1.25 }}>{children}</Box>
  );

  switch (destination) {
    case 'subscreen-series':
      return grid(
        <>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <NumberField
              disabled={disabled}
              label={t('core:video_publisher.fields.season')}
              max={99}
              onChange={(season) => onChange({ season })}
              value={fields.season}
            />
            <NumberField
              disabled={disabled}
              label={t('core:video_publisher.fields.episode')}
              max={9999}
              onChange={(episode) =>
                onChange({
                  episode,
                  ...(episode != null && !fields.episodeKind
                    ? { episodeKind: 'episode' as const }
                    : {}),
                })
              }
              value={fields.episode}
            />
          </Box>
          <LimitedTextField
            disabled={disabled}
            error={missing.includes('title_too_long')}
            label={t('core:video_publisher.fields.episode_title')}
            max={titleMaxLength(destination)}
            onChange={(episodeTitle) => onChange({ episodeTitle })}
            placeholder={t(
              'core:video_publisher.fields.episode_title_placeholder',
              {
                label: subscreenEpisodeTitle(
                  { ...fields, title: '' },
                  index,
                  seriesTitle || '…'
                ),
              }
            )}
            value={fields.episodeTitle ?? ''}
          />
        </>
      );
    case 'subscreen-film':
      return grid(
        <>
          {titleField}
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
              onChange={(year) => onChange({ year })}
              value={fields.year}
            />
            <CategorySelect
              disabled={disabled}
              error={missing.includes('genre')}
              label={t('core:video_publisher.fields.genre')}
              onChange={(genre) => onChange({ genre })}
              options={FILM_GENRES}
              value={fields.genre}
            />
          </Box>
          {description}
          <CreditsEditor
            credits={fields.credits}
            disabled={disabled}
            onChange={(credits) => onChange({ credits })}
          />
        </>
      );
    case 'torq':
      return grid(
        <>
          <LimitedTextField
            disabled={disabled}
            label={t('core:video_publisher.fields.post_text')}
            multiline
            onChange={(postText) => onChange({ postText })}
            placeholder={t('core:video_publisher.fields.post_text_placeholder')}
            value={fields.postText ?? ''}
          />
          {titleField}
          <QtubeCategoryFields
            category={fields.category}
            disabled={disabled}
            missing={missing}
            onChange={onChange}
            subcategory={fields.subcategory}
          />
        </>
      );
    case 'qshare':
      return grid(
        <>
          {titleField}
          <CategorySelect
            disabled={disabled}
            error={missing.includes('subcategory')}
            label={t('core:video_publisher.fields.category')}
            onChange={(qshareSubcategory) => onChange({ qshareSubcategory })}
            options={QSHARE_VIDEO_SUBCATEGORIES}
            value={fields.qshareSubcategory}
          />
          {description}
        </>
      );
    default:
      return grid(
        <>
          {titleField}
          <QtubeCategoryFields
            category={fields.category}
            disabled={disabled}
            missing={missing}
            onChange={onChange}
            subcategory={fields.subcategory}
          />
          {description}
        </>
      );
  }
};
