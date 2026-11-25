import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import {
  Avatar,
  Box,
  ButtonBase,
  Collapse,
  FormControl,
  MenuItem,
  Select,
  SelectChangeEvent,
  TextField,
  Tooltip,
} from '@mui/material';
import { LoadingButton } from '@mui/lab';
import { useTheme } from '@mui/material/styles';
import { UserListOfInvites } from './UserListOfInvites';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { getFee } from '../../background/background.ts';
import {
  getArbitraryEndpointReact,
  getBaseApiReact,
  QORTAL_APP_CONTEXT,
} from '../../App';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import { txListAtom } from '../../atoms/global';
import ImageUploader from '../../common/ImageUploader';
import { fileToBase64 } from '../../utils/fileReading';
import { MAX_SIZE_AVATAR } from '../../constants/constants.ts';
import { AvatarPreviewModal } from '../Chat/AvatarPreviewModal';
import { getClickableAvatarSx } from '../Chat/clickableAvatarStyles';

const RETICULUM_ACTIVE_BLUE = '#2563eb';
const GROUP_DESCRIPTION_MAX_LENGTH = 300;

/** Block-delay choices; `unit`/`count` feed the pluralised core:time.* keys. */
type BlockDelayOption = {
  count: number;
  unit: 'minute' | 'hour' | 'day';
  value: string;
};

const MIN_BLOCK_DELAY_OPTIONS: BlockDelayOption[] = [
  { value: '5', unit: 'minute', count: 5 },
  { value: '10', unit: 'minute', count: 10 },
  { value: '30', unit: 'minute', count: 30 },
  { value: '60', unit: 'hour', count: 1 },
  { value: '180', unit: 'hour', count: 3 },
  { value: '300', unit: 'hour', count: 5 },
  { value: '420', unit: 'hour', count: 7 },
  { value: '720', unit: 'hour', count: 12 },
  { value: '1440', unit: 'day', count: 1 },
  { value: '4320', unit: 'day', count: 3 },
  { value: '7200', unit: 'day', count: 5 },
  { value: '10080', unit: 'day', count: 7 },
];

const MAX_BLOCK_DELAY_OPTIONS: BlockDelayOption[] = [
  { value: '60', unit: 'hour', count: 1 },
  { value: '180', unit: 'hour', count: 3 },
  { value: '300', unit: 'hour', count: 5 },
  { value: '420', unit: 'hour', count: 7 },
  { value: '720', unit: 'hour', count: 12 },
  { value: '1440', unit: 'day', count: 1 },
  { value: '4320', unit: 'day', count: 3 },
  { value: '7200', unit: 'day', count: 5 },
  { value: '10080', unit: 'day', count: 7 },
  { value: '14400', unit: 'day', count: 10 },
  { value: '21600', unit: 'day', count: 15 },
];
const GROUP_MODAL_CONTROL_SX = {
  '& .MuiOutlinedInput-root': {
    backgroundColor: 'background.default',
    borderRadius: '8px',
    color: 'text.primary',
    '&:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: 'text.secondary',
    },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
      borderColor: RETICULUM_ACTIVE_BLUE,
      borderWidth: 1,
    },
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: 'divider',
  },
} as const;

