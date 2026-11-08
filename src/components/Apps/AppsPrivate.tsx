import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Input,
  MenuItem,
  Select,
  useTheme,
} from '@mui/material';
import { useDropzone } from 'react-dropzone';
import { useHandlePrivateApps } from '../../hooks/useHandlePrivateApps';
import { Spacer } from '../../common/Spacer';
import { PublishQAppChoseFile, PublishQAppInfo } from './Apps-styles';
import ImageUploader from '../../common/ImageUploader';
import { getBaseApiReact, QORTAL_APP_CONTEXT } from '../../App';
import { fileToBase64 } from '../../utils/fileReading';
import { objectToBase64 } from '../../qdn/encryption/group-encryption';
import { getFee } from '../../background/background.ts';
import { useAtom, useSetAtom } from 'jotai';
import {
  groupsPropertiesAtom,
  infoSnackGlobalAtom,
  memberGroupsAtom,
  myGroupsWhereIAmAdminAtom,
  openSnackGlobalAtom,
} from '../../atoms/global';
import { useTranslation } from 'react-i18next';
import { useSortedMyNames } from '../../hooks/useSortedMyNames';
import { Label } from '../../styles/App-styles.ts';
import { filterPrivateGroups } from './privateGroups';
import { buildPrivateAppDescription } from './privateAppMetadata';

const maxFileSize = 50 * 1024 * 1024; // 50MB

export type PrivateAppAction = 'access' | 'publish';

