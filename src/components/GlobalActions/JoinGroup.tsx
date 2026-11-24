import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
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
import { useAtom, useAtomValue, useStore } from 'jotai';
import {
  memberGroupsAtom,
  rawWalletAtom,
  txListAtom,
  userInfoAtom,
} from '../../atoms/global';
import { appLockedAtom } from '../../atoms/presence';
import { useTranslation } from 'react-i18next';

/** Hub's task records of a join: being sent, or sent (done once confirmed). */
const JOIN_RECORDS = ['joining-group', 'joined-group', 'joined-group-request'];

/**
 * A join of `groupId` that Hub's task list has on its way, as Find groups
 * reads it: one being sent, or one sent whose record isn't done yet.
 */
const isJoinOnItsWay = (txList, groupId) =>
  (txList || []).some(
    (record) =>
      JOIN_RECORDS.includes(record?.type) &&
      record?.done !== true &&
      Number(record?.groupId) === Number(groupId)
  );

export const JoinGroup = () => {
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const [txList, setTxList] = useAtom(txListAtom);
  const titleId = useId();
  const descriptionId = useId();
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
  // Read after a join's waits, which can outlast this window (it goes when
  // the account signs out) and the account that pressed Join.
  const store = useStore();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
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
    // The join belongs to the account that pressed Join. Hub signs a join
    // with whichever account is signed in when it is sent, so after each
    // wait the join goes on only for that account, from this window. The
    // wallet's address is known from unlock on; the account info only once
    // the node has answered (as chatAccount() reads it).
    const signedIn = () =>
      store.get(rawWalletAtom)?.address0 ||
      store.get(userInfoAtom)?.address ||
      null;
    const account = signedIn();
    const sameAccount = () => signedIn() === account;
    const stillItsJoin = () => mountedRef.current && sameAccount();
    // This join's record in Hub's task list while it is being sent.
    let sending: object | null = null;
    try {
      const groupId = group.groupId;
      confirmingRef.current = confirming;
      const fee = await getFee('JOIN_GROUP');
      // Signed out, or another account signed in, meanwhile: no confirmation.
      if (!stillItsJoin()) return;

      // Another fee confirmation taking this one's place answers it as
      // declined, so this join stops holding Q-Apps' group links.
      await show(
        {
          message: t('core:message.question.perform_transaction', {
            action: 'JOIN_GROUP',
            postProcess: 'capitalizeFirstChar',
          }),
          publishFee: fee.fee + ' QORT',
        },
        { cancelIfReplaced: true }
      );
      confirmed();
      // The same while the confirmation was up: nothing is sent.
      if (!stillItsJoin()) return;
      // Another join of this group went out while this one waited (its link
      // opened again while this fee was looked up), or the account is in the
      // group now: nothing more to send.
      if (
        isJoinOnItsWay(store.get(txListAtom), groupId) ||
        (store.get(memberGroupsAtom) || []).some(
          (item) => +item?.groupId === +groupId
        )
      )
        return;
      // In Hub's task list from now on, before the node has answered; the
      // record of the join that was sent takes its place.
      const record = {
        type: 'joining-group',
        label: isOpen
          ? t('group:message.success.group_join_name', {
              group_name: group?.groupName,
              postProcess: 'capitalizeFirstChar',
            })
          : t('group:message.success.group_join_request', {
              group_name: group?.groupName,
              postProcess: 'capitalizeFirstChar',
            }),
        done: false,
        groupId,
      };
      sending = record;
      setTxList((prev) => [record, ...prev]);

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

              // The join that was sent takes the place of its record, in the
              // task list of the account that sent it only.
              const sent = sending;
              sending = null;
              if (!sameAccount()) {
                // Another account's list now: the join isn't one of its
                // tasks, and its record of the join being sent goes.
                setTxList((prev) => prev.filter((item) => item !== sent));
              } else if (isOpen) {
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
                  ...prev.filter((item) => item !== sent),
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
                  ...prev.filter((item) => item !== sent),
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
      // A join that wasn't sent comes off Hub's task list.
      if (sending) {
        const failed = sending;
        setTxList((prev) => prev.filter((item) => item !== failed));
      }
      setIsLoadingJoinGroup(false);
    }
  };

  const onItsWay = !!groupInfo && isJoinOnItsWay(txList, groupInfo.groupId);
  const canJoin = !!groupInfo && !isInGroup && !onItsWay;
  const buttonFocusSx = {
    borderRadius: '5px',
    '&.Mui-focusVisible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: '2px',
    },
  };

  return (
    <>
      <Dialog
        ref={windowRef}
        open={isOpen}
        onClose={(_event, reason) => {
          if (reason === 'escapeKeyDown') showWindow(false);
        }}
        // Named after its group, or what went wrong; "loading" while the
        // group is read.
        aria-labelledby={groupInfo || loadError ? titleId : undefined}
        slotProps={{
          paper: {
            'aria-label':
              groupInfo || loadError
                ? undefined
                : t('core:loading.generic', {
                    postProcess: 'capitalizeFirstChar',
                  }),
          },
        }}
        aria-describedby={
          groupInfo?.description && !loadError ? descriptionId : undefined
        }
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
                id={titleId}
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
              id={loadError ? undefined : titleId}
              sx={{
                fontSize: '15px',
                fontWeight: 600,
              }}
            >
              {t('group:group.name', { postProcess: 'capitalizeFirstChar' })}:{' '}
              {` ${groupInfo?.groupName ?? ''}`}
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
                id={descriptionId}
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
            disabled={!canJoin}
            sx={buttonFocusSx}
          >
            <CustomButtonAccept
              customColor="black"
              customBgColor={theme.palette.other.positive}
              sx={{
                minWidth: '102px',
                height: '45px',
                fontSize: '16px',
                opacity: canJoin ? 1 : onItsWay ? 0.6 : 0.1,
              }}
            >
              {/* A join on its way says so, as Find groups does. */}
              {onItsWay
                ? t('group:find_groups.action_pending')
                : t('core:action.join', {
                    postProcess: 'capitalizeFirstChar',
                  })}
            </CustomButtonAccept>
          </ButtonBase>

          <ButtonBase onClick={() => showWindow(false)} sx={buttonFocusSx}>
            <CustomButtonAccept
              customColor="black"
              customBgColor={theme.palette.other.danger}
              sx={{
                minWidth: '102px',
                height: '45px',
              }}
            >
              {t('core:action.close', {
                postProcess: 'capitalizeFirstChar',
              })}
            </CustomButtonAccept>
          </ButtonBase>
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
