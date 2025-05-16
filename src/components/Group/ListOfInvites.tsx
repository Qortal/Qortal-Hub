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
import { useTranslation } from 'react-i18next';

export const getMemberInvites = async (groupNumber) => {
  const response = await fetch(
    `${getBaseApiReact()}/groups/invites/group/${groupNumber}?limit=0`
  );
  const groupData = await response.json();
  return groupData;
};

const getNames = async (listOfMembers, includeNoNames) => {
  let members = [];
  if (listOfMembers && Array.isArray(listOfMembers)) {
    for (const member of listOfMembers) {
      if (member.invitee) {
        const name = await getNameInfo(member.invitee);
        if (name) {
          members.push({ ...member, name });
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

export const ListOfInvites = ({
  groupId,
  setInfoSnack,
  setOpenSnack,
  show,
}) => {
  const [invites, setInvites] = useState([]);
  const [popoverAnchor, setPopoverAnchor] = useState(null); // Track which list item the popover is anchored to
  const [openPopoverIndex, setOpenPopoverIndex] = useState(null); // Track which list item has the popover open
  const [isLoadingCancelInvite, setIsLoadingCancelInvite] = useState(false);
  const { t } = useTranslation(['core', 'group']);
  const listRef = useRef(null);

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

  const handleCancelInvitation = async (address) => {
    try {
      const fee = await getFee('CANCEL_GROUP_INVITE');

      await show({
        message: t('group:question.perform_transaction', {
          action: 'CANCEL_GROUP_INVITE',
          postProcess: 'capitalizeFirst',
        }),
        publishFee: fee.fee + ' QORT',
      });

      setIsLoadingCancelInvite(true);

      await new Promise((res, rej) => {
        window
          .sendMessage('cancelInvitationToGroup', {
            groupId,
            qortalAddress: address,
          })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: 'success',
                message: t('group:message.success.invitation_cancellation', {
                  postProcess: 'capitalizeFirst',
                }),
              });
              setOpenSnack(true);
              handlePopoverClose();
              setIsLoadingCancelInvite(true);
              res(response);
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
                error.message ||
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
      setIsLoadingCancelInvite(false);
    }
  };

  const rowRenderer = ({ index, key, parent, style }) => {
    const member = invites[index];

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
                    alignItems: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    height: '250px',
                    padding: '10px',
                    width: '325px',
                  }}
                >
                  <LoadingButton
                    loading={isLoadingCancelInvite}
                    loadingPosition="start"
                    variant="contained"
                    onClick={() => handleCancelInvitation(member?.invitee)}
                  >
                    {t('core:action.cancel_invitation', {
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

                <ListItemText primary={member?.name || member?.invitee} />
              </ListItemButton>
            </ListItem>
          </div>
        )}
      </CellMeasurer>
    );
  };

  return (
    <div>
      <p>
        {t('group:invitees_list', {
          postProcess: 'capitalizeFirst',
        })}
      </p>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 1,
          height: '500px',
          position: 'relative',
          width: '100%',
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
