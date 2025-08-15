import {
  Fragment,
  SyntheticEvent,
  useContext,
  useEffect,
  useState,
} from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import {
  Box,
  Collapse,
  Input,
  MenuItem,
  Select,
  SelectChangeEvent,
  Tab,
  Tabs,
  useTheme,
} from '@mui/material';
import { AddGroupList } from './AddGroupList';
import { UserListOfInvites } from './UserListOfInvites';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { getFee } from '../../background/background.ts';
import { QORTAL_APP_CONTEXT } from '../../App';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import { txListAtom } from '../../atoms/global';
import { TransitionUp } from '../../common/Transitions.tsx';
import { Label } from '../../styles/App-styles.ts';

export const AddGroup = ({ address, open, setOpen }) => {
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const setTxList = useSetAtom(txListAtom);

  const [openAdvance, setOpenAdvance] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [groupType, setGroupType] = useState('1');
  const [approvalThreshold, setApprovalThreshold] = useState('40');
  const [minBlock, setMinBlock] = useState('5');
  const [maxBlock, setMaxBlock] = useState('21600');
  const [value, setValue] = useState(0);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);

  const handleChange = (event: SyntheticEvent, newValue: number) => {
    setValue(newValue);
  };

  const handleClose = () => {
    setOpen(false);
  };

  const handleChangeGroupType = (event: SelectChangeEvent) => {
    setGroupType(event.target.value as string);
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

  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const theme = useTheme();

  const handleCreateGroup = async () => {
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
        console.log(error);
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
    }
  };

  function a11yProps(index: number) {
    return {
      id: `simple-tab-${index}`,
      'aria-controls': `simple-tabpanel-${index}`,
    };
  }

  const openGroupInvitesRequestFunc = () => {
    setValue(2);
  };

  useEffect(() => {
    subscribeToEvent('openGroupInvitesRequest', openGroupInvitesRequestFunc);

    return () => {
      unsubscribeFromEvent(
        'openGroupInvitesRequest',
        openGroupInvitesRequestFunc
      );
    };
  }, []);

  if (!open) return null;

  return (
    <Fragment>
      <Dialog
        fullScreen
        open={open}
        onClose={handleClose}
        slots={{
          transition: TransitionUp,
        }}
      >
        <AppBar
          sx={{
            position: 'relative',
          }}
        >
          <Toolbar>
            <Typography sx={{ ml: 2, flex: 1 }} variant="h4" component="div">
              {t('group:group.management', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>

            <IconButton
              aria-label={t('core:action.close', {
                postProcess: 'capitalizeFirstChar',
              })}
              color="inherit"
              edge="start"
              onClick={handleClose}
              sx={{
                bgcolor: theme.palette.background.default,
                color: theme.palette.text.primary,
              }}
            >
              <CloseIcon />
            </IconButton>
          </Toolbar>
        </AppBar>

        <Box
          sx={{
            bgcolor: theme.palette.background.default,
            color: theme.palette.text.primary,
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            overflowY: 'auto',
          }}
        >
          <Box
            sx={{ borderBottom: 1, borderColor: theme.palette.text.secondary }}
          >
            <Tabs
              value={value}
              onChange={handleChange}
              variant={'fullWidth'}
              scrollButtons="auto"
              allowScrollButtonsMobile
              sx={{
                '&.MuiTabs-indicator': {
                  backgroundColor: theme.palette.background.default,
                },
              }}
            >
              <Tab
                label={t('group:action.create_group', {
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
                label={t('group:action.find_group', {
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
              <Tab
                label={t('group:group.invites', {
                  postProcess: 'capitalizeFirstChar',
                })}
                {...a11yProps(2)}
                sx={{
                  '&.Mui-selected': {
                    color: theme.palette.text.primary,
                  },
                  fontSize: '1rem',
                }}
              />
            </Tabs>
          </Box>

          {value === 0 && (
            <Box
              sx={{
                width: '100%',
                padding: '25px',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
                  maxWidth: '500px',
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '5px',
                  }}
                >
                  <Label>
                    {t('group:group.name', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Label>

                  <Input
                    placeholder={t('group:group.name', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Box>

                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '5px',
                  }}
                >
                  <Label>
                    {t('group:group.description', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Label>

                  <Input
                    placeholder={t('group:group.description', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Box>

                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '5px',
                  }}
                >
                  <Label>
                    {t('group:group.type', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Label>

                  <Select
                    labelId="demo-simple-select-label"
                    id="demo-simple-select"
                    value={groupType}
                    label={t('group:group.type', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    onChange={handleChangeGroupType}
                  >
                    <MenuItem value={1}>
                      {t('group:group.open', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </MenuItem>
                    <MenuItem value={0}>
                      {t('group:group.closed', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </MenuItem>
                  </Select>
                </Box>

                <Box
                  sx={{
                    alignItems: 'center',
                    cursor: 'pointer',
                    display: 'flex',
                    gap: '15px',
                  }}
                  onClick={() => setOpenAdvance((prev) => !prev)}
                >
                  <Typography>
                    {t('group:advanced_options', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>

                  {openAdvance ? <ExpandLess /> : <ExpandMore />}
                </Box>

                <Collapse in={openAdvance} timeout="auto" unmountOnExit>
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '5px',
                    }}
                  >
                    <Label>
                      {t('group:message.generic.group_approval_threshold', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Label>

                    <Select
                      labelId="demo-simple-select-label"
                      id="demo-simple-select"
                      value={approvalThreshold}
                      label={t('group:group.approval_threshold', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                      onChange={handleChangeApprovalThreshold}
                    >
                      <MenuItem value={0}>
                        {t('core:count.none', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </MenuItem>
                      <MenuItem value={1}>
                        {t('core:count.one', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </MenuItem>
                      <MenuItem value={20}>20%</MenuItem>
                      <MenuItem value={40}>40%</MenuItem>
                      <MenuItem value={60}>60%</MenuItem>
                      <MenuItem value={80}>80%</MenuItem>
                      <MenuItem value={100}>100%</MenuItem>
                    </Select>
                  </Box>

                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '5px',
                    }}
                  >
                    <Label>
                      {t('group:message.generic.block_delay_minimum', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Label>

                    <Select
                      labelId="demo-simple-select-label"
                      id="demo-simple-select"
                      value={minBlock}
                      label={t('group:block_delay.minimum', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                      onChange={handleChangeMinBlock}
                    >
                      <MenuItem value={5}>
                        {t('core:time.minute', { count: 5 })}
                      </MenuItem>
                      <MenuItem value={10}>
                        {t('core:time.minute', { count: 10 })}
                      </MenuItem>
                      <MenuItem value={30}>
                        {t('core:time.minute', { count: 30 })}
                      </MenuItem>
                      <MenuItem value={60}>
                        {t('core:time.hour', { count: 1 })}
                      </MenuItem>
                      <MenuItem value={180}>
                        {t('core:time.hour', { count: 3 })}
                      </MenuItem>
                      <MenuItem value={300}>
                        {t('core:time.hour', { count: 5 })}
                      </MenuItem>
                      <MenuItem value={420}>
                        {t('core:time.hour', { count: 7 })}
                      </MenuItem>
                      <MenuItem value={720}>
                        {t('core:time.hour', { count: 12 })}
                      </MenuItem>
                      <MenuItem value={1440}>
                        {t('core:time.day', { count: 1 })}
                      </MenuItem>
                      <MenuItem value={4320}>
                        {t('core:time.day', { count: 3 })}
                      </MenuItem>
                      <MenuItem value={7200}>
                        {t('core:time.day', { count: 5 })}
                      </MenuItem>
                      <MenuItem value={10080}>
                        {t('core:time.day', { count: 7 })}
                      </MenuItem>
                    </Select>
                  </Box>

                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '5px',
                    }}
                  >
                    <Label>
                      {t('group:message.generic.block_delay_maximum', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Label>

                    <Select
                      labelId="demo-simple-select-label"
                      id="demo-simple-select"
                      value={maxBlock}
                      label={t('group:block_delay.minimum', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                      onChange={handleChangeMaxBlock}
                    >
                      <MenuItem value={60}>
                        {t('core:time.hour', { count: 1 })}
                      </MenuItem>
                      <MenuItem value={180}>
                        {t('core:time.hour', { count: 3 })}
                      </MenuItem>
                      <MenuItem value={300}>
                        {t('core:time.hour', { count: 5 })}
                      </MenuItem>
                      <MenuItem value={420}>
                        {t('core:time.hour', { count: 7 })}
                      </MenuItem>
                      <MenuItem value={720}>
                        {t('core:time.hour', { count: 12 })}
                      </MenuItem>
                      <MenuItem value={1440}>
                        {t('core:time.day', { count: 1 })}
                      </MenuItem>
                      <MenuItem value={4320}>
                        {t('core:time.day', { count: 3 })}
                      </MenuItem>
                      <MenuItem value={7200}>
                        {t('core:time.day', { count: 5 })}
                      </MenuItem>
                      <MenuItem value={10080}>
                        {t('core:time.day', { count: 7 })}
                      </MenuItem>
                      <MenuItem value={14400}>
                        {t('core:time.day', { count: 10 })}
                      </MenuItem>
                      <MenuItem value={21600}>
                        {t('core:time.day', { count: 15 })}
                      </MenuItem>
                    </Select>
                  </Box>
                </Collapse>

                <Box
                  sx={{
                    display: 'flex',
                    width: '100%',
                    justifyContent: 'center',
                  }}
                >
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={handleCreateGroup}
                  >
                    {t('group:action.create_group', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Button>
                </Box>
              </Box>
            </Box>
          )}

          {value === 1 && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                flexGrow: 1,
                padding: '25px',
                width: '100%',
              }}
            >
              <AddGroupList
                setOpenSnack={setOpenSnack}
                setInfoSnack={setInfoSnack}
              />
            </Box>
          )}

          {value === 2 && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                flexGrow: 1,
                padding: '25px',
                width: '100%',
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

        <CustomizedSnackbars
          open={openSnack}
          setOpen={setOpenSnack}
          info={infoSnack}
          setInfo={setInfoSnack}
        />
      </Dialog>
    </Fragment>
  );
};
