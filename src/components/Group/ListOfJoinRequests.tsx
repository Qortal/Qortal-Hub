import { useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Popover,
} from '@mui/material';
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  List,
} from 'react-virtualized';
import { getNameInfo } from './Group';
import { getFee } from '../../background';
import { LoadingButton } from '@mui/lab';
import { getBaseApiReact } from '../../App';
import { txListAtom } from '../../atoms/global';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

export const getMemberInvites = async (groupNumber) => {
  const response = await fetch(
    `${getBaseApiReact()}/groups/joinrequests/${groupNumber}?limit=0`
  );
  const groupData = await response.json();
  return groupData;
};

const getNames = async (listOfMembers, includeNoNames) => {
  let members = [];
  if (listOfMembers && Array.isArray(listOfMembers)) {
    for (const member of listOfMembers) {
      if (member.joiner) {
        const name = await getNameInfo(member.joiner);
        if (name) {
          members.push({ ...member, name: name || '' });
        } else if (includeNoNames) {
          members.push({ ...member, name: name || '' });
        }
      }
    }
  }
  return members;
};

const cache = new CellMeasurerCache({
  fixedWidth: true,
  defaultHeight: 50,
});

export const ListOfJoinRequests = ({
  groupId,
  setInfoSnack,
  setOpenSnack,
  show,
}) => {
  const [invites, setInvites] = useState([]);
  const [txList, setTxList] = useAtom(txListAtom);
  const [popoverAnchor, setPopoverAnchor] = useState(null); // Track which list item the popover is anchored to
  const [openPopoverIndex, setOpenPopoverIndex] = useState(null); // Track which list item has the popover open
  const listRef = useRef(null);
  const [isLoadingAccept, setIsLoadingAccept] = useState(false);
  const { t } = useTranslation(['auth', 'core', 'group']);

  const getInvites = async (groupId) => {
    try {
      const res = await getMemberInvites(groupId);
      const resWithNames = await getNames(res, true);
      setInvites(resWithNames);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (groupId) {
      getInvites(groupId);
    }
  }, [groupId]);

  const handlePopoverOpen = (event, index) => {
    setPopoverAnchor(event.currentTarget);
    setOpenPopoverIndex(index);
  };

  const handlePopoverClose = () => {
    setPopoverAnchor(null);
    setOpenPopoverIndex(null);
  };

  const handleAcceptJoinRequest = async (address) => {
    try {
      const fee = await getFee('GROUP_INVITE');

      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'GROUP_INVITE',
          postProcess: 'capitalizeFirst',
        }),
        publishFee: fee.fee + ' QORT',
      });

      setIsLoadingAccept(true);

      await new Promise((res, rej) => {
        window
          .sendMessage('inviteToGroup', {
            groupId,
            qortalAddress: address,
            inviteTime: 10800,
          })
          .then((response) => {
            if (!response?.error) {
              setIsLoadingAccept(false);
              setInfoSnack({
                type: 'success',
                message: t('group:message.success,group_join', {
                  postProcess: 'capitalizeFirst',
                }),
              });
              setOpenSnack(true);
              handlePopoverClose();
              res(response);
              setTxList((prev) => [
                {
                  ...response,
                  type: 'join-request-accept',
                  label: t('group:message.success,invitation_request', {
                    postProcess: 'capitalizeFirst',
                  }),
                  labelDone: t('group:message.success,user_joined', {
                    postProcess: 'capitalizeFirst',
                  }),
                  done: false,
                  groupId,
                  qortalAddress: address,
                },
                ...prev,
              ]);

              return;
            }

            setInfoSnack({
              type: 'error',
              message: response?.error,
            });
            setOpenSnack(true);
            rej(response.error);
          })
          .catch((error) => {
            setInfoSnack({
              type: 'error',
              message:
                error?.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirst',
                }),
            });
            setOpenSnack(true);
            rej(error);
          });
      });
    } catch (error) {
      console.log(error);
    } finally {
      setIsLoadingAccept(false);
    }
  };

  const rowRenderer = ({ index, key, parent, style }) => {
    const member = invites[index];
    const findJoinRequestInTxList = txList?.find(
      (tx) =>
        tx?.groupId === groupId &&
        tx?.qortalAddress === member?.joiner &&
        tx?.type === 'join-request-accept'
    );

    if (findJoinRequestInTxList) return null;

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
            <ListItem disablePadding>
              <Popover
                open={openPopoverIndex === index}
                anchorEl={popoverAnchor}
                onClose={handlePopoverClose}
                anchorOrigin={{
                  vertical: 'bottom',
                  horizontal: 'center',
                }}
                transformOrigin={{
                  vertical: 'top',
                  horizontal: 'center',
                }}
                style={{ marginTop: '8px' }}
              >
                <Box
                  sx={{
                    width: '325px',
                    height: '250px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px',
                  }}
                >
                  <LoadingButton
                    loading={isLoadingAccept}
                    loadingPosition="start"
                    variant="contained"
                    onClick={() => handleAcceptJoinRequest(member?.joiner)}
                  >
                    {t('core:action.accept', {
                      postProcess: 'capitalizeFirst',
                    })}
                  </LoadingButton>
                </Box>
              </Popover>

              <ListItemButton
                onClick={(event) => handlePopoverOpen(event, index)}
              >
                <ListItemAvatar>
                  <Avatar
                    alt={member?.name}
                    src={
                      member?.name
                        ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${member?.name}/qortal_avatar?async=true`
                        : ''
                    }
                  />
                </ListItemAvatar>
                <ListItemText primary={member?.name || member?.joiner} />
              </ListItemButton>
            </ListItem>
          </div>
        )}
      </CellMeasurer>
    );
  };

  return (
    <div>
      <p>{t('core:list.join_request', { postProcess: 'capitalizeFirst' })}</p>
      <div
        style={{
          position: 'relative',
          height: '500px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 1,
        }}
      >
        <AutoSizer>
          {({ height, width }) => (
            <List
              ref={listRef}
              width={width}
              height={height}
              rowCount={invites.length}
              rowHeight={cache.rowHeight}
              rowRenderer={rowRenderer}
              deferredMeasurementCache={cache}
            />
          )}
        </AutoSizer>
      </div>
    </div>
  );
};
