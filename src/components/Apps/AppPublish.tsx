import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppLibrarySubTitle,
  AppPublishTagsContainer,
  AppsLibraryContainer,
  AppsWidthLimiter,
  PublishQAppCTAButton,
  PublishQAppChoseFile,
  PublishQAppInfo,
} from './Apps-styles';
import {
  InputBase,
  InputLabel,
  MenuItem,
  Select,
  useTheme,
} from '@mui/material';
import { styled } from '@mui/system';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import { Spacer } from '../../common/Spacer';
import { executeEvent } from '../../utils/events';
import { useDropzone } from 'react-dropzone';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { getFee } from '../../background/background.ts';
import {
  QDN_DESCRIPTION_MAX_BYTES,
  QDN_TITLE_MAX_BYTES,
  limitQdnDescription,
  limitQdnTag,
  limitQdnTitle,
  utf8ByteLength,
} from '../../utils/qdnMetadataLimits';
import { useTranslation } from 'react-i18next';
import { useSortedMyNames } from '../../hooks/useSortedMyNames';
import {
  EMPTY_PREFILL,
  PublishPrefill,
  loadPublishPrefill,
} from './appPublishPrefill';

const TITLE_MAX_CHARS = 80;
const DESCRIPTION_MAX_CHARS = 240;
const TAG_MAX_CHARS = 20;

/**
 * Text state whose setter applies Core's metadata limit, so the form shows what
 * Core will keep: it cuts the title and description by UTF-8 bytes, not
 * characters (see utils/qdnMetadataLimits.ts).
 */
const useLimitedText = (limit: (value: string) => string) => {
  const [value, setValue] = useState('');
  const setLimited = useCallback(
    (next: string) => setValue(limit(next)),
    [limit]
  );
  return [value, setLimited] as const;
};

const CustomSelect = styled(Select)({
  border: '0.5px solid var(--50-white, #FFFFFF80)',
  padding: '0px 15px',
  borderRadius: '8px',
  height: '36px',
  width: '100%',
  maxWidth: '450px',
  '& .MuiSelect-select': {
    padding: '0px',
  },
  '&:hover': {
    borderColor: 'none',
  },
  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderColor: 'none',
  },
  '&.Mui-disabled': {
    opacity: 0.5, // Lower opacity when disabled
  },
  '& .MuiSvgIcon-root': {
    color: 'var(--50-white, #FFFFFF80)',
  },
});

const LabelRow = styled('div')({
  alignItems: 'center',
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: '2px',
  width: '100%',
});

const CounterText = styled('span')(({ theme }) => ({
  color: theme.palette.text.secondary,
  fontSize: '12px',
}));

interface AppPublishProps {
  categories: any;
  myAddress: any;
  myName: any;
  initialName?: string;
  initialAppType?: 'APP' | 'WEBSITE';
  isAppTypeLocked?: boolean;
}

