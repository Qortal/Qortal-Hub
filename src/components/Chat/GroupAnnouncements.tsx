import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CreateCommonSecret } from "./CreateCommonSecret";
import { reusableGet } from "../../qdn/publish/pubish";
import { uint8ArrayToObject } from "../../backgroundFunctions/encryption";
import {
  base64ToUint8Array,
  objectToBase64,
} from "../../qdn/encryption/group-encryption";
import { ChatContainerComp } from "./ChatContainer";
import { ChatList } from "./ChatList";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import Tiptap from "./TipTap";
import { AuthenticatedContainerInnerTop, CustomButton } from "../../App-styles";
import CircularProgress from "@mui/material/CircularProgress";
import { getBaseApi, getFee } from "../../background";
import { LoadingSnackbar } from "../Snackbar/LoadingSnackbar";
import { Box, Typography } from "@mui/material";
import { Spacer } from "../../common/Spacer";
import ShortUniqueId from "short-unique-id";
import { AnnouncementList } from "./AnnouncementList";
const uid = new ShortUniqueId({ length: 8 });
import CampaignIcon from "@mui/icons-material/Campaign";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { AnnouncementDiscussion } from "./AnnouncementDiscussion";
import {
  MyContext,
  getArbitraryEndpointReact,
  getBaseApiReact,
  isMobile,
  pauseAllQueues,
  resumeAllQueues,
} from "../../App";
import { RequestQueueWithPromise } from "../../utils/queue/queue";
import { CustomizedSnackbars } from "../Snackbar/Snackbar";
import { addDataPublishesFunc, getDataPublishesFunc } from "../Group/Group";
import { getRootHeight } from "../../utils/mobile/mobileUtils";

export const requestQueueCommentCount = new RequestQueueWithPromise(3);
export const requestQueuePublishedAccouncements = new RequestQueueWithPromise(
  3
);

