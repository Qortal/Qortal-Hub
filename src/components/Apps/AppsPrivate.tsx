import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  Input,
  MenuItem,
  Select,
  Tab,
  Tabs,
  useTheme,
} from '@mui/material';
import { useDropzone } from 'react-dropzone';
import { useHandlePrivateApps } from '../../hooks/useHandlePrivateApps';
import {
  groupsPropertiesAtom,
  memberGroupsAtom,
  myGroupsWhereIAmAdminAtom,
} from '../../atoms/global';
import { Label } from '../Group/AddGroup';
import { Spacer } from '../../common/Spacer';
import {
  AppCircle,
  AppCircleContainer,
  AppCircleLabel,
  PublishQAppChoseFile,
  PublishQAppInfo,
} from './Apps-styles';
import AddIcon from '@mui/icons-material/Add';
import ImageUploader from '../../common/ImageUploader';
import { QORTAL_APP_CONTEXT } from '../../App';
import { fileToBase64 } from '../../utils/fileReading';
import { objectToBase64 } from '../../qdn/encryption/group-encryption';
import { getFee } from '../../background/background.ts';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useSortedMyNames } from '../../hooks/useSortedMyNames';

const maxFileSize = 50 * 1024 * 1024; // 50MB

export const AppsPrivate = ({ myName, myAddress }) => {
  const [names, setNames] = useState([]);
  const [name, setName] = useState(0);

  const { openApp } = useHandlePrivateApps();
  const [file, setFile] = useState(null);
  const [logo, setLogo] = useState(null);
  const [qortalUrl, setQortalUrl] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(0);

  const [valueTabPrivateApp, setValueTabPrivateApp] = useState(0);
  const [groupsProperties] = useAtom(groupsPropertiesAtom);
  const [myGroupsWhereIAmAdminFromGlobal] = useAtom(myGroupsWhereIAmAdminAtom);

  const myGroupsWhereIAmAdmin = useMemo(() => {
    return myGroupsWhereIAmAdminFromGlobal?.filter(
      (group) => groupsProperties[group?.groupId]?.isOpen === false
    );
  }, [myGroupsWhereIAmAdminFromGlobal, groupsProperties]);

  const [isOpenPrivateModal, setIsOpenPrivateModal] = useState(false);
  const { show, setInfoSnackCustom, setOpenSnackGlobal } =
    useContext(QORTAL_APP_CONTEXT);
  const [memberGroups] = useAtom(memberGroupsAtom);

  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const myGroupsPrivate = useMemo(() => {
    return memberGroups?.filter(
      (group) => groupsProperties[group?.groupId]?.isOpen === false
    );
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
      await openApp(privateAppValues, true);
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
    setValueTabPrivateApp(0);
    setSelectedGroup(0);
    setLogo(null);
  };

  const publishPrivateApp = async () => {
    try {
      if (selectedGroup === 0) return;

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
      clearFields();
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

  const handleChange = (event: React.SyntheticEvent, newValue: number) => {
    setValueTabPrivateApp(newValue);
  };

  function a11yProps(index: number) {
    return {
      id: `simple-tab-${index}`,
      'aria-controls': `simple-tabpanel-${index}`,
    };
  }

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
    getNames();
  }, [getNames]);

  return (
    <>
      <ButtonBase
        onClick={() => {
          setIsOpenPrivateModal(true);
        }}
        sx={{
          width: '80px',
        }}
      >
        <AppCircleContainer
          sx={{
            gap: '10px',
          }}
        >
          <AppCircle>
            <AddIcon />
          </AppCircle>

          <AppCircleLabel>Private</AppCircleLabel>
        </AppCircleContainer>
      </ButtonBase>

      {isOpenPrivateModal && (
        <Dialog
          open={isOpenPrivateModal}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (valueTabPrivateApp === 0) {
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
          PaperProps={{
            style: {
              backgroundColor: theme.palette.background.paper,
              boxShadow: 'none',
            },
          }}
        >
          <Box>
            <Tabs
              value={valueTabPrivateApp}
              onChange={handleChange}
              aria-label={t('core:basic_tabs_example', {
                postProcess: 'capitalizeFirstChar',
              })}
              variant={'fullWidth'}
              scrollButtons="auto"
              sx={{
                '& .MuiTabs-indicator': {
                  backgroundColor: theme.palette.background.default,
                },
              }}
            >
              <Tab
                label={t('core:action.access_app', {
                  postProcess: 'capitalizeFirstChar',
                })}
                {...a11yProps(0)}
                sx={{
                  '&.Mui-selected': {
                    color: theme.palette.text.primary,
                  },
                  fontSize: '1rem',
                }}
              />
              <Tab
                label={t('core:action.publish_app', {
                  postProcess: 'capitalizeFirstChar',
                })}
                {...a11yProps(1)}
                sx={{
                  '&.Mui-selected': {
                    color: theme.palette.text.primary,
                  },
                  fontSize: '1rem',
                }}
              />
            </Tabs>
          </Box>
          {valueTabPrivateApp === 0 && (
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

                    {myGroupsPrivate
                      ?.filter((item) => !item?.isOpen)
                      .map((group) => {
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
                <Button
                  variant="contained"
                  onClick={() => {
                    setIsOpenPrivateModal(false);
                  }}
                >
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
          {valueTabPrivateApp === 1 && (
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
                >{`
                       50mb MB max`}</PublishQAppInfo>
                {file && (
                  <>
                    <Spacer height="5px" />

                    <PublishQAppInfo>{`Selected: (${file?.name})`}</PublishQAppInfo>
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
                  <Label>Select a Qortal name</Label>

                  <Select
                    labelId="demo-simple-select-label"
                    id="demo-simple-select"
                    value={name}
                    label="Groups where you are an admin"
                    onChange={(e) => setName(e.target.value)}
                  >
                    <MenuItem value={0}>No name selected</MenuItem>
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
                    {t('group:amessage.generic.admin_only', {
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

                    {myGroupsWhereIAmAdmin
                      ?.filter((item) => !item?.isOpen)
                      .map((group) => {
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
                <Button
                  variant="contained"
                  onClick={() => {
                    setIsOpenPrivateModal(false);
                    clearFields();
                  }}
                >
                  {t('core:action.close', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>

                <Button
                  disabled={
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
