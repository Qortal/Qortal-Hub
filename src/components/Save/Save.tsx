import { useContext, useEffect, useMemo, useState } from 'react';
import { useRecoilState, useSetRecoilState } from 'recoil';
import isEqual from 'lodash/isEqual'; // TODO Import deep comparison utility
import {
  canSaveSettingToQdnAtom,
  hasSettingsChangedAtom,
  isUsingImportExportSettingsAtom,
  oldPinnedAppsAtom,
  settingsLocalLastUpdatedAtom,
  settingsQDNLastUpdatedAtom,
  sortablePinnedAppsAtom,
} from '../../atoms/global';
import {
  Box,
  Button,
  ButtonBase,
  Popover,
  Typography,
  useTheme,
} from '@mui/material';
import { objectToBase64 } from '../../qdn/encryption/group-encryption';
import { MyContext } from '../../App';
import { getFee } from '../../background';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { SaveIcon } from '../../assets/Icons/SaveIcon';
import { IconWrapper } from '../Desktop/DesktopFooter';
import { Spacer } from '../../common/Spacer';
import { LoadingButton } from '@mui/lab';
import { saveToLocalStorage } from '../Apps/AppsNavBarDesktop';
import { decryptData, encryptData } from '../../qortalRequests/get';
import { saveFileToDiskGeneric } from '../../utils/generateWallet/generateWallet';
import {
  base64ToUint8Array,
  uint8ArrayToObject,
} from '../../backgroundFunctions/encryption';
import { useTranslation } from 'react-i18next';

export const handleImportClick = async () => {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.base64,.txt';

  // Create a promise to handle file selection and reading synchronously
  return await new Promise((resolve, reject) => {
    fileInput.onchange = () => {
      const file = fileInput.files[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        resolve(e.target.result); // Resolve with the file content
      };
      reader.onerror = () => {
        reject(new Error('Error reading file'));
      };

      reader.readAsText(file); // Read the file as text (Base64 string)
    };

    // Trigger the file input dialog
    fileInput.click();
  });
};

