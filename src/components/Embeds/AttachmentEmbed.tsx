import { useContext, useState } from 'react';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import {
  Card,
  CardContent,
  Typography,
  Box,
  ButtonBase,
  Divider,
  CircularProgress,
  useTheme,
} from '@mui/material';
import { base64ToBlobUrl } from '../../utils/fileReading';
import { saveFileToDiskGeneric } from '../../utils/generateWallet/generateWallet';
import AttachmentIcon from '@mui/icons-material/Attachment';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { CustomLoader } from '../../common/CustomLoader';
import { Spacer } from '../../common/Spacer';
import { FileAttachmentContainer, FileAttachmentFont } from './Embed-styles';
import DownloadIcon from '@mui/icons-material/Download';
import SaveIcon from '@mui/icons-material/Save';
import { decodeIfEncoded } from '../../utils/decode';
import { useTranslation } from 'react-i18next';

export const AttachmentCard = ({
  resourceData,
  resourceDetails,
  owner,
  refresh,
  openExternal,
  external,
  isLoadingParent,
  errorMsg,
  encryptionType,
  selectedGroupId,
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const { downloadResource } = useContext(QORTAL_APP_CONTEXT);
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const saveToDisk = async () => {
    const { name, service, identifier } = resourceData;

    const url = `${getBaseApiReact()}/arbitrary/${service}/${name}/${identifier}`;
    fetch(url)
      .then((response) => response.blob())
      .then(async (blob) => {
        await saveFileToDiskGeneric(blob, resourceData?.fileName);
      })
      .catch((error) => {
        console.error('Error fetching the video:', error);
      });
  };

  const saveToDiskEncrypted = async () => {
    let blobUrl;
    try {
      const { name, service, identifier, key } = resourceData;
      const url = `${getBaseApiReact()}/arbitrary/${service}/${name}/${identifier}?encoding=base64`;
      const res = await fetch(url);
      const data = await res.text();
      let decryptedData;

      try {
        if (key && encryptionType === 'private') {
          decryptedData = await window.sendMessage(
            'DECRYPT_DATA_WITH_SHARING_KEY',
            {
              encryptedData: data,
              key: decodeURIComponent(key),
            }
          );
        }
        if (encryptionType === 'group') {
          decryptedData = await window.sendMessage(
            'DECRYPT_QORTAL_GROUP_DATA',

            {
              data64: data,
              groupId: selectedGroupId,
            }
          );
        }
      } catch (error) {
        throw new Error(
          t('auth:message.error.decrypt', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }

      if (!decryptedData || decryptedData?.error)
        throw new Error(
          t('auth:message.error.decrypt_data', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      blobUrl = base64ToBlobUrl(decryptedData, resourceData?.mimeType);
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      await saveFileToDiskGeneric(blob, resourceData?.fileName);
    } catch (error) {
      console.error(error);
    } finally {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    }
  };

  return (
    <Card
      sx={{
        backgroundColor: theme.palette.background.default,
        height: '250px',
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          padding: '16px 16px 0px 16px',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <AttachmentIcon
            sx={{
              color: theme.palette.text.primary,
            }}
          />
          <Typography>
            {t('core:attachment', { postProcess: 'capitalizeAll' })}
          </Typography>
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '10px',
          }}
        >
          <ButtonBase>
            <RefreshIcon
              onClick={refresh}
              sx={{
                fontSize: '24px',
                color: theme.palette.text.primary,
              }}
            />
          </ButtonBase>

          {external && (
            <ButtonBase>
              <OpenInNewIcon
                onClick={openExternal}
                sx={{
                  fontSize: '24px',
                  color: theme.palette.text.primary,
                }}
              />
            </ButtonBase>
          )}
        </Box>
      </Box>

      <Box
        sx={{
          padding: '8px 16px 8px 16px',
        }}
      >
        <Typography
          sx={{
            fontSize: '12px',
          }}
        >
          {t('core:message.generic.created_by', {
            owner: decodeIfEncoded(owner),
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>

        <Typography
          sx={{
            fontSize: '12px',
          }}
        >
          {encryptionType === 'private'
            ? t('core:message.generic.encrypted', {
                postProcess: 'capitalizeAll',
              })
            : encryptionType === 'group'
              ? t('group:message.generic.group_encrypted', {
                  postProcess: 'capitalizeAll',
                })
              : t('core:message.generic.encrypted_not', {
                  postProcess: 'capitalizeFirstChar',
                })}
        </Typography>
      </Box>

      <Divider sx={{ borderColor: 'rgb(255 255 255 / 10%)' }} />

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
        }}
      >
        {isLoadingParent && isOpen && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <CustomLoader />
          </Box>
        )}
        {errorMsg && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <Typography
              sx={{
                fontSize: '14px',
                color: theme.palette.other.danger,
              }}
            >
              {errorMsg}
            </Typography>
          </Box>
        )}
      </Box>

      <Box>
        <CardContent>
          {resourceData?.fileName && (
            <>
              <Typography
                sx={{
                  fontSize: '14px',
                }}
              >
                {resourceData?.fileName}
              </Typography>
              <Spacer height="10px" />
            </>
          )}
          <ButtonBase
            sx={{
              maxWidth: '400px',
              width: '90%',
            }}
            onClick={() => {
              if (resourceDetails?.status?.status === 'READY') {
                if (encryptionType) {
                  saveToDiskEncrypted();
                  return;
                }
                saveToDisk();
                return;
              }
              downloadResource(resourceData);
            }}
          >
            <FileAttachmentContainer>
              <Typography>
                {resourceDetails?.status?.status === 'DOWNLOADED'
                  ? t('core:message.error.generic.building', {
                      postProcess: 'capitalizeAll',
                    })
                  : resourceDetails?.status?.status}
              </Typography>

              {!resourceDetails && (
                <>
                  <DownloadIcon />
                  <FileAttachmentFont>
                    {t('core:action.download_file', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </FileAttachmentFont>
                </>
              )}

              {resourceDetails &&
                resourceDetails?.status?.status !== 'READY' &&
                resourceDetails?.status?.status !== 'FAILED_TO_DOWNLOAD' && (
                  <>
                    <CircularProgress
                      size={20}
                      sx={{
                        color: theme.palette.text.primary,
                      }}
                    />
                    <FileAttachmentFont>
                      {t('core:message.generic.downloading', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                      : {resourceDetails?.status?.percentLoaded || '0'}%
                    </FileAttachmentFont>
                  </>
                )}

              {resourceDetails &&
                resourceDetails?.status?.status === 'READY' && (
                  <>
                    <SaveIcon />
                    <FileAttachmentFont>
                      {t('core:action.save_disk', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </FileAttachmentFont>
                  </>
                )}
            </FileAttachmentContainer>
          </ButtonBase>
        </CardContent>
      </Box>
    </Card>
  );
};
