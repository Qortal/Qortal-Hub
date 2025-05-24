import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Typography,
  useTheme,
} from '@mui/material';
import { ShowMessage } from './ShowMessageWithoutModal';
import {
  ComposeP,
  GroupContainer,
  GroupNameP,
  ShowMessageReturnButton,
  SingleThreadParent,
  ThreadContainer,
  ThreadContainerFullWidth,
  ThreadInfoColumn,
  ThreadInfoColumnNameP,
  ThreadInfoColumnTime,
} from './Mail-styles';
import { Spacer } from '../../../common/Spacer';
import { threadIdentifier } from './GroupMail';
import { NewThread } from './NewThread';
import {
  decryptPublishes,
  getTempPublish,
  handleUnencryptedPublishes,
} from '../../Chat/GroupAnnouncements';
import { LoadingSnackbar } from '../../Snackbar/LoadingSnackbar';
import { subscribeToEvent, unsubscribeFromEvent } from '../../../utils/events';
import RefreshIcon from '@mui/icons-material/Refresh';
import { getArbitraryEndpointReact, getBaseApiReact } from '../../../App';
import {
  ArrowDownward as ArrowDownwardIcon,
  ArrowUpward as ArrowUpwardIcon,
} from '@mui/icons-material';
import { addDataPublishesFunc, getDataPublishesFunc } from '../Group';
import { RequestQueueWithPromise } from '../../../utils/queue/queue';
import { CustomLoader } from '../../../common/CustomLoader';
import { WrapperUserAction } from '../../WrapperUserAction';
import { formatTimestampForum } from '../../../utils/time';
import { useTranslation } from 'react-i18next';
import { ReturnIcon } from '../../../assets/Icons/ReturnIcon';

const requestQueueSaveToLocal = new RequestQueueWithPromise(1);

const requestQueueDownloadPost = new RequestQueueWithPromise(3);

interface ThreadProps {
  currentThread: any;
  groupInfo: any;
  closeThread: () => void;
  members: any;
}

const getEncryptedResource = async (
  { name, identifier, secretKey, resource, groupId, dataPublishes },
  isPrivate
) => {
  let data = dataPublishes[`${name}-${identifier}`];
  if (
    !data ||
    data?.update ||
    data?.created !== (resource?.updated || resource?.created)
  ) {
    const res = await requestQueueDownloadPost.enqueue(() => {
      return fetch(
        `${getBaseApiReact()}/arbitrary/DOCUMENT/${name}/${identifier}?encoding=base64`
      );
    });
    if (!res.ok) {
      const errorData = await res.json();

      return {
        error: errorData?.message,
      };
    }
    data = await res.text();

    if (data?.error || typeof data !== 'string') return;
    await requestQueueSaveToLocal.enqueue(() => {
      return addDataPublishesFunc({ ...resource, data }, groupId, 'thmsg');
    });
  } else {
    data = data.data;
  }
  const response =
    isPrivate === false
      ? handleUnencryptedPublishes([data])
      : await decryptPublishes([{ data }], secretKey);

  const messageData = response[0];
  return messageData.decryptedData;
};

