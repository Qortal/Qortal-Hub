import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { uint8ArrayToObject } from '../../encryption/encryption.ts';
import {
  base64ToUint8Array,
  objectToBase64,
} from '../../qdn/encryption/group-encryption';
import Tiptap from './TipTap';
import { CustomButton } from '../../styles/App-styles';
import CircularProgress from '@mui/material/CircularProgress';
import { getFee } from '../../background/background.ts';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import { Box, Typography, useTheme } from '@mui/material';
import { Spacer } from '../../common/Spacer';
import ShortUniqueId from 'short-unique-id';
import { AnnouncementList } from './AnnouncementList';
import CampaignIcon from '@mui/icons-material/Campaign';
import { AnnouncementDiscussion } from './AnnouncementDiscussion';
import {
  QORTAL_APP_CONTEXT,
  getArbitraryEndpointReact,
  getBaseApiReact,
  pauseAllQueues,
  resumeAllQueues,
} from '../../App';
import { RequestQueueWithPromise } from '../../utils/queue/queue';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { addDataPublishesFunc, getDataPublishesFunc } from '../Group/Group';
import { useTranslation } from 'react-i18next';

const uid = new ShortUniqueId({ length: 8 });

export const requestQueueCommentCount = new RequestQueueWithPromise(3);

export const requestQueuePublishedAccouncements = new RequestQueueWithPromise(
  3
);

export const saveTempPublish = async ({ data, key }: any) => {
  return new Promise((res, rej) => {
    window
      .sendMessage('saveTempPublish', {
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
        rej(error.message || 'An error occurred');
      });
  });
};

export const getTempPublish = async () => {
  return new Promise((res, rej) => {
    window
      .sendMessage('getTempPublish', {})
      .then((response) => {
        if (!response?.error) {
          res(response);
          return;
        }
        rej(response.error);
      })
      .catch((error) => {
        rej(error.message || 'An error occurred');
      });
  });
};

export const decryptPublishes = async (encryptedMessages: any[], secretKey) => {
  try {
    return await new Promise((res, rej) => {
      window
        .sendMessage('decryptSingleForPublishes', {
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
          rej(error.message || 'An error occurred');
        });
    });
  } catch (error) {
    console.log(error);
  }
};

