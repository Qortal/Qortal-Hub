import React, { useContext, useEffect, useState } from 'react';
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
import { MyContext, getBaseApiReact } from '../../App';
import { Spacer } from '../../common/Spacer';
import { executeEvent } from '../../utils/events';
import { useDropzone } from 'react-dropzone';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { getFee } from '../../background';
import { fileToBase64 } from '../../utils/fileReading';
import { useTranslation } from 'react-i18next';

const CustomSelect = styled(Select)({
  border: '0.5px solid var(--50-white, #FFFFFF80)',
  padding: '0px 15px',
  borderRadius: '5px',
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

export const AppPublish = ({ names, categories }) => {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [appType, setAppType] = useState('APP');
  const [file, setFile] = useState(null);
  const { show } = useContext(MyContext);
  const theme = useTheme();
  const { t } = useTranslation(['core', 'auth', 'group']);
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
                postProcess: 'capitalizeFirst',
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
          postProcess: 'capitalizeFirst',
        });
        throw new Error(errorMsg);
      }
      const fee = await getFee('ARBITRARY');

      await show({
        message: t('core:message.question.publish_app', {
          postProcess: 'capitalizeFirst',
        }),
        publishFee: fee.fee + ' QORT',
      });
      setIsLoading(
        t('core:message.generic.publishing', {
          postProcess: 'capitalizeFirst',
        })
      );
      const fileBase64 = await fileToBase64(file);
      await new Promise((res, rej) => {
        window
          .sendMessage('publishOnQDN', {
            data: fileBase64,
            service: appType,
            title,
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
                  postProcess: 'capitalizeFirst',
                })
            );
          });
      });
      setInfoSnack({
        type: 'success',
        message: t('core:message.success.published', {
          postProcess: 'capitalizeFirst',
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
            postProcess: 'capitalizeFirst',
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
            postProcess: 'capitalizeFirst',
          })}
          !
        </AppLibrarySubTitle>

        <Spacer height="18px" />

        <PublishQAppInfo>
          {t('core:message.generic.one_app_per_name', {
            postProcess: 'capitalizeFirst',
          })}
        </PublishQAppInfo>

        <Spacer height="18px" />

        <InputLabel sx={{ fontSize: '14px', marginBottom: '2px' }}>
          {t('core:name_app', {
            postProcess: 'capitalizeFirst',
          })}
        </InputLabel>

        <CustomSelect
          placeholder="Select Name/App"
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
                postProcess: 'capitalizeFirst',
              })}
            </em>
            {/* This is the placeholder item */}
          </CustomMenuItem>
          {names.map((name) => {
            return <CustomMenuItem value={name}>{name}</CustomMenuItem>;
          })}
        </CustomSelect>

        <Spacer height="15px" />

        <InputLabel sx={{ fontSize: '14px', marginBottom: '2px' }}>
          {t('core:app_service_type', {
            postProcess: 'capitalizeFirst',
          })}
        </InputLabel>

        <CustomSelect
          placeholder="SERVICE TYPE"
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
                postProcess: 'capitalizeFirst',
              })}
            </em>
          </CustomMenuItem>
          <CustomMenuItem value={'APP'}>
            {t('core:app', {
              postProcess: 'capitalizeFirst',
            })}
          </CustomMenuItem>
          <CustomMenuItem value={'WEBSITE'}>
            {t('core:website', {
              postProcess: 'capitalizeFirst',
            })}
          </CustomMenuItem>
        </CustomSelect>

        <Spacer height="15px" />

        <InputLabel sx={{ fontSize: '14px', marginBottom: '2px' }}>
          {t('core:title', {
            postProcess: 'capitalizeFirst',
          })}
        </InputLabel>

        <InputBase
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          sx={{
            border: `0.5px solid ${theme.palette.action.disabled}`,
            padding: '0px 15px',
            borderRadius: '5px',
            height: '36px',
            width: '100%',
            maxWidth: '450px',
          }}
          placeholder="Title"
          inputProps={{
            'aria-label': 'Title',
            fontSize: '14px',
            fontWeight: 400,
          }}
        />

        <Spacer height="15px" />

        <InputLabel sx={{ fontSize: '14px', marginBottom: '2px' }}>
          {t('core:description', {
            postProcess: 'capitalizeFirst',
          })}
        </InputLabel>

        <InputBase
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          sx={{
            border: `0.5px solid ${theme.palette.action.disabled}`,
            padding: '0px 15px',
            borderRadius: '5px',
            height: '36px',
            width: '100%',
            maxWidth: '450px',
          }}
          placeholder="Description"
          inputProps={{
            'aria-label': 'Description',
            fontSize: '14px',
            fontWeight: 400,
          }}
        />

        <Spacer height="15px" />

        <InputLabel sx={{ fontSize: '14px', marginBottom: '2px' }}>
          {t('core:category', {
            postProcess: 'capitalizeFirst',
          })}
        </InputLabel>

        <CustomSelect
          displayEmpty
          placeholder="Select Category"
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
                postProcess: 'capitalizeFirst',
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
            postProcess: 'capitalizeFirst',
          })}
        </InputLabel>

        <AppPublishTagsContainer>
          <InputBase
            value={tag1}
            onChange={(e) => setTag1(e.target.value)}
            sx={{
              border: `0.5px solid ${theme.palette.action.disabled}`,
              padding: '0px 15px',
              borderRadius: '5px',
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
              borderRadius: '5px',
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
              borderRadius: '5px',
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
              borderRadius: '5px',
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
              borderRadius: '5px',
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
            postProcess: 'capitalizeFirst',
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
          {t('core:action.choose_file', { postProcess: 'capitalizeFirst' })}
        </PublishQAppChoseFile>

        <Spacer height="35px" />

        <PublishQAppCTAButton
          sx={{
            alignSelf: 'center',
          }}
          onClick={publishApp}
        >
          {t('core:action.publish', { postProcess: 'capitalizeFirst' })}
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