export const saveTempPublish = async ({ data, key }: any) => {
  return new Promise((res, rej) => {
    window.sendMessage("saveTempPublish", {
      data,
      key,
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
};

export const getTempPublish = async () => {
  return new Promise((res, rej) => {
    window.sendMessage("getTempPublish", {})
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
};

export const decryptPublishes = async (encryptedMessages: any[], secretKey) => {
  try {
    return await new Promise((res, rej) => {
      window.sendMessage("decryptSingleForPublishes", {
        data: encryptedMessages,
        secretKeyObject: secretKey,
        skipDecodeBase64: true,
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
  } catch (error) {}
};
export const handleUnencryptedPublishes =  (publishes) => {
  let publishesData = []
  publishes.forEach((pub)=> {
    try {
      const decryptToUnit8Array = base64ToUint8Array(pub);
      const decodedData = uint8ArrayToObject(decryptToUnit8Array);
      if(decodedData){
        publishesData.push({decryptedData: decodedData})
      }
    } catch (error) {
      
    }
  })
  return publishesData
};
export const GroupAnnouncements = ({
  selectedGroup,
  secretKey,
  setSecretKey,
  getSecretKey,
  myAddress,
  handleNewEncryptionNotification,
  isAdmin,
  hide,
  myName,
  isPrivate
}) => {
  const [messages, setMessages] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [announcements, setAnnouncements] = useState([]);
  const [tempPublishedList, setTempPublishedList] = useState([]);
  const [announcementData, setAnnouncementData] = useState({});
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);
  const [isFocusedParent, setIsFocusedParent] = useState(false);

  const { show, rootHeight } = React.useContext(MyContext);
  const [openSnack, setOpenSnack] = React.useState(false);
  const [infoSnack, setInfoSnack] = React.useState(null);
  const hasInitialized = useRef(false);
  const hasInitializedWebsocket = useRef(false);
  const editorRef = useRef(null);
  const dataPublishes = useRef({});
  const setEditorRef = (editorInstance) => {
    editorRef.current = editorInstance;
  };
  const [, forceUpdate] = React.useReducer((x) => x + 1, 0);

  const triggerRerender = () => {
    forceUpdate(); // Trigger re-render by updating the state
  };
  useEffect(() => {
    if (!selectedGroup) return;
    (async () => {
      const res = await getDataPublishesFunc(selectedGroup, "anc");
      dataPublishes.current = res || {};
    })();
  }, [selectedGroup]);

  const getAnnouncementData = async ({ identifier, name, resource }, isPrivate) => {
    try {
      let data = dataPublishes.current[`${name}-${identifier}`];
      if (
        !data ||
        data?.update ||
        data?.created !== (resource?.updated || resource?.created)
      ) {
        const res = await requestQueuePublishedAccouncements.enqueue(() => {
          return fetch(
            `${getBaseApiReact()}/arbitrary/DOCUMENT/${name}/${identifier}?encoding=base64`
          );
        });
        if (!res?.ok) return;
        data = await res.text();
        await addDataPublishesFunc({ ...resource, data }, selectedGroup, "anc");
      } else {
        data = data.data;
      }

      const response = isPrivate === false ? handleUnencryptedPublishes([data]) :  await decryptPublishes([{ data }], secretKey);
      const messageData = response[0];
      if(!messageData) return
      setAnnouncementData((prev) => {
        return {
          ...prev,
          [`${identifier}-${name}`]: messageData,
        };
      });
    } catch (error) {
      console.error("error", error);
    }
  };

  useEffect(() => {
    if ((!secretKey && isPrivate) || hasInitializedWebsocket.current || isPrivate === null) return;
    setIsLoading(true);
    // initWebsocketMessageGroup()
    hasInitializedWebsocket.current = true;
  }, [secretKey, isPrivate]);

  const encryptChatMessage = async (data: string, secretKeyObject: any) => {
    try {
      return new Promise((res, rej) => {
        window.sendMessage("encryptSingle", {
          data,
          secretKeyObject,
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
    } catch (error) {}
  };

  const publishAnc = async ({ encryptedData, identifier }: any) => {
    return new Promise((res, rej) => {
      window.sendMessage("publishGroupEncryptedResource", {
        encryptedData,
        identifier,
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
  };
  const clearEditorContent = () => {
    if (editorRef.current) {
      editorRef.current.chain().focus().clearContent().run();
      if (isMobile) {
        setTimeout(() => {
          editorRef.current?.chain().blur().run();
          setIsFocusedParent(false);
          setTimeout(() => {
            triggerRerender();
           }, 300);
        }, 200);
      }
    }
  };

  const setTempData = async (selectedGroup) => {
    try {
      const getTempAnnouncements = await getTempPublish();
      if (getTempAnnouncements?.announcement) {
        let tempData = [];
        Object.keys(getTempAnnouncements?.announcement || {}).filter((annKey)=> annKey?.startsWith(`grp-${selectedGroup}-anc`)).map((key) => {
          const value = getTempAnnouncements?.announcement[key];
          tempData.push(value.data);
        });
        setTempPublishedList(tempData);
      }
    } catch (error) {}
  };

  const publishAnnouncement = async () => {
    try {
      pauseAllQueues();
      const fee = await getFee("ARBITRARY");
      await show({
        message: "Would you like to perform a ARBITRARY transaction?",
        publishFee: fee.fee + " QORT",
      });
      if (isSending) return;
      if (editorRef.current) {
        const htmlContent = editorRef.current.getHTML();
        if (!htmlContent?.trim() || htmlContent?.trim() === "<p></p>") return;
        setIsSending(true);
        const message = {
          version: 1,
          extra: {},
          message: htmlContent,
        };
        const secretKeyObject = isPrivate === false ? null : await getSecretKey(false, true);
        const message64: any =  await objectToBase64(message);
        const encryptSingle =  isPrivate === false ? message64 : await encryptChatMessage(
          message64,
          secretKeyObject
        );
        const randomUid = uid.rnd();
        const identifier = `grp-${selectedGroup}-anc-${randomUid}`;
        const res = await publishAnc({
          encryptedData: encryptSingle,
          identifier,
        });

        const dataToSaveToStorage = {
          name: myName,
          identifier,
          service: "DOCUMENT",
          tempData: message,
          created: Date.now(),
        };
        await saveTempPublish({
          data: dataToSaveToStorage,
          key: "announcement",
        });
        setTempData(selectedGroup);
        clearEditorContent();
      }
      // send chat message
    } catch (error) {
      if (!error) return;
      setInfoSnack({
        type: "error",
        message: error,
      });
      setOpenSnack(true);
    } finally {
      resumeAllQueues();
      setIsSending(false);
    }
  };

  const getAnnouncements = React.useCallback(
    async (selectedGroup, isPrivate) => {
      try {
        const offset = 0;

        // dispatch(setIsLoadingGlobal(true))
        const identifier = `grp-${selectedGroup}-anc-`;
        const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT&identifier=${identifier}&limit=20&includemetadata=false&offset=${offset}&reverse=true&prefix=true`;
        const response = await fetch(url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });
        const responseData = await response.json();

        setTempData(selectedGroup);
        setAnnouncements(responseData);
        setIsLoading(false);
        for (const data of responseData) {
          getAnnouncementData({
            name: data.name,
            identifier: data.identifier,
            resource: data,
          }, isPrivate);
        }
      } catch (error) {
      } finally {
        // dispatch(setIsLoadingGlobal(false))
      }
    },
    [secretKey]
  );

  React.useEffect(() => {
    if(!secretKey && isPrivate) return
    if (selectedGroup && !hasInitialized.current && !hide && isPrivate !== null) {
      getAnnouncements(selectedGroup, isPrivate);
      hasInitialized.current = true;
    }
  }, [selectedGroup, secretKey, hide, isPrivate]);

  const loadMore = async () => {
    try {
      setIsLoading(true);

      const offset = announcements.length;
      const identifier = `grp-${selectedGroup}-anc-`;
      const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT&identifier=${identifier}&limit=20&includemetadata=false&offset=${offset}&reverse=true&prefix=true`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const responseData = await response.json();

      setAnnouncements((prev) => [...prev, ...responseData]);
      setIsLoading(false);
      for (const data of responseData) {
        getAnnouncementData({ name: data.name, identifier: data.identifier }, isPrivate);
      }
    } catch (error) {}
  };

  const interval = useRef<any>(null);

  const checkNewMessages = React.useCallback(async () => {
    try {
      const identifier = `grp-${selectedGroup}-anc-`;
      const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT&identifier=${identifier}&limit=20&includemetadata=false&offset=${0}&reverse=true&prefix=true`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const responseData = await response.json();
      const latestMessage = announcements[0];
      if (!latestMessage) {
        for (const data of responseData) {
          try {
            getAnnouncementData({
              name: data.name,
              identifier: data.identifier,
            }, isPrivate);
          } catch (error) {}
        }
        setAnnouncements(responseData);
        return;
      }
      const findMessage = responseData?.findIndex(
        (item: any) => item?.identifier === latestMessage?.identifier
      );

      if (findMessage === -1) return;
      const newArray = responseData.slice(0, findMessage);

      for (const data of newArray) {
        try {
          getAnnouncementData({ name: data.name, identifier: data.identifier }, isPrivate);
        } catch (error) {}
      }
      setAnnouncements((prev) => [...newArray, ...prev]);
    } catch (error) {
    } finally {
    }
  }, [announcements, secretKey, selectedGroup]);

  const checkNewMessagesFunc = useCallback(() => {
    let isCalling = false;
    interval.current = setInterval(async () => {
      if (isCalling) return;
      isCalling = true;
      const res = await checkNewMessages();
      isCalling = false;
    }, 20000);
  }, [checkNewMessages]);

  useEffect(() => {
    if ((!secretKey && isPrivate) || hide || isPrivate === null) return;
    checkNewMessagesFunc();
    return () => {
      if (interval?.current) {
        clearInterval(interval.current);
      }
    };
  }, [checkNewMessagesFunc, hide, isPrivate]);

  const combinedListTempAndReal = useMemo(() => {
    // Combine the two lists
    const combined = [...tempPublishedList, ...announcements];

    // Remove duplicates based on the "identifier"
    const uniqueItems = new Map();
    combined.forEach((item) => {
      uniqueItems.set(item.identifier, item); // This will overwrite duplicates, keeping the last occurrence
    });

    // Convert the map back to an array and sort by "created" timestamp in descending order
    const sortedList = Array.from(uniqueItems.values()).sort(
      (a, b) => b.created - a.created
    );

    return sortedList;
  }, [tempPublishedList, announcements]);

  if (selectedAnnouncement) {
    return (
      <div
        style={{
          // reference to change height
          height: isMobile ? `calc(${rootHeight} - 127px` : "calc(100vh - 70px)",
          display: "flex",
          flexDirection: "column",
          width: "100%",
          visibility: hide && "hidden",
          position: hide && "fixed",
          left: hide && "-1000px",
        }}
      >
        <AnnouncementDiscussion
          myName={myName}
          show={show}
          secretKey={secretKey}
          selectedAnnouncement={selectedAnnouncement}
          setSelectedAnnouncement={setSelectedAnnouncement}
          encryptChatMessage={encryptChatMessage}
          getSecretKey={getSecretKey}
          isPrivate={isPrivate}
        />
      </div>
    );
  }


  return (
    <div
      style={{
         // reference to change height
        height: isMobile ? `calc(${rootHeight} - 127px` : "calc(100vh - 70px)",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        visibility: hide && "hidden",
        position: hide && "fixed",
        left: hide && "-1000px",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        {!isMobile && (
          <Box
            sx={{
              width: "100%",
              display: "flex",
              justifyContent: "center",
              padding: isMobile ? "8px" : "25px",
              fontSize: isMobile ? "16px" : "20px",
              gap: "20px",
              alignItems: "center",
            }}
          >
            <CampaignIcon
              sx={{
                fontSize: isMobile ? "16px" : "30px",
              }}
            />
            Group Announcements
          </Box>
        )}

        <Spacer height={isMobile ? "0px" : "25px"} />
      </div>
      {!isLoading && combinedListTempAndReal?.length === 0 && (
        <Box
          sx={{
            width: "100%",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <Typography
            sx={{
              fontSize: "16px",
            }}
          >
            No announcements
          </Typography>
        </Box>
      )}
      <AnnouncementList
        announcementData={announcementData}
        initialMessages={combinedListTempAndReal}
        setSelectedAnnouncement={setSelectedAnnouncement}
        disableComment={false}
        showLoadMore={
          announcements.length > 0 && announcements.length % 20 === 0
        }
        loadMore={loadMore}
        myName={myName}
      />

      {isAdmin && (
        <div
          style={{
            // position: 'fixed',
            // bottom: '0px',
            backgroundColor: "#232428",
            minHeight: isMobile ? "0px" : "150px",
            maxHeight: isMobile ? "auto" : "400px",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            width: "100%",
            boxSizing: "border-box",
            padding: isMobile ? "10px" : "20px",
            position: isFocusedParent ? "fixed" : "relative",
            bottom: isFocusedParent ? "0px" : "unset",
            top: isFocusedParent ? "0px" : "unset",
            zIndex: isFocusedParent ? 5 : "unset",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flexGrow: isMobile && 1,
              overflow: "auto",
              // height: '100%',
            }}
          >
            <Tiptap
              setEditorRef={setEditorRef}
              onEnter={publishAnnouncement}
              disableEnter
              maxHeightOffset="40px"
              isFocusedParent={isFocusedParent}
              setIsFocusedParent={setIsFocusedParent}
            />
          </div>
          <Box
            sx={{
              display: "flex",
              width: "100&",
              gap: "10px",
              justifyContent: "center",
              flexShrink: 0,
              position: "relative",
            }}
          >
            {isFocusedParent && (
              <CustomButton
                onClick={() => {
                  if (isSending) return;
                  setIsFocusedParent(false);
                  clearEditorContent();
                 setTimeout(() => {
                  triggerRerender();
                 }, 300);
                  // Unfocus the editor
                }}
                style={{
                  marginTop: "auto",
                  alignSelf: "center",
                  cursor: isSending ? "default" : "pointer",
                  background: "var(--danger)",
                  flexShrink: 0,
                  padding: isMobile && "5px",
                  fontSize: isMobile && "14px",
                }}
              >
                {` Close`}
              </CustomButton>
            )}
            <CustomButton
              onClick={() => {
                if (isSending) return;
                publishAnnouncement();
              }}
              style={{
                marginTop: "auto",
                alignSelf: "center",
                cursor: isSending ? "default" : "pointer",
                background: isSending && "rgba(0, 0, 0, 0.8)",
                flexShrink: 0,
                padding: isMobile && "5px",
                fontSize: isMobile && "14px",
              }}
            >
              {isSending && (
                <CircularProgress
                  size={18}
                  sx={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    marginTop: "-12px",
                    marginLeft: "-12px",
                    color: "white",
                  }}
                />
              )}
              {` Publish Announcement`}
            </CustomButton>
          </Box>
        </div>
      )}

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />

      <LoadingSnackbar
        open={isLoading}
        info={{
          message: "Loading announcements... please wait.",
        }}
      />
    </div>
  );
};