export const handleUnencryptedPublishes = (publishes) => {
  let publishesData = [];
  publishes.forEach((pub) => {
    try {
      const decryptToUnit8Array = base64ToUint8Array(pub);
      const decodedData = uint8ArrayToObject(decryptToUnit8Array);
      if (decodedData) {
        publishesData.push({ decryptedData: decodedData });
      }
    } catch (error) {
      console.log(error);
    }
  });
  return publishesData;
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
  isPrivate,
}) => {
  const [messages, setMessages] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [announcements, setAnnouncements] = useState([]);
  const [tempPublishedList, setTempPublishedList] = useState([]);
  const [announcementData, setAnnouncementData] = useState({});
  const [selectedAnnouncement, setSelectedAnnouncement] = useState(null);
  const [isFocusedParent, setIsFocusedParent] = useState(false);

  const { show } = useContext(QORTAL_APP_CONTEXT);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const hasInitialized = useRef(false);
  const hasInitializedWebsocket = useRef(false);
  const editorRef = useRef(null);
  const dataPublishes = useRef({});
  const setEditorRef = (editorInstance) => {
    editorRef.current = editorInstance;
  };
  const [, forceUpdate] = useReducer((x) => x + 1, 0);
  const { t } = useTranslation(['auth', 'core', 'group']);

  const triggerRerender = () => {
    forceUpdate(); // Trigger re-render by updating the state
  };

  useEffect(() => {
    if (!selectedGroup) return;
    (async () => {
      const res = await getDataPublishesFunc(selectedGroup, 'anc');
      dataPublishes.current = res || {};
    })();
  }, [selectedGroup]);

  const getAnnouncementData = async (
    { identifier, name, resource },
    isPrivate
  ) => {
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
        await addDataPublishesFunc({ ...resource, data }, selectedGroup, 'anc');
      } else {
        data = data.data;
      }

      const response =
        isPrivate === false
          ? handleUnencryptedPublishes([data])
          : await decryptPublishes([{ data }], secretKey);
      const messageData = response[0];
      if (!messageData) return;
      setAnnouncementData((prev) => {
        return {
          ...prev,
          [`${identifier}-${name}`]: messageData,
        };
      });
    } catch (error) {
      console.error('error', error);
    }
  };

  useEffect(() => {
    if (
      (!secretKey && isPrivate) ||
      hasInitializedWebsocket.current ||
      isPrivate === null
    )
      return;
    setIsLoading(true);
    hasInitializedWebsocket.current = true;
  }, [secretKey, isPrivate]);

  const encryptChatMessage = async (data: string, secretKeyObject: any) => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('encryptSingle', {
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
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
    } catch (error) {
      console.log(error);
    }
  };

  const publishAnc = async ({ encryptedData, identifier }: any) => {
    return new Promise((res, rej) => {
      window
        .sendMessage('publishGroupEncryptedResource', {
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
          rej(
            error.message ||
              t('core:message.error.generic', {
                postProcess: 'capitalizeFirstChar',
              })
          );
        });
    });
  };

  const clearEditorContent = () => {
    if (editorRef.current) {
      editorRef.current.chain().focus().clearContent().run();
    }
  };

  const setTempData = async (selectedGroup) => {
    try {
      const getTempAnnouncements = await getTempPublish();
      if (getTempAnnouncements?.announcement) {
        let tempData = [];
        Object.keys(getTempAnnouncements?.announcement || {})
          .filter((annKey) => annKey?.startsWith(`grp-${selectedGroup}-anc`))
          .map((key) => {
            const value = getTempAnnouncements?.announcement[key];
            tempData.push(value.data);
          });
        setTempPublishedList(tempData);
      }
    } catch (error) {
      console.log(error);
    }
  };

  const publishAnnouncement = async () => {
    try {
      pauseAllQueues();
      const fee = await getFee('ARBITRARY');

      await show({
        message: t('core:message.question.perform_transaction', {
          action: 'ARBITRARY',
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });

      if (isSending) return;
      if (editorRef.current) {
        const htmlContent = editorRef.current.getHTML();
        if (!htmlContent?.trim() || htmlContent?.trim() === '<p></p>') return;
        setIsSending(true);
        const message = {
          version: 1,
          extra: {},
          message: htmlContent,
        };
        const secretKeyObject =
          isPrivate === false ? null : await getSecretKey(false, true);
        const message64: any = await objectToBase64(message);
        const encryptSingle =
          isPrivate === false
            ? message64
            : await encryptChatMessage(message64, secretKeyObject);
        const randomUid = uid.rnd();
        const identifier = `grp-${selectedGroup}-anc-${randomUid}`;
        const res = await publishAnc({
          encryptedData: encryptSingle,
          identifier,
        });

        const dataToSaveToStorage = {
          name: myName,
          identifier,
          service: 'DOCUMENT',
          tempData: message,
          created: Date.now(),
        };
        await saveTempPublish({
          data: dataToSaveToStorage,
          key: 'announcement',
        });
        setTempData(selectedGroup);
        clearEditorContent();
      }
      // send chat message
    } catch (error) {
      if (!error) return;
      setInfoSnack({
        type: 'error',
        message: error,
      });
      setOpenSnack(true);
    } finally {
      resumeAllQueues();
      setIsSending(false);
    }
  };

  const getAnnouncements = useCallback(
    async (selectedGroup, isPrivate) => {
      try {
        const offset = 0;

        // dispatch(setIsLoadingGlobal(true))
        const identifier = `grp-${selectedGroup}-anc-`;
        const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT&identifier=${identifier}&limit=20&includemetadata=false&offset=${offset}&reverse=true&prefix=true`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const responseData = await response.json();

        setTempData(selectedGroup);
        setAnnouncements(responseData);
        setIsLoading(false);
        for (const data of responseData) {
          getAnnouncementData(
            {
              name: data.name,
              identifier: data.identifier,
              resource: data,
            },
            isPrivate
          );
        }
      } catch (error) {
        console.log(error);
      }
    },
    [secretKey]
  );

  useEffect(() => {
    if (!secretKey && isPrivate) return;
    if (
      selectedGroup &&
      !hasInitialized.current &&
      !hide &&
      isPrivate !== null
    ) {
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
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const responseData = await response.json();

      setAnnouncements((prev) => [...prev, ...responseData]);
      setIsLoading(false);
      for (const data of responseData) {
        getAnnouncementData(
          { name: data.name, identifier: data.identifier },
          isPrivate
        );
      }
    } catch (error) {
      console.log(error);
    }
  };

  const interval = useRef<any>(null);

  const theme = useTheme();

  const checkNewMessages = useCallback(async () => {
    try {
      const identifier = `grp-${selectedGroup}-anc-`;
      const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=DOCUMENT&identifier=${identifier}&limit=20&includemetadata=false&offset=${0}&reverse=true&prefix=true`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const responseData = await response.json();
      const latestMessage = announcements[0];
      if (!latestMessage) {
        for (const data of responseData) {
          try {
            getAnnouncementData(
              {
                name: data.name,
                identifier: data.identifier,
              },
              isPrivate
            );
          } catch (error) {
            console.log(error);
          }
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
          getAnnouncementData(
            { name: data.name, identifier: data.identifier },
            isPrivate
          );
        } catch (error) {
          console.log(error);
        }
      }
      setAnnouncements((prev) => [...newArray, ...prev]);
    } catch (error) {
      console.log(error);
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
          display: 'flex',
          flexDirection: 'column',
          height: 'calc(100vh - 70px)',
          left: hide && '-1000px',
          position: hide && 'fixed',
          visibility: hide && 'hidden',
          width: '100%',
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
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 70px)',
        left: hide && '-1000px',
        position: hide && 'fixed',
        visibility: hide && 'hidden',
        width: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          position: 'relative',
          width: '100%',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            fontSize: '20px',
            gap: '20px',
            justifyContent: 'center',
            padding: '25px',
            width: '100%',
          }}
        >
          <CampaignIcon
            sx={{
              fontSize: '30px',
            }}
          />
          {t('group:message.generic.group_announcement', {
            postProcess: 'capitalizeFirstChar',
          })}
        </Box>

        <Spacer height={'25px'} />
      </div>

      {!isLoading && combinedListTempAndReal?.length === 0 && (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            width: '100%',
          }}
        >
          <Typography
            sx={{
              fontSize: '16px',
            }}
          >
            {t('group:message.generic.no_announcement', {
              postProcess: 'capitalizeFirstChar',
            })}
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
            backgroundColor: theme.palette.background.default,
            bottom: isFocusedParent ? '0px' : 'unset',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            maxHeight: '400px',
            minHeight: '150px',
            overflow: 'hidden',
            padding: '20px',
            position: isFocusedParent ? 'fixed' : 'relative',
            top: isFocusedParent ? '0px' : 'unset',
            width: '100%',
            zIndex: isFocusedParent ? 5 : 'unset',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
              overflow: 'auto',
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
              display: 'flex',
              flexShrink: 0,
              gap: '10px',
              justifyContent: 'center',
              position: 'relative',
              width: '100&',
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
                  alignSelf: 'center',
                  background: theme.palette.other.danger,
                  cursor: isSending ? 'default' : 'pointer',
                  flexShrink: 0,
                  fontSize: '14px',
                  marginTop: 'auto',
                  padding: '5px',
                }}
              >
                {t('core:action.close', { postProcess: 'capitalizeFirstChar' })}
              </CustomButton>
            )}

            <CustomButton
              onClick={() => {
                if (isSending) return;
                publishAnnouncement();
              }}
              style={{
                alignSelf: 'center',
                background: isSending
                  ? theme.palette.background.default
                  : theme.palette.background.paper,
                cursor: isSending ? 'default' : 'pointer',
                flexShrink: 0,
                fontSize: '14px',
                marginTop: 'auto',
                padding: '5px',
              }}
            >
              {isSending && (
                <CircularProgress
                  size={18}
                  sx={{
                    color: theme.palette.text.primary,
                    left: '50%',
                    marginLeft: '-12px',
                    marginTop: '-12px',
                    position: 'absolute',
                    top: '50%',
                  }}
                />
              )}
              {t('group:action.publish_announcement', {
                postProcess: 'capitalizeFirstChar',
              })}
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
          message: t('core:loading.announcements', {
            postProcess: 'capitalizeFirstChar',
          }),
        }}
      />
    </div>
  );
};
