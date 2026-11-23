import SubtitlesRoundedIcon from '@mui/icons-material/SubtitlesRounded';
import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { VideoProbe } from '../../../electron/src/video-tool-types';
import {
  languageName,
  SUBTITLE_LANGUAGE_CODES,
} from '../../lib/videoPublisher';
import { SectionHeading } from './FormParts';
import { audioCodecName, channelLayout } from './format';
import { chosenSubtitles } from './queueHelpers';
import type { SubtitleChoice } from './videoPublisherTypes';

const SUBTITLE_FILE_TYPES = '.srt,.vtt,.ass,.ssa';

/** The sound kept: browsers can't switch sound tracks in an MP4. */
export const AudioTrackSelect = ({
  disabled,
  onChange,
  probe,
  value,
}: {
  disabled: boolean;
  onChange: (index: number | null | undefined) => void;
  probe: VideoProbe;
  value: number | null | undefined;
}) => {
  const { t, i18n } = useTranslation(['core']);
  const fallback =
    probe.audio.find((stream) => stream.isDefault) ?? probe.audio[0];
  const current = value === null ? 'none' : String(value ?? fallback?.index);
  return (
    <TextField
      disabled={disabled}
      fullWidth
      label={t('core:video_publisher.audio.heading')}
      onChange={(event) =>
        onChange(
          event.target.value === 'none' ? null : Number(event.target.value)
        )
      }
      select
      size="small"
      value={current}
    >
      {probe.audio.map((stream, position) => (
        <MenuItem key={stream.index} value={String(stream.index)}>
          {t('core:video_publisher.audio.track', {
            details: [
              stream.language
                ? languageName(stream.language, i18n.language)
                : null,
              `${audioCodecName(stream.codec)} ${channelLayout(t, stream.channels)}`,
              stream.title,
            ]
              .filter(Boolean)
              .join(' · '),
            index: position + 1,
          })}
        </MenuItem>
      ))}
      <MenuItem value="none">{t('core:video_publisher.audio.none')}</MenuItem>
    </TextField>
  );
};

/**
 * The subtitles that go along: a tick and a language each. Picture tracks
 * can only be burned into the video; a file's own name gives an added
 * track's language.
 */
/** A text track's row: its name, then its language. */
const ROW_GRID = {
  alignItems: 'center',
  columnGap: 1.5,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(140px, 190px)',
  // A slim queue pane: more room for the file's name.
  '@container vp-queue (max-width: 480px)': {
    gridTemplateColumns: 'minmax(0, 1fr) minmax(112px, 150px)',
  },
} as const;