export const Save = ({ isDesktop, disableWidth, myName }) => {
  const [pinnedApps, setPinnedApps] = useRecoilState(sortablePinnedAppsAtom);
  const [settingsQdnLastUpdated, setSettingsQdnLastUpdated] = useRecoilState(
    settingsQDNLastUpdatedAtom
  );
  const [settingsLocalLastUpdated] = useRecoilState(
    settingsLocalLastUpdatedAtom
  );
  const setHasSettingsChangedAtom = useSetRecoilState(hasSettingsChangedAtom);
  const [isUsingImportExportSettings, setIsUsingImportExportSettings] =
    useRecoilState(isUsingImportExportSettingsAtom);

  const [canSave] = useRecoilState(canSaveSettingToQdnAtom);
  const [openSnack, setOpenSnack] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [oldPinnedApps, setOldPinnedApps] = useRecoilState(oldPinnedAppsAtom);
  const [anchorEl, setAnchorEl] = useState(null);
  const { show } = useContext(MyContext);
  const theme = useTheme();
  const { t } = useTranslation(['core']);

  const hasChanged = useMemo(() => {
    const newChanges = {
      sortablePinnedApps: pinnedApps.map((item) => {
        return {
          name: item?.name,
          service: item?.service,
        };
      }),
    };
    const oldChanges = {
      sortablePinnedApps: oldPinnedApps.map((item) => {
        return {
          name: item?.name,
          service: item?.service,
        };
      }),
    };
    if (settingsQdnLastUpdated === -100) return false;
    return (
      !isEqual(oldChanges, newChanges) &&
      settingsQdnLastUpdated < settingsLocalLastUpdated
    );
  }, [
    oldPinnedApps,
    pinnedApps,
    settingsQdnLastUpdated,
    settingsLocalLastUpdated,
  ]);

  useEffect(() => {
    setHasSettingsChangedAtom(hasChanged);
  }, [hasChanged]);

  const saveToQdn = async () => {
    try {
      setIsLoading(true);
      const data64 = await objectToBase64({
        sortablePinnedApps: pinnedApps.map((item) => {
          return {
            name: item?.name,
            service: item?.service,
          };
        }),
      });
      const encryptData = await new Promise((res, rej) => {
        window
          .sendMessage(
            'ENCRYPT_DATA',
            {
              data64,
            },
            60000
          )
          .then((response) => {
            if (response.error) {
              rej(response?.message);
              return;
            } else {
              res(response);
            }
          })
          .catch((error) => {
            console.error('Failed qortalRequest', error);
          });
      });
      if (encryptData && !encryptData?.error) {
        const fee = await getFee('ARBITRARY');

        await show({
          message: t('core:save.publish_qnd', { postProcess: 'capitalize' }),
          publishFee: fee.fee + ' QORT',
        });
        const response = await new Promise((res, rej) => {
          window
            .sendMessage('publishOnQDN', {
              data: encryptData,
              identifier: 'ext_saved_settings',
              service: 'DOCUMENT_PRIVATE',
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
                  t('core:message.error.generic', { postProcess: 'capitalize' })
              );
            });
        });
        if (response?.identifier) {
          setOldPinnedApps(pinnedApps);
          setSettingsQdnLastUpdated(Date.now());
          setInfoSnack({
            type: 'success',
            message: t('core:message.success.publish_qdn', {
              postProcess: 'capitalize',
            }),
          });
          setOpenSnack(true);
          setAnchorEl(null);
        }
      }
    } catch (error) {
      setInfoSnack({
        type: 'error',
        message:
          error?.message ||
          t('core:message.error.save_qdn', {
            postProcess: 'capitalize',
          }),
      });
      setOpenSnack(true);
    } finally {
      setIsLoading(false);
    }
  };
  const handlePopupClick = (event) => {
    event.stopPropagation(); // Prevent parent onClick from firing
    setAnchorEl(event.currentTarget);
  };

  const revertChanges = () => {
    setPinnedApps(oldPinnedApps);
    saveToLocalStorage('ext_saved_settings', 'sortablePinnedApps', null);
    setAnchorEl(null);
  };

  return (
    <>
      <ButtonBase
        onClick={handlePopupClick}
        disabled={
          // !hasChanged ||
          // !canSave ||
          isLoading
          // settingsQdnLastUpdated === -100
        }
      >
        {isDesktop ? (
          <IconWrapper
            disableWidth={disableWidth}
            label={t('core:save_options.save', {
              postProcess: 'capitalize',
            })}
            selected={false}
            color={
              hasChanged && !isLoading
                ? '#5EB049'
                : theme.palette.text.secondary
            }
          >
            <SaveIcon
              color={
                hasChanged && !isLoading
                  ? '#5EB049'
                  : theme.palette.text.secondary
              }
            />
          </IconWrapper>
        ) : (
          <SaveIcon
            color={
              hasChanged && !isLoading
                ? '#5EB049'
                : theme.palette.text.secondary
            }
          />
        )}
      </ButtonBase>

      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)} // Close popover on click outside
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        sx={{
          width: '300px',
          maxWidth: '90%',
          maxHeight: '80%',
          overflow: 'auto',
        }}
      >
        {isUsingImportExportSettings && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              padding: '15px',
              width: '100%',
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
              }}
            >
              <Typography
                sx={{
                  fontSize: '14px',
                }}
              >
                {t('core:save_options.settings', {
                  postProcess: 'capitalize',
                })}
              </Typography>{' '}
              <Spacer height="40px" />
              <Button
                size="small"
                onClick={() => {
                  saveToLocalStorage(
                    'ext_saved_settings_import_export',
                    'sortablePinnedApps',
                    null,
                    true
                  );
                  setIsUsingImportExportSettings(false);
                }}
                variant="contained"
                sx={{
                  backgroundColor: theme.palette.other.danger,
                  color: 'black',
                  fontWeight: 'bold',
                  opacity: 0.7,
                  '&:hover': {
                    backgroundColor: theme.palette.other.danger,
                    color: 'black',
                    opacity: 1,
                  },
                }}
              >
                {t('core:save_options.qdn', {
                  postProcess: 'capitalize',
                })}
              </Button>
            </Box>
          </Box>
        )}
        {!isUsingImportExportSettings && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              padding: '15px',
              width: '100%',
            }}
          >
            {!myName ? (
              <Box
                sx={{
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                }}
              >
                <Typography
                  sx={{
                    fontSize: '14px',
                  }}
                >
                  {t('core:save_options.register_name', {
                    postProcess: 'capitalize',
                  })}
                </Typography>
              </Box>
            ) : (
              <>
                {hasChanged && (
                  <Box
                    sx={{
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: '14px',
                      }}
                    >
                      {t('core:save_options.unsaved_changes', {
                        postProcess: 'capitalize',
                      })}
                    </Typography>

                    <Spacer height="10px" />

                    <LoadingButton
                      sx={{
                        backgroundColor: theme.palette.other.positive,
                        color: 'black',
                        opacity: 0.7,
                        fontWeight: 'bold',
                        '&:hover': {
                          backgroundColor: theme.palette.other.positive,
                          color: 'black',
                          opacity: 1,
                        },
                      }}
                      size="small"
                      loading={isLoading}
                      onClick={saveToQdn}
                      variant="contained"
                    >
                      {t('core:save_options.save_qdn', {
                        postProcess: 'capitalize',
                      })}
                    </LoadingButton>
                    <Spacer height="20px" />
                    {!isNaN(settingsQdnLastUpdated) &&
                      settingsQdnLastUpdated > 0 && (
                        <>
                          <Typography
                            sx={{
                              fontSize: '14px',
                            }}
                          >
                            {t('core:save_options.reset_qdn', {
                              postProcess: 'capitalize',
                            })}
                          </Typography>
                          <Spacer height="10px" />
                          <LoadingButton
                            size="small"
                            loading={isLoading}
                            onClick={revertChanges}
                            variant="contained"
                            sx={{
                              backgroundColor: theme.palette.other.danger,
                              color: 'black',
                              fontWeight: 'bold',
                              opacity: 0.7,
                              '&:hover': {
                                backgroundColor: theme.palette.other.danger,
                                color: 'black',
                                opacity: 1,
                              },
                            }}
                          >
                            {t('core:save_options.revert_qdn', {
                              postProcess: 'capitalize',
                            })}
                          </LoadingButton>
                        </>
                      )}
                    {!isNaN(settingsQdnLastUpdated) &&
                      settingsQdnLastUpdated === 0 && (
                        <>
                          <Typography
                            sx={{
                              fontSize: '14px',
                            }}
                          >
                            {' '}
                            {t('core:save_options.reset_pinned', {
                              postProcess: 'capitalize',
                            })}
                          </Typography>
                          <Spacer height="10px" />
                          <LoadingButton
                            loading={isLoading}
                            onClick={revertChanges}
                            variant="contained"
                          >
                            {t('core:save_options.revert_default', {
                              postProcess: 'capitalize',
                            })}
                          </LoadingButton>
                        </>
                      )}
                  </Box>
                )}
                {!isNaN(settingsQdnLastUpdated) &&
                  settingsQdnLastUpdated === -100 &&
                  isUsingImportExportSettings !== true && (
                    <Box
                      sx={{
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                      }}
                    >
                      <Typography
                        sx={{
                          fontSize: '14px',
                        }}
                      >
                        {t('core:save_options.overwrite_changes', {
                          postProcess: 'capitalize',
                        })}
                      </Typography>
                      <Spacer height="10px" />
                      <LoadingButton
                        size="small"
                        loading={isLoading}
                        onClick={saveToQdn}
                        variant="contained"
                        sx={{
                          backgroundColor: theme.palette.other.danger,
                          color: 'black',
                          fontWeight: 'bold',
                          opacity: 0.7,
                          '&:hover': {
                            backgroundColor: theme.palette.other.danger,
                            color: 'black',
                            opacity: 1,
                          },
                        }}
                      >
                        {t('core:save_options.overwrite_qdn', {
                          postProcess: 'capitalize',
                        })}
                      </LoadingButton>
                    </Box>
                  )}
                {!hasChanged && (
                  <Box
                    sx={{
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: '14px',
                      }}
                    >
                      {t('core:save_options.no_pinned_changes', {
                        postProcess: 'capitalize',
                      })}
                    </Typography>
                  </Box>
                )}
              </>
            )}
          </Box>
        )}
        <Box
          sx={{
            padding: '15px',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            width: '100%',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              gap: '10px',
              justifyContent: 'flex-end',
              width: '100%',
            }}
          >
            <ButtonBase
              onClick={async () => {
                try {
                  const fileContent = await handleImportClick();
                  const decryptedData = await decryptData({
                    encryptedData: fileContent,
                  });
                  const decryptToUnit8ArraySubject =
                    base64ToUint8Array(decryptedData);
                  const responseData = uint8ArrayToObject(
                    decryptToUnit8ArraySubject
                  );
                  if (Array.isArray(responseData)) {
                    saveToLocalStorage(
                      'ext_saved_settings_import_export',
                      'sortablePinnedApps',
                      responseData,
                      {
                        isUsingImportExport: true,
                      }
                    );
                    setPinnedApps(responseData);
                    setOldPinnedApps(responseData);
                    setIsUsingImportExportSettings(true);
                  }
                } catch (error) {
                  console.log('error', error);
                }
              }}
            >
              {t('core:action.import', {
                postProcess: 'capitalize',
              })}
            </ButtonBase>

            <ButtonBase
              onClick={async () => {
                try {
                  const data64 = await objectToBase64(pinnedApps);

                  const encryptedData = await encryptData({
                    data64,
                  });
                  const blob = new Blob([encryptedData], {
                    type: 'text/plain',
                  });

                  const timestamp = new Date().toISOString().replace(/:/g, '-'); // Safe timestamp for filenames
                  const filename = `qortal-new-ui-backup-settings-${timestamp}.txt`;
                  await saveFileToDiskGeneric(blob, filename);
                } catch (error) {
                  console.log('error', error);
                }
              }}
            >
              {t('core:action.export', {
                postProcess: 'capitalize',
              })}
            </ButtonBase>
          </Box>
        </Box>
      </Popover>
      <CustomizedSnackbars
        duration={3500}
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </>
  );
};