/** Dialog for one private-app action; `action === null` keeps it closed. */
export const AppsPrivate = ({
  myName,
  myAddress,
  action,
  onClose,
  onPublished,
}: {
  myName: string;
  myAddress: string;
  action: PrivateAppAction | null;
  onClose: () => void;
  onPublished?: () => void;
}) => {
  const [names, setNames] = useState([]);
  const [name, setName] = useState(0);

  const { openApp } = useHandlePrivateApps();
  const [file, setFile] = useState(null);
  const [logo, setLogo] = useState(null);
  const [qortalUrl, setQortalUrl] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(0);

  const [groupsProperties] = useAtom(groupsPropertiesAtom);
  const [myGroupsWhereIAmAdminFromGlobal] = useAtom(myGroupsWhereIAmAdminAtom);

  const myGroupsWhereIAmAdmin = useMemo(() => {
    return filterPrivateGroups(
      myGroupsWhereIAmAdminFromGlobal,
      groupsProperties
    );
  }, [myGroupsWhereIAmAdminFromGlobal, groupsProperties]);

  const isOpen = action !== null;
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const setInfoSnackCustom = useSetAtom(infoSnackGlobalAtom);
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const [memberGroups] = useAtom(memberGroupsAtom);

  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);

  const myGroupsPrivate = useMemo(() => {
    return filterPrivateGroups(memberGroups, groupsProperties);
  }, [memberGroups, groupsProperties]);

  const [privateAppValues, setPrivateAppValues] = useState({
    name: '',
    service: 'DOCUMENT',
    identifier: '',
    groupId: 0,
  });

  const [newPrivateAppValues, setNewPrivateAppValues] = useState({
    service: 'DOCUMENT',
    identifier: '',
    name: '',
  });

  const mySortedNames = useSortedMyNames(names, myName);

  const { getRootProps, getInputProps } = useDropzone({
    accept: {
      'application/zip': ['.zip'], // Only accept zip files
    },
    maxSize: maxFileSize,
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

  const addPrivateApp = async () => {
    try {
      if (privateAppValues?.groupId === 0) return;
      const opened = await openApp(privateAppValues, true, undefined);
      if (opened) closeDialog();
    } catch (error) {
      console.error(error);
    }
  };

  const clearFields = () => {
    setPrivateAppValues({
      name: '',
      service: 'DOCUMENT',
      identifier: '',
      groupId: 0,
    });
    setNewPrivateAppValues({
      service: 'DOCUMENT',
      identifier: '',
      name: '',
    });
    setFile(null);
    setSelectedGroup(0);
    setLogo(null);
  };

  const closeDialog = () => {
    clearFields();
    onClose();
  };

  const publishPrivateApp = async () => {
    try {
      if (selectedGroup === 0) {
        setOpenSnackGlobal(true);
        setInfoSnackCustom({
          type: 'error',
          message: t('group:message.generic.no_selection', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        return;
      }

      if (!name || name === 0) {
        setOpenSnackGlobal(true);
        setInfoSnackCustom({
          type: 'error',
          message: t('core:action.select_name_app', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        return;
      }

      if (!file) {
        setOpenSnackGlobal(true);
        setInfoSnackCustom({
          type: 'error',
          message: t('core:message.generic.select_zip', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        return;
      }

      if (!logo)
        throw new Error(
          t('core:message.generic.select_image', {
            postProcess: 'capitalizeFirstChar',
          })
        );

      if (!myName)
        throw new Error(
          t('core:message.generic.name_publish', {
            postProcess: 'capitalizeFirstChar',
          })
        );

      if (!newPrivateAppValues?.name)
        throw new Error(
          t('core:message.error.app_need_name', {
            postProcess: 'capitalizeFirstChar',
          })
        );

      const base64Logo = await fileToBase64(logo);
      const base64App = await fileToBase64(file);
      const objectToSave = {
        app: base64App,
        logo: base64Logo,
        name: newPrivateAppValues.name,
      };
      const object64 = await objectToBase64(objectToSave);
      const decryptedData = await window.sendMessage(
        'ENCRYPT_QORTAL_GROUP_DATA',
        {
          base64: object64,
          groupId: selectedGroup,
        }
      );

      if (decryptedData?.error) {
        throw new Error(
          decryptedData?.error ||
            t('core:message.error.encrypt_app', {
              postProcess: 'capitalizeFirstChar',
            })
        );
      }

      const fee = await getFee('ARBITRARY');

      await show({
        message: t('core:message.question.publish_app', {
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });

      await new Promise((res, rej) => {
        window
          .sendMessage('publishOnQDN', {
            data: decryptedData,
            identifier: newPrivateAppValues?.identifier,
            service: newPrivateAppValues?.service,
            uploadType: 'base64',
            name,
            description: buildPrivateAppDescription(selectedGroup),
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

      openApp(
        {
          identifier: newPrivateAppValues?.identifier,
          service: newPrivateAppValues?.service,
          name,
          groupId: selectedGroup,
        },
        true
      );
      closeDialog();
      onPublished?.();
    } catch (error) {
      setOpenSnackGlobal(true);
      setInfoSnackCustom({
        type: 'error',
        message:
          error?.message ||
          t('core:message.error.publish_app', {
            postProcess: 'capitalizeFirstChar',
          }),
      });
    }
  };

  const getNames = useCallback(async () => {
    if (!myAddress) return;
    try {
      const res = await fetch(
        `${getBaseApiReact()}/names/address/${myAddress}?limit=0`
      );
      const data = await res.json();
      setNames(data?.map((item) => item.name));
    } catch (error) {
      console.error(error);
    }
  }, [myAddress]);
  useEffect(() => {
    if (isOpen) {
      getNames();
    }
  }, [getNames, isOpen]);

  return (
    <>
      {isOpen && (
        <Dialog
          open={isOpen}
          onClose={closeDialog}
          aria-labelledby="private-app-dialog-title"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (action === 'access') {
                if (
                  !privateAppValues.name ||
                  !privateAppValues.service ||
                  !privateAppValues.identifier ||
                  !privateAppValues?.groupId
                )
                  return;
                addPrivateApp();
              }
            }
          }}
          maxWidth="md"
          fullWidth={true}
          slotProps={{
            paper: {
              style: {
                backgroundColor: theme.palette.background.paper,
                boxShadow: 'none',
              },
            },
          }}
        >
          <DialogTitle id="private-app-dialog-title">
            {action === 'access'
              ? t('core:action.access_app', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('core:action.publish_app', {
                  postProcess: 'capitalizeFirstChar',
                })}
          </DialogTitle>

          {action === 'access' && (
            <>
              <DialogContent>
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '5px',
                  }}
                >
                  <Label>
                    {t('group:action.select_group', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Label>

                  <Label>
                    {t('group:message.generic.only_private_groups', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Label>

                  <Select
                    labelId="demo-simple-select-label"
                    id="demo-simple-select"
                    value={privateAppValues?.groupId}
                    label={t('group:group.group_other', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    onChange={(e) => {
                      setPrivateAppValues((prev) => {
                        return {
                          ...prev,
                          groupId: e.target.value,
                        };
                      });
                    }}
                  >
                    <MenuItem value={0}>
                      {t('group:message.generic.no_selection', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </MenuItem>

                    {myGroupsPrivate?.map((group) => {
                      return (
                        <MenuItem key={group?.groupId} value={group?.groupId}>
                          {group?.groupName}
                        </MenuItem>
                      );
                    })}
                  </Select>
                </Box>

                <Spacer height="10px" />

                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '5px',
                    marginTop: '15px',
                  }}
                >
                  <Label>
                    {t('core:name', { postProcess: 'capitalizeFirstChar' })}
                  </Label>

                  <Input
                    placeholder={t('core:name', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    value={privateAppValues?.name}
                    onChange={(e) =>
                      setPrivateAppValues((prev) => {
                        return {
                          ...prev,
                          name: e.target.value,
                        };
                      })
                    }
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
                    {t('core:identifier', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Label>

                  <Input
                    placeholder={t('core:identifier', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    value={privateAppValues?.identifier}
                    onChange={(e) =>
                      setPrivateAppValues((prev) => {
                        return {
                          ...prev,
                          identifier: e.target.value,
                        };
                      })
                    }
                  />
                </Box>
              </DialogContent>

              <DialogActions>
                <Button variant="contained" onClick={closeDialog}>
                  {t('core:action.close', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>

                <Button
                  disabled={
                    !privateAppValues.name ||
                    !privateAppValues.service ||
                    !privateAppValues.identifier ||
                    !privateAppValues?.groupId
                  }
                  variant="contained"
                  onClick={() => addPrivateApp()}
                  autoFocus
                >
                  {t('core:action.access', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
              </DialogActions>
            </>
          )}

          {action === 'publish' && (
            <>
              <DialogContent>
                <PublishQAppInfo
                  sx={{
                    backgroundColor: theme.palette.background.paper,
                    fontSize: '14px',
                  }}
                >
                  {t('core:message.generic.select_zip', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </PublishQAppInfo>

                <Spacer height="10px" />

                <PublishQAppInfo
                  sx={{
                    backgroundColor: theme.palette.background.paper,
                    fontSize: '14px',
                  }}
                >
                  {t('core:private_apps.max_file_size', {
                    size: maxFileSize / (1024 * 1024),
                    postProcess: 'capitalizeFirstChar',
                  })}
                </PublishQAppInfo>
                {file && (
                  <>
                    <Spacer height="5px" />

                    <PublishQAppInfo>
                      {t('core:private_apps.selected_file', {
                        filename: file?.name,
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </PublishQAppInfo>
                  </>
                )}

                <Spacer height="18px" />

                <PublishQAppChoseFile
                  sx={{
                    backgroundColor: theme.palette.background.default,
                    fontSize: '14px',
                  }}
                  {...getRootProps()}
                >
                  {' '}
                  <input {...getInputProps()} />
                  {file
                    ? t('core:action.change_file', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    : t('core:action.choose_file', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                </PublishQAppChoseFile>
                <Spacer height="20px" />

                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '5px',
                  }}
                >
                  <Label>
                    {t('core:private_apps.select_name', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Label>

                  <Select
                    labelId="demo-simple-select-label"
                    id="demo-simple-select"
                    value={name}
                    label={t('core:private_apps.select_name', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    onChange={(e) => setName(e.target.value)}
                  >
                    <MenuItem value={0}>
                      {t('core:private_apps.no_name_selected', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </MenuItem>
                    {mySortedNames.map((name) => {
                      return (
                        <MenuItem key={name} value={name}>
                          {name}
                        </MenuItem>
                      );
                    })}
                  </Select>
                </Box>
                <Spacer height="20px" />

                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '5px',
                  }}
                >
                  <Label>
                    {t('group:action.select_group', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Label>

                  <Label>
                    {t('group:message.generic.admin_only', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Label>

                  <Select
                    labelId="demo-simple-select-label"
                    id="demo-simple-select"
                    value={selectedGroup}
                    label={t('group:group.groups_admin', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    onChange={(e) => setSelectedGroup(e.target.value)}
                  >
                    <MenuItem value={0}>
                      {t('group:message.generic.no_selection', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </MenuItem>

                    {myGroupsWhereIAmAdmin?.map((group) => {
                      return (
                        <MenuItem key={group?.groupId} value={group?.groupId}>
                          {group?.groupName}
                        </MenuItem>
                      );
                    })}
                  </Select>
                </Box>

                <Spacer height="20px" />

                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '5px',
                    marginTop: '15px',
                  }}
                >
                  <Label>
                    {t('core:identifier', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Label>

                  <Input
                    placeholder={t('core:identifier', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    value={newPrivateAppValues?.identifier}
                    onChange={(e) =>
                      setNewPrivateAppValues((prev) => {
                        return {
                          ...prev,
                          identifier: e.target.value,
                        };
                      })
                    }
                  />
                </Box>

                <Spacer height="10px" />

                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '5px',
                    marginTop: '15px',
                  }}
                >
                  <Label>
                    {t('core:app_name', { postProcess: 'capitalizeFirstChar' })}
                  </Label>

                  <Input
                    placeholder={t('core:app_name', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    value={newPrivateAppValues?.name}
                    onChange={(e) =>
                      setNewPrivateAppValues((prev) => {
                        return {
                          ...prev,
                          name: e.target.value,
                        };
                      })
                    }
                  />
                </Box>

                <Spacer height="10px" />

                <ImageUploader onPick={(file) => setLogo(file)}>
                  <Button variant="contained">
                    {t('core:action.choose_logo', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Button>
                </ImageUploader>

                {logo?.name}

                <Spacer height="25px" />
              </DialogContent>

              <DialogActions>
                <Button variant="contained" onClick={closeDialog}>
                  {t('core:action.close', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>

                <Button
                  disabled={
                    !name ||
                    name === 0 ||
                    !file ||
                    !logo ||
                    !newPrivateAppValues.name ||
                    !newPrivateAppValues.service ||
                    !newPrivateAppValues.identifier ||
                    !selectedGroup
                  }
                  variant="contained"
                  onClick={() => publishPrivateApp()}
                  autoFocus
                >
                  {t('core:action.publish', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
              </DialogActions>
            </>
          )}
        </Dialog>
      )}
    </>
  );
};
