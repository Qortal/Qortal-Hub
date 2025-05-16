import { useContext, useState } from 'react';
import {
  AppCircle,
  AppCircleContainer,
  AppCircleLabel,
  AppLibrarySubTitle,
  AppsContainer,
} from './Apps-styles';
import { Buffer } from 'buffer';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Input,
} from '@mui/material';
import { Add } from '@mui/icons-material';
import { MyContext, getBaseApiReact } from '../../App';
import { executeEvent } from '../../utils/events';
import { Spacer } from '../../common/Spacer';
import { useModal } from '../../common/useModal';
import { createEndpoint, isUsingLocal } from '../../background';
import { Label } from '../Group/AddGroup';
import ShortUniqueId from 'short-unique-id';
import swaggerSVG from '../../assets/svgs/swagger.svg';
import { useTranslation } from 'react-i18next';

const uid = new ShortUniqueId({ length: 8 });

export const AppsDevModeHome = ({
  setMode,
  myApp,
  myWebsite,
  availableQapps,
  myName,
}) => {
  const [domain, setDomain] = useState('127.0.0.1');
  const [port, setPort] = useState('');
  const [selectedPreviewFile, setSelectedPreviewFile] = useState(null);
  const { t } = useTranslation(['core', 'group']);
  const { isShow, onCancel, onOk, show, message } = useModal();
  const {
    openSnackGlobal,
    setOpenSnackGlobal,
    infoSnackCustom,
    setInfoSnackCustom,
  } = useContext(MyContext);

  const handleSelectFile = async (existingFilePath) => {
    const filePath = existingFilePath || (await window.electron.selectFile());
    if (filePath) {
      const content = await window.electron.readFile(filePath);
      return { buffer: content, filePath };
    } else {
      console.log('No file selected.');
    }
  };

  const handleSelectDirectry = async (existingDirectoryPath) => {
    const { buffer, directoryPath } =
      await window.electron.selectAndZipDirectory(existingDirectoryPath);
    if (buffer) {
      return { buffer, directoryPath };
    } else {
      console.log('No file selected.');
    }
  };

  const addDevModeApp = async () => {
    try {
      const usingLocal = await isUsingLocal();
      if (!usingLocal) {
        setOpenSnackGlobal(true);

        setInfoSnackCustom({
          type: 'error',
          message: '',
        });
        return;
      }
      const { portVal, domainVal } = await show({
        message: '',
        publishFee: '',
      });
      const framework = domainVal + ':' + portVal;
      const response = await fetch(
        `${getBaseApiReact()}/developer/proxy/start`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
          },
          body: framework,
        }
      );
      const responseData = await response.text();
      executeEvent('appsDevModeAddTab', {
        data: {
          url: 'http://127.0.0.1:' + responseData,
        },
      });
    } catch (error) {
      console.log(error);
    }
  };

  const addPreviewApp = async (isRefresh, existingFilePath, tabId) => {
    try {
      const usingLocal = await isUsingLocal();
      if (!usingLocal) {
        setOpenSnackGlobal(true);
        setInfoSnackCustom({
          type: 'error',
          message: t('core:message.generic.devmode_local_node', {
            postProcess: 'capitalizeFirst',
          }),
        });
        return;
      }
      if (!myName) {
        setOpenSnackGlobal(true);
        setInfoSnackCustom({
          type: 'error',
          message: t('core:message.generic.name_preview', {
            postProcess: 'capitalizeFirst',
          }),
        });
        return;
      }

      const { buffer, filePath } = await handleSelectFile(existingFilePath);

      if (!buffer) {
        setOpenSnackGlobal(true);
        setInfoSnackCustom({
          type: 'error',
          message: t('core:message.generic.select_file', {
            postProcess: 'capitalizeFirst',
          }),
        });
        return;
      }

      const postBody = Buffer.from(buffer).toString('base64');
      const endpoint = await createEndpoint(
        `/arbitrary/APP/${myName}/zip?preview=true`
      );
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: postBody,
      });

      if (!response?.ok) throw new Error('Invalid zip');
      const previewPath = await response.text();
      if (tabId) {
        executeEvent('appsDevModeUpdateTab', {
          data: {
            url: 'http://127.0.0.1:12391' + previewPath,
            isPreview: true,
            filePath,
            refreshFunc: (tabId) => {
              addPreviewApp(true, filePath, tabId);
            },
            tabId,
          },
        });
        return;
      }
      executeEvent('appsDevModeAddTab', {
        data: {
          url: 'http://127.0.0.1:12391' + previewPath,
          isPreview: true,
          filePath,
          refreshFunc: (tabId) => {
            addPreviewApp(true, filePath, tabId);
          },
        },
      });
    } catch (error) {
      console.error(error);
    }
  };

  const addPreviewAppWithDirectory = async (isRefresh, existingDir, tabId) => {
    try {
      const usingLocal = await isUsingLocal();
      if (!usingLocal) {
        setOpenSnackGlobal(true);
        setInfoSnackCustom({
          type: 'error',
          message: t('core:message.generic.devmode_local_node', {
            postProcess: 'capitalizeFirst',
          }),
        });
        return;
      }
      if (!myName) {
        setOpenSnackGlobal(true);
        setInfoSnackCustom({
          type: 'error',
          message: t('core:message.generic.name_preview', {
            postProcess: 'capitalizeFirst',
          }),
        });
        return;
      }

      const { buffer, directoryPath } = await handleSelectDirectry(existingDir);

      if (!buffer) {
        setOpenSnackGlobal(true);
        setInfoSnackCustom({
          type: 'error',
          message: t('core:message.generic.select_file', {
            postProcess: 'capitalizeFirst',
          }),
        });
        return;
      }

      const postBody = Buffer.from(buffer).toString('base64');
      const endpoint = await createEndpoint(
        `/arbitrary/APP/${myName}/zip?preview=true`
      );
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: postBody,
      });

      if (!response?.ok)
        throw new Error(
          t('core:message.error.invalid_zip', {
            postProcess: 'capitalizeFirst',
          })
        );
      const previewPath = await response.text();

      if (tabId) {
        executeEvent('appsDevModeUpdateTab', {
          data: {
            url: 'http://127.0.0.1:12391' + previewPath,
            isPreview: true,
            directoryPath,
            refreshFunc: (tabId) => {
              addPreviewAppWithDirectory(true, directoryPath, tabId);
            },
            tabId,
          },
        });
        return;
      }
      executeEvent('appsDevModeAddTab', {
        data: {
          url: 'http://127.0.0.1:12391' + previewPath,
          isPreview: true,
          directoryPath,
          refreshFunc: (tabId) => {
            addPreviewAppWithDirectory(true, directoryPath, tabId);
          },
        },
      });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <>
      <AppsContainer
        sx={{
          justifyContent: 'flex-start',
        }}
      >
        <AppLibrarySubTitle
          sx={{
            fontSize: '30px',
          }}
        >
          {t('core:devmode_apps', { postProcess: 'capitalizeFirst' })}
        </AppLibrarySubTitle>
      </AppsContainer>

      <Spacer height="45px" />

      <AppsContainer
        sx={{
          gap: '75px',
          justifyContent: 'flex-start',
        }}
      >
        <ButtonBase
          onClick={() => {
            addDevModeApp();
          }}
        >
          <AppCircleContainer
            sx={{
              gap: '10px',
            }}
          >
            <AppCircle>
              <Add>+</Add>
            </AppCircle>
            <AppCircleLabel>
              {t('core:server', { postProcess: 'capitalizeFirst' })}
            </AppCircleLabel>
          </AppCircleContainer>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            addPreviewApp();
          }}
        >
          <AppCircleContainer
            sx={{
              gap: '10px',
            }}
          >
            <AppCircle>
              <Add>+</Add>
            </AppCircle>

            <AppCircleLabel>
              {t('core:zip', { postProcess: 'capitalizeFirst' })}
            </AppCircleLabel>
          </AppCircleContainer>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            addPreviewAppWithDirectory();
          }}
        >
          <AppCircleContainer
            sx={{
              gap: '10px',
            }}
          >
            <AppCircle>
              <Add>+</Add>
            </AppCircle>
            <AppCircleLabel>
              {t('core:directory', { postProcess: 'capitalizeFirst' })}
            </AppCircleLabel>
          </AppCircleContainer>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            executeEvent('appsDevModeAddTab', {
              data: {
                service: 'APP',
                name: 'Q-Sandbox',
                tabId: uid.rnd(),
              },
            });
          }}
        >
          <AppCircleContainer
            sx={{
              gap: '10px',
            }}
          >
            <AppCircle>
              <Avatar
                sx={{
                  height: '42px',
                  width: '42px',
                  '& img': {
                    objectFit: 'fill',
                  },
                }}
                alt={t('core:q_apps.q_sandbox', {
                  postProcess: 'capitalizeFirst',
                })}
                src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/Q-Sandbox/qortal_avatar?async=true`}
              >
                <img
                  style={{
                    width: '31px',
                    height: 'auto',
                  }}
                  alt="center-icon"
                />
              </Avatar>
            </AppCircle>

            <AppCircleLabel>
              {t('core:q_apps.q_sandbox', {
                postProcess: 'capitalizeFirst',
              })}
            </AppCircleLabel>
          </AppCircleContainer>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            executeEvent('appsDevModeAddTab', {
              data: {
                url: 'http://127.0.0.1:12391',
                isPreview: false,
                customIcon: swaggerSVG,
              },
            });
          }}
        >
          <AppCircleContainer
            sx={{
              gap: '10px',
            }}
          >
            <AppCircle>
              <Avatar
                sx={{
                  height: '42px',
                  width: '42px',
                  '& img': {
                    objectFit: 'fill',
                  },
                }}
                alt={t('core:api', {
                  postProcess: 'capitalizeAll',
                })}
                src={swaggerSVG}
              >
                <img
                  style={{
                    width: '31px',
                    height: 'auto',
                  }}
                  alt="center-icon"
                />
              </Avatar>
            </AppCircle>

            <AppCircleLabel>
              {t('core:api', {
                postProcess: 'capitalizeAll',
              })}
            </AppCircleLabel>
          </AppCircleContainer>
        </ButtonBase>
      </AppsContainer>

      {isShow && (
        <Dialog
          open={isShow}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && domain && port) {
              onOk({ portVal: port, domainVal: domain });
            }
          }}
        >
          <DialogTitle id="alert-dialog-title">
            {t('core:action.add_custom_framework', {
              postProcess: 'capitalizeFirst',
            })}
          </DialogTitle>

          <DialogContent>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
              }}
            >
              <Label>
                {t('core:domain', {
                  postProcess: 'capitalizeFirst',
                })}
              </Label>
              <Input
                placeholder={t('core:domain', {
                  postProcess: 'capitalizeFirst',
                })}
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </Box>

            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                marginTop: '15px',
              }}
            >
              <Label>
                {t('core:port', {
                  postProcess: 'capitalizeFirst',
                })}
              </Label>
              <Input
                placeholder={t('core:port', {
                  postProcess: 'capitalizeFirst',
                })}
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </Box>
          </DialogContent>

          <DialogActions>
            <Button variant="contained" onClick={onCancel}>
              {t('core:action.close', {
                postProcess: 'capitalizeFirst',
              })}
            </Button>

            <Button
              disabled={!domain || !port}
              variant="contained"
              onClick={() => onOk({ portVal: port, domainVal: domain })}
              autoFocus
            >
              {t('core:action.add', {
                postProcess: 'capitalizeFirst',
              })}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
};
