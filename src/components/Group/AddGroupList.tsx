import {
  Box,
  Button,
  ListItem,
  ListItemButton,
  ListItemText,
  Popover,
  TextField,
  Typography,
} from "@mui/material";
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  List,
} from "react-virtualized";
import _ from "lodash";
import { MyContext, getBaseApiReact } from "../../App";
import { LoadingButton } from "@mui/lab";
import { getBaseApi, getFee } from "../../background";
import LockIcon from '@mui/icons-material/Lock';
import NoEncryptionGmailerrorredIcon from '@mui/icons-material/NoEncryptionGmailerrorred';
import { Spacer } from "../../common/Spacer";
const cache = new CellMeasurerCache({
  fixedWidth: true,
  defaultHeight: 50,
});

export const AddGroupList = ({ setInfoSnack, setOpenSnack }) => {
  const { memberGroups, show, setTxList } = useContext(MyContext);

  const [groups, setGroups] = useState([]);
  const [popoverAnchor, setPopoverAnchor] = useState(null); // Track which list item the popover is anchored to
  const [openPopoverIndex, setOpenPopoverIndex] = useState(null); // Track which list item has the popover open
  const listRef = useRef();
  const [inputValue, setInputValue] = useState("");
  const [filteredItems, setFilteredItems] = useState(groups);
  const [isLoading, setIsLoading] = useState(false);

  const handleFilter = useCallback(
    (query) => {
      if (query) {
        setFilteredItems(
          groups.filter((item) =>
            item.groupName.toLowerCase().includes(query.toLowerCase())
          )
        );
      } else {
        setFilteredItems(groups);
      }
    },
    [groups]
  );
  const debouncedFilter = useMemo(
    () => _.debounce(handleFilter, 500),
    [handleFilter]
  );

  const handleChange = (event) => {
    const value = event.target.value;
    setInputValue(value);
    debouncedFilter(value);
  };

  const getGroups = async () => {
    try {
      const response = await fetch(
        `${getBaseApiReact()}/groups/?limit=0`
      );
      const groupData = await response.json();
      const filteredGroup = groupData.filter(
        (item) => !memberGroups.find((group) => group.groupId === item.groupId)
      );
      setGroups(filteredGroup);
      setFilteredItems(filteredGroup);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    getGroups();
  }, [memberGroups]);

  const handlePopoverOpen = (event, index) => {
    setPopoverAnchor(event.currentTarget);
    setOpenPopoverIndex(index);
  };

  const handlePopoverClose = () => {
    setPopoverAnchor(null);
    setOpenPopoverIndex(null);
  };

  const handleJoinGroup = async (group, isOpen) => {
    try {
      const groupId = group.groupId;
      const fee = await getFee('JOIN_GROUP')
          await show({
            message: "Would you like to perform an JOIN_GROUP transaction?" ,
            publishFee: fee.fee + ' QORT'
          })
      setIsLoading(true);
      await new Promise((res, rej) => {
        window.sendMessage("joinGroup", {
          groupId,
        })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: "success",
                message: "Successfully requested to join group. It may take a couple of minutes for the changes to propagate",
              });
        
              if (isOpen) {
                setTxList((prev) => [
                  {
                    ...response,
                    type: 'joined-group',
                    label: `Joined Group ${group?.groupName}: awaiting confirmation`,
                    labelDone: `Joined Group ${group?.groupName}: success!`,
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
                    label: `Requested to join Group ${group?.groupName}: awaiting confirmation`,
                    labelDone: `Requested to join Group ${group?.groupName}: success!`,
                    done: false,
                    groupId,
                  },
                  ...prev,
                ]);
              }
        
              setOpenSnack(true);
              handlePopoverClose();
              res(response);
              return;
            } else {
              setInfoSnack({
                type: "error",
                message: response?.error,
              });
              setOpenSnack(true);
              rej(response.error);
            }
          })
          .catch((error) => {
            setInfoSnack({
              type: "error",
              message: error.message || "An error occurred",
            });
            setOpenSnack(true);
            rej(error);
          });
        
      });
      setIsLoading(false);
    } catch (error) {} finally {
      setIsLoading(false);

    }
  };

  const rowRenderer = ({ index, key, parent, style }) => {
    const group = filteredItems[index];

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
                  vertical: "bottom",
                  horizontal: "center",
                }}
                transformOrigin={{
                  vertical: "top",
                  horizontal: "center",
                }}
                style={{ marginTop: "8px" }}
              >
                <Box
                  sx={{
                    width: "325px",
                    height: "250px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px",
                  }}
                >
                  <Typography>Join {group?.groupName}</Typography>
                  <Typography>
                    {group?.isOpen === false &&
                      "This is a closed/private group, so you will need to wait until an admin accepts your request"}
                  </Typography>
                  <LoadingButton
                    loading={isLoading}
                    loadingPosition="start"
                    variant="contained"
                    onClick={() => handleJoinGroup(group, group?.isOpen)}
                  >
                    Join group
                  </LoadingButton>
                </Box>
              </Popover>
              <ListItemButton
                onClick={(event) => handlePopoverOpen(event, index)}
              >
                {group?.isOpen === false && (
          <LockIcon sx={{
            color: 'var(--green)'
          }} />
        )}
        {group?.isOpen === true && (
          <NoEncryptionGmailerrorredIcon sx={{
            color: 'var(--danger)'
          }} />
        )}
        <Spacer width="15px" />
                <ListItemText
                  primary={group?.groupName}
                  secondary={group?.description}
                />
              </ListItemButton>
            </ListItem>
          </div>
        )}
      </CellMeasurer>
    );
  };

  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      flexGrow: 1
    }}>
      <p>Groups list</p>
      <TextField
        label="Search for Groups"
        variant="outlined"
        fullWidth
        value={inputValue}
        onChange={handleChange}
      />
      <div
        style={{
          position: "relative",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
        }}
      >
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
      </div>
    </Box>
  );
};
