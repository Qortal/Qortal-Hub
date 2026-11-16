import { useState } from 'react';
import { Box, Button, Typography, useTheme } from '@mui/material';
import { useDropzone } from 'react-dropzone';
import { useTranslation } from 'react-i18next';
import { PublishQAppChoseFile, PublishQAppInfo } from './Apps-styles';
import type { PublishProfileSource } from './publishProfiles';
import {
  canPickFolder,
  canPickZip,
  pickFolderSource,
  pickZipSource,
  PublishSource,
  sourceFromFile,
} from './publishSource';

export const formatPublishDate = (timestamp: number, language?: string) => {
  const date = new Date(timestamp);
  try {
    return new Intl.DateTimeFormat(language || undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
};

interface PublishSourcePickerProps {
  source: PublishSource | null;
  onChange: (source: PublishSource) => void;
  /** Where the last publish from this PC took its files. */
  savedSource?: PublishProfileSource | null;
  /** Count a folder's files modified after this time. */
  changedSince?: number | null;
  /** Bytes. */
  maxSize: number;
  onError: (message: string) => void;
  /** 'dialog' on a paper surface, as in the private app dialog. */
  surface?: 'page' | 'dialog';
}

/**
 * Picks the zip to publish: a zip file, or in the desktop app a folder that
 * Hub zips. With a saved profile it offers the folder or file used last time;
 * the picker then opens there, and for a folder Hub says how many of its files
 * changed since the last publish.
 */
export const PublishSourcePicker = ({
  source,
  onChange,
  savedSource = null,
  changedSince = null,
  maxSize,
  onError,
  surface = 'page',
}: PublishSourcePickerProps) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation(['core']);
  const [offerSaved, setOfferSaved] = useState(true);
  const [isPicking, setIsPicking] = useState(false);
  const maxSizeMb = Math.round(maxSize / (1024 * 1024));

  const textSx =
    surface === 'dialog'
      ? { backgroundColor: theme.palette.background.paper, fontSize: '14px' }
      : {};
  const buttonSx = {
    minWidth: '120px',
    padding: '0 16px',
    width: 'auto',
    ...(surface === 'dialog'
      ? { backgroundColor: theme.palette.background.default, fontSize: '14px' }
      : {}),
  };

  const tooLarge = (name: string) =>
    onError(
      t('core:message.error.file_too_large', {
        filename: name,
        size: maxSizeMb,
        postProcess: 'capitalizeFirstChar',
      })
    );

  const accept = (next: PublishSource | null) => {
    if (!next) return;
    if (next.file.size > maxSize) {
      tooLarge(next.name);
      return;
    }
    onChange(next);
  };

  const pick = async (picker: () => Promise<PublishSource | null>) => {
    if (isPicking) return;
    setIsPicking(true);
    try {
      accept(await picker());
    } catch (error) {
      console.error(error);
      onError(
        t('core:publish_source.read_error', {
          postProcess: 'capitalizeFirstChar',
        })
      );
    } finally {
      setIsPicking(false);
    }
  };

  const { getRootProps, getInputProps } = useDropzone({
    accept: {
      'application/zip': ['.zip'],
    },
    maxSize,
    multiple: false,
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) accept(sourceFromFile(acceptedFiles[0]));
    },
    onDropRejected: (fileRejections) => {
      fileRejections.forEach(({ file, errors }) => {
        if (errors.some((error) => error.code === 'file-too-large')) {
          tooLarge(file.name);
        }
      });
    },
  });

  const canReuseSaved =
    !!savedSource &&
    (savedSource.kind === 'folder' ? canPickFolder() : canPickZip());
  const showSaved = canReuseSaved && offerSaved && !source;

  const reuseSaved = () =>
    pick(() =>
      savedSource.kind === 'folder'
        ? pickFolderSource({ defaultPath: savedSource.path, changedSince })
        : pickZipSource({ defaultPath: savedSource.path })
    );

  return (
    <Box
      sx={{
        alignItems: 'flex-start',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        width: '100%',
      }}
    >
      {showSaved ? (
        <>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            <Button
              disabled={isPicking}
              onClick={reuseSaved}
              variant="contained"
            >
              {savedSource.kind === 'folder'
                ? t('core:publish_source.same_folder', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('core:publish_source.same_file', {
                    postProcess: 'capitalizeFirstChar',
                  })}
            </Button>
            <Button
              disabled={isPicking}
              onClick={() => setOfferSaved(false)}
              variant="outlined"
            >
              {t('core:publish_source.choose_another', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Button>
          </Box>
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '13px',
              wordBreak: 'break-all',
            }}
          >
            {savedSource.path}
          </Typography>
        </>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          <PublishQAppChoseFile sx={buttonSx} {...getRootProps()}>
            <input {...getInputProps()} />
            {source
              ? t('core:action.change_file', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('core:action.choose_file', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </PublishQAppChoseFile>
          {canPickFolder() && (
            <PublishQAppChoseFile
              disabled={isPicking}
              onClick={() => pick(() => pickFolderSource({ changedSince }))}
              sx={buttonSx}
            >
              {t('core:publish_source.choose_folder', {
                postProcess: 'capitalizeFirstChar',
              })}
            </PublishQAppChoseFile>
          )}
        </Box>
      )}

      {source && (
        <PublishQAppInfo sx={textSx}>
          {source.kind === 'folder'
            ? t('core:publish_source.selected_folder', {
                name: source.name,
                postProcess: 'capitalizeFirstChar',
              })
            : t('core:publish_source.selected_file', {
                name: source.name,
                postProcess: 'capitalizeFirstChar',
              })}
        </PublishQAppInfo>
      )}

      {source?.changedFiles != null && changedSince ? (
        <PublishQAppInfo sx={textSx}>
          {t('core:publish_source.changed_files', {
            date: formatPublishDate(changedSince, i18n?.language),
            number: source.changedFiles,
            postProcess: 'capitalizeFirstChar',
          })}
        </PublishQAppInfo>
      ) : null}
    </Box>
  );
};
