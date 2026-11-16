import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  alpha,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  MenuItem,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import { useHandlePrivateApps } from '../../hooks/useHandlePrivateApps';
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
import { FormSection } from './PublishFormParts';
import { NameAvatar } from './AppPage/AppPageParts';

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
  isShown = true,
}: {
  myName: string;
  myAddress: string;
  action: PrivateAppAction | null;
  /** The published private app an 'update' opens. */
  updateTarget?: PrivateAppTarget | null;
  onClose: () => void;
  onPublished?: () => void;
  /**
   * False while the launcher tab it is in is hidden: the dialog is put away,
   * and comes back as it was when the tab shows again.
   */
  isShown?: boolean;
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
  const capital = { postProcess: 'capitalizeFirstChar' };

  // The fee, shown before publishing as in the main publish form.
  const [unitFee, setUnitFee] = useState<number | null>(null);
  useEffect(() => {
    if (!isOpen || action === 'access') return;
    let alive = true;
    Promise.resolve(getFee('ARBITRARY'))
      .then((fee) => {
        const value = Number(fee?.fee);
        if (alive && Number.isFinite(value)) setUnitFee(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isOpen, action]);

  const logoPreview = useMemo(
    () =>
      logo && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(logo)
        : null,
    [logo]
  );
  useEffect(
    () => () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    },
    [logoPreview]
  );

  const fieldSx = { '& .MuiOutlinedInput-root': { borderRadius: '12px' } };

  const sourceSection = (
    <FormSection
      hint={t('core:private_apps.max_file_size', {
        size: maxFileSize / (1024 * 1024),
        ...capital,
      })}
      number={2}
      title={t('core:publish_form.section_files', capital)}
    >
      <PublishSourcePicker
        changedSince={changedSince}
        maxSize={maxFileSize}
        onChange={setSource}
        onError={showError}
        savedSource={profile?.source}
        source={source}
        surface="dialog"
      />
      {isUpdate && profile?.publishedAt ? (
        <Typography
          sx={{
            color: theme.palette.text.secondary,
            fontSize: '13px',
            mt: 1.5,
          }}
        >
          {t('core:publish_update.last_published', {
            date: formatPublishDate(profile.publishedAt, i18n?.language),
            ...capital,
          })}
        </Typography>
      ) : null}
    </FormSection>
  );

  const logoBlock = (
    <Box
      sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 1.5 }}
    >
      <Avatar
        alt={newPrivateAppValues?.name}
        src={
          logoPreview ||
          (currentLogo ? `data:image/png;base64,${currentLogo}` : undefined)
        }
        sx={{
          bgcolor: alpha(theme.palette.primary.main, 0.15),
          borderRadius: '16px',
          color:
            theme.palette.mode === 'dark'
              ? theme.palette.primary.light
              : theme.palette.primary.dark,
          height: 56,
          width: 56,
        }}
        variant="rounded"
      >
        <ImageRoundedIcon />
      </Avatar>
      <ImageUploader onPick={(file) => setLogo(file)}>
        <Button
          startIcon={<AddPhotoAlternateRoundedIcon />}
          sx={{ borderRadius: '12px', fontWeight: 600, textTransform: 'none' }}
          variant="outlined"
        >
          {t('core:action.choose_logo', capital)}
        </Button>
      </ImageUploader>
      <Typography sx={{ color: 'text.secondary', fontSize: '13px' }}>
        {logo
          ? logo.name
          : currentLogo
            ? t('core:publish_update.logo_kept', capital)
            : t('core:private_publish.logo_hint', capital)}
      </Typography>
    </Box>
  );

  // The colour is in the frame and the icon; the text stays text.primary,
  // so it's readable on the light theme's darker dialog paper too.
  const statusIconSx = { flexShrink: 0, fontSize: 20, mt: '1px' };
  const adminMessage = {
    checking: {
      color: theme.palette.text.secondary,
      icon: <CircularProgress size={16} sx={{ flexShrink: 0, mt: '2px' }} />,
      text: t('core:publish_update.checking_admin', {
        group: updateGroupName,
        ...capital,
      }),
    },
    admin: {
      color: theme.palette.success.main,
      icon: <CheckCircleRoundedIcon color="success" sx={statusIconSx} />,
      text: t('core:publish_update.is_admin', {
        group: updateGroupName,
        ...capital,
      }),
    },
    not_admin: {
      color: theme.palette.error.main,
      icon: <ErrorOutlineRoundedIcon color="error" sx={statusIconSx} />,
      text: t('core:publish_update.not_admin', {
        group: updateGroupName,
        ...capital,
      }),
    },
    unknown: {
      color: theme.palette.warning.main,
      icon: <WarningAmberRoundedIcon color="warning" sx={statusIconSx} />,
      text: t('core:publish_update.admin_unknown', {
        group: updateGroupName,
        ...capital,
      }),
    },
  }[adminStatus];

  const title =
    action === 'access'
      ? t('core:action.access_app', capital)
      : isUpdate
        ? t('core:publish_update.title', {
            name: updateTarget.identifier,
            ...capital,
          })
        : t('core:action.publish_app', capital);
  const intro =
    action === 'access'
      ? t('core:private_publish.intro_access', capital)
      : isUpdate
        ? t('core:private_publish.intro_update', capital)
        : t('core:private_publish.intro_publish', capital);

  const accessDisabled =
    !privateAppValues.name ||
    !privateAppValues.service ||
    !privateAppValues.identifier ||
    !privateAppValues?.groupId;
  const publishDisabled = isUpdate
    ? adminStatus !== 'admin' ||
      currentVersion === 'loading' ||
      !source ||
      (!logo && !currentLogo) ||
      !newPrivateAppValues.name
    : !name ||
      name === 0 ||
      !source ||
      !logo ||
      !newPrivateAppValues.name ||
      !newPrivateAppValues.service ||
      !newPrivateAppValues.identifier ||
      !selectedGroup;

  return (
    <>
      {isOpen && (
        <Dialog
          aria-labelledby="private-app-dialog-title"
          fullWidth={true}
          maxWidth="md"
          onClose={closeDialog}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && action === 'access') {
              if (accessDisabled) return;
              addPrivateApp();
            }
          }}
          open={isOpen && isShown}
          slotProps={{
            paper: {
              sx: {
                backgroundColor: theme.palette.background.default,
                backgroundImage: 'none',
                borderRadius: '20px',
                boxShadow: 'none',
              },
            },
          }}
        >
          <Box
            sx={{
              alignItems: 'flex-start',
              background: `linear-gradient(160deg, ${alpha(theme.palette.primary.main, 0.14)}, transparent 70%)`,
              display: 'flex',
              gap: 1.75,
              pb: 1.5,
              pt: 3,
              px: 3,
            }}
          >
            <Box
              aria-hidden
              sx={{
                alignItems: 'center',
                backgroundColor: alpha(theme.palette.primary.main, 0.18),
                borderRadius: '14px',
                color:
                  theme.palette.mode === 'dark'
                    ? theme.palette.primary.light
                    : theme.palette.primary.dark,
                display: 'flex',
                flexShrink: 0,
                height: 44,
                justifyContent: 'center',
                width: 44,
              }}
            >
              <LockRoundedIcon />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                component="h2"
                id="private-app-dialog-title"
                sx={{
                  fontSize: '22px',
                  fontWeight: 750,
                  letterSpacing: '-0.01em',
                }}
              >
                {title}
              </Typography>
              <Typography sx={{ color: 'text.secondary', fontSize: '13.5px' }}>
                {intro}
              </Typography>
            </Box>
            <IconButton
              aria-label={t('core:action.close', capital)}
              onClick={closeDialog}
            >
              <CloseRoundedIcon />
            </IconButton>
          </Box>

          <DialogContent sx={{ pt: 1.5 }}>
            {action === 'access' && (
              <FormSection
                hint={t('group:message.generic.only_private_groups', capital)}
                title={t('core:private_publish.section_find', capital)}
              >
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField
                    label={t('group:action.select_group', capital)}
                    onChange={(e) =>
                      setPrivateAppValues((prev) => ({
                        ...prev,
                        groupId: Number(e.target.value),
                      }))
                    }
                    select
                    sx={fieldSx}
                    value={privateAppValues?.groupId}
                  >
                    <MenuItem value={0}>
                      {t('group:message.generic.no_selection', capital)}
                    </MenuItem>
                    {myGroupsPrivate?.map((group) => (
                      <MenuItem key={group?.groupId} value={group?.groupId}>
                        {group?.groupName}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label={t('core:name', capital)}
                    onChange={(e) =>
                      setPrivateAppValues((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                    sx={fieldSx}
                    value={privateAppValues?.name}
                  />
                  <TextField
                    label={t('core:identifier', capital)}
                    onChange={(e) =>
                      setPrivateAppValues((prev) => ({
                        ...prev,
                        identifier: e.target.value,
                      }))
                    }
                    sx={fieldSx}
                    value={privateAppValues?.identifier}
                  />
                </Box>
              </FormSection>
            )}

            {action === 'publish' && (
              <>
                <FormSection
                  hint={t('group:message.generic.admin_only', capital)}
                  number={1}
                  title={t('core:private_publish.section_name_group', capital)}
                >
                  <Box
                    sx={{
                      display: 'grid',
                      gap: 2,
                      gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    }}
                  >
                    <TextField
                      label={t('core:private_apps.select_name', capital)}
                      onChange={(e) => setName(e.target.value)}
                      select
                      sx={fieldSx}
                      value={name}
                    >
                      <MenuItem value={0}>
                        {t('core:private_apps.no_name_selected', capital)}
                      </MenuItem>
                      {mySortedNames.map((item) => (
                        <MenuItem key={item} value={item}>
                          <Box
                            component="span"
                            sx={{
                              alignItems: 'center',
                              display: 'flex',
                              gap: 1,
                            }}
                          >
                            <NameAvatar decorative name={item} size={24} />
                            {item}
                          </Box>
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      label={t('group:action.select_group', capital)}
                      onChange={(e) => setSelectedGroup(Number(e.target.value))}
                      select
                      sx={fieldSx}
                      value={selectedGroup}
                    >
                      <MenuItem value={0}>
                        {t('group:message.generic.no_selection', capital)}
                      </MenuItem>
                      {myGroupsWhereIAmAdmin?.map((group) => (
                        <MenuItem key={group?.groupId} value={group?.groupId}>
                          {group?.groupName}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>
                </FormSection>

                {sourceSection}

                <FormSection
                  number={3}
                  title={t('core:private_publish.section_details', capital)}
                >
                  <Box
                    sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                  >
                    <TextField
                      label={t('core:app_name', capital)}
                      onChange={(e) =>
                        setNewPrivateAppValues((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      sx={fieldSx}
                      value={newPrivateAppValues?.name}
                    />
                    <TextField
                      helperText={t(
                        'core:private_publish.identifier_hint',
                        capital
                      )}
                      label={t('core:identifier', capital)}
                      onChange={(e) =>
                        setNewPrivateAppValues((prev) => ({
                          ...prev,
                          identifier: e.target.value,
                        }))
                      }
                      sx={fieldSx}
                      value={newPrivateAppValues?.identifier}
                    />
                    {logoBlock}
                  </Box>
                </FormSection>
              </>
            )}

            {isUpdate && (
              <>
                <Box
                  sx={{
                    alignItems: 'flex-start',
                    backgroundColor: alpha(adminMessage.color, 0.1),
                    border: `1px solid ${alpha(adminMessage.color, 0.35)}`,
                    borderRadius: '12px',
                    display: 'flex',
                    gap: 1.25,
                    mb: 2,
                    px: 2,
                    py: 1.25,
                  }}
                >
                  {adminMessage.icon}
                  <Typography
                    role="status"
                    sx={{ color: 'text.primary', fontSize: '14px' }}
                  >
                    {adminMessage.text}
                  </Typography>
                </Box>

                <FormSection
                  hint={t('core:publish_update.identifier_locked', capital)}
                  number={1}
                  title={t('core:private_publish.section_app', capital)}
                >
                  <Box
                    sx={{
                      display: 'grid',
                      gap: 2,
                      gridTemplateColumns: {
                        xs: '1fr',
                        sm: 'repeat(3, minmax(0, 1fr))',
                      },
                    }}
                  >
                    <TextField
                      disabled
                      label={t('core:name', capital)}
                      sx={fieldSx}
                      value={updateTarget.name}
                    />
                    <TextField
                      disabled
                      label={t('core:identifier', capital)}
                      sx={fieldSx}
                      value={updateTarget.identifier}
                    />
                    <TextField
                      disabled
                      label={t('group:group.group', capital)}
                      sx={fieldSx}
                      value={updateGroupName}
                    />
                  </Box>
                </FormSection>

                {sourceSection}

                <FormSection
                  number={3}
                  title={t('core:private_publish.section_details', capital)}
                >
                  <Box
                    sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                  >
                    <TextField
                      label={t('core:app_name', capital)}
                      onChange={(e) => {
                        appNameEditedRef.current = true;
                        setNewPrivateAppValues((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }));
                      }}
                      sx={fieldSx}
                      value={newPrivateAppValues?.name}
                    />
                    {currentVersion === 'loading' && (
                      <Box
                        sx={{ alignItems: 'center', display: 'flex', gap: 1 }}
                      >
                        <CircularProgress size={16} />
                        <Typography sx={{ fontSize: '14px' }}>
                          {t('core:publish_update.loading_current', capital)}
                        </Typography>
                      </Box>
                    )}
                    {currentVersion === 'failed' && (
                      <Box
                        sx={{
                          alignItems: 'flex-start',
                          display: 'flex',
                          gap: 1,
                        }}
                      >
                        <WarningAmberRoundedIcon
                          color="warning"
                          sx={statusIconSx}
                        />
                        <Typography
                          sx={{ color: 'text.primary', fontSize: '14px' }}
                        >
                          {t(
                            'core:publish_update.current_unavailable',
                            capital
                          )}
                        </Typography>
                      </Box>
                    )}
                    {logoBlock}
                  </Box>
                </FormSection>
              </>
            )}
          </DialogContent>

          <DialogActions
            // Wraps on a phone: the fee above, Close and Publish below.
            disableSpacing
            sx={{
              borderTop: `1px solid ${theme.palette.divider}`,
              columnGap: 1,
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              px: 3,
              py: 1.5,
              rowGap: 1,
            }}
          >
            <Box sx={{ alignItems: 'baseline', display: 'flex', gap: 1 }}>
              {action !== 'access' && unitFee !== null && (
                <>
                  <Typography
                    sx={{ color: 'text.secondary', fontSize: '13px' }}
                  >
                    {t('core:publish_form.summary_fee', capital)}
                  </Typography>
                  <Typography sx={{ fontSize: '14px', fontWeight: 700 }}>
                    {`${unitFee.toFixed(2)} QORT`}
                  </Typography>
                </>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
              <Button onClick={closeDialog} sx={{ textTransform: 'none' }}>
                {t('core:action.close', capital)}
              </Button>
              {action === 'access' ? (
                <Button
                  autoFocus
                  disableElevation
                  disabled={accessDisabled}
                  onClick={() => addPrivateApp()}
                  startIcon={<LockOpenRoundedIcon />}
                  sx={{
                    borderRadius: '12px',
                    fontWeight: 700,
                    px: 3,
                    textTransform: 'none',
                  }}
                  variant="contained"
                >
                  {t('core:action.access', capital)}
                </Button>
              ) : (
                <Button
                  autoFocus={!isUpdate}
                  disableElevation
                  disabled={publishDisabled}
                  onClick={() => publishPrivateApp()}
                  startIcon={<CloudUploadRoundedIcon />}
                  sx={{
                    borderRadius: '12px',
                    fontWeight: 700,
                    px: 3,
                    textTransform: 'none',
                  }}
                  variant="contained"
                >
                  {t('core:action.publish', capital)}
                </Button>
              )}
            </Box>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
};