export const Thread = ({
  currentThread,
  groupInfo,
  closeThread,
  members,
  userInfo,
  secretKey,
  getSecretKey,
  updateThreadActivityCurrentThread,
  isPrivate,
}: ThreadProps) => {
  const [tempPublishedList, setTempPublishedList] = useState([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [hashMapMailMessages, setHashMapMailMessages] = useState({});
  const [hasFirstPage, setHasFirstPage] = useState(false);
  const [hasPreviousPage, setHasPreviousPage] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [postReply, setPostReply] = useState(null);
  const [hasLastPage, setHasLastPage] = useState(false);
  const { t } = useTranslation(['auth', 'core', 'group']);
  const theme = useTheme();
  // Update: Use a new ref for the scrollable container
  const threadContainerRef = useRef(null);
  const threadBeginningRef = useRef(null);
  // New state variables
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(false);

  const secretKeyRef = useRef(null);
  const currentThreadRef = useRef(null);
  const containerRef = useRef(null);
  const dataPublishes = useRef({});

  const getSavedData = useCallback(async (groupId) => {
    const res = await getDataPublishesFunc(groupId, 'thmsg');
    dataPublishes.current = res || {};
  }, []);

  useEffect(() => {
    if (!groupInfo?.groupId) return;
    getSavedData(groupInfo?.groupId);
  }, [groupInfo?.groupId]);

  useEffect(() => {
    currentThreadRef.current = currentThread;
  }, [currentThread]);

  useEffect(() => {
    secretKeyRef.current = secretKey;
  }, [secretKey]);

  const getIndividualMsg = async (message: any) => {
    try {
      const responseDataMessage = await getEncryptedResource(
        {
          identifier: message.identifier,
          name: message.name,
          secretKey,
          resource: message,
          groupId: groupInfo?.groupId,
          dataPublishes: dataPublishes.current,
        },
        isPrivate
      );

      if (responseDataMessage?.error) {
        const fullObject = {
          ...message,
          error: responseDataMessage?.error,
          id: message.identifier,
        };
        setHashMapMailMessages((prev) => {
          return {
            ...prev,
            [message.identifier]: fullObject,
          };
        });
        return;
      }

      const fullObject = {
        ...message,
        ...(responseDataMessage || {}),
        id: message.identifier,
      };
      setHashMapMailMessages((prev) => {
        return {
          ...prev,
          [message.identifier]: fullObject,
        };
      });
    } catch (error) {
      console.log(error);
    }
  };

  const setTempData = async () => {
    try {
      let threadId = currentThread.threadId;

      const keyTemp = 'thread-post';
      const getTempAnnouncements = await getTempPublish();

      if (getTempAnnouncements?.[keyTemp]) {
        let tempData = [];
        Object.keys(getTempAnnouncements?.[keyTemp] || {}).map((key) => {
          const value = getTempAnnouncements?.[keyTemp][key];

          if (value.data?.threadId === threadId) {
            tempData.push(value.data);
          }
        });
        setTempPublishedList(tempData);
      }
    } catch (error) {
      console.log(error);
    }
  };

  const getMailMessages = useCallback(
    async (groupInfo: any, before, after, isReverse, groupId) => {
      try {
        setTempPublishedList([]);
        setIsLoading(true);
        setHasFirstPage(false);
        setHasPreviousPage(false);
        setHasLastPage(false);
        setHasNextPage(false);
        let threadId = groupInfo.threadId;

        const identifier = `thmsg-${threadId}`;
        let url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=${threadIdentifier}&identifier=${identifier}&limit=20&includemetadata=false&prefix=true`;
        if (!isReverse) {
          url = url + '&reverse=false';
        }
        if (isReverse) {
          url = url + '&reverse=true';
        }
        if (after) {
          url = url + `&after=${after}`;
        }
        if (before) {
          url = url + `&before=${before}`;
        }

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        const responseData = await response.json();

        let fullArrayMsg = [...responseData];
        if (isReverse) {
          fullArrayMsg = fullArrayMsg.reverse();
        }
        // let newMessages: any[] = []
        for (const message of responseData) {
          getIndividualMsg(message);
        }
        setMessages(fullArrayMsg);
        if (before === null && after === null && isReverse) {
          setTimeout(() => {
            containerRef.current.scrollIntoView({ behavior: 'smooth' });
          }, 300);
        }
        if (after || (before === null && after === null && !isReverse)) {
          setTimeout(() => {
            threadBeginningRef.current.scrollIntoView();
          }, 100);
        }

        if (fullArrayMsg.length === 0) {
          setTempData();
          return;
        }
        // check if there are newer posts
        const urlNewer = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=${threadIdentifier}&identifier=${identifier}&limit=1&includemetadata=false&reverse=false&prefix=true&before=${
          fullArrayMsg[0].created
        }`;

        const responseNewer = await fetch(urlNewer, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        const responseDataNewer = await responseNewer.json();
        if (responseDataNewer.length > 0) {
          setHasFirstPage(true);
          setHasPreviousPage(true);
        } else {
          setHasFirstPage(false);
          setHasPreviousPage(false);
        }
        // check if there are older posts
        const urlOlder = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=${threadIdentifier}&identifier=${identifier}&limit=1&includemetadata=false&reverse=false&prefix=true&after=${
          fullArrayMsg[fullArrayMsg.length - 1].created
        }`;

        const responseOlder = await fetch(urlOlder, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });

        const responseDataOlder = await responseOlder.json();
        if (responseDataOlder.length > 0) {
          setHasLastPage(true);
          setHasNextPage(true);
        } else {
          setHasLastPage(false);
          setHasNextPage(false);
          setTempData();
          updateThreadActivityCurrentThread();
        }
      } catch (error) {
        console.log('error', error);
      } finally {
        setIsLoading(false);
        getSavedData(groupId);
      }
    },
    [messages, secretKey]
  );

  const getMessages = useCallback(async () => {
    if (
      !currentThread ||
      (!secretKey && isPrivate) ||
      !groupInfo?.groupId ||
      isPrivate === null
    )
      return;
    await getMailMessages(currentThread, null, null, false, groupInfo?.groupId);
  }, [
    getMailMessages,
    currentThread,
    secretKey,
    groupInfo?.groupId,
    isPrivate,
  ]);

  const firstMount = useRef(false);

  const saveTimestamp = useCallback((currentThread: any, username?: string) => {
    if (
      !currentThread?.threadData?.groupId ||
      !currentThread?.threadId ||
      !username
    )
      return;
    const threadIdForLocalStorage = `qmail_threads_${currentThread?.threadData?.groupId}_${currentThread?.threadId}`;
    const threads = JSON.parse(
      localStorage.getItem(`qmail_threads_viewedtimestamp_${username}`) || '{}'
    );
    // Convert to an array of objects with identifier and all fields
    let dataArray = Object.entries(threads).map(([identifier, value]) => ({
      identifier,
      ...(value as any),
    }));

    // Sort the array based on timestamp in descending order
    dataArray.sort((a, b) => b.timestamp - a.timestamp);

    // Slice the array to keep only the first 500 elements
    let latest500 = dataArray.slice(0, 500);

    // Convert back to the original object format
    let latest500Data: any = {};
    latest500.forEach((item) => {
      const { identifier, ...rest } = item;
      latest500Data[identifier] = rest;
    });
    latest500Data[threadIdForLocalStorage] = {
      timestamp: Date.now(),
    };
    localStorage.setItem(
      `qmail_threads_viewedtimestamp_${username}`,
      JSON.stringify(latest500Data)
    );
  }, []);

  const getMessagesMiddleware = async () => {
    await new Promise((res) => {
      setTimeout(() => {
        res(null);
      }, 400);
    });
    if (firstMount.current) return;
    getMessages();
    firstMount.current = true;
  };
  useEffect(() => {
    if (currentThreadRef.current?.threadId !== currentThread?.threadId) {
      firstMount.current = false;
    }
    if (!secretKey && isPrivate) return;
    if (currentThread && !firstMount.current && isPrivate !== null) {
      getMessagesMiddleware();
    }
  }, [currentThread, secretKey, isPrivate]);
  const messageCallback = useCallback((msg: any) => {
    // dispatch(addToHashMapMail(msg))
    // setMessages((prev) => [msg, ...prev])
  }, []);

  const interval = useRef<any>(null);

  const checkNewMessages = useCallback(
    async (groupInfo: any) => {
      try {
        let threadId = groupInfo.threadId;

        const identifier = `thmsg-${threadId}`;
        const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=${threadIdentifier}&identifier=${identifier}&limit=20&includemetadata=false&offset=${0}&reverse=true&prefix=true`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const responseData = await response.json();
        const latestMessage = messages[0];
        if (!latestMessage) return;
        const findMessage = responseData?.findIndex(
          (item: any) => item?.identifier === latestMessage?.identifier
        );
        let sliceLength = responseData.length;
        if (findMessage !== -1) {
          sliceLength = findMessage;
        }
        const newArray = responseData.slice(0, findMessage).reverse();
        let fullArrayMsg = [...messages];

        for (const message of newArray) {
          try {
            const responseDataMessage = await getEncryptedResource({
              identifier: message.identifier,
              name: message.name,
              secretKey: secretKeyRef.current,
              resource: message,
              groupId: groupInfo?.groupId,
              dataPublishes: dataPublishes.current,
            });

            const fullObject = {
              ...message,
              ...(responseDataMessage || {}),
              id: message.identifier,
            };
            setHashMapMailMessages((prev) => {
              return {
                ...prev,
                [message.identifier]: fullObject,
              };
            });
            const index = messages.findIndex(
              (p) => p.identifier === fullObject.identifier
            );
            if (index !== -1) {
              fullArrayMsg[index] = fullObject;
            } else {
              fullArrayMsg.unshift(fullObject);
            }
          } catch (error) {
            console.log(error);
          }
        }
        setMessages(fullArrayMsg);
      } catch (error) {
        console.log(error);
      }
    },
    [messages]
  );

  const openNewPostWithQuote = useCallback((reply) => {
    setPostReply(reply);
  }, []);

  const closeCallback = useCallback(() => {
    setPostReply(null);
  }, []);

  const threadFetchModeFunc = (e) => {
    const mode = e.detail?.mode;
    if (mode === 'last-page') {
      getMailMessages(currentThread, null, null, true, groupInfo?.groupId);
    }
    firstMount.current = true;
  };

  useEffect(() => {
    subscribeToEvent('threadFetchMode', threadFetchModeFunc);

    return () => {
      unsubscribeFromEvent('threadFetchMode', threadFetchModeFunc);
    };
  }, []);

  const combinedListTempAndReal = useMemo(() => {
    // Combine the two lists
    const combined = [...tempPublishedList, ...messages];

    // Remove duplicates based on the "identifier"
    const uniqueItems = new Map();
    combined.forEach((item) => {
      uniqueItems.set(item.identifier, item); // This will overwrite duplicates, keeping the last occurrence
    });

    // Convert the map back to an array and sort by "created" timestamp in descending order
    const sortedList = Array.from(uniqueItems.values()).sort(
      (a, b) => a.created - b.created
    );

    return sortedList;
  }, [tempPublishedList, messages]);

  // Updated useEffect to handle scroll and overflow
  useEffect(() => {
    const container = threadContainerRef.current; // Updated reference
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Check if user is at the bottom
      if (scrollTop + clientHeight >= scrollHeight - 5) {
        setIsAtBottom(true);
      } else {
        setIsAtBottom(false);
      }

      // Initial check if content overflows
      if (container.scrollHeight > container.clientHeight) {
        setShowScrollButton(true);
      } else {
        setShowScrollButton(false);
      }
    };
    setTimeout(() => {
      handleScroll();
    }, 400);

    container.addEventListener('scroll', handleScroll);

    // Cleanup
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [messages]);

  // Function to scroll to the top or bottom of the container
  const scrollToPosition = () => {
    const container = threadContainerRef.current; // Updated reference
    if (!container) return;

    if (isAtBottom) {
      container.scrollTo({ top: 0, behavior: 'smooth' }); // Scroll to top
    } else {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' }); // Scroll to bottom
    }
  };

  if (!currentThread) return null;
  return (
    <GroupContainer
      sx={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
      // Removed the ref from here since the scrollable area has changed
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexShrink: 0, // Corrected property name
          justifyContent: 'space-between',
        }}
      >
        <NewThread
          groupInfo={groupInfo}
          isMessage={true}
          currentThread={currentThread}
          messageCallback={messageCallback}
          members={members}
          userInfo={userInfo}
          getSecretKey={getSecretKey}
          closeCallback={closeCallback}
          postReply={postReply}
          myName={userInfo?.name}
          publishCallback={setTempData}
          setPostReply={setPostReply}
          isPrivate={isPrivate}
        />
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '35px',
          }}
        >
          <ShowMessageReturnButton
            onClick={() => {
              setMessages([]);
              closeThread();
            }}
          >
            <ReturnIcon />
            <ComposeP>
              {t('group:action.return_to_thread', {
                postProcess: 'capitalizeFirstChar',
              })}
            </ComposeP>
          </ShowMessageReturnButton>

          {/* Conditionally render the scroll buttons */}
          {showScrollButton &&
            (isAtBottom ? (
              <ButtonBase onClick={scrollToPosition}>
                <ArrowUpwardIcon
                  sx={{
                    color: theme.palette.text.primary,
                    cursor: 'pointer',
                    fontSize: '36px',
                  }}
                />
              </ButtonBase>
            ) : (
              <ButtonBase onClick={scrollToPosition}>
                <ArrowDownwardIcon
                  sx={{
                    color: theme.palette.text.primary,
                    cursor: 'pointer',
                    fontSize: '36px',
                  }}
                />
              </ButtonBase>
            ))}
        </Box>
      </Box>

      <ThreadContainerFullWidth
        sx={{
          flexGrow: 1,
          overflow: 'auto',
        }}
        ref={threadContainerRef} // Updated ref attached here
      >
        <div ref={threadBeginningRef} />
        <ThreadContainer>
          <Spacer height={'30px'} />

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <GroupNameP>{currentThread?.threadData?.title}</GroupNameP>
          </Box>

          <Spacer height={'15px'} />

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: '5px',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <Button
              sx={{
                textTransformation: 'capitalize',
              }}
              onClick={() => {
                getMailMessages(
                  currentThread,
                  null,
                  null,
                  false,
                  groupInfo?.groupId
                );
              }}
              disabled={!hasFirstPage}
              variant="contained"
            >
              {t('core:page.first', { postProcess: 'capitalizeFirstChar' })}
            </Button>

            <Button
              sx={{
                textTransformation: 'capitalize',
              }}
              onClick={() => {
                getMailMessages(
                  currentThread,
                  messages[0].created,
                  null,
                  false,
                  groupInfo?.groupId
                );
              }}
              disabled={!hasPreviousPage}
              variant="contained"
            >
              {t('core:page.previous', { postProcess: 'capitalizeFirstChar' })}
            </Button>

            <Button
              sx={{
                textTransformation: 'capitalize',
              }}
              onClick={() => {
                getMailMessages(
                  currentThread,
                  null,
                  messages[messages.length - 1].created,
                  false,
                  groupInfo?.groupId
                );
              }}
              disabled={!hasNextPage}
              variant="contained"
            >
              {t('core:page.next', { postProcess: 'capitalizeFirstChar' })}
            </Button>

            <Button
              sx={{
                textTransformation: 'capitalize',
              }}
              onClick={() => {
                getMailMessages(
                  currentThread,
                  null,
                  null,
                  true,
                  groupInfo?.groupId
                );
              }}
              disabled={!hasLastPage}
              variant="contained"
            >
              {t('core:page.last', { postProcess: 'capitalizeFirstChar' })}
            </Button>
          </Box>

          <Spacer height={'30px'} />

          {combinedListTempAndReal.map((message, index, list) => {
            let fullMessage = message;

            if (hashMapMailMessages[message?.identifier]) {
              fullMessage = hashMapMailMessages[message.identifier];

              if (fullMessage?.error) {
                return (
                  <SingleThreadParent
                    sx={{
                      height: 'auto',
                    }}
                  >
                    <Box
                      style={{
                        borderRadius: '8px',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        position: 'relative',
                        width: '100%',
                      }}
                    >
                      <Box
                        sx={{
                          alignItems: 'flex-start',
                          display: 'flex',
                          gap: '10px',
                        }}
                      >
                        <WrapperUserAction
                          disabled={userInfo?.name === message?.name}
                          address={undefined}
                          name={message?.name}
                        >
                          <Avatar
                            sx={{
                              height: '50px',
                              width: '50px',
                            }}
                            src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
                              message?.name
                            }/qortal_avatar?async=true`}
                            alt={message?.name}
                          >
                            {message?.name?.charAt(0)}
                          </Avatar>
                        </WrapperUserAction>

                        <ThreadInfoColumn>
                          <WrapperUserAction
                            disabled={userInfo?.name === message?.name}
                            address={undefined}
                            name={message?.name}
                          >
                            <ThreadInfoColumnNameP>
                              {message?.name}
                            </ThreadInfoColumnNameP>
                          </WrapperUserAction>

                          <ThreadInfoColumnTime>
                            {formatTimestampForum(message?.created)}
                          </ThreadInfoColumnTime>
                        </ThreadInfoColumn>
                      </Box>

                      <Box
                        sx={{
                          alignItems: 'center',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                          width: '100%',
                        }}
                      >
                        <Typography
                          sx={{
                            fontSize: '18px',
                          }}
                        >
                          {fullMessage?.error}
                        </Typography>
                      </Box>
                    </Box>
                  </SingleThreadParent>
                );
              }
              return (
                <ShowMessage
                  key={message?.identifier}
                  message={fullMessage}
                  openNewPostWithQuote={openNewPostWithQuote}
                  myName={userInfo?.name}
                />
              );
            } else if (message?.tempData) {
              return (
                <ShowMessage
                  key={message?.identifier}
                  message={message?.tempData}
                  openNewPostWithQuote={openNewPostWithQuote}
                  myName={userInfo?.name}
                />
              );
            }

            return (
              <SingleThreadParent
                sx={{
                  height: 'auto',
                }}
              >
                <Box
                  style={{
                    borderRadius: '8px',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    position: 'relative',
                    width: '100%',
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'flex-start',
                      display: 'flex',
                      gap: '10px',
                    }}
                  >
                    <WrapperUserAction
                      disabled={userInfo?.name === message?.name}
                      address={undefined}
                      name={message?.name}
                    >
                      <Avatar
                        sx={{
                          height: '50px',
                          width: '50px',
                        }}
                        src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
                          message?.name
                        }/qortal_avatar?async=true`}
                        alt={message?.name}
                      >
                        {message?.name?.charAt(0)}
                      </Avatar>
                    </WrapperUserAction>

                    <ThreadInfoColumn>
                      <WrapperUserAction
                        disabled={userInfo?.name === message?.name}
                        address={undefined}
                        name={message?.name}
                      >
                        <ThreadInfoColumnNameP>
                          {message?.name}
                        </ThreadInfoColumnNameP>
                      </WrapperUserAction>

                      <ThreadInfoColumnTime>
                        {formatTimestampForum(message?.created)}
                      </ThreadInfoColumnTime>
                    </ThreadInfoColumn>
                  </Box>

                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      width: '100%',
                    }}
                  >
                    <CustomLoader />

                    <Typography
                      sx={{
                        fontSize: '18px',
                      }}
                    >
                      {t('core:downloading_qdn', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                  </Box>
                </Box>
              </SingleThreadParent>
            );
          })}

          {!hasLastPage && !isLoading && (
            <>
              <Spacer height="20px" />
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  width: '100%',
                }}
              >
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={() => {
                    getMailMessages(
                      currentThread,
                      null,
                      null,
                      true,
                      groupInfo?.groupId
                    );
                  }}
                >
                  {t('group:action.refetch_page', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
              </Box>
            </>
          )}

          <Box
            sx={{
              width: '100%',
              visibility: messages?.length > 4 ? 'visible' : 'hidden',
            }}
          >
            <Spacer height="30px" />
            <Box
              sx={{
                width: '100%',
                alignItems: 'center',
                display: 'flex',
                justifyContent: 'center',
                gap: '5px',
              }}
            >
              <Button
                sx={{
                  textTransformation: 'capitalize',
                }}
                onClick={() => {
                  getMailMessages(
                    currentThread,
                    null,
                    null,
                    false,
                    groupInfo?.groupId
                  );
                }}
                disabled={!hasFirstPage}
                variant="contained"
              >
                {t('core:page.first', { postProcess: 'capitalizeFirstChar' })}
              </Button>

              <Button
                sx={{
                  textTransformation: 'capitalize',
                }}
                onClick={() => {
                  getMailMessages(
                    currentThread,
                    messages[0].created,
                    null,
                    false,
                    groupInfo?.groupId
                  );
                }}
                disabled={!hasPreviousPage}
                variant="contained"
              >
                {t('core:page.previous', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Button>

              <Button
                sx={{
                  textTransformation: 'capitalize',
                }}
                onClick={() => {
                  getMailMessages(
                    currentThread,
                    null,
                    messages[messages.length - 1].created,
                    false,
                    groupInfo?.groupId
                  );
                }}
                disabled={!hasNextPage}
                variant="contained"
              >
                {t('core:page.next', { postProcess: 'capitalizeFirstChar' })}
              </Button>

              <Button
                sx={{
                  textTransformation: 'capitalize',
                }}
                onClick={() => {
                  getMailMessages(
                    currentThread,
                    null,
                    null,
                    true,
                    groupInfo?.groupId
                  );
                }}
                disabled={!hasLastPage}
                variant="contained"
              >
                {t('core:page.last', { postProcess: 'capitalizeFirstChar' })}
              </Button>
            </Box>

            <Spacer height="30px" />
          </Box>

          <div ref={containerRef} />
        </ThreadContainer>
      </ThreadContainerFullWidth>

      <LoadingSnackbar
        open={isLoading}
        info={{
          message: t('core:loading.posts', {
            postProcess: 'capitalizeFirstChar',
          }),
        }}
      />
    </GroupContainer>
  );
};