export const AppPublish = ({
  categories,
  myAddress,
  myName,
  initialName = '',
  initialAppType = 'APP',
  isAppTypeLocked = false,
}: AppPublishProps) => {
  const [names, setNames] = useState([]);
  const [name, setName] = useState(initialName);
  const [title, setTitle] = useLimitedText(limitQdnTitle);
  const [description, setDescription] = useLimitedText(limitQdnDescription);
  const [category, setCategory] = useState('');
  const [appType, setAppType] = useState(initialAppType);
  const [file, setFile] = useState(null);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);
  const [tag1, setTag1] = useLimitedText(limitQdnTag);
  const [tag2, setTag2] = useLimitedText(limitQdnTag);
  const [tag3, setTag3] = useLimitedText(limitQdnTag);
  const [tag4, setTag4] = useLimitedText(limitQdnTag);
  const [tag5, setTag5] = useLimitedText(limitQdnTag);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [isLoading, setIsLoading] = useState('');
  const [prefillPending, setPrefillPending] = useState(false);
  const [activeField, setActiveField] = useState<string | null>(null);
  // The latest prefill; an answer for an earlier name or type is dropped.
  const prefillRunRef = useRef(0);
  // Fields the user changed since that prefill started: it never overwrites them.
  const editedFieldsRef = useRef(new Set<string>());
  const markEdited = (field: string) => editedFieldsRef.current.add(field);
  const maxFileSize = appType === 'APP' ? 50 * 1024 * 1024 : 400 * 1024 * 1024; // 50MB or 400MB
  const { getRootProps, getInputProps } = useDropzone({
    accept: {
      'application/zip': ['.zip'], // Only accept zip files
    },
    maxSize: maxFileSize, // Set the max size based on appType
    multiple: false, // Disable multiple file uploads
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        setFile(acceptedFiles[0]); // Set the file name
      }
    },
    onDropRejected: (fileRejections) => {
      fileRejections.forEach(({ file, errors }) => {
        errors.forEach((error) => {
          if (error.code === 'file-too-large') {
            console.error(
              t('core:message.error.file_too_large', {
                filename: file.name,
                size: maxFileSize / (1024 * 1024),
                postProcess: 'capitalizeFirstChar',
              })
            );
          }
        });
      });
    },
  });

  /** Fills in the form, except fields the user changed meanwhile. */
  const applyPrefill = (prefill: PublishPrefill) => {
    const edited = editedFieldsRef.current;
    const setters: [string, (value: string) => void, string][] = [
      ['title', setTitle, prefill.title.slice(0, TITLE_MAX_CHARS)],
      [
        'description',
        setDescription,
        prefill.description.slice(0, DESCRIPTION_MAX_CHARS),
      ],
      ['category', setCategory, prefill.category],
      ...[setTag1, setTag2, setTag3, setTag4, setTag5].map(
        (setTag, index) =>
          [
            `tag${index + 1}`,
            setTag,
            (prefill.tags[index] || '').slice(0, TAG_MAX_CHARS),
          ] as [string, (value: string) => void, string]
      ),
    ];
    setters.forEach(([field, setValue, value]) => {
      if (!edited.has(field)) setValue(value);
    });
  };

  useEffect(() => {
    if (!name || !appType) return;
    const run = ++prefillRunRef.current;
    editedFieldsRef.current = new Set();
    const controller = new AbortController();
    setPrefillPending(true);

    loadPublishPrefill(getBaseApiReact(), appType, name, {
      signal: controller.signal,
    })
      .then((result) => {
        if (run !== prefillRunRef.current) return;
        applyPrefill(result.kind === 'found' ? result.prefill : EMPTY_PREFILL);
        if (result.kind === 'unavailable') {
          setInfoSnack({
            type: 'warning',
            message: t('core:message.generic.app_details_unavailable', {
              postProcess: 'capitalizeFirstChar',
            }),
          });
          setOpenSnack(true);
        }
      })
      .catch(() => {
        // Aborted: a newer name or type, or the form closed.
      })
      .finally(() => {
        if (run === prefillRunRef.current) setPrefillPending(false);
      });

    return () => controller.abort();
  }, [name, appType]);

  const getNames = useCallback(async () => {
    if (!myAddress) return;
    try {
      setIsLoading(
        t('core:loading.generic', { postProcess: 'capitalizeFirstChar' })
      );
      const res = await fetch(
        `${getBaseApiReact()}/names/address/${myAddress}?limit=0`
      );
      const data = await res.json();
      setNames(data?.map((item) => item.name));
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading('');
    }
  }, [myAddress]);
  useEffect(() => {
    getNames();
  }, [getNames]);

  useEffect(() => {
    if (initialName) setName(initialName);
  }, [initialName]);

  const mySortedNames = useSortedMyNames(names, myName);
  const activeTagInfo = useMemo(() => {
    switch (activeField) {
      case 'tag1':
        return { label: 'Tag 1', length: tag1.length };
      case 'tag2':
        return { label: 'Tag 2', length: tag2.length };
      case 'tag3':
        return { label: 'Tag 3', length: tag3.length };
      case 'tag4':
        return { label: 'Tag 4', length: tag4.length };
      case 'tag5':
        return { label: 'Tag 5', length: tag5.length };
      default:
        return null;
    }
  }, [
    activeField,
    tag1.length,
    tag2.length,
    tag3.length,
    tag4.length,
    tag5.length,
  ]);

  const publishApp = async () => {
    // Publishing before the form is filled in would replace the app's details.
    if (prefillPending) return;
    try {
      const data = {
        name,
        title,
        description,
        category,
        appType,
        file,
      };
      const requiredFields = [
        'name',
        'title',
        'description',
        'category',
        'appType',
        'file',
      ];

      const missingFields: string[] = [];
      requiredFields.forEach((field) => {
        if (!data[field]) {
          missingFields.push(field);
        }
      });
      if (missingFields.length > 0) {
        const missingFieldsString = missingFields.join(', ');
        const errorMsg = t('core:message.error.missing_fields', {
          fields: missingFieldsString,
          postProcess: 'capitalizeFirstChar',
        });
        throw new Error(errorMsg);
      }
      const fee = await getFee('ARBITRARY');

      await show({
        message: t('core:message.question.publish_app', {
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });
      setIsLoading(
        t('core:message.generic.publishing', {
          postProcess: 'capitalizeFirstChar',
        })
      );
      await new Promise((res, rej) => {
        window
          .sendMessage('publishOnQDN', {
            data: file,
            service: appType,
            title,
            name,
            description,
            category,
            tag1,
            tag2,
            tag3,
            tag4,
            tag5,
            uploadType: 'zip',
          })
          .then((response) => {
            if (!response?.error) {
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
      setInfoSnack({
        type: 'success',
        message: t('core:message.success.published', {
          postProcess: 'capitalizeFirstChar',
        }),
      });
      setOpenSnack(true);
      const dataObj = {
        name: name,
        service: appType,
        metadata: {
          title: title,
          description: description,
          category: category,
        },
        created: Date.now(),
      };
      executeEvent('addTab', {
        data: dataObj,
      });
    } catch (error) {
      setInfoSnack({
        type: 'error',
        message:
          error?.message ||
          t('core:message.error.publish_app', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
      setOpenSnack(true);
    } finally {
      setIsLoading('');
    }
  };

  return (
    <AppsLibraryContainer
      sx={{
        alignItems: 'center',
        height: '100%',
        paddingTop: '30px',
      }}
    >
      <AppsWidthLimiter
        sx={{
          width: 'auto',
        }}
      >
        <AppLibrarySubTitle>
          {appType === 'WEBSITE'
            ? t('core:developer.publish_site', {
                postProcess: 'capitalizeFirstChar',
              })
            : t('core:developer.publish_app', {
                postProcess: 'capitalizeFirstChar',
              })}
        </AppLibrarySubTitle>

        <Spacer height="18px" />

        <PublishQAppInfo>
          {t('core:message.generic.one_app_per_name', {
            postProcess: 'capitalizeFirstChar',
          })}
        </PublishQAppInfo>

        <Spacer height="18px" />

        <InputLabel sx={{ fontSize: '14px', marginBottom: '2px' }}>
          {t('core:name_app', {
            postProcess: 'capitalizeFirstChar',
          })}
        </InputLabel>

        <CustomSelect
          placeholder={t('core:action.select_name_app', {
            postProcess: 'capitalizeFirstChar',
          })}
          displayEmpty
          value={name}
          onChange={(event) => setName(event?.target.value)}
        >
          <MenuItem value="">
            <em
              style={{
                color: theme.palette.text.secondary,
              }}
            >
              {t('core:action.select_name_app', {
                postProcess: 'capitalizeFirstChar',
              })}
            </em>
            {/* This is the placeholder item */}
          </MenuItem>
          {mySortedNames.map((name) => {
            return <MenuItem value={name}>{name}</MenuItem>;
          })}
        </CustomSelect>

        <Spacer height="15px" />

        <InputLabel sx={{ fontSize: '14px', marginBottom: '2px' }}>
          {t('core:app_service_type', {
            postProcess: 'capitalizeFirstChar',
          })}
        </InputLabel>

        <CustomSelect
          placeholder={t('core:service_type', {
            postProcess: 'capitalizeFirstChar',
          })}
          displayEmpty
          value={appType}
          onChange={(event) => setAppType(event?.target.value)}
          disabled={isAppTypeLocked}
        >
          <MenuItem value="">
            <em
              style={{
                color: theme.palette.text.secondary,
              }}
            >
              {t('core:action.select_app_type', {
                postProcess: 'capitalizeFirstChar',
              })}
            </em>
          </MenuItem>

          <MenuItem value={'APP'}>
            {t('core:app', {
              postProcess: 'capitalizeFirstChar',
            })}
          </MenuItem>

          <MenuItem value={'WEBSITE'}>
            {t('core:website', {
              postProcess: 'capitalizeFirstChar',
            })}
          </MenuItem>
        </CustomSelect>

        <Spacer height="15px" />

        <LabelRow>
          <InputLabel sx={{ fontSize: '14px' }}>
            {t('core:title', {
              postProcess: 'capitalizeFirstChar',
            })}
          </InputLabel>
          {activeField === 'title' && (
            <CounterText>{`${utf8ByteLength(title)}/${QDN_TITLE_MAX_BYTES}`}</CounterText>
          )}
        </LabelRow>

        <InputBase
          value={title}
          onFocus={() => setActiveField('title')}
          onBlur={() => setActiveField(null)}
          onChange={(e) => {
            markEdited('title');
            setTitle(e.target.value.slice(0, TITLE_MAX_CHARS));
          }}
          sx={{
            border: `0.5px solid ${theme.palette.action.disabled}`,
            padding: '0px 15px',
            borderRadius: '8px',
            height: '36px',
            width: '100%',
            maxWidth: '450px',
          }}
          placeholder={t('core:title', { postProcess: 'capitalizeFirstChar' })}
          inputProps={{
            'aria-label': 'Title',
            fontSize: '14px',
            fontWeight: 400,
            maxLength: TITLE_MAX_CHARS,
          }}
        />

        <Spacer height="15px" />

        <LabelRow>
          <InputLabel sx={{ fontSize: '14px' }}>
            {t('core:description', {
              postProcess: 'capitalizeFirstChar',
            })}
          </InputLabel>
          {activeField === 'description' && (
            <CounterText>{`${utf8ByteLength(description)}/${QDN_DESCRIPTION_MAX_BYTES}`}</CounterText>
          )}
        </LabelRow>

        <InputBase
          value={description}
          onFocus={() => setActiveField('description')}
          onBlur={() => setActiveField(null)}
          onChange={(e) => {
            markEdited('description');
            setDescription(e.target.value.slice(0, DESCRIPTION_MAX_CHARS));
          }}
          sx={{
            border: `0.5px solid ${theme.palette.action.disabled}`,
            padding: '0px 15px',
            borderRadius: '8px',
            height: '36px',
            width: '100%',
            maxWidth: '450px',
          }}
          placeholder={t('core:description', {
            postProcess: 'capitalizeFirstChar',
          })}
          inputProps={{
            'aria-label': 'Description',
            fontSize: '14px',
            fontWeight: 400,
            maxLength: DESCRIPTION_MAX_CHARS,
          }}
        />

        <Spacer height="15px" />

        <InputLabel sx={{ fontSize: '14px', marginBottom: '2px' }}>
          {t('core:category', {
            postProcess: 'capitalizeFirstChar',
          })}
        </InputLabel>

        <CustomSelect
          displayEmpty
          placeholder={t('core:action.select_category', {
            postProcess: 'capitalizeFirstChar',
          })}
          value={category}
          onChange={(event) => {
            markEdited('category');
            setCategory(event?.target.value);
          }}
        >
          <MenuItem value="">
            <em
              style={{
                color: theme.palette.text.secondary,
              }}
            >
              {t('core:action.select_category', {
                postProcess: 'capitalizeFirstChar',
              })}
            </em>
          </MenuItem>
          {categories?.map((category) => {
            return <MenuItem value={category?.id}>{category?.name}</MenuItem>;
          })}
        </CustomSelect>

        <Spacer height="15px" />

        <LabelRow>
          <InputLabel sx={{ fontSize: '14px' }}>
            {t('core:tags', {
              postProcess: 'capitalizeFirstChar',
            })}
          </InputLabel>
          {activeTagInfo && (
            <CounterText>{`${activeTagInfo.label}: ${activeTagInfo.length}/${TAG_MAX_CHARS}`}</CounterText>
          )}
        </LabelRow>

        <AppPublishTagsContainer>
          <InputBase
            value={tag1}
            onFocus={() => setActiveField('tag1')}
            onBlur={() => setActiveField(null)}
            onChange={(e) => {
              markEdited('tag1');
              setTag1(e.target.value.slice(0, TAG_MAX_CHARS));
            }}
            sx={{
              border: `0.5px solid ${theme.palette.action.disabled}`,
              padding: '0px 15px',
              borderRadius: '8px',
              height: '36px',
              width: '100px',
            }}
            placeholder="Tag 1"
            inputProps={{
              'aria-label': 'Tag 1',
              fontSize: '14px',
              fontWeight: 400,
              maxLength: TAG_MAX_CHARS,
            }}
          />
          <InputBase
            value={tag2}
            onFocus={() => setActiveField('tag2')}
            onBlur={() => setActiveField(null)}
            onChange={(e) => {
              markEdited('tag2');
              setTag2(e.target.value.slice(0, TAG_MAX_CHARS));
            }}
            sx={{
              border: `0.5px solid ${theme.palette.action.disabled}`,
              padding: '0px 15px',
              borderRadius: '8px',
              height: '36px',
              width: '100px',
            }}
            placeholder="Tag 2"
            inputProps={{
              'aria-label': 'Tag 2',
              fontSize: '14px',
              fontWeight: 400,
              maxLength: TAG_MAX_CHARS,
            }}
          />
          <InputBase
            value={tag3}
            onFocus={() => setActiveField('tag3')}
            onBlur={() => setActiveField(null)}
            onChange={(e) => {
              markEdited('tag3');
              setTag3(e.target.value.slice(0, TAG_MAX_CHARS));
            }}
            sx={{
              border: `0.5px solid ${theme.palette.action.disabled}`,
              padding: '0px 15px',
              borderRadius: '8px',
              height: '36px',
              width: '100px',
            }}
            placeholder="Tag 3"
            inputProps={{
              'aria-label': 'Tag 3',
              fontSize: '14px',
              fontWeight: 400,
              maxLength: TAG_MAX_CHARS,
            }}
          />
          <InputBase
            value={tag4}
            onFocus={() => setActiveField('tag4')}
            onBlur={() => setActiveField(null)}
            onChange={(e) => {
              markEdited('tag4');
              setTag4(e.target.value.slice(0, TAG_MAX_CHARS));
            }}
            sx={{
              border: `0.5px solid ${theme.palette.action.disabled}`,
              padding: '0px 15px',
              borderRadius: '8px',
              height: '36px',
              width: '100px',
            }}
            placeholder="Tag 4"
            inputProps={{
              'aria-label': 'Tag 4',
              fontSize: '14px',
              fontWeight: 400,
              maxLength: TAG_MAX_CHARS,
            }}
          />
          <InputBase
            value={tag5}
            onFocus={() => setActiveField('tag5')}
            onBlur={() => setActiveField(null)}
            onChange={(e) => {
              markEdited('tag5');
              setTag5(e.target.value.slice(0, TAG_MAX_CHARS));
            }}
            sx={{
              border: `0.5px solid ${theme.palette.action.disabled}`,
              padding: '0px 15px',
              borderRadius: '8px',
              height: '36px',
              width: '100px',
            }}
            placeholder="Tag 5"
            inputProps={{
              'aria-label': 'Tag 5',
              fontSize: '14px',
              fontWeight: 400,
              maxLength: TAG_MAX_CHARS,
            }}
          />
        </AppPublishTagsContainer>

        <Spacer height="30px" />

        <PublishQAppInfo>
          {t('core:message.generic.select_zip', {
            postProcess: 'capitalizeFirstChar',
          })}
        </PublishQAppInfo>

        <Spacer height="10px" />

        <PublishQAppInfo>{`(${
          appType === 'APP' ? '50mb' : '400mb'
        } MB maximum)`}</PublishQAppInfo>
        {file && (
          <>
            <Spacer height="5px" />
            <PublishQAppInfo>{`Selected: (${file?.name})`}</PublishQAppInfo>
          </>
        )}

        <Spacer height="18px" />

        <PublishQAppChoseFile {...getRootProps()}>
          {' '}
          <input {...getInputProps()} />
          {t('core:action.choose_file', { postProcess: 'capitalizeFirstChar' })}
        </PublishQAppChoseFile>

        <Spacer height="35px" />

        <PublishQAppCTAButton
          sx={{
            alignSelf: 'center',
            '&.Mui-disabled': { opacity: 0.5 },
          }}
          disabled={prefillPending}
          onClick={publishApp}
        >
          {t('core:action.publish', { postProcess: 'capitalizeFirstChar' })}
        </PublishQAppCTAButton>
      </AppsWidthLimiter>

      <LoadingSnackbar
        open={!!isLoading || prefillPending}
        info={{
          message:
            isLoading ||
            t('core:loading.generic', { postProcess: 'capitalizeFirstChar' }),
        }}
      />
      <CustomizedSnackbars
        duration={3500}
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </AppsLibraryContainer>
  );
};
