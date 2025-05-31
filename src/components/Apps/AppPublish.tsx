import React, { useCallback, useContext, useEffect, useState } from 'react';
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
import { fileToBase64 } from '../../utils/fileReading';
import { useTranslation } from 'react-i18next';
import { useSortedMyNames } from '../../hooks/useSortedMyNames';

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
    borderColor: 'none', // Border color on hover
  },
  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderColor: 'none', // Border color when focused
  },
  '&.Mui-disabled': {
    opacity: 0.5, // Lower opacity when disabled
  },
  '& .MuiSvgIcon-root': {
    color: 'var(--50-white, #FFFFFF80)',
  },
});

const CustomMenuItem = styled(MenuItem)({
  // backgroundColor: '#1f1f1f', // Background for dropdown items
  // color: '#ccc',
  // '&:hover': {
  //   backgroundColor: '#333', // Darker background on hover
  // },
});

export const AppPublish = ({ categories, myAddress, myName }) => {
  const [names, setNames] = useState([]);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [appType, setAppType] = useState('APP');
  const [file, setFile] = useState(null);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const [tag1, setTag1] = useState('');
  const [tag2, setTag2] = useState('');
  const [tag3, setTag3] = useState('');
  const [tag4, setTag4] = useState('');
  const [tag5, setTag5] = useState('');
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [isLoading, setIsLoading] = useState('');
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

  const getQapp = React.useCallback(async (name, appType) => {
    try {
      setIsLoading('Loading app information');
      const url = `${getBaseApiReact()}/arbitrary/resources/search?service=${appType}&mode=ALL&name=${name}&includemetadata=true`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response?.ok) return;
      const responseData = await response.json();

      if (responseData?.length > 0) {
        const myApp = responseData[0];
        setTitle(myApp?.metadata?.title || '');
        setDescription(myApp?.metadata?.description || '');
        setCategory(myApp?.metadata?.category || '');
        setTag1(myApp?.metadata?.tags[0] || '');
        setTag2(myApp?.metadata?.tags[1] || '');
        setTag3(myApp?.metadata?.tags[2] || '');
        setTag4(myApp?.metadata?.tags[3] || '');
        setTag5(myApp?.metadata?.tags[4] || '');
      }
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoading('');
    }
  }, []);

  useEffect(() => {
    if (!name || !appType) return;
    getQapp(name, appType);
  }, [name, appType]);

  const getNames = useCallback(async () => {
    if (!myAddress) return;
    try {
      setIsLoading('Loading names');
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

  const mySortedNames = useSortedMyNames(names, myName);

  const publishApp = async () => {
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
          {t('core:action.create_apps', {
            postProcess: 'capitalizeFirstChar',
          })}
          !
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
          <CustomMenuItem value="">
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
          </CustomMenuItem>
          {mySortedNames.map((name) => {
            return <CustomMenuItem value={name}>{name}</CustomMenuItem>;
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
        >
          <CustomMenuItem value="">
            <em
              style={{
                color: theme.palette.text.secondary,
              }}
            >
              {t('core:action.select_app_type', {
                postProcess: 'capitalizeFirstChar',
              })}
            </em>
          </CustomMenuItem>

          <CustomMenuItem value={'APP'}>
            {t('core:app', {
              postProcess: 'capitalizeFirstChar',
            })}
          </CustomMenuItem>

          <CustomMenuItem value={'WEBSITE'}>
            {t('core:website', {
              postProcess: 'capitalizeFirstChar',
            })}
          </CustomMenuItem>
        </CustomSelect>

        <Spacer height="15px" />

        <InputLabel sx={{ fontSize: '14px', marginBottom: '2px' }}>
          {t('core:title', {
            postProcess: 'capitalizeFirstChar',
          })}
        </InputLabel>

        <InputBase
          value={title}
          onChange={(e) => setTitle(e.target.value)}
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
          }}
        />

        <Spacer height="15px" />

        <InputLabel sx={{ fontSize: '14px', marginBottom: '2px' }}>
          {t('core:description', {
            postProcess: 'capitalizeFirstChar',
          })}
        </InputLabel>

        <InputBase
          value={description}
          onChange={(e) => setDescription(e.target.value)}
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
          onChange={(event) => setCategory(event?.target.value)}
        >
          <CustomMenuItem value="">
            <em
              style={{
                color: theme.palette.text.secondary,
              }}
            >
              {t('core:action.select_category', {
                postProcess: 'capitalizeFirstChar',
              })}
            </em>
          </CustomMenuItem>
          {categories?.map((category) => {
            return (
              <CustomMenuItem value={category?.id}>
                {category?.name}
              </CustomMenuItem>
            );
          })}
        </CustomSelect>

        <Spacer height="15px" />

        <InputLabel sx={{ fontSize: '14px', marginBottom: '2px' }}>
          {t('core:tags', {
            postProcess: 'capitalizeFirstChar',
          })}
        </InputLabel>

        <AppPublishTagsContainer>
          <InputBase
            value={tag1}
            onChange={(e) => setTag1(e.target.value)}
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
            }}
          />
          <InputBase
            value={tag2}
            onChange={(e) => setTag2(e.target.value)}
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
            }}
          />
          <InputBase
            value={tag3}
            onChange={(e) => setTag3(e.target.value)}
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
            }}
          />
          <InputBase
            value={tag4}
            onChange={(e) => setTag4(e.target.value)}
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
            }}
          />
          <InputBase
            value={tag5}
            onChange={(e) => setTag5(e.target.value)}
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
          }}
          onClick={publishApp}
        >
          {t('core:action.publish', { postProcess: 'capitalizeFirstChar' })}
        </PublishQAppCTAButton>
      </AppsWidthLimiter>

      <LoadingSnackbar
        open={!!isLoading}
        info={{
          message: isLoading,
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
