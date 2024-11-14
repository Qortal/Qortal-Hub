import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Avatar,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  MenuItem,
  Popover,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import {
  AutoSizer,
  CellMeasurer,
  CellMeasurerCache,
  List,
} from "react-virtualized";
import { getNameInfo } from "./Group";
import { getBaseApi, getFee } from "../../background";
import { LoadingButton } from "@mui/lab";
import {
  MyContext,
  getArbitraryEndpointReact,
  getBaseApiReact,
  isMobile,
} from "../../App";
import { Spacer } from "../../common/Spacer";
import { CustomLoader } from "../../common/CustomLoader";
import { RequestQueueWithPromise } from "../../utils/queue/queue";
import { useRecoilState } from "recoil";
import { myGroupsWhereIAmAdminAtom, promotionTimeIntervalAtom, promotionsAtom } from "../../atoms/global";
import { Label } from "./AddGroup";
import ShortUniqueId from "short-unique-id";
import { CustomizedSnackbars } from "../Snackbar/Snackbar";
import { getGroupNames } from "./UserListOfInvites";
import { WrapperUserAction } from "../WrapperUserAction";

export const requestQueuePromos = new RequestQueueWithPromise(20);

export function utf8ToBase64(inputString: string): string {
  // Encode the string as UTF-8
  const utf8String = encodeURIComponent(inputString).replace(
    /%([0-9A-F]{2})/g,
    (match, p1) => String.fromCharCode(Number("0x" + p1))
  );

  // Convert the UTF-8 encoded string to base64
  const base64String = btoa(utf8String);
  return base64String;
}

const uid = new ShortUniqueId({ length: 8 });

const cache = new CellMeasurerCache({
  fixedWidth: true,
  defaultHeight: 50,
});

