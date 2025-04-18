import {
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  IconButton,
} from '@mui/material';
import React, { useContext, useEffect, useRef } from 'react';
import PendingIcon from '@mui/icons-material/Pending';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { MyContext, getBaseApiReact, isMobile } from '../../App';
import { executeEvent } from '../../utils/events';

export const TaskManager = ({ getUserInfo }) => {
  const { txList, setTxList, memberGroups } = useContext(MyContext);
  const [open, setOpen] = React.useState(false);
  const intervals = useRef({});

  const handleClick = () => {
    setOpen((prev) => !prev);
  };

  const getStatus = ({ signature }, callback) => {
    let stop = false;
    const getAnswer = async () => {
      const getTx = async () => {
        const url = `${getBaseApiReact()}/transactions/signature/${signature}`;
        const res = await fetch(url);
        return await res.json();
      };

      if (!stop) {
        stop = true;
        try {
          const txTransaction = await getTx();
          if (!txTransaction.error && txTransaction.signature) {
            await new Promise((res) =>
              setTimeout(() => {
                res(null);
              }, 60000)
            );
            setTxList((prev) => {
              let previousData = [...prev];
              const findTxWithSignature = previousData.findIndex(
                (tx) => tx.signature === signature
              );
              if (findTxWithSignature !== -1) {
                previousData[findTxWithSignature].done = true;
                return previousData;
              }
              return previousData;
            });
            if (callback) {
              callback(true);
            }
            clearInterval(intervals.current[signature]);
          }
        } catch (error) {}
        stop = false;
      }
    };

    intervals.current[signature] = setInterval(getAnswer, 60000);
  };

  useEffect(() => {
    setTxList((prev) => {
      let previousData = [...prev];
      memberGroups.forEach((group) => {
        const findGroup = txList.findIndex(
          (tx) => tx?.type === 'joined-group' && tx?.groupId === group.groupId
        );
        if (findGroup !== -1 && !previousData[findGroup]?.done) {
          previousData[findGroup].done = true;
        }
      });

      memberGroups.forEach((group) => {
        const findGroup = txList.findIndex(
          (tx) =>
            tx?.type === 'created-group' && tx?.groupName === group.groupName
        );
        if (findGroup !== -1 && !previousData[findGroup]?.done) {
          previousData[findGroup].done = true;
        }
      });

      prev.forEach((tx, index) => {
        if (
          tx?.type === 'leave-group' &&
          memberGroups.findIndex((group) => tx?.groupId === group.groupId) ===
            -1
        ) {
          previousData[index].done = true;
        }
      });

      return previousData;
    });
  }, [memberGroups, getUserInfo]);

  useEffect(() => {
    txList.forEach((tx) => {
      if (
        [
          'created-common-secret',
          'joined-group-request',
          'join-request-accept',
        ].includes(tx?.type) &&
        tx?.signature &&
        !tx.done
      ) {
        if (!intervals.current[tx.signature]) {
          getStatus({ signature: tx.signature });
        }
      }
      if (tx?.type === 'register-name' && tx?.signature && !tx.done) {
        if (!intervals.current[tx.signature]) {
          getStatus({ signature: tx.signature }, getUserInfo);
        }
      }
      if (
        (tx?.type === 'remove-rewardShare' || tx?.type === 'add-rewardShare') &&
        tx?.signature &&
        !tx.done
      ) {
        if (!intervals.current[tx.signature]) {
          const sendEventForRewardShare = () => {
            executeEvent('refresh-rewardshare-list', {});
          };
          getStatus({ signature: tx.signature }, sendEventForRewardShare);
        }
      }
    });
  }, [txList]);

  if (isMobile || txList?.length === 0 || txList.every((item) => item?.done))
    return null;

  return (
    <>
      {!open && (
        <IconButton
          onClick={handleClick}
          sx={{
            // position: "fixed",
            // bottom: 16,
            // right: 16,
            bgcolor: 'primary.main',
            color: 'white',
            ':hover': { bgcolor: 'primary.dark' },
          }}
        >
          {txList.some((item) => !item.done) ? (
            <PendingIcon />
          ) : (
            <TaskAltIcon />
          )}
        </IconButton>
      )}
      {open && (
        <List
          sx={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            width: '300px',
            maxHeight: '400px',
            bgcolor: 'background.paper',
            boxShadow: 4,
            overflow: 'auto',
            zIndex: 10,
            padding: '0px',
          }}
          component="nav"
        >
          <ListItemButton onClick={handleClick}>
            <ListItemIcon>
              {txList.some((item) => !item.done) ? (
                <PendingIcon
                  sx={{
                    color: 'white',
                  }}
                />
              ) : (
                <TaskAltIcon
                  sx={{
                    color: 'white',
                  }}
                />
              )}
            </ListItemIcon>
            <ListItemText primary="Ongoing Transactions" />
            {open ? <ExpandLess /> : <ExpandMore />}
          </ListItemButton>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <List component="div" disablePadding>
              {txList.map((item) => (
                <ListItemButton key={item?.signature} sx={{ pl: 4 }}>
                  <ListItemText
                    primary={item?.done ? item.labelDone : item.label}
                  />
                </ListItemButton>
              ))}
            </List>
          </Collapse>
        </List>
      )}
    </>
  );
};