export const SubtitleList = ({
  burnIndex,
  burnOnly = false,
  burnDisabled,
  disabled,
  note,
  onAddFiles,
  onBurn,
  onChange,
  subtitles: allSubtitles,
}: {
  burnIndex: number | null | undefined;
  /**
   * Text tracks don't go where it's sent (Save to this PC keeps the MP4
   * alone): only picture tracks, to burn in, are offered.
   */
  burnOnly?: boolean;
  /**
   * Burning in is part of the picture: fixed once the conversion starts,
   * while text subtitles can still change. Defaults to `disabled`.
   */
  burnDisabled?: boolean;
  disabled: boolean;
  /** One line under the heading: what happens to the subtitles there. */
  note?: string;
  onAddFiles: (files: File[]) => void;
  onBurn: (index: number | null) => void;
  onChange: (key: string, change: Partial<SubtitleChoice>) => void;
  subtitles: SubtitleChoice[];
}) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const inputRef = useRef<HTMLInputElement>(null);
  const subtitles = burnOnly
    ? allSubtitles.filter((track) => track.picture && !track.unsupported)
    : allSubtitles;
  const languages = useMemo(
    () =>
      SUBTITLE_LANGUAGE_CODES.map((code) => ({
        code,
        name: languageName(code, i18n.language),
      })).sort((a, b) => a.name.localeCompare(b.name, i18n.language)),
    [i18n.language]
  );
  const hasTextTracks = subtitles.some(
    (track) => !track.picture && !track.unsupported
  );
  // The track of each language that goes along (chosenSubtitles).
  const goingKeys = new Set(
    chosenSubtitles(allSubtitles).map((track) => track.key)
  );

  return (
    <Box sx={{ display: 'grid', gap: 0.75 }}>
      <SectionHeading
        end={
          burnOnly ? undefined : (
            <Button
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              size="small"
              startIcon={<SubtitlesRoundedIcon />}
              sx={{ textTransform: 'none' }}
            >
              {t('core:video_publisher.subtitles.add')}
            </Button>
          )
        }
      >
        {t('core:video_publisher.subtitles.heading')}
      </SectionHeading>
      {note ? (
        <Typography
          sx={{ color: theme.palette.text.secondary, fontSize: '0.74rem' }}
        >
          {note}
        </Typography>
      ) : null}
      <input
        accept={SUBTITLE_FILE_TYPES}
        hidden
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) onAddFiles(files);
        }}
        ref={inputRef}
        type="file"
      />
      {!subtitles.length && !burnOnly ? (
        <Typography
          sx={{ color: theme.palette.text.secondary, fontSize: '0.78rem' }}
        >
          {t('core:video_publisher.subtitles.none')}
        </Typography>
      ) : null}
      {subtitles.length ? (
        <Box
          sx={{
            border: `1px solid ${alpha(theme.palette.text.primary, 0.14)}`,
            borderRadius: '10px',
            display: 'grid',
            overflow: 'hidden',
          }}
        >
          {/* One "Language" over the column, not one on every field: a long
              list stays roomy. Each field still has its own name. */}
          {hasTextTracks ? (
            <Box
              aria-hidden
              sx={{
                ...ROW_GRID,
                bgcolor: alpha(theme.palette.text.primary, 0.04),
                px: 1.5,
                py: 0.75,
              }}
            >
              <span />
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '0.72rem',
                  fontWeight: 650,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {t('core:video_publisher.subtitles.language')}
              </Typography>
            </Box>
          ) : null}
          {subtitles.map((track, position) => {
            const rowSx = {
              // The theme's divider barely shows on the dark card.
              borderTop:
                position > 0 || hasTextTracks
                  ? `1px solid ${alpha(theme.palette.text.primary, 0.09)}`
                  : 'none',
              px: 1.5,
              py: 0.75,
            };
            const name =
              track.source === 'file'
                ? t('core:video_publisher.subtitles.from_file', {
                    name: track.fileName,
                  })
                : track.label ||
                  t('core:video_publisher.subtitles.track', {
                    index: position + 1,
                  });
            const duplicate =
              track.include &&
              !track.picture &&
              !track.unsupported &&
              track.language &&
              !goingKeys.has(track.key);
            if (track.unsupported) {
              return (
                <Box
                  key={track.key}
                  sx={{ ...rowSx, display: 'grid', gap: 0.25 }}
                >
                  <Typography sx={{ fontSize: '0.8rem' }}>
                    {[
                      name,
                      track.language
                        ? languageName(track.language, i18n.language)
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.72rem',
                    }}
                  >
                    {t('core:video_publisher.subtitles.unsupported')}
                  </Typography>
                </Box>
              );
            }
            if (track.picture) {
              const burned = burnIndex === track.streamIndex;
              return (
                <Box
                  key={track.key}
                  sx={{ ...rowSx, display: 'grid', gap: 0.25 }}
                >
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={burned}
                        disabled={burnDisabled ?? disabled}
                        onChange={(_event, checked) =>
                          onBurn(checked ? track.streamIndex : null)
                        }
                        size="small"
                      />
                    }
                    label={
                      <Typography sx={{ fontSize: '0.8rem' }}>
                        {[
                          name,
                          track.language
                            ? languageName(track.language, i18n.language)
                            : null,
                          t('core:video_publisher.subtitles.burn'),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Typography>
                    }
                  />
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.72rem',
                      pl: 4,
                    }}
                  >
                    {t('core:video_publisher.subtitles.picture')}
                  </Typography>
                </Box>
              );
            }
            return (
              <Box key={track.key} sx={{ ...ROW_GRID, ...rowSx }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={track.include}
                      disabled={disabled}
                      onChange={(_event, checked) =>
                        onChange(track.key, { include: checked })
                      }
                      size="small"
                    />
                  }
                  label={
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        noWrap
                        sx={{ fontSize: '0.8rem' }}
                        title={name}
                      >
                        {name}
                        {track.forced
                          ? ` · ${t('core:video_publisher.subtitles.forced')}`
                          : ''}
                        {track.hearingImpaired
                          ? ` · ${t('core:video_publisher.subtitles.hearing_impaired')}`
                          : ''}
                      </Typography>
                      {duplicate ? (
                        <Typography
                          sx={{
                            color: theme.palette.warning.main,
                            fontSize: '0.7rem',
                          }}
                        >
                          {t('core:video_publisher.subtitles.duplicate')}
                        </Typography>
                      ) : null}
                    </Box>
                  }
                  sx={{
                    minWidth: 0,
                    mr: 0,
                    // A long file name ends in "…" before its language (the
                    // whole name shows on hover).
                    '& .MuiFormControlLabel-label': {
                      minWidth: 0,
                      overflow: 'hidden',
                    },
                  }}
                />
                <TextField
                  disabled={disabled}
                  error={track.include && !track.language}
                  onChange={(event) =>
                    onChange(track.key, {
                      language: event.target.value || null,
                      ...(event.target.value ? { include: true } : {}),
                    })
                  }
                  select
                  size="small"
                  slotProps={{
                    htmlInput: {
                      'aria-label': t(
                        'core:video_publisher.subtitles.language_of',
                        {
                          name: track.source === 'file' ? track.fileName : name,
                        }
                      ),
                    },
                    select: { displayEmpty: true },
                  }}
                  value={track.language ?? ''}
                >
                  <MenuItem value="">
                    <Box component="em" sx={{ opacity: 0.7 }}>
                      {t('core:video_publisher.subtitles.pick_language')}
                    </Box>
                  </MenuItem>
                  {languages.map((language) => (
                    <MenuItem key={language.code} value={language.code}>
                      {language.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
};
