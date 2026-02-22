import {
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemText,
  Skeleton,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import GroupIcon from '@mui/icons-material/Group';
import PersonIcon from '@mui/icons-material/Person';
import DescriptionIcon from '@mui/icons-material/Description';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  List,
} from 'react-virtualized';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import { LoadingButton } from '@mui/lab';
import { getFee } from '../../background/background.ts';
import LockIcon from '@mui/icons-material/Lock';
import NoEncryptionGmailerrorredIcon from '@mui/icons-material/NoEncryptionGmailerrorred';
import { useTranslation } from 'react-i18next';
import { useAtom, useSetAtom } from 'jotai';
import { memberGroupsAtom, txListAtom } from '../../atoms/global';
import { formatTimestamp } from '../../utils/time.ts';
import { getNameInfo } from './groupApi';
import { Spacer } from '../../common/Spacer.tsx';

const cache = new CellMeasurerCache({
  fixedWidth: true,
  defaultHeight: 88,
});

export const AddGroupList = ({ setInfoSnack, setOpenSnack }) => {
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const [memberGroups] = useAtom(memberGroupsAtom);
  const setTxList = useSetAtom(txListAtom);
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [ownerAddress, setOwnerAddress] = useState(null);
  const [ownerPrimaryName, setOwnerPrimaryName] = useState(null);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const listRef = useRef(null);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const theme = useTheme();

  useEffect(() => {
    if (!selectedGroup?.groupId) {
      setOwnerAddress(null);
      setOwnerPrimaryName(null);
      return;
    }
    let cancelled = false;
    setOwnerLoading(true);
    setOwnerAddress(null);
    setOwnerPrimaryName(null);
    const fetchOwner = async () => {
      try {
        const res = await fetch(
          `${getBaseApiReact()}/groups/${selectedGroup.groupId}`
        );
        const data = await res.json();
        if (cancelled || !data?.owner) return;
        setOwnerAddress(data.owner);
        const name = await getNameInfo(data.owner);
        if (!cancelled) setOwnerPrimaryName(name || null);
      } catch (err) {
        if (!cancelled) {
          setOwnerAddress(null);
          setOwnerPrimaryName(null);
        }
      } finally {
        if (!cancelled) setOwnerLoading(false);
      }
    };
    fetchOwner();
    return () => {
      cancelled = true;
    };
  }, [selectedGroup?.groupId]);

  // Derive filtered list from groups + search so refetches (e.g. when memberGroups updates) don't clear the filter
  const filteredItems = useMemo(() => {
    const query = (inputValue || '').trim().toLowerCase();
    if (!query) return groups;
    return groups.filter((item) =>
      item.groupName.toLowerCase().includes(query)
    );
  }, [groups, inputValue]);

  const handleChange = (event) => {
    setInputValue(event.target.value);
  };

  const getGroups = async () => {
    setGroupsLoading(true);
    try {
      const response = await fetch(`${getBaseApiReact()}/groups/?limit=0`);
      const groupData = await response.json();
      const filteredGroup = groupData.filter(
        (item) => !memberGroups.find((group) => group.groupId === item.groupId)
      );
      setGroups(filteredGroup);
    } catch (error) {
      console.error(error);
    } finally {
      setGroupsLoading(false);
    }
  };

  useEffect(() => {
    getGroups();
  }, [memberGroups]);

  const handleOpenDialog = (group) => {
    setSelectedGroup(group);
  };

  const handleCloseDialog = () => {
    setSelectedGroup(null);
  };

  const handleCopyAddress = () => {
    if (ownerAddress) {
      navigator.clipboard
        .writeText(ownerAddress)
        .then(() => {
          setInfoSnack({
            type: 'success',
            message: t('auth:action.copy_address', {
              postProcess: 'capitalizeFirstChar',
            }),
          });
          setOpenSnack(true);
        })
        .catch(() => {
          setInfoSnack({
            type: 'error',
            message: t('question:message.error.copy_clipboard', {
              postProcess: 'capitalizeFirstChar',
            }),
          });
          setOpenSnack(true);
        });
    }
  };

  const handleJoinGroup = async (group, isOpen) => {
    try {
      const groupId = group.groupId;

      const fee = await getFee('JOIN_GROUP');

      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'JOIN_GROUP',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });
      setIsLoading(true);

      await new Promise((res, rej) => {
        window
          .sendMessage('joinGroup', {
            groupId,
          })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: 'success',
                message: t('group:message.success.group_join', {
                  postProcess: 'capitalizeFirstChar',
                }),
              });

              if (isOpen) {
                setTxList((prev) => [
                  {
                    ...response,
                    type: 'joined-group',
                    label: t('group:message.success.group_join_label', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
                    labelDone: t('group:message.success.group_join_label', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
                    done: false,
                    groupId,
                  },
                  ...prev,
                ]);
              } else {
                setTxList((prev) => [
                  {
                    ...response,
                    type: 'joined-group-request',
                    label: t('group:message.success.group_join_request', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
                    labelDone: t('group:message.success.group_join_outcome', {
                      group_name: group?.groupName,
                      postProcess: 'capitalizeFirstChar',
                    }),
                    done: false,
                    groupId,
                  },
                  ...prev,
                ]);
              }
              setOpenSnack(true);
              handleCloseDialog();
              res(response);
              return;
            } else {
              setInfoSnack({
                type: 'error',
                message: response?.error,
              });
              setOpenSnack(true);
              rej(response.error);
            }
          })
          .catch((error) => {
            setInfoSnack({
              type: 'error',
              message:
                error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                }),
            });
            setOpenSnack(true);
            rej(error);
          });
      });
      setIsLoading(false);
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoading(false);
    }
  };

  const rowRenderer = ({ index, key, parent, style }) => {
    const group = filteredItems[index];
    const memberCount = group?.memberCount ?? 0;
    const createdDate = group?.created
      ? formatTimestamp(group.created)
      : '—';

    return (
      <CellMeasurer
        key={key}
        cache={cache}
        parent={parent}
        columnIndex={0}
        rowIndex={index}
      >
        {({ measure }) => (
          <div style={style} onLoad={measure}>
            <ListItem disablePadding sx={{ px: 0, py: 0.75 }}>
              <ListItemButton
                onClick={() => handleOpenDialog(group)}
                sx={{
                  borderRadius: 2,
                  py: 2,
                  px: 2,
                  alignItems: 'flex-start',
                  '&:hover': {
                    bgcolor: theme.palette.action.hover,
                  },
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0,
                    mt: 0.25,
                    mr: 1.5,
                  }}
                >
                  {group?.isOpen === false && (
                    <LockIcon
                      sx={{
                        color: theme.palette.other.positive,
                        fontSize: 22,
                      }}
                    />
                  )}
                  {group?.isOpen === true && (
                    <NoEncryptionGmailerrorredIcon
                      sx={{
                        color: theme.palette.other.danger,
                        fontSize: 22,
                      }}
                    />
                  )}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    variant="body1"
                    sx={{
                      fontWeight: 600,
                      color: theme.palette.text.primary,
                      lineHeight: 1.35,
                      display: 'block',
                    }}
                  >
                    {group?.groupName}
                  </Typography>
                  {group?.description && (
                    <Typography
                      variant="body2"
                      sx={{
                        color: theme.palette.text.secondary,
                        display: 'block',
                        mt: 0.75,
                        lineHeight: 1.5,
                      }}
                    >
                      {group.description}
                    </Typography>
                  )}
                  <Typography
                    variant="caption"
                    sx={{
                      color: theme.palette.text.secondary,
                      opacity: 0.85,
                      display: 'block',
                      mt: 1,
                      lineHeight: 1.4,
                    }}
                  >
                    {memberCount}{' '}
                    {t('group:group.member', { count: memberCount })}
                    {' • '}
                    {t('group:group.created', {
                      postProcess: 'capitalizeFirstChar',
                      date: createdDate,
                    })}
                  </Typography>
                </Box>
              </ListItemButton>
            </ListItem>
          </div>
        )}
      </CellMeasurer>
    );
  };

  const isSelectedGroupOpen =
    selectedGroup != null && selectedGroup?.isOpen !== false;

  return (
    <>
      <Dialog
        open={selectedGroup != null}
        onClose={handleCloseDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            maxWidth: 440,
            boxShadow: theme.shadows[12],
            overflow: 'hidden',
            bgcolor: theme.palette.background.default,
          },
        }}
        sx={{
          '& .MuiDialog-container': {
            alignItems: 'center',
            justifyContent: 'center',
          },
        }}
      >
        {selectedGroup && (
          <>
            <DialogTitle
              sx={{
                fontWeight: 700,
                fontSize: '1.25rem',
                letterSpacing: '-0.02em',
                py: 2,
                px: 2.5,
                borderBottom: `1px solid ${theme.palette.divider}`,
              }}
            >
              <Typography
                component="span"
                sx={{
                  color: theme.palette.text.secondary,
                  fontWeight: 500,
                  fontSize: '0.875rem',
                  display: 'block',
                  mb: 0.5,
                }}
              >
                {t('core:action.join', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
              <Typography
                component="span"
                sx={{
                  wordBreak: 'break-word',
                  lineHeight: 1.3,
                }}
              >
                {selectedGroup.groupName}
              </Typography>
            </DialogTitle>
            <DialogContent sx={{ px: 2.5, pt: 3, pb: 2 }}>
              <Spacer height="15px" />
              {ownerLoading && (
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{
                    mb: 2,
                    py: 1.5,
                    px: 2,
                    borderRadius: 2,
                    bgcolor: theme.palette.action.hover,
                  }}
                >
                  <CircularProgress size={18} thickness={4} />
                  <Typography variant="body2" color="text.secondary">
                    {t('core:loading.generic', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                </Stack>
              )}

              {selectedGroup.isOpen === false && (
                <Typography
                  variant="body2"
                  sx={{
                    color: theme.palette.text.secondary,
                    mb: 2,
                    lineHeight: 1.6,
                  }}
                >
                  {t('group:message.generic.closed_group', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              )}

              <Stack spacing={2}>
                <Box>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={0.75}
                    sx={{ mb: 1.5 }}
                  >
                    <DescriptionIcon
                      sx={{
                        fontSize: 18,
                        color: theme.palette.text.secondary,
                      }}
                    />
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: theme.palette.text.secondary,
                      }}
                    >
                      {t('group:group.description', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                  </Stack>
                  <Typography
                    variant="body2"
                    sx={{
                      color: theme.palette.text.primary,
                      lineHeight: 1.5,
                      pl: 2.75,
                    }}
                  >
                    {selectedGroup.description &&
                    selectedGroup.description.trim() !== ''
                      ? selectedGroup.description
                      : '—'}
                  </Typography>
                </Box>

                <Box>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={0.75}
                    sx={{ mb: 0.5 }}
                  >
                    <GroupIcon
                      sx={{
                        fontSize: 18,
                        color: theme.palette.text.secondary,
                      }}
                    />
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: theme.palette.text.secondary,
                      }}
                    >
                      {t('group:group.member_number', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                  </Stack>
                  <Typography
                    variant="body2"
                    sx={{
                      color: theme.palette.text.primary,
                      pl: 2.75,
                    }}
                  >
                    {selectedGroup.memberCount ?? 0}{' '}
                    {t('group:group.member', {
                      count: selectedGroup.memberCount ?? 0,
                    })}
                  </Typography>
                </Box>

                <Box>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={0.75}
                    sx={{ mb: 1.5 }}
                  >
                    <PersonIcon
                      sx={{
                        fontSize: 18,
                        color: theme.palette.text.secondary,
                      }}
                    />
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: theme.palette.text.secondary,
                      }}
                    >
                      {t('group:group.owner', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                  </Stack>
                  <Box sx={{ pl: 2.75 }}>
                    {ownerLoading ? (
                      <Stack spacing={0.75}>
                        <Skeleton
                          variant="text"
                          width="40%"
                          height={20}
                          sx={{ bgcolor: theme.palette.action.hover }}
                        />
                        <Skeleton
                          variant="text"
                          width="90%"
                          height={16}
                          sx={{ bgcolor: theme.palette.action.hover }}
                        />
                      </Stack>
                    ) : (
                      <>
                        {ownerPrimaryName && (
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 500,
                              color: theme.palette.text.primary,
                              mb: 0.25,
                            }}
                          >
                            {ownerPrimaryName}
                          </Typography>
                        )}
                        {ownerAddress && (
                          <Stack
                            direction="row"
                            alignItems="center"
                            spacing={0.5}
                            flexWrap="wrap"
                          >
                            <Typography
                              variant="body2"
                              component="code"
                              sx={{
                                fontFamily: 'monospace',
                                fontSize: '0.75rem',
                                color: theme.palette.text.secondary,
                                wordBreak: 'break-all',
                              }}
                            >
                              {ownerAddress}
                            </Typography>
                            <IconButton
                              size="small"
                              onClick={handleCopyAddress}
                              aria-label={t('auth:action.copy_address', {
                                postProcess: 'capitalizeFirstChar',
                              })}
                              sx={{
                                color: theme.palette.text.secondary,
                                '&:hover': {
                                  color: theme.palette.primary.main,
                                  bgcolor: theme.palette.action.selected,
                                },
                              }}
                            >
                              <ContentCopyIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        )}
                        {!ownerAddress && !ownerLoading && (
                          <Typography variant="body2" color="text.secondary">
                            —
                          </Typography>
                        )}
                      </>
                    )}
                  </Box>
                </Box>
              </Stack>

              <Divider sx={{ mt: 3.5, mb: 2 }} />

              <LoadingButton
                fullWidth
                loading={isLoading}
                loadingPosition="start"
                variant="contained"
                color="primary"
                onClick={() =>
                  handleJoinGroup(selectedGroup, isSelectedGroupOpen)
                }
                sx={{
                  py: 1.5,
                  borderRadius: 2,
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  fontSize: '0.8125rem',
                  boxShadow: theme.shadows[2],
                  '&:hover': {
                    boxShadow: theme.shadows[4],
                  },
                }}
              >
                {t('group:action.join_group', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </LoadingButton>
            </DialogContent>
          </>
        )}
      </Dialog>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          gap: 2,
          minHeight: 0,
        }}
      >
        <Typography
          variant="h6"
          sx={{
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: theme.palette.text.primary,
          }}
        >
          {t('core:list.groups', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography
            component="label"
            variant="body2"
            sx={{
              color: theme.palette.text.primary,
              fontWeight: 600,
              letterSpacing: '0.02em',
            }}
          >
            {t('core:action.search_groups', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
          <TextField
            placeholder={t('core:action.search_groups', {
              postProcess: 'capitalizeFirstChar',
            })}
            variant="outlined"
            fullWidth
            value={inputValue}
            onChange={handleChange}
            size="small"
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                bgcolor: theme.palette.background.paper,
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: theme.palette.action.hover,
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderWidth: 2,
                },
              },
            }}
          />
        </Box>

        <Box
          sx={{
            position: 'relative',
            width: '100%',
            flexGrow: 1,
            minHeight: 0,
          }}
        >
          {groupsLoading ? (
            <Stack
              alignItems="center"
              justifyContent="center"
              spacing={1.5}
              sx={{
                width: '100%',
                height: '100%',
                minHeight: 200,
              }}
            >
              <CircularProgress size={32} thickness={4} />
              <Typography variant="body2" color="text.secondary">
                {t('core:loading.generic', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Stack>
          ) : filteredItems.length === 0 ? (
            <Stack
              alignItems="center"
              justifyContent="center"
              sx={{
                width: '100%',
                height: '100%',
                minHeight: 200,
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {t('group:group.no_groups_found', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Stack>
          ) : (
            <AutoSizer>
              {({ height, width }) => (
                <List
                  ref={listRef}
                  width={width}
                  height={height}
                  rowCount={filteredItems.length}
                  rowHeight={cache.rowHeight}
                  rowRenderer={rowRenderer}
                  deferredMeasurementCache={cache}
                />
              )}
            </AutoSizer>
          )}
        </Box>
      </Box>
    </>
  );
};