export function getGroupId(str) {
  const match = str.match(/group-(\d+)-/);
  return match ? match[1] : null;
}
const THIRTY_MINUTES = 30 * 60 * 1000; // 30 minutes in milliseconds
export const ListOfGroupPromotions = () => {
  const [popoverAnchor, setPopoverAnchor] = useState(null);
  const [openPopoverIndex, setOpenPopoverIndex] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isShowModal, setIsShowModal] = useState(false);
  const [text, setText] = useState("");
  const [myGroupsWhereIAmAdmin, setMyGroupsWhereIAmAdmin] = useRecoilState(
    myGroupsWhereIAmAdminAtom
  );
  const [promotions, setPromotions] = useRecoilState(
    promotionsAtom
  );
  const [promotionTimeInterval, setPromotionTimeInterval] = useRecoilState(
    promotionTimeIntervalAtom
  );
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [fee, setFee] = useState(null);
  const [isLoadingJoinGroup, setIsLoadingJoinGroup] = useState(false);
  const [isLoadingPublish, setIsLoadingPublish] = useState(false);
  const { show, setTxList } = useContext(MyContext);

  const listRef = useRef();

  useEffect(() => {
    try {
      (async () => {
        const feeRes = await getFee("ARBITRARY");
        setFee(feeRes?.fee);
      })();
    } catch (error) {}
  }, []);
  const getPromotions = useCallback(async () => {
    try {
      setPromotionTimeInterval(Date.now())
      const identifier = `group-promotions-ui24-`;
      const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT&identifier=${identifier}&limit=100&includemetadata=false&reverse=true&prefix=true`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const responseData = await response.json();
      let data: any[] = [];
      const uniqueGroupIds = new Set();
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const getPromos = responseData?.map(async (promo: any) => {
        if (promo?.size < 200 && promo.created > oneWeekAgo) {
          const name = await requestQueuePromos.enqueue(async () => {
            const url = `${getBaseApiReact()}/arbitrary/${promo.service}/${
              promo.name
            }/${promo.identifier}`;
            const response = await fetch(url, {
              method: "GET",
            });

            try {
              const responseData = await response.text();
              if (responseData) {
                const groupId = getGroupId(promo.identifier);

                // Check if this groupId has already been processed
                if (!uniqueGroupIds.has(groupId)) {
                  // Add the groupId to the set
                  uniqueGroupIds.add(groupId);

                  // Push the item to data
                  data.push({
                    data: responseData,
                    groupId,
                    ...promo,
                  });
                }
              }
            } catch (error) {
              console.error("Error fetching promo:", error);
            }
          });
        }

        return true;
      });

      await Promise.all(getPromos);
      const groupWithInfo = await getGroupNames(data);
      setPromotions(groupWithInfo);
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    const now = Date.now();
    
    const timeSinceLastFetch = now - promotionTimeInterval;
    const initialDelay = timeSinceLastFetch >= THIRTY_MINUTES 
      ? 0 
      : THIRTY_MINUTES - timeSinceLastFetch;
    const initialTimeout = setTimeout(() => {
      getPromotions();
  
      // Start a 30-minute interval
      const interval = setInterval(() => {
        getPromotions();
      }, THIRTY_MINUTES);
  
      return () => clearInterval(interval);
    }, initialDelay);
  
    return () => clearTimeout(initialTimeout);
  }, [getPromotions]);

  const handlePopoverOpen = (event, index) => {
    setPopoverAnchor(event.currentTarget);
    setOpenPopoverIndex(index);
  };

  const handlePopoverClose = () => {
    setPopoverAnchor(null);
    setOpenPopoverIndex(null);
  };
  const publishPromo = async () => {
    try {
      setIsLoadingPublish(true);

      const data = utf8ToBase64(text);
      const identifier = `group-promotions-ui24-group-${selectedGroup}-${uid.rnd()}`;

      await new Promise((res, rej) => {
        window
          .sendMessage("publishOnQDN", {
            data: data,
            identifier: identifier,
            service: "DOCUMENT",
          })
          .then((response) => {
            if (!response?.error) {
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(error.message || "An error occurred");
          });
      });
      setInfoSnack({
        type: "success",
        message:
          "Successfully published promotion. It may take a couple of minutes for the promotion to appear",
      });
      setOpenSnack(true);
      setText("");
      setSelectedGroup(null);
      setIsShowModal(false);
    } catch (error) {
      setInfoSnack({
        type: "error",
        message:
          error?.message || "Error publishing the promotion. Please try again",
      });
      setOpenSnack(true);
    } finally {
      setIsLoadingPublish(false);
    }
  };

  const handleJoinGroup = async (group, isOpen) => {
    try {
      const groupId = group.groupId;
      const fee = await getFee("JOIN_GROUP");
      await show({
        message: "Would you like to perform an JOIN_GROUP transaction?",
        publishFee: fee.fee + " QORT",
      });
      setIsLoadingJoinGroup(true);
      await new Promise((res, rej) => {
        window
          .sendMessage("joinGroup", {
            groupId,
          })
          .then((response) => {
            if (!response?.error) {
              setInfoSnack({
                type: "success",
                message:
                  "Successfully requested to join group. It may take a couple of minutes for the changes to propagate",
              });

              if (isOpen) {
                setTxList((prev) => [
                  {
                    ...response,
                    type: "joined-group",
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
                    type: "joined-group-request",
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
      setIsLoadingJoinGroup(false);
    } catch (error) {
    } finally {
      setIsLoadingJoinGroup(false);
    }
  };

  // const handleCancelInvitation = async (address)=> {
  //   try {
  //     const fee = await getFee('CANCEL_GROUP_INVITE')
  //     await show({
  //       message: "Would you like to perform a CANCEL_GROUP_INVITE transaction?" ,
  //       publishFee: fee.fee + ' QORT'
  //     })
  //     setIsLoadingCancelInvite(true)
  //     await new Promise((res, rej)=> {
  //       window.sendMessage("cancelInvitationToGroup", {
  //         groupId,
  //         qortalAddress: address,
  //       })
  //         .then((response) => {
  //           if (!response?.error) {
  //             setInfoSnack({
  //               type: "success",
  //               message: "Successfully canceled invitation. It may take a couple of minutes for the changes to propagate",
  //             });
  //             setOpenSnack(true);
  //             handlePopoverClose();
  //             setIsLoadingCancelInvite(true);
  //             res(response);
  //             return;
  //           }
  //           setInfoSnack({
  //             type: "error",
  //             message: response?.error,
  //           });
  //           setOpenSnack(true);
  //           rej(response.error);
  //         })
  //         .catch((error) => {
  //           setInfoSnack({
  //             type: "error",
  //             message: error.message || "An error occurred",
  //           });
  //           setOpenSnack(true);
  //           rej(error);
  //         });

  //       })
  //   } catch (error) {

  //   } finally {
  //     setIsLoadingCancelInvite(false)
  //   }
  // }

  const rowRenderer = ({ index, key, parent, style }) => {
    const promotion = promotions[index];

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
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
                padding: "0px 20px",
              }}
            >
              <Popover
                open={openPopoverIndex === promotion?.groupId}
                anchorEl={popoverAnchor}
                onClose={(event, reason) => {
                  if (reason === "backdropClick") {
                    // Prevent closing on backdrop click
                    return;
                  }
                  handlePopoverClose(); // Close only on other events like Esc key press
                }}
                anchorOrigin={{
                  vertical: "top",
                  horizontal: "center",
                }}
                transformOrigin={{
                  vertical: "bottom",
                  horizontal: "center",
                }}
                style={{ marginTop: "8px" }}
              >
                <Box
                  sx={{
                    width: "325px",
                    height: "auto",
                    maxHeight: "400px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "10px",
                    padding: "10px",
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: "13px",
                      fontWeight: 600,
                    }}
                  >
                    Group name: {` ${promotion?.groupName}`}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: "13px",
                      fontWeight: 600,
                    }}
                  >
                    Number of members: {` ${promotion?.memberCount}`}
                  </Typography>
                  {promotion?.description && (
                    <Typography
                      sx={{
                        fontSize: "13px",
                        fontWeight: 600,
                      }}
                    >
                      {promotion?.description}
                    </Typography>
                  )}
                  {promotion?.isOpen === false && (
                    <Typography
                      sx={{
                        fontSize: "13px",
                        fontWeight: 600,
                      }}
                    >
                      *This is a closed/private group, so you will need to wait
                      until an admin accepts your request
                    </Typography>
                  )}
                  <Spacer height="5px" />
                  <Box
                    sx={{
                      display: "flex",
                      gap: "20px",
                      alignItems: "center",
                      width: "100%",
                      justifyContent: "center",
                    }}
                  >
                    <LoadingButton
                      loading={isLoadingJoinGroup}
                      loadingPosition="start"
                      variant="contained"
                      onClick={handlePopoverClose}
                    >
                      Close
                    </LoadingButton>
                    <LoadingButton
                      loading={isLoadingJoinGroup}
                      loadingPosition="start"
                      variant="contained"
                      onClick={() =>
                        handleJoinGroup(promotion, promotion?.isOpen)
                      }
                    >
                      Join
                    </LoadingButton>
                  </Box>
                </Box>
              </Popover>

              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: "15px",
                  }}
                >
                  <Avatar
                    sx={{
                      backgroundColor: "#27282c",
                      color: "white",
                    }}
                    alt={promotion?.name}
                    src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
                      promotion?.name
                    }/qortal_avatar?async=true`}
                  >
                    {promotion?.name?.charAt(0)}
                  </Avatar>
                  <Typography
                    sx={{
                      fontWight: 600,
                      fontFamily: "Inter",
                      color: "cadetBlue",
                    }}
                  >
                    {promotion?.name}
                  </Typography>
                </Box>
                <Typography
                  sx={{
                    fontWight: 600,
                    fontFamily: "Inter",
                    color: "cadetBlue",
                  }}
                >
                  {promotion?.groupName}
                </Typography>
              </Box>
              <Spacer height="20px" />
              <Typography
                sx={{
                  fontWight: 600,
                  fontFamily: "Inter",
                  color: "cadetBlue",
                }}
              >
                {promotion?.data}
              </Typography>
              <Spacer height="20px" />
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "center",
                  width: "100%",
                }}
              >
                <Button
                  variant="contained"
                  onClick={(event) => handlePopoverOpen(event, promotion?.groupId)}
                  sx={{
                    fontSize: "12px",
                  }}
                >
                  Join Group: {` ${promotion?.groupName}`}
                </Button>
              </Box>
            </Box>
            <Spacer height="50px" />
          </div>
        )}
      </CellMeasurer>
    );
  };


  return (
    <Box
      sx={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        marginTop: "25px",
      }}
    >
      <Box
        sx={{
          width: isMobile ? "320px" : "750px",
          maxWidth: "90%",
          display: "flex",
          flexDirection: "column",
          padding: "0px 20px",
        }}
      >
        <Box
          sx={{
            width: "100%",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Typography
            sx={{
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            Group Promotions
          </Typography>
          <Button
            variant="contained"
            onClick={() => setIsShowModal(true)}
            sx={{
              fontSize: "12px",
            }}
          >
            Add Promotion
          </Button>
        </Box>
        <Spacer height="10px" />
      </Box>

      <Box
        sx={{
          width: isMobile ? "320px" : "750px",
          maxWidth: "90%",
          maxHeight: "700px",
          display: "flex",
          flexDirection: "column",
          bgcolor: "background.paper",
          padding: "20px 0px",
          borderRadius: "19px",
        }}
      >
        {loading && promotions.length === 0 && (
          <Box
            sx={{
              width: "100%",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <CustomLoader />
          </Box>
        )}
        {!loading && promotions.length === 0 && (
          <Box
            sx={{
              width: "100%",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
            }}
          >
            <Typography
              sx={{
                fontSize: "11px",
                fontWeight: 400,
                color: "rgba(255, 255, 255, 0.2)",
              }}
            >
              Nothing to display
            </Typography>
          </Box>
        )}
        <div
          style={{
            height: "600px",
          }}
        >
          <AutoSizer>
            {({ height, width }) => (
              <List
                ref={listRef}
                width={width}
                height={height}
                rowCount={promotions.length}
                rowHeight={cache.rowHeight}
                rowRenderer={rowRenderer}
                deferredMeasurementCache={cache}
              />
            )}
          </AutoSizer>
        </div>
      </Box>
      <Spacer height="20px" />

      {isShowModal && (
        <Dialog
          open={isShowModal}
          aria-labelledby="alert-dialog-title"
          aria-describedby="alert-dialog-description"
        >
          <DialogTitle id="alert-dialog-title">
            {"Publish Group Promotion"}
          </DialogTitle>
          <DialogContent>
            <DialogContentText id="alert-dialog-description">
              Only the latest promotion from the week will be shown for your
              group.
            </DialogContentText>
            <DialogContentText id="alert-dialog-description2">
              Max 200 characters. Publish Fee: {fee && fee} {" QORT"}
            </DialogContentText>
            <Spacer height="20px" />
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: "5px",
              }}
            >
              <Label>Select a group</Label>
              <Label>Only groups where you are an admin will be shown</Label>
              <Select
                labelId="demo-simple-select-label"
                id="demo-simple-select"
                value={selectedGroup}
                label="Groups where you are an admin"
                onChange={(e) => setSelectedGroup(e.target.value)}
              >
                {myGroupsWhereIAmAdmin?.map((group) => {
                  return (
                    <MenuItem key={group?.groupId} value={group?.groupId}>
                      {group?.groupName}
                    </MenuItem>
                  );
                })}
              </Select>
            </Box>
            <Spacer height="20px" />
            <TextField
              label="Promotion text"
              variant="filled"
              fullWidth
              value={text}
              onChange={(e) => setText(e.target.value)}
              inputProps={{
                maxLength: 200,
              }}
              multiline={true}
              sx={{
                "& .MuiFormLabel-root": {
                  color: "white",
                },
                "& .MuiFormLabel-root.Mui-focused": {
                  color: "white",
                },
              }}
            />
          </DialogContent>
          <DialogActions>
            <Button
              disabled={isLoadingPublish}
              variant="contained"
              onClick={() => setIsShowModal(false)}
            >
              Close
            </Button>
            <Button
              disabled={!text.trim() || !selectedGroup || isLoadingPublish}
              variant="contained"
              onClick={publishPromo}
              autoFocus
            >
              Publish
            </Button>
          </DialogActions>
        </Dialog>
      )}
      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </Box>
  );
};
