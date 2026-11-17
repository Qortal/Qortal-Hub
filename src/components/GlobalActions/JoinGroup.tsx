import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Typography,
  useTheme,
} from '@mui/material';
import { CustomButtonAccept } from '../../styles/App-styles';
import { getBaseApiReact, QORTAL_APP_CONTEXT } from '../../App';
import { getFee } from '../../background/background.ts';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { FidgetSpinner } from 'react-loader-spinner';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { memberGroupsAtom, txListAtom } from '../../atoms/global';
import { appLockedAtom } from '../../atoms/presence';
import { useTranslation } from 'react-i18next';

export const JoinGroup = () => {
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const setTxList = useSetAtom(txListAtom);
  const [memberGroups] = useAtom(memberGroupsAtom);
  // Read when a join link opens, after the listener was set up.
  const memberGroupsRef = useRef(memberGroups);
  memberGroupsRef.current = memberGroups;
  const isAppLocked = useAtomValue(appLockedAtom);
  const isAppLockedRef = useRef(isAppLocked);
  isAppLockedRef.current = isAppLocked;
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  // Set only for a group the node knows: Join waits for it.
  const [groupInfo, setGroupInfo] = useState(null);
  // 'failed' when the node couldn't be read, 'missing' when it doesn't know
  // the group.
  const [loadError, setLoadError] = useState<'failed' | 'missing' | null>(null);
  // The group the window reads, read again by Retry.
  const shownGroupIdRef = useRef(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  // Read when a link opens, before the window has drawn.
  const isOpenRef = useRef(false);
  // Only the latest request's answer is shown; closing drops it.
  const requestRef = useRef(0);
  // The join whose fee confirmation is up, if any.
  const confirmingRef = useRef<object | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  // Another Hub dialog is open, such as a fee confirmation of a join started
  // elsewhere or a Q-App's request.
  const isOtherDialogOpen = () =>
    Array.from(
      document.querySelectorAll('.MuiDialog-root:not(.MuiModal-hidden)')
    ).some((dialog) => dialog !== windowRef.current);
  const showWindow = (open: boolean) => {
    isOpenRef.current = open;
    if (!open) {
      requestRef.current += 1;
      setIsLoadingInfo(false);
    }
    setIsOpen(open);
  };
  const theme = useTheme();
  const { t } = useTranslation(['auth', 'core', 'group', 'question']);
  const [isLoadingJoinGroup, setIsLoadingJoinGroup] = useState(false);

  const handleJoinGroup = async (e) => {
    const groupId = e?.detail?.groupId;
    // A Q-App's or widget's link only opens this window, for members too,
    // never changes the group of a window that is open or of a join being
    // confirmed, and never opens over another Hub dialog or while Hub is
    // locked.
    const fromApp = !!e?.detail?.fromApp;
    if (
      fromApp &&
      (!groupId ||
        isAppLockedRef.current ||
        isOpenRef.current ||
        confirmingRef.current ||
        isOtherDialogOpen())
    )
      return;
    // A member opening the group's link goes to the group: there is nothing
    // to join.
    if (
      !fromApp &&
      groupId &&
      memberGroupsRef.current?.some((group) => +group?.groupId === +groupId)
    ) {
      executeEvent('openGroupMessage', { from: String(groupId) });
      return;
    }
    if (fromApp) e.detail.opened = true;
    setGroupInfo(null);
    if (groupId) {
      showWindow(true);
      await loadGroup(groupId);
    }
  };

  const loadGroup = async (groupId) => {
    const request = ++requestRef.current;
    shownGroupIdRef.current = groupId;
    setGroupInfo(null);
    setLoadError(null);
    setIsLoadingInfo(true);
    let group = null;
    let error: 'failed' | 'missing' | null = null;
    try {
      const response = await fetch(`${getBaseApiReact()}/groups/${groupId}`);
      const groupData = response.ok ? await response.json() : null;
      if (typeof groupData?.groupId === 'number') group = groupData;
      else error = response.status === 404 ? 'missing' : 'failed';
    } catch (err) {
      console.log(err);
      error = 'failed';
    }
    if (request !== requestRef.current) return;
    setGroupInfo(group);
    setLoadError(error);
    setIsLoadingInfo(false);
  };

  useEffect(() => {
    subscribeToEvent('globalActionJoinGroup', handleJoinGroup);

    return () => {
      unsubscribeFromEvent('globalActionJoinGroup', handleJoinGroup);
    };
  }, []);

  const isInGroup = useMemo(() => {
    return !!memberGroups.find(
      (item) => +item?.groupId === +groupInfo?.groupId
    );
  }, [memberGroups, groupInfo]);

  const joinGroup = async (group, isOpen) => {
    const confirming = {};
    const confirmed = () => {
      if (confirmingRef.current === confirming) confirmingRef.current = null;
    };
    try {
      const groupId = group.groupId;
      confirmingRef.current = confirming;
      const fee = await getFee('JOIN_GROUP');

      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'JOIN_GROUP',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });
      confirmed();

      setIsLoadingJoinGroup(true);

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
      setIsLoadingJoinGroup(false);
    } catch (error) {
      console.log(error);
    } finally {
      confirmed();
      setIsLoadingJoinGroup(false);
    }
  };

  return (
    <>
      <Dialog
        ref={windowRef}
        open={isOpen}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogContent>
          {!groupInfo && !loadError && (
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                height: '150px',
                justifyContent: 'center',
                width: '325px',
              }}
            >
              <CircularProgress
                size={25}
                sx={{
                  color: theme.palette.text.primary,
                }}
              />
            </Box>
          )}
          {loadError && (
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                justifyContent: 'center',
                minHeight: '150px',
                width: '325px',
              }}
            >
              <Typography
                sx={{
                  fontSize: '15px',
                  fontWeight: 600,
                  textAlign: 'center',
                }}
              >
                {loadError === 'missing'
                  ? t('question:message.error.no_group_found', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('group:message.error.group_info', {
                      postProcess: 'capitalizeFirstChar',
                    })}
              </Typography>
              {loadError === 'failed' && (
                <Button onClick={() => loadGroup(shownGroupIdRef.current)}>
                  {t('core:retry', { postProcess: 'capitalizeFirstChar' })}
                </Button>
              )}
            </Box>
          )}
          <Box
            sx={{
              alignItems: 'center',
              display: !groupInfo ? 'none' : 'flex',
              flexDirection: 'column',
              gap: '10px',
              height: 'auto',
              maxHeight: '400px',
              padding: '10px',
              width: '325px',
            }}
          >
            <Typography
              sx={{
                fontSize: '15px',
                fontWeight: 600,
              }}
            >
              {t('group:group.name', { postProcess: 'capitalizeFirstChar' })}:{' '}
              {` ${groupInfo?.groupName}`}
            </Typography>

            <Typography
              sx={{
                fontSize: '15px',
                fontWeight: 600,
              }}
            >
              {t('group:group.member_number', {
                postProcess: 'capitalizeFirstChar',
              })}
              : {` ${groupInfo?.memberCount}`}
            </Typography>

            {groupInfo?.description && (
              <Typography
                sx={{
                  fontSize: '15px',
                  fontWeight: 600,
                }}
              >
                {groupInfo?.description}
              </Typography>
            )}
            {isInGroup && (
              <Typography
                sx={{
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              >
                {t('group:message.generic.already_in_group', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            )}
            {!isInGroup && groupInfo?.isOpen === false && (
              <Typography
                sx={{
                  fontSize: '14px',
                  fontWeight: 600,
                }}
              >
                {t('group:message.generic.closed_group', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            )}
          </Box>
        </DialogContent>

        <DialogActions>
          <ButtonBase
            onClick={() => {
              joinGroup(groupInfo, groupInfo?.isOpen);

              showWindow(false);
            }}
            disabled={isInGroup || !groupInfo}
          >
            <CustomButtonAccept
              customColor="black"
              customBgColor={theme.palette.other.positive}
              sx={{
                minWidth: '102px',
                height: '45px',
                fontSize: '16px',
                opacity: isInGroup || !groupInfo ? 0.1 : 1,
              }}
            >
              {t('core:action.join', {
                postProcess: 'capitalizeFirstChar',
              })}
            </CustomButtonAccept>
          </ButtonBase>

          <CustomButtonAccept
            customColor="black"
            customBgColor={theme.palette.other.danger}
            sx={{
              minWidth: '102px',
              height: '45px',
            }}
            onClick={() => showWindow(false)}
          >
            {t('core:action.close', {
              postProcess: 'capitalizeFirstChar',
            })}
          </CustomButtonAccept>
        </DialogActions>
      </Dialog>

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
      {isLoadingJoinGroup && (
        <Box
          sx={{
            alignItems: 'center',
            bottom: 0,
            display: 'flex',
            justifyContent: 'center',
            left: 0,
            position: 'absolute',
            right: 0,
            top: 0,
          }}
        >
          <FidgetSpinner
            visible={true}
            height="80"
            width="80"
            ariaLabel="fidget-spinner-loading"
            wrapperStyle={{}}
            wrapperClass="fidget-spinner-wrapper"
          />
        </Box>
      )}
    </>
  );
};
