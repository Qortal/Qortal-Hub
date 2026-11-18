import { useState } from 'react';
import {
  alpha,
  Box,
  Button,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import FolderZipRoundedIcon from '@mui/icons-material/FolderZipRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import { useDropzone } from 'react-dropzone';
import { useTranslation } from 'react-i18next';
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

/**
 * A small (i) that explains a choice on hover, focus or tap. Its name says
 * which choice; the text is its description, so screen readers read it too.
 */
const InfoTip = ({ text, label }: { text: string; label: string }) => (
  <Tooltip
    arrow
    describeChild
    enterDelay={0}
    enterTouchDelay={0}
    placement="top"
    title={text}
  >
    <IconButton
      aria-label={label}
      size="small"
      sx={{ color: 'text.secondary', p: 0.5 }}
    >
      <InfoOutlinedIcon sx={{ fontSize: 18 }} />
    </IconButton>
  </Tooltip>
);

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

  const buttonSx = {
    borderRadius: '12px',
    fontWeight: 600,
    px: 2,
    textTransform: 'none',
  };
  const infoLabel = (choiceLabel: string) =>
    t('core:publish_source.info_about', {
      choice: choiceLabel,
      postProcess: 'capitalizeFirstChar',
    });
  const choice = (label: string, button: React.ReactNode, info: string) => (
    <Box sx={{ alignItems: 'center', display: 'inline-flex', gap: 0.25 }}>
      {button}
      <InfoTip label={infoLabel(label)} text={info} />
    </Box>
  );
  const sameLabel =
    savedSource?.kind === 'folder'
      ? t('core:publish_source.same_folder', {
          postProcess: 'capitalizeFirstChar',
        })
      : t('core:publish_source.same_file', {
          postProcess: 'capitalizeFirstChar',
        });
  const fileLabel = source
    ? t('core:action.change_file', { postProcess: 'capitalizeFirstChar' })
    : t('core:action.choose_file', { postProcess: 'capitalizeFirstChar' });
  const folderLabel = t('core:publish_source.choose_folder', {
    postProcess: 'capitalizeFirstChar',
  });

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
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '10px',
            }}
          >
            {choice(
              sameLabel,
              <Button
                disableElevation
                disabled={isPicking}
                onClick={reuseSaved}
                startIcon={<HistoryRoundedIcon />}
                sx={buttonSx}
                variant="contained"
              >
                {sameLabel}
              </Button>,
              savedSource.kind === 'folder'
                ? t('core:publish_source.info_same_folder', {
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('core:publish_source.info_same_file', {
                    postProcess: 'capitalizeFirstChar',
                  })
            )}
            <Button
              disabled={isPicking}
              onClick={() => setOfferSaved(false)}
              sx={buttonSx}
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
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          {choice(
            fileLabel,
            <Button
              startIcon={<FolderZipRoundedIcon />}
              sx={buttonSx}
              variant="outlined"
              {...getRootProps({ role: 'button' })}
            >
              <input {...getInputProps()} />
              {fileLabel}
            </Button>,
            t('core:publish_source.info_file', {
              size: maxSizeMb,
              postProcess: 'capitalizeFirstChar',
            })
          )}
          {canPickFolder() &&
            choice(
              folderLabel,
              <Button
                disabled={isPicking}
                onClick={() => pick(() => pickFolderSource({ changedSince }))}
                startIcon={<FolderOpenRoundedIcon />}
                sx={buttonSx}
                variant="outlined"
              >
                {folderLabel}
              </Button>,
              t('core:publish_source.info_folder', {
                postProcess: 'capitalizeFirstChar',
              })
            )}
        </Box>
      )}

      {source && (
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: alpha(
              theme.palette.success.main,
              surface === 'dialog' ? 0.1 : 0.08
            ),
            border: `1px solid ${alpha(theme.palette.success.main, 0.3)}`,
            borderRadius: '12px',
            display: 'flex',
            gap: 1.25,
            px: 1.5,
            py: 1,
          }}
        >
          {source.kind === 'folder' ? (
            <FolderOpenRoundedIcon sx={{ color: theme.palette.success.main }} />
          ) : (
            <FolderZipRoundedIcon sx={{ color: theme.palette.success.main }} />
          )}
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                fontSize: '14px',
                fontWeight: 600,
                overflowWrap: 'anywhere',
              }}
            >
              {source.kind === 'folder'
                ? t('core:publish_source.selected_folder', {
                    name: source.name,
                    postProcess: 'capitalizeFirstChar',
                  })
                : t('core:publish_source.selected_file', {
                    name: source.name,
                    postProcess: 'capitalizeFirstChar',
                  })}
            </Typography>
            {source.changedFiles != null && changedSince ? (
              <Typography sx={{ color: 'text.secondary', fontSize: '13px' }}>
                {t('core:publish_source.changed_files', {
                  date: formatPublishDate(changedSince, i18n?.language),
                  number: source.changedFiles,
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            ) : null}
          </Box>
        </Box>
      )}
    </Box>
  );
};
