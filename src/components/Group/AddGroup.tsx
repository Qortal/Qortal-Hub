import {
  forwardRef,
  Fragment,
  ReactElement,
  Ref,
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
import Slide from '@mui/material/Slide';
import { TransitionProps } from '@mui/material/transitions';
import {
  Box,
  Collapse,
  Input,
  MenuItem,
  Select,
  SelectChangeEvent,
  Tab,
  Tabs,
  styled,
  useTheme,
} from '@mui/material';
import { AddGroupList } from './AddGroupList';
import { UserListOfInvites } from './UserListOfInvites';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { getFee } from '../../background';
import { MyContext } from '../../App';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { useTranslation } from 'react-i18next';
import { useSetAtom } from 'jotai';
import { txListAtom } from '../../atoms/global';

export const Label = styled('label')`
  display: block;
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 14px;
  font-weight: 400;
  margin-bottom: 4px;
`;

const Transition = forwardRef(function Transition(
  props: TransitionProps & {
    children: ReactElement;
  },
  ref: Ref<unknown>
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

export const AddGroup = ({ address, open, setOpen }) => {
  const { show } = useContext(MyContext);
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

  const { t } = useTranslation(['core', 'group']);
  const theme = useTheme();

  const handleCreateGroup = async () => {
    try {
      if (!name)
        throw new Error(
          t('group:message.error.name_required', {
            postProcess: 'capitalize',
          })
        );
      if (!description)
        throw new Error(
          t('group:message.error.description_required', {
            postProcess: 'capitalize',
          })
        );

      const fee = await getFee('CREATE_GROUP');

      await show({
        message: t('group:question.perform_transaction', {
          action: 'CREATE_GROUP',
          postProcess: 'capitalize',
        }),
        publishFee: fee.fee + ' QORT',
      });

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
                  postProcess: 'capitalize',
                }),
              });
              setOpenSnack(true);
              setTxList((prev) => [
                {
                  ...response,
                  type: 'created-group',
                  label: t('group:message.success.group_creation_name', {
                    group_name: name,
                    postProcess: 'capitalize',
                  }),
                  labelDone: t('group:message.success.group_creation_label', {
                    group_name: name,
                    postProcess: 'capitalize',
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
                t('core:message.error.generic', { postProcess: 'capitalize' }),
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
        TransitionComponent={Transition}
      >
        <AppBar
          sx={{
            position: 'relative',
            bgcolor: theme.palette.background.default,
          }}
        >
          <Toolbar>
            <Typography sx={{ ml: 2, flex: 1 }} variant="h4" component="div">
              {t('group:group.management', { postProcess: 'capitalize' })}
            </Typography>

            <IconButton
              aria-label="close"
              color="inherit"
              edge="start"
              onClick={handleClose}
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
              aria-label="basic tabs example"
              variant={'fullWidth'}
              scrollButtons="auto"
              allowScrollButtonsMobile
              sx={{
                '& .MuiTabs-indicator': {
                  backgroundColor: theme.palette.background.default,
                },
              }}
            >
              <Tab
                label={t('group:action.create_group', {
                  postProcess: 'capitalize',
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
                  postProcess: 'capitalize',
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
                  postProcess: 'capitalize',
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
                      postProcess: 'capitalize',
                    })}
                  </Label>

                  <Input
                    placeholder={t('group:group.name', {
                      postProcess: 'capitalize',
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
                      postProcess: 'capitalize',
                    })}
                  </Label>

                  <Input
                    placeholder={t('group:group.description', {
                      postProcess: 'capitalize',
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
                    {' '}
                    {t('group:group.type', {
                      postProcess: 'capitalize',
                    })}
                  </Label>

                  <Select
                    labelId="demo-simple-select-label"
                    id="demo-simple-select"
                    value={groupType}
                    label="Group Type"
                    onChange={handleChangeGroupType}
                  >
                    <MenuItem value={1}>
                      {t('group:group.open', {
                        postProcess: 'capitalize',
                      })}
                    </MenuItem>
                    <MenuItem value={0}>
                      {t('group:group.closed', {
                        postProcess: 'capitalize',
                      })}
                    </MenuItem>
                  </Select>
                </Box>

                <Box
                  sx={{
                    display: 'flex',
                    gap: '15px',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                  onClick={() => setOpenAdvance((prev) => !prev)}
                >
                  <Typography>
                    {t('group:advanced_options', {
                      postProcess: 'capitalize',
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
                      {t('group:approval_threshold', {
                        postProcess: 'capitalize',
                      })}
                    </Label>
                    <Select
                      labelId="demo-simple-select-label"
                      id="demo-simple-select"
                      value={approvalThreshold}
                      label="Group Approval Threshold"
                      onChange={handleChangeApprovalThreshold}
                    >
                      <MenuItem value={0}>
                        {t('core:count.none', {
                          postProcess: 'capitalize',
                        })}
                      </MenuItem>
                      <MenuItem value={1}>
                        {t('core:count.one', {
                          postProcess: 'capitalize',
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
                      {t('group:block_delay.minimum', {
                        postProcess: 'capitalize',
                      })}
                    </Label>
                    <Select
                      labelId="demo-simple-select-label"
                      id="demo-simple-select"
                      value={minBlock}
                      label="Minimum Block delay"
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
                      {t('group:block_delay.maximum', {
                        postProcess: 'capitalize',
                      })}
                    </Label>
                    <Select
                      labelId="demo-simple-select-label"
                      id="demo-simple-select"
                      value={maxBlock}
                      label="Maximum Block delay"
                      onChange={handleChangeMaxBlock}
                    >
                      <MenuItem value={60}>
                        {t('core:time.hour', { count: 1 })}
                      </MenuItem>
                      <MenuItem value={180}>
                        3{t('core:time.hour', { count: 3 })}
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
                      postProcess: 'capitalize',
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