export const AddGroup = ({
  address,
  open,
  setOpen,
  initialTab = 0,
  mode = 'create',
  groupId,
  myName,
  balance,
}: {
  address: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  initialTab?: number;
  mode?: 'create' | 'update';
  groupId?: number;
  myName?: string;
  balance?: number;
}) => {
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const setTxList = useSetAtom(txListAtom);
  const theme = useTheme();

  const [openAdvance, setOpenAdvance] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [groupType, setGroupType] = useState('1');
  const [approvalThreshold, setApprovalThreshold] = useState('40');
  const [minBlock, setMinBlock] = useState('5');
  const [maxBlock, setMaxBlock] = useState('21600');
  const [isLoadingGroup, setIsLoadingGroup] = useState(false);
  const [groupOwner, setGroupOwner] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [tempAvatar, setTempAvatar] = useState<string | null>(null);
  const [hasAvatar, setHasAvatar] = useState(false);
  const [isLoadingAvatar, setIsLoadingAvatar] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [value, setValue] = useState(initialTab);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleClose = () => {
    if (isCreating) return;
    setOpen(false);
  };

  const handleChangeApprovalThreshold = (event: SelectChangeEvent) => {
    setApprovalThreshold(event.target.value as string);
  };

  const handleChangeMinBlock = (event: SelectChangeEvent) => {
    setMinBlock(event.target.value as string);
  };

  const handleChangeMaxBlock = (event: SelectChangeEvent) => {
    setMaxBlock(event.target.value as string);
  };

  const { t } = useTranslation(['auth', 'core', 'group', 'question']);
  const handleCreateGroup = async () => {
    if (isCreating) return;
    try {
      if (!name)
        throw new Error(
          t('group:message.error.name_required', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      if (!description)
        throw new Error(
          t('group:message.error.description_required', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      if (description.length > GROUP_DESCRIPTION_MAX_LENGTH) {
        throw new Error(
          t('group:add_group.description_too_long', {
            max: GROUP_DESCRIPTION_MAX_LENGTH,
            postProcess: 'capitalizeFirstChar',
          })
        );
      }

      setIsCreating(true);

      const fee = await getFee('CREATE_GROUP');

      try {
        await show({
          message: t('core:message.question.perform_transaction', {
            action: 'CREATE_GROUP',
            postProcess: 'capitalizeFirstChar',
          }),
          publishFee: fee.fee + ' QORT',
        });
      } catch (error) {
        return;
      }

      await new Promise((res, rej) => {
        window
          .sendMessage('createGroup', {
            groupName: name,
            groupDescription: description,
            groupType: +groupType,
            groupApprovalThreshold: +approvalThreshold,
            minBlock: +minBlock,
            maxBlock: +maxBlock,
          })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: 'success',
                message: t('group:message.success.group_creation', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });
              setOpenSnack(true);
              setTxList((prev) => [
                {
                  ...response,
                  type: 'created-group',
                  label: t('group:message.success.group_creation_name', {
                    group_name: name,
                    postProcess: 'capitalizeFirstChar',
                  }),
                  labelDone: t('group:message.success.group_creation_label', {
                    group_name: name,
                    postProcess: 'capitalizeFirstChar',
                  }),
                  done: false,
                },
                ...prev,
              ]);
              setName('');
              setDescription('');
              setGroupType('1');
              res(response);
              return;
            }
            rej({ message: response.error });
          })
          .catch((error) => {
            rej({
              message:
                error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                }),
            });
          });
      });
    } catch (error) {
      setInfoSnack({
        type: 'error',
        message: error?.message,
      });
      setOpenSnack(true);
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateGroup = async () => {
    if (isCreating || !groupId) return;
    try {
      if (!description)
        throw new Error(
          t('group:message.error.description_required', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      if (description.length > GROUP_DESCRIPTION_MAX_LENGTH) {
        throw new Error(
          t('group:add_group.description_too_long', {
            max: GROUP_DESCRIPTION_MAX_LENGTH,
            postProcess: 'capitalizeFirstChar',
          })
        );
      }

      setIsCreating(true);

      const fee = await getFee('UPDATE_GROUP');

      try {
        await show({
          message: t('core:message.question.perform_transaction', {
            action: 'UPDATE_GROUP',
            postProcess: 'capitalizeFirstChar',
          }),
          publishFee: fee.fee + ' QORT',
        });
      } catch (error) {
        return;
      }

      await new Promise((res, rej) => {
        window
          .sendMessage('updateGroup', {
            groupId: groupId,
            newOwner: groupOwner || address,
            newIsOpen: +groupType,
            newDescription: description,
            newApprovalThreshold: +approvalThreshold,
            newMinimumBlockDelay: +minBlock,
            newMaximumBlockDelay: +maxBlock,
          })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: 'success',
                message: t('group:message.success.group_updated', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });
              setOpenSnack(true);
              setTxList((prev) => [
                {
                  ...response,
                  type: 'updated-group',
                  label: t('group:message.success.group_update_name', {
                    group_name: name,
                    postProcess: 'capitalizeFirstChar',
                  }),
                  labelDone: t('group:message.success.group_update_label', {
                    group_name: name,
                    postProcess: 'capitalizeFirstChar',
                  }),
                  done: false,
                },
                ...prev,
              ]);
              res(response);
              return;
            }
            rej({ message: response.error });
          })
          .catch((error) => {
            rej({
              message:
                error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                }),
            });
          });
      });
    } catch (error) {
      setInfoSnack({
        type: 'error',
        message: error?.message,
      });
      setOpenSnack(true);
    } finally {
      setIsCreating(false);
    }
  };

  const openGroupInvitesRequestFunc = () => {
    setValue(2);
  };

  const tabItems = [
    {
      value: 0,
      icon: <AddRoundedIcon sx={{ fontSize: 22 }} />,
      label: t('group:action.create_group', {
        postProcess: 'capitalizeFirstChar',
      }),
    },
    {
      value: 2,
      icon: <CheckRoundedIcon sx={{ fontSize: 21 }} />,
      label: t('group:group.invites', {
        postProcess: 'capitalizeFirstChar',
      }),
    },
  ];

  useEffect(() => {
    if (open) {
      setValue(initialTab);
    }
  }, [initialTab, open]);

  useEffect(() => {
    subscribeToEvent('openGroupInvitesRequest', openGroupInvitesRequestFunc);

    return () => {
      unsubscribeFromEvent(
        'openGroupInvitesRequest',
        openGroupInvitesRequestFunc
      );
    };
  }, []);

  useEffect(() => {
    if (mode === 'update' && groupId && open) {
      setIsLoadingGroup(true);
      const controller = new AbortController();

      fetch(`${getBaseApiReact()}/groups/${groupId}`, {
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error('Unable to load group information');
          return response.json();
        })
        .then((data) => {
          const APPROVAL_THRESHOLD_MAP: Record<string, string> = {
            ZERO: '0',
            ONE: '1',
            P20: '20',
            P40: '40',
            P60: '60',
            P80: '80',
            P100: '100',
          };
          const rawThreshold = data.approvalThreshold;
          let mappedThreshold: string;
          if (typeof rawThreshold === 'number') {
            mappedThreshold = String(rawThreshold);
          } else {
            const str = String(rawThreshold ?? '0');
            mappedThreshold = APPROVAL_THRESHOLD_MAP[str] ?? str;
            if (!/^\d+$/.test(mappedThreshold)) {
              const numMatch = str.match(/\d+/);
              mappedThreshold = numMatch ? numMatch[0] : '0';
            }
          }
          setName(data.groupName || '');
          setDescription(data.description || '');
          setGroupOwner(data.owner || '');
          setGroupType(data.isOpen ? '1' : '0');
          setApprovalThreshold(mappedThreshold);
          setMinBlock(String(data.minimumBlockDelay ?? '5'));
          setMaxBlock(String(data.maximumBlockDelay ?? '21600'));
          setIsLoadingGroup(false);
        })
        .catch((error) => {
          if (error?.name !== 'AbortError') {
            console.error('Failed to load group data:', error);
            setInfoSnack({
              type: 'error',
              message: t('group:message.error.group_info'),
            });
            setOpenSnack(true);
            setIsLoadingGroup(false);
          }
        });

      return () => controller.abort();
    }
  }, [mode, groupId, open, t]);

  useEffect(() => {
    if (avatarFile) {
      const url = URL.createObjectURL(avatarFile);
      setAvatarPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setAvatarPreviewUrl(null);
  }, [avatarFile]);

  const checkIfAvatarExists = useCallback(async (name: string, gid: number) => {
    try {
      const identifier = `qortal_group_avatar_${gid}`;
      const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=THUMBNAIL&identifier=${identifier}&limit=1&name=${name}&includemetadata=false&prefix=true`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const responseData = await response.json();
      if (responseData?.length > 0) {
        setHasAvatar(true);
      }
    } catch (error) {
      console.log(error);
    }
  }, []);

  useEffect(() => {
    if (mode === 'update' && myName && groupId) {
      checkIfAvatarExists(myName, groupId);
    }
  }, [mode, myName, groupId, checkIfAvatarExists]);

  const groupAvatarUrl = useMemo(() => {
    if (!myName || !groupId) return null;
    return `${getBaseApiReact()}/arbitrary/THUMBNAIL/${myName}/qortal_group_avatar_${groupId}?async=true`;
  }, [myName, groupId]);

  const handleAvatarPreview = useCallback((src: string | null) => {
    if (!src) return;
    setPreviewSrc(src);
    setIsPreviewOpen(true);
  }, []);

  const closePreview = useCallback(() => {
    setIsPreviewOpen(false);
    setPreviewSrc(null);
  }, []);

  const publishAvatar = async () => {
    try {
      if (!groupId) return;
      const fee = await getFee('ARBITRARY');

      if (balance != null && +balance < +fee.fee)
        throw new Error(
          t('core:message.generic.avatar_publish_fee', {
            fee: fee.fee,
            postProcess: 'capitalizeFirstChar',
          })
        );

      await show({
        message: t('core:message.question.publish_avatar', {
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });
      setIsLoadingAvatar(true);
      const avatarBase64 = await fileToBase64(avatarFile);

      await new Promise((res, rej) => {
        window
          .sendMessage('publishOnQDN', {
            data: avatarBase64,
            identifier: `qortal_group_avatar_${groupId}`,
            service: 'THUMBNAIL',
            uploadType: 'base64',
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
      setAvatarFile(null);
      setTempAvatar(`data:image/webp;base64,${avatarBase64}`);
      setHasAvatar(true);
    } catch (error) {
      if (error?.message) {
        setOpenSnack(true);
        setInfoSnack({
          type: 'error',
          message: error?.message,
        });
      }
    } finally {
      setIsLoadingAvatar(false);
    }
  };

  const modeTitle =
    value === 0
      ? mode === 'create'
        ? t('group:action.create_group', {
            postProcess: 'capitalizeEachFirstChar',
          })
        : t('group:action.update_group', {
            postProcess: 'capitalizeEachFirstChar',
          })
      : t('group:group.invites', { postProcess: 'capitalizeFirstChar' });
  const modeDescription =
    value === 0
      ? mode === 'create'
        ? t('group:add_group.description_create')
        : t('group:add_group.description_update')
      : t('group:add_group.description_invites');
  const canCreateGroup =
    mode === 'update'
      ? Boolean(description.trim()) && !isCreating
      : Boolean(name.trim() && description.trim()) && !isCreating;

  const handleDialogClose = (_event, reason) => {
    if (isCreating) return;
    // MUI only emits this reason for a primary click on the Dialog backdrop.
    if (reason !== 'backdropClick' && reason !== 'escapeKeyDown') return;
    handleClose();
  };

  if (!open) return null;

  return (
    <Fragment>
      <Dialog
        open={open}
        onClose={handleDialogClose}
        fullWidth
        maxWidth={false}
        PaperProps={{
          sx: {
            backgroundColor: 'background.paper',
            backgroundImage: 'none',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: '12px',
            boxShadow: '0 24px 70px rgba(0, 0, 0, 0.45)',
            display: 'flex',
            flexDirection: 'column',
            height: 'min(680px, calc(100vh - 32px))',
            m: 2,
            maxHeight: 'min(720px, calc(100vh - 32px))',
            maxWidth: 'calc(100vw - 32px)',
            overflow: 'hidden',
            width: 680,
          },
        }}
      >
        <Box
          component="header"
          sx={{
            alignItems: 'flex-start',
            display: 'flex',
            gap: 2,
            justifyContent: 'space-between',
            px: { xs: 2.5, sm: 4 },
            pt: { xs: 2.5, sm: 3.5 },
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              component="h2"
              sx={{
                color: 'text.primary',
                fontSize: { xs: 25, sm: 28 },
                fontWeight: 800,
                lineHeight: 1.15,
              }}
            >
              {modeTitle}
            </Typography>
            <Typography
              sx={{
                color: 'text.secondary',
                fontSize: 14,
                lineHeight: '20px',
                mt: 0.75,
              }}
            >
              {modeDescription}
            </Typography>
          </Box>
          <Box
            aria-label={t('group:add_group.modes_aria')}
            sx={{ display: 'flex', flexShrink: 0, gap: 0.5 }}
          >
            {tabItems.map((item) => {
              const selected = value === item.value;
              return (
                <Tooltip key={item.label} title={item.label}>
                  <IconButton
                    aria-label={item.label}
                    aria-pressed={selected}
                    onClick={() => setValue(item.value)}
                    sx={{
                      backgroundColor: selected
                        ? RETICULUM_ACTIVE_BLUE
                        : 'transparent',
                      borderRadius: '8px',
                      color: selected ? 'common.white' : 'text.secondary',
                      height: 40,
                      width: 40,
                      '&:hover': {
                        backgroundColor: selected
                          ? RETICULUM_ACTIVE_BLUE
                          : 'action.hover',
                        color: 'common.white',
                      },
                    }}
                  >
                    {item.icon}
                  </IconButton>
                </Tooltip>
              );
            })}
          </Box>
        </Box>

        <Box
          sx={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}
        >
          {value === 0 && (
            <Box
              component="form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateGroup();
              }}
              sx={{
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                gap: 2,
                minHeight: 0,
                overflowY: 'auto',
                px: { xs: 2.5, sm: 4 },
                py: 2.5,
                scrollbarColor: 'rgba(143, 150, 165, 0.7) transparent',
                scrollbarWidth: 'thin',
                '&::-webkit-scrollbar': { width: 7 },
                '&::-webkit-scrollbar-thumb': {
                  backgroundColor: 'rgba(143, 150, 165, 0.7)',
                  borderRadius: 8,
                },
              }}
            >
              {mode === 'update' && (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 1,
                    pb: 1,
                  }}
                >
                  <Avatar
                    sx={{
                      height: '100px',
                      width: '100px',
                      ...getClickableAvatarSx(
                        theme,
                        Boolean(avatarPreviewUrl || tempAvatar || hasAvatar)
                      ),
                    }}
                    src={
                      avatarPreviewUrl ||
                      tempAvatar ||
                      groupAvatarUrl ||
                      undefined
                    }
                    alt={name}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleAvatarPreview(
                        avatarPreviewUrl || tempAvatar || groupAvatarUrl
                      );
                    }}
                  >
                    {name?.charAt(0)}
                  </Avatar>
                  <ImageUploader onPick={(file: File) => setAvatarFile(file)}>
                    <ButtonBase>
                      <Typography
                        sx={{
                          fontSize: '14px',
                          opacity: 0.6,
                          '&:hover': { opacity: 1 },
                        }}
                      >
                        {hasAvatar || tempAvatar
                          ? t('core:action.change_avatar', {
                              postProcess: 'capitalizeFirstChar',
                            })
                          : t('core:action.set_avatar', {
                              postProcess: 'capitalizeFirstChar',
                            })}
                      </Typography>
                    </ButtonBase>
                  </ImageUploader>
                  {avatarFile?.name && (
                    <Typography
                      sx={{ fontSize: '12px', color: 'text.secondary' }}
                    >
                      {avatarFile.name}
                    </Typography>
                  )}
                  <Typography
                    sx={{ fontSize: '11px', color: 'text.secondary' }}
                  >
                    {t('core:message.generic.avatar_size', {
                      size: MAX_SIZE_AVATAR,
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  <LoadingButton
                    loading={isLoadingAvatar}
                    disabled={!avatarFile || !myName}
                    onClick={() => void publishAvatar()}
                    variant="contained"
                    size="small"
                    sx={{
                      backgroundColor: 'other.positive',
                      color: 'text.primary',
                      fontWeight: 'bold',
                      opacity: 1,
                      '&:hover': {
                        backgroundColor: 'other.positive',
                        opacity: 0.7,
                      },
                    }}
                  >
                    {t('group:action.publish_avatar', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </LoadingButton>
                </Box>
              )}
              <Box>
                <Typography
                  component="label"
                  htmlFor="reticulum-group-name"
                  sx={{
                    color: 'text.primary',
                    display: 'block',
                    fontSize: 15,
                    fontWeight: 800,
                    mb: 1,
                  }}
                >
                  {t('group:group.name', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
                <TextField
                  autoFocus={mode === 'create'}
                  disabled={mode === 'update'}
                  fullWidth
                  id="reticulum-group-name"
                  inputProps={{ maxLength: 32 }}
                  placeholder={t('group:add_group.name_placeholder')}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  sx={{
                    ...GROUP_MODAL_CONTROL_SX,
                    '& .MuiOutlinedInput-root': {
                      ...GROUP_MODAL_CONTROL_SX['& .MuiOutlinedInput-root'],
                      height: 48,
                    },
                  }}
                />
                <Box
                  sx={{
                    color: 'text.secondary',
                    display: 'flex',
                    fontSize: 12.5,
                    justifyContent: 'space-between',
                    lineHeight: '18px',
                    mt: 0.75,
                  }}
                >
                  <span>{t('group:add_group.name_hint')}</span>
                  <span>{name.length} / 32</span>
                </Box>
              </Box>

              <Box>
                <Typography
                  component="label"
                  htmlFor="reticulum-group-description"
                  sx={{
                    color: 'text.primary',
                    display: 'block',
                    fontSize: 15,
                    fontWeight: 800,
                    mb: 1,
                  }}
                >
                  {t('core:description', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
                <TextField
                  fullWidth
                  id="reticulum-group-description"
                  inputProps={{ maxLength: GROUP_DESCRIPTION_MAX_LENGTH }}
                  maxRows={4}
                  minRows={2}
                  multiline
                  placeholder={t('group:add_group.description_placeholder')}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  sx={{
                    ...GROUP_MODAL_CONTROL_SX,
                    '& .MuiInputBase-inputMultiline': {
                      scrollbarColor: 'rgba(143, 150, 165, 0.72) transparent',
                      scrollbarWidth: 'thin',
                      '&::-webkit-scrollbar': { width: 6 },
                      '&::-webkit-scrollbar-thumb': {
                        backgroundColor: 'rgba(143, 150, 165, 0.72)',
                        borderRadius: 8,
                      },
                    },
                  }}
                />
                <Box
                  sx={{
                    color: 'text.secondary',
                    display: 'flex',
                    fontSize: 12.5,
                    justifyContent: 'flex-end',
                    lineHeight: '18px',
                    mt: 0.75,
                  }}
                >
                  {description.length} / {GROUP_DESCRIPTION_MAX_LENGTH}
                </Box>
              </Box>

              <Box>
                <Typography
                  id="reticulum-group-access-label"
                  sx={{
                    color: 'text.primary',
                    fontSize: 15,
                    fontWeight: 800,
                    mb: 1,
                  }}
                >
                  {t('group:add_group.access_label')}
                </Typography>
                <Box
                  aria-labelledby="reticulum-group-access-label"
                  role="radiogroup"
                  sx={{
                    backgroundColor: 'background.default',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: '10px',
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: '1fr',
                      sm: 'repeat(2, minmax(0, 1fr))',
                    },
                    overflow: 'hidden',
                  }}
                >
                  {[
                    {
                      description: t('group:add_group.access_open_description'),
                      icon: PublicRoundedIcon,
                      label: t('group:add_group.access_open_label'),
                      value: '1',
                    },
                    {
                      description: t(
                        'group:add_group.access_closed_description'
                      ),
                      icon: LockRoundedIcon,
                      label: t('group:add_group.access_closed_label'),
                      value: '0',
                    },
                  ].map((option, index) => {
                    const selected = groupType === option.value;
                    const Icon = option.icon;
                    return (
                      <Button
                        aria-checked={selected}
                        key={option.value}
                        onClick={() => setGroupType(option.value)}
                        role="radio"
                        sx={{
                          backgroundColor: selected
                            ? 'rgba(37, 99, 235, 0.12)'
                            : 'transparent',
                          borderColor: selected
                            ? RETICULUM_ACTIVE_BLUE
                            : 'divider',
                          borderLeft: {
                            xs: 'none',
                            sm: index === 0 ? 'none' : '1px solid',
                          },
                          borderRadius: {
                            xs: index === 0 ? '9px 9px 0 0' : '0 0 9px 9px',
                            sm: index === 0 ? '9px 0 0 9px' : '0 9px 9px 0',
                          },
                          borderTop: {
                            xs: index === 0 ? 'none' : '1px solid',
                            sm: 'none',
                          },
                          boxShadow: selected
                            ? `inset 0 0 0 1px ${RETICULUM_ACTIVE_BLUE}`
                            : 'none',
                          color: selected ? 'primary.main' : 'text.primary',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 0.5,
                          minHeight: 126,
                          p: 1.5,
                          position: 'relative',
                          textTransform: 'none',
                          zIndex: selected ? 1 : 0,
                          '&:hover': {
                            backgroundColor: selected
                              ? 'rgba(37, 99, 235, 0.16)'
                              : 'action.hover',
                          },
                        }}
                      >
                        {selected && (
                          <CheckCircleRoundedIcon
                            sx={{
                              color: RETICULUM_ACTIVE_BLUE,
                              fontSize: 19,
                              position: 'absolute',
                              right: 9,
                              top: 9,
                            }}
                          />
                        )}
                        <Icon
                          sx={{
                            color: selected ? 'primary.main' : 'text.secondary',
                            fontSize: 25,
                          }}
                        />
                        <Typography
                          sx={{
                            color: 'inherit',
                            fontSize: 15,
                            fontWeight: 800,
                          }}
                        >
                          {option.label}
                        </Typography>
                        <Typography
                          sx={{
                            color: 'text.secondary',
                            fontSize: 13,
                            lineHeight: '18px',
                            textAlign: 'center',
                          }}
                        >
                          {option.description}
                        </Typography>
                      </Button>
                    );
                  })}
                </Box>
              </Box>

              <Box>
                <Button
                  aria-expanded={openAdvance}
                  fullWidth
                  onClick={() => setOpenAdvance((previous) => !previous)}
                  startIcon={<TuneRoundedIcon sx={{ fontSize: 18 }} />}
                  sx={{
                    backgroundColor: 'action.hover',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: '8px',
                    color: 'text.primary',
                    justifyContent: 'flex-start',
                    minHeight: 42,
                    px: 1.5,
                    textTransform: 'none',
                    '&:hover': { backgroundColor: 'action.selected' },
                  }}
                >
                  <Typography
                    sx={{
                      flex: 1,
                      fontSize: 14,
                      fontWeight: 700,
                      textAlign: 'left',
                    }}
                  >
                    {t('group:advanced_options', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  {openAdvance ? <ExpandLess /> : <ExpandMore />}
                </Button>
                <Collapse in={openAdvance} timeout="auto" unmountOnExit>
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      pt: 2,
                    }}
                  >
                    <Box>
                      <Typography
                        component="label"
                        sx={{
                          color: 'text.primary',
                          display: 'block',
                          fontSize: 13,
                          fontWeight: 700,
                          mb: 0.4,
                        }}
                      >
                        {t('group:add_group.approval_threshold_label')}
                      </Typography>
                      <Typography
                        sx={{
                          color: 'text.secondary',
                          fontSize: 12,
                          lineHeight: '17px',
                          mb: 0.85,
                        }}
                      >
                        {t('group:add_group.approval_threshold_description')}
                      </Typography>
                      <FormControl fullWidth sx={GROUP_MODAL_CONTROL_SX}>
                        <Select
                          value={approvalThreshold}
                          onChange={handleChangeApprovalThreshold}
                        >
                          <MenuItem value="0">
                            {t('group:add_group.approval_none')}
                          </MenuItem>
                          <MenuItem value="1">
                            {t('group:add_group.approval_single')}
                          </MenuItem>
                          <MenuItem value="20">20%</MenuItem>
                          <MenuItem value="40">40%</MenuItem>
                          <MenuItem value="60">60%</MenuItem>
                          <MenuItem value="80">80%</MenuItem>
                          <MenuItem value="100">100%</MenuItem>
                        </Select>
                      </FormControl>
                    </Box>
                    <Box
                      sx={{
                        display: 'grid',
                        gap: 1.75,
                        gridTemplateColumns: {
                          xs: '1fr',
                          sm: 'repeat(2, minmax(0, 1fr))',
                        },
                      }}
                    >
                      <Box>
                        <Typography
                          component="label"
                          sx={{
                            color: 'text.primary',
                            display: 'block',
                            fontSize: 13,
                            fontWeight: 700,
                            mb: 0.85,
                          }}
                        >
                          {t('group:add_group.min_delay_label')}
                        </Typography>
                        <FormControl fullWidth sx={GROUP_MODAL_CONTROL_SX}>
                          <Select
                            value={minBlock}
                            onChange={handleChangeMinBlock}
                          >
                            {MIN_BLOCK_DELAY_OPTIONS.map((option) => (
                              <MenuItem key={option.value} value={option.value}>
                                {t(`core:time.${option.unit}`, {
                                  count: option.count,
                                })}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Box>
                      <Box>
                        <Typography
                          component="label"
                          sx={{
                            color: 'text.primary',
                            display: 'block',
                            fontSize: 13,
                            fontWeight: 700,
                            mb: 0.85,
                          }}
                        >
                          {t('group:add_group.max_delay_label')}
                        </Typography>
                        <FormControl fullWidth sx={GROUP_MODAL_CONTROL_SX}>
                          <Select
                            value={maxBlock}
                            onChange={handleChangeMaxBlock}
                          >
                            {MAX_BLOCK_DELAY_OPTIONS.map((option) => (
                              <MenuItem key={option.value} value={option.value}>
                                {t(`core:time.${option.unit}`, {
                                  count: option.count,
                                })}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Box>
                    </Box>
                  </Box>
                </Collapse>
              </Box>
            </Box>
          )}

          {value === 2 && (
            <Box
              sx={{
                display: 'flex',
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                px: { xs: 2.5, sm: 4 },
                py: 2.5,
              }}
            >
              <UserListOfInvites
                myAddress={address}
                setOpenSnack={setOpenSnack}
                setInfoSnack={setInfoSnack}
              />
            </Box>
          )}
        </Box>

        <Box
          component="footer"
          sx={{
            alignItems: 'center',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            gap: 1,
            justifyContent: 'flex-end',
            px: { xs: 2.5, sm: 4 },
            py: 1.5,
          }}
        >
          <Button
            disabled={isCreating}
            onClick={handleClose}
            sx={{
              borderRadius: '8px',
              color: 'text.secondary',
              fontWeight: 700,
              minHeight: 40,
              px: 2,
              textTransform: 'none',
              '&:hover': {
                backgroundColor: 'action.hover',
                color: 'text.primary',
              },
            }}
          >
            {t('core:action.cancel', { postProcess: 'capitalizeFirstChar' })}
          </Button>
          {value === 0 && (
            <Button
              disabled={!canCreateGroup}
              onClick={() =>
                void (mode === 'update'
                  ? handleUpdateGroup()
                  : handleCreateGroup())
              }
              variant="contained"
              sx={{
                backgroundColor: RETICULUM_ACTIVE_BLUE,
                borderRadius: '8px',
                color: 'common.white',
                fontWeight: 700,
                minHeight: 40,
                minWidth: 138,
                px: 2.25,
                textTransform: 'none',
                '&:hover': { backgroundColor: '#1e40af' },
                '&.Mui-disabled': {
                  backgroundColor: 'action.disabledBackground',
                  color: 'text.disabled',
                },
              }}
            >
              {isCreating
                ? mode === 'update'
                  ? t('group:add_group.updating')
                  : t('group:add_group.creating')
                : mode === 'update'
                  ? t('group:add_group.button_update')
                  : t('group:action.create_group', {
                      postProcess: 'capitalizeEachFirstChar',
                    })}
            </Button>
          )}
        </Box>

        <CustomizedSnackbars
          open={openSnack}
          setOpen={setOpenSnack}
          info={infoSnack}
          setInfo={setInfoSnack}
        />
        <AvatarPreviewModal
          open={isPreviewOpen}
          src={previewSrc}
          alt={name}
          onClose={closePreview}
        />
      </Dialog>
    </Fragment>
  );
};
