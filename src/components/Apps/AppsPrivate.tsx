import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Input,
  MenuItem,
  Select,
  Typography,
  useTheme,
} from '@mui/material';
import { useHandlePrivateApps } from '../../hooks/useHandlePrivateApps';
import { Spacer } from '../../common/Spacer';
import { PublishQAppInfo } from './Apps-styles';
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
import {
  GroupAdminStatus,
  PrivateAppTarget,
  checkGroupAdmin,
  loadPrivateAppCurrentVersion,
} from './privateAppUpdate';
import {
  PublishProfile,
  loadPublishProfile,
  logoHash,
  profileChangedSince,
  publishProfileKey,
  publishSignature,
  savePublishProfile,
} from './publishProfiles';
import { PublishSource } from './publishSource';
import { PublishSourcePicker, formatPublishDate } from './PublishSourcePicker';

const maxFileSize = 50 * 1024 * 1024; // 50MB

export type PrivateAppAction = 'access' | 'publish' | 'update';

type CurrentVersionState = 'idle' | 'loading' | 'loaded' | 'failed';

/** Dialog for one private-app action; `action === null` keeps it closed. */
export const AppsPrivate = ({
  myName,
  myAddress,
  action,
  updateTarget = null,
  onClose,
  onPublished,
}: {
  myName: string;
  myAddress: string;
  action: PrivateAppAction | null;
  /** The published private app an 'update' opens. */
  updateTarget?: PrivateAppTarget | null;
  onClose: () => void;
  onPublished?: () => void;
}) => {
  const [names, setNames] = useState([]);
  const [name, setName] = useState<string | number>(0);

  const { openApp } = useHandlePrivateApps();
  const [source, setSource] = useState<PublishSource | null>(null);
  const [logo, setLogo] = useState(null);
  const [qortalUrl, setQortalUrl] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(0);
  // Update: the published version's logo, this PC's profile, the admin check.
  const [currentLogo, setCurrentLogo] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] =
    useState<CurrentVersionState>('idle');
  const [adminStatus, setAdminStatus] = useState<GroupAdminStatus>('checking');
  const [profile, setProfile] = useState<PublishProfile | null>(null);
  const appNameEditedRef = useRef(false);
  const isUpdate = action === 'update' && !!updateTarget;

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
  const { t, i18n } = useTranslation(['auth', 'core', 'group', 'question']);

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

  const showError = (message: string) => {
    setOpenSnackGlobal(true);
    setInfoSnackCustom({ type: 'error', message });
  };

  const updateGroupName = useMemo(() => {
    if (!updateTarget) return '';
    const groupId = Number(updateTarget.groupId);
    const group = [
      ...(myGroupsWhereIAmAdminFromGlobal ?? []),
      ...(memberGroups ?? []),
    ].find((item) => Number(item?.groupId) === groupId);
    return (
      group?.groupName ||
      t('core:private_apps.group_id', { groupId: updateTarget.groupId })
    );
  }, [updateTarget, myGroupsWhereIAmAdminFromGlobal, memberGroups, t]);

  // Update: the resource and group are fixed. The app name and logo come from
  // the published version (or this PC's profile if it can't be decrypted).
  useEffect(() => {
    if (!isUpdate) return;
    const target = updateTarget;
    let active = true;
    appNameEditedRef.current = false;
    setName(target.name);
    setSelectedGroup(target.groupId);
    setNewPrivateAppValues({
      service: target.service,
      identifier: target.identifier,
      name: '',
    });
    setCurrentVersion('loading');
    setAdminStatus('checking');

    const fillAppName = (appName: string) => {
      if (appName && !appNameEditedRef.current) {
        setNewPrivateAppValues((prev) => ({ ...prev, name: appName }));
      }
    };

    checkGroupAdmin(target.groupId, myAddress, {
      knownAdminGroupIds: (myGroupsWhereIAmAdminFromGlobal ?? []).map(
        (group) => group?.groupId
      ),
    }).then((status) => {
      if (active) setAdminStatus(status);
    });

    (async () => {
      const saved = await loadPublishProfile(
        publishProfileKey(
          myAddress,
          target.service,
          target.name,
          target.identifier
        )
      );
      if (!active) return;
      setProfile(saved);
      try {
        const current = await loadPrivateAppCurrentVersion(
          getBaseApiReact(),
          target
        );
        if (!active) return;
        if (current) {
          fillAppName(current.appName || saved?.privateApp?.appName);
          setCurrentLogo(current.logo);
          setCurrentVersion('loaded');
          return;
        }
      } catch (error) {
        console.error(error);
        if (!active) return;
      }
      fillAppName(saved?.privateApp?.appName);
      setCurrentVersion('failed');
    })();

    return () => {
      active = false;
    };
  }, [isUpdate, updateTarget, myAddress]);

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
    setSource(null);
    setSelectedGroup(0);
    setLogo(null);
    setCurrentLogo(null);
    setCurrentVersion('idle');
    setAdminStatus('checking');
    setProfile(null);
    appNameEditedRef.current = false;
  };

  const closeDialog = () => {
    clearFields();
    onClose();
  };

  const publishPrivateApp = async () => {
    try {
      // An update needs the group's admin rights, checked when it opened.
      if (isUpdate && adminStatus !== 'admin') return;

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

      if (!source) {
        setOpenSnackGlobal(true);
        setInfoSnackCustom({
          type: 'error',
          message: t('core:message.generic.select_zip', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        return;
      }

      if (!logo && !currentLogo)
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

      // An update keeps the published logo unless a new one was chosen.
      const base64Logo = logo ? await fileToBase64(logo) : currentLogo;
      const base64App = await fileToBase64(source.file);
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

      const response = await new Promise((res, rej) => {
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

      // Remembered on this PC for the next update: never the app or its logo.
      const signature = publishSignature(response);
      void savePublishProfile(
        publishProfileKey(
          myAddress,
          newPrivateAppValues?.service,
          typeof name === 'string' ? name : null,
          newPrivateAppValues?.identifier
        ),
        {
          publishedAt: Date.now(),
          ...(source.path
            ? {
                source: {
                  path: source.path,
                  kind: source.kind,
                  takenAt: source.takenAt,
                },
              }
            : {}),
          privateApp: {
            groupId: Number(selectedGroup),
            appName: newPrivateAppValues.name,
            logoHash: logoHash(base64Logo),
          },
          ...(signature ? { signature } : {}),
        }
      );

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

  const changedSince = profileChangedSince(profile);

  const sourceSection = (
    <>
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

      <Spacer height="18px" />

      <PublishSourcePicker
        changedSince={changedSince}
        maxSize={maxFileSize}
        onChange={setSource}
        onError={showError}
        savedSource={profile?.source}
        source={source}
        surface="dialog"
      />
    </>
  );

  const adminMessage = {
    checking: {
      color: theme.palette.text.secondary,
      text: t('core:publish_update.checking_admin', {
        group: updateGroupName,
        postProcess: 'capitalizeFirstChar',
      }),
    },
    admin: {
      color: theme.palette.text.secondary,
      text: t('core:publish_update.is_admin', {
        group: updateGroupName,
        postProcess: 'capitalizeFirstChar',
      }),
    },
    not_admin: {
      color: theme.palette.error.main,
      text: t('core:publish_update.not_admin', {
        group: updateGroupName,
        postProcess: 'capitalizeFirstChar',
      }),
    },
    unknown: {
      color: theme.palette.warning.main,
      text: t('core:publish_update.admin_unknown', {
        group: updateGroupName,
        postProcess: 'capitalizeFirstChar',
      }),
    },
  }[adminStatus];

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
              : isUpdate
                ? t('core:publish_update.title', {
                    name: updateTarget.identifier,
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
                {sourceSection}
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
                    !source ||
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

          {isUpdate && (
            <>
              <DialogContent>
                <Typography
                  role="status"
                  sx={{ color: adminMessage.color, fontSize: '14px' }}
                >
                  {adminMessage.text}
                </Typography>

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
                    disabled
                    inputProps={{
                      'aria-label': t('core:name', {
                        postProcess: 'capitalizeFirstChar',
                      }),
                    }}
                    value={updateTarget.name}
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
                    disabled
                    inputProps={{
                      'aria-label': t('core:identifier', {
                        postProcess: 'capitalizeFirstChar',
                      }),
                    }}
                    value={updateTarget.identifier}
                  />
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '13px',
                    }}
                  >
                    {t('core:publish_update.identifier_locked', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
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
                    {t('group:group.group', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Label>
                  <Input
                    disabled
                    inputProps={{
                      'aria-label': t('group:group.group', {
                        postProcess: 'capitalizeFirstChar',
                      }),
                    }}
                    value={updateGroupName}
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
                    {t('core:app_name', { postProcess: 'capitalizeFirstChar' })}
                  </Label>
                  <Input
                    inputProps={{
                      'aria-label': t('core:app_name', {
                        postProcess: 'capitalizeFirstChar',
                      }),
                    }}
                    onChange={(e) => {
                      appNameEditedRef.current = true;
                      setNewPrivateAppValues((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }));
                    }}
                    placeholder={t('core:app_name', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    value={newPrivateAppValues?.name}
                  />
                </Box>

                {currentVersion === 'loading' && (
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: '8px',
                      marginTop: '10px',
                    }}
                  >
                    <CircularProgress size={16} />
                    <Typography sx={{ fontSize: '14px' }}>
                      {t('core:publish_update.loading_current', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                  </Box>
                )}

                {currentVersion === 'failed' && (
                  <Typography
                    sx={{
                      color: theme.palette.warning.main,
                      fontSize: '14px',
                      marginTop: '10px',
                    }}
                  >
                    {t('core:publish_update.current_unavailable', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                )}

                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '10px',
                    marginTop: '15px',
                  }}
                >
                  {!logo && currentLogo && (
                    <Avatar
                      alt={newPrivateAppValues?.name}
                      src={`data:image/png;base64,${currentLogo}`}
                      variant="rounded"
                    />
                  )}
                  <ImageUploader onPick={(file) => setLogo(file)}>
                    <Button variant="contained">
                      {t('core:action.choose_logo', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Button>
                  </ImageUploader>
                  <Typography sx={{ fontSize: '14px' }}>
                    {logo
                      ? logo.name
                      : currentLogo
                        ? t('core:publish_update.logo_kept', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : null}
                  </Typography>
                </Box>

                <Spacer height="20px" />

                {sourceSection}

                {profile?.publishedAt ? (
                  <Typography
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '13px',
                      marginTop: '15px',
                    }}
                  >
                    {t('core:publish_update.last_published', {
                      date: formatPublishDate(
                        profile.publishedAt,
                        i18n?.language
                      ),
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                ) : null}

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
                    adminStatus !== 'admin' ||
                    currentVersion === 'loading' ||
                    !source ||
                    (!logo && !currentLogo) ||
                    !newPrivateAppValues.name
                  }
                  variant="contained"
                  onClick={() => publishPrivateApp()}
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
