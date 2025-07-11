import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Box, Popover, Typography, useTheme } from '@mui/material';
import { Thread } from './Thread';
import {
  AllThreadP,
  ArrowDownIcon,
  ComposeContainer,
  ComposeContainerBlank,
  ComposeP,
  GroupContainer,
  InstanceFooter,
  InstanceListContainer,
  InstanceListContainerRow,
  InstanceListContainerRowCheck,
  InstanceListContainerRowMain,
  InstanceListContainerRowMainP,
  InstanceListHeader,
  InstanceListParent,
  SelectInstanceContainerFilterInner,
  SingleThreadParent,
  ThreadContainer,
  ThreadContainerFullWidth,
  ThreadInfoColumn,
  ThreadInfoColumnNameP,
  ThreadInfoColumnTime,
  ThreadInfoColumnbyP,
  ThreadSingleLastMessageP,
  ThreadSingleLastMessageSpanP,
  ThreadSingleTitle,
} from './Mail-styles';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import { Spacer } from '../../../common/Spacer';
import { formatDate, formatTimestamp } from '../../../utils/time';
import LazyLoad from '../../../common/LazyLoad';
import { delay } from '../../../utils/helpers';
import { NewThread } from './NewThread';
import {
  decryptPublishes,
  getTempPublish,
  handleUnencryptedPublishes,
} from '../../Chat/GroupAnnouncements';
import ArrowDownSVG from '../../../assets/svgs/ArrowDown.svg';
import { LoadingSnackbar } from '../../Snackbar/LoadingSnackbar';
import { executeEvent } from '../../../utils/events';
import RefreshIcon from '@mui/icons-material/Refresh';
import { getArbitraryEndpointReact, getBaseApiReact } from '../../../App';
import { addDataPublishesFunc, getDataPublishesFunc } from '../Group';
import { useTranslation } from 'react-i18next';
import { SortIcon } from '../../../assets/Icons/SortIcon';
import { CustomButton } from '../../../styles/App-styles';

const filterOptions = ['Recently active', 'Newest', 'Oldest'];
import CheckIcon from '@mui/icons-material/Check';
export const threadIdentifier = 'DOCUMENT';

export const GroupMail = ({
  selectedGroup,
  userInfo,
  getSecretKey,
  secretKey,
  defaultThread,
  setDefaultThread,
  hide,
  isPrivate,
}) => {
  const [viewedThreads, setViewedThreads] = useState<any>({});
  const [filterMode, setFilterMode] = useState<string>('Recently active');
  const [currentThread, setCurrentThread] = useState(null);
  const [recentThreads, setRecentThreads] = useState<any[]>([]);
  const [allThreads, setAllThreads] = useState<any[]>([]);
  const [members, setMembers] = useState<any>(null);
  const [isOpenFilterList, setIsOpenFilterList] = useState<boolean>(false);
  const anchorElInstanceFilter = useRef<any>(null);
  const [tempPublishedList, setTempPublishedList] = useState([]);
  const dataPublishes = useRef({});
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const theme = useTheme();
  const [isLoading, setIsLoading] = useState(false);
  const groupIdRef = useRef<any>(null);
  const groupId = useMemo(() => {
    return selectedGroup?.groupId;
  }, [selectedGroup]);

  useEffect(() => {
    if (!groupId) return;
    (async () => {
      const res = await getDataPublishesFunc(groupId, 'thread');
      dataPublishes.current = res || {};
    })();
  }, [groupId]);

  useEffect(() => {
    if (groupId !== groupIdRef?.current) {
      setCurrentThread(null);
      setRecentThreads([]);
      setAllThreads([]);
      groupIdRef.current = groupId;
    }
  }, [groupId]);

  const setTempData = async () => {
    try {
      const getTempAnnouncements = await getTempPublish();

      if (getTempAnnouncements?.thread) {
        let tempData = [];
        Object.keys(getTempAnnouncements?.thread || {}).map((key) => {
          const value = getTempAnnouncements?.thread[key];
          if (value?.data?.groupId === groupIdRef?.current) {
            tempData.push(value.data);
          }
        });
        setTempPublishedList(tempData);
      }
    } catch (error) {
      console.log(error);
    }
  };

  const getEncryptedResource = async (
    { name, identifier, resource },
    isPrivate
  ) => {
    let data = dataPublishes.current[`${name}-${identifier}`];
    if (
      !data ||
      data?.update ||
      data?.created !== (resource?.updated || resource?.created)
    ) {
      const res = await fetch(
        `${getBaseApiReact()}/arbitrary/DOCUMENT/${name}/${identifier}?encoding=base64`
      );
      if (!res?.ok) return;
      data = await res.text();
      await addDataPublishesFunc({ ...resource, data }, groupId, 'thread');
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

  const updateThreadActivity = async ({
    threadId,
    qortalName,
    groupId,
    thread,
  }) => {
    try {
      await new Promise((res, rej) => {
        window
          .sendMessage('updateThreadActivity', {
            threadId,
            qortalName,
            groupId,
            thread,
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

  const getAllThreads = useCallback(
    async (groupId: string, mode: string, isInitial?: boolean) => {
      try {
        setIsLoading(true);
        const offset = isInitial ? 0 : allThreads.length;
        const isReverse = mode === 'Newest' ? true : false;
        if (isInitial) {
          // dispatch(setIsLoadingCustom("Loading threads"));
        }
        const identifier = `grp-${groupId}-thread-`;

        const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=${threadIdentifier}&identifier=${identifier}&limit=${20}&includemetadata=false&offset=${offset}&reverse=${isReverse}&prefix=true`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const responseData = await response.json();

        const fullArrayMsg = isInitial ? [] : [...allThreads];
        const getMessageForThreads = responseData.map(async (message: any) => {
          let fullObject: any = null;
          if (message?.metadata?.description) {
            fullObject = {
              ...message,
              threadData: {
                title: message?.metadata?.description,
                groupId: groupId,
                createdAt: message?.created,
                name: message?.name,
              },
              threadOwner: message?.name,
            };
          } else {
            let threadRes = null;
            try {
              threadRes = await Promise.race([
                getEncryptedResource(
                  {
                    name: message.name,
                    identifier: message.identifier,
                    resource: message,
                  },
                  isPrivate
                ),
                delay(5000),
              ]);
            } catch (error) {
              console.log(error);
            }

            if (threadRes?.title) {
              fullObject = {
                ...message,
                threadData: threadRes,
                threadOwner: message?.name,
                threadId: message.identifier,
              };
            }
          }
          if (fullObject?.identifier) {
            const index = fullArrayMsg.findIndex(
              (p) => p.identifier === fullObject.identifier
            );
            if (index !== -1) {
              fullArrayMsg[index] = fullObject;
            } else {
              fullArrayMsg.push(fullObject);
            }
          }
        });
        await Promise.all(getMessageForThreads);
        let sorted = fullArrayMsg;
        if (isReverse) {
          sorted = fullArrayMsg.sort((a: any, b: any) => b.created - a.created);
        } else {
          sorted = fullArrayMsg.sort((a: any, b: any) => a.created - b.created);
        }
        setAllThreads(sorted);
      } catch (error) {
        console.log({ error });
      } finally {
        if (isInitial) {
          setIsLoading(false);
        }
      }
    },
    [allThreads, isPrivate]
  );

  const getMailMessages = useCallback(
    async (groupId: string, members: any) => {
      try {
        setIsLoading(true);

        const identifier = `thmsg-grp-${groupId}-thread-`;
        const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=${threadIdentifier}&identifier=${identifier}&limit=100&includemetadata=false&offset=${0}&reverse=true&prefix=true`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        const responseData = await response.json();
        const messagesForThread: any = {};
        for (const message of responseData) {
          let str = message.identifier;
          const parts = str.split('-');

          // Get the second last element
          const secondLastId = parts[parts.length - 2];
          const result = `grp-${groupId}-thread-${secondLastId}`;
          const checkMessage = messagesForThread[result];
          if (!checkMessage) {
            messagesForThread[result] = message;
          }
        }

        const newArray = Object.keys(messagesForThread)
          .map((key) => {
            return {
              ...messagesForThread[key],
              threadId: key,
            };
          })
          .sort((a, b) => b.created - a.created)
          .slice(0, 10);

        const fullThreadArray: any = [];
        const getMessageForThreads = newArray.map(async (message: any) => {
          try {
            const identifierQuery = message.threadId;
            const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=${threadIdentifier}&identifier=${identifierQuery}&limit=1&includemetadata=false&offset=${0}&reverse=true&prefix=true`;
            const response = await fetch(url, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
              },
            });
            const responseData = await response.json();

            if (responseData.length > 0) {
              const thread = responseData[0];
              if (thread?.metadata?.description) {
                const fullObject = {
                  ...message,
                  threadData: {
                    title: thread?.metadata?.description,
                    groupId: groupId,
                    createdAt: thread?.created,
                    name: thread?.name,
                  },
                  threadOwner: thread?.name,
                };
                fullThreadArray.push(fullObject);
              } else {
                const threadRes = await Promise.race([
                  getEncryptedResource(
                    {
                      name: thread.name,
                      identifier: message.threadId,
                      resource: thread,
                    },
                    isPrivate
                  ),
                  delay(10000),
                ]);
                if (threadRes?.title) {
                  const fullObject = {
                    ...message,
                    threadData: threadRes,
                    threadOwner: thread?.name,
                  };
                  fullThreadArray.push(fullObject);
                }
              }
            }
          } catch (error) {
            console.log(error);
          }
          return null;
        });
        await Promise.all(getMessageForThreads);
        const sorted = fullThreadArray.sort(
          (a: any, b: any) => b.created - a.created
        );
        setRecentThreads(sorted);
      } catch (error) {
        console.log(error);
      } finally {
        setIsLoading(false);
      }
    },
    [secretKey, isPrivate]
  );

  const getMessages = useCallback(async () => {
    // if ( !groupId || members?.length === 0) return;
    if (!groupId || isPrivate === null) return;

    await getMailMessages(groupId, members);
  }, [getMailMessages, groupId, members, secretKey, isPrivate]);

  const interval = useRef<any>(null);
  const firstMount = useRef(false);
  const filterModeRef = useRef('');

  useEffect(() => {
    if (hide) return;
    if (filterModeRef.current !== filterMode) {
      firstMount.current = false;
    }
    if (groupId && !firstMount.current && isPrivate !== null) {
      if (filterMode === 'Recently active') {
        getMessages();
      } else if (filterMode === 'Newest') {
        getAllThreads(groupId, 'Newest', true);
      } else if (filterMode === 'Oldest') {
        getAllThreads(groupId, 'Oldest', true);
      }
      setTempData();
      firstMount.current = true;
    }
  }, [groupId, members, filterMode, hide, isPrivate]);

  const closeThread = useCallback(() => {
    setCurrentThread(null);
  }, []);

  const getGroupMembers = useCallback(async (groupNumber: string) => {
    try {
      const response = await fetch(`/groups/members/${groupNumber}?limit=0`);
      const groupData = await response.json();

      let members: any = {};
      if (groupData && Array.isArray(groupData?.members)) {
        for (const member of groupData.members) {
          if (member.member) {
            const name = res;
            const publicKey = resAddress.publicKey;
            if (name) {
              members[name] = {
                publicKey,
                address: member.member,
              };
            }
          }
        }
      }
      setMembers(members);
    } catch (error) {
      console.log({ error });
    }
  }, []);

  let listOfThreadsToDisplay = recentThreads;
  if (filterMode === 'Newest' || filterMode === 'Oldest') {
    listOfThreadsToDisplay = allThreads;
  }

  const onSubmitNewThread = useCallback(
    (val: any) => {
      if (filterMode === 'Recently active') {
        setRecentThreads((prev) => [val, ...prev]);
      } else if (filterMode === 'Newest') {
        setAllThreads((prev) => [val, ...prev]);
      }
    },
    [filterMode]
  );

  const handleCloseThreadFilterList = () => {
    setIsOpenFilterList(false);
  };

  const refetchThreadsLists = useCallback(() => {
    if (filterMode === 'Recently active') {
      getMessages();
    } else if (filterMode === 'Newest') {
      getAllThreads(groupId, 'Newest', true);
    } else if (filterMode === 'Oldest') {
      getAllThreads(groupId, 'Oldest', true);
    }
  }, [filterMode, isPrivate]);

  const updateThreadActivityCurrentThread = () => {
    if (!currentThread) return;
    const thread = currentThread;
    updateThreadActivity({
      threadId: thread?.threadId,
      qortalName: thread?.threadData?.name,
      groupId: groupId,
      thread: thread,
    });
  };

  const setThreadFunc = (data) => {
    const thread = data;
    setCurrentThread(thread);
    if (thread?.threadId && thread?.threadData?.name) {
      updateThreadActivity({
        threadId: thread?.threadId,
        qortalName: thread?.threadData?.name,
        groupId: groupId,
        thread: thread,
      });
    }
    setTimeout(() => {
      executeEvent('threadFetchMode', {
        mode: 'last-page',
      });
    }, 300);
  };

  useEffect(() => {
    if (defaultThread) {
      setThreadFunc(defaultThread);
      setDefaultThread(null);
    }
  }, [defaultThread]);

  const combinedListTempAndReal = useMemo(() => {
    // Combine the two lists
    const transformTempPublishedList = tempPublishedList.map((item) => {
      return {
        ...item,
        threadData: item.tempData,
        threadOwner: item?.name,
        threadId: item.identifier,
      };
    });
    const combined = [...transformTempPublishedList, ...listOfThreadsToDisplay];

    // Remove duplicates based on the "identifier"
    const uniqueItems = new Map();
    combined.forEach((item) => {
      uniqueItems.set(item.threadId, item); // This will overwrite duplicates, keeping the last occurrence
    });

    // Convert the map back to an array and sort by "created" timestamp in descending order
    const sortedList = Array.from(uniqueItems.values()).sort((a, b) =>
      filterMode === 'Oldest'
        ? a.threadData?.createdAt - b.threadData?.createdAt
        : b.threadData?.createdAt - a.threadData?.createdAt
    );

    return sortedList;
  }, [tempPublishedList, listOfThreadsToDisplay, filterMode]);

  if (currentThread)
    return (
      <Thread
        currentThread={currentThread}
        groupInfo={selectedGroup}
        closeThread={closeThread}
        members={members}
        userInfo={userInfo}
        secretKey={secretKey}
        getSecretKey={getSecretKey}
        updateThreadActivityCurrentThread={updateThreadActivityCurrentThread}
        isPrivate={isPrivate}
      />
    );

  return (
    <GroupContainer
      sx={{
        position: 'relative',
        overflow: 'auto',
        width: '100%',
      }}
    >
      <Popover
        open={isOpenFilterList}
        anchorEl={anchorElInstanceFilter.current}
        onClose={handleCloseThreadFilterList}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <InstanceListParent
          sx={{
            minHeight: 'unset',
            width: 'auto',
            padding: '0px',
          }}
        >
          <InstanceListHeader />

          <InstanceListContainer>
            {filterOptions?.map((filter) => {
              return (
                <InstanceListContainerRow
                  onClick={() => {
                    setFilterMode(filter);
                  }}
                  sx={{
                    backgroundColor:
                      filterMode === filter
                        ? theme.palette.action.selected
                        : 'unset',
                  }}
                  key={filter}
                >
                  <InstanceListContainerRowCheck>
                    {filter === filterMode && (
                      <CheckIcon
                        sx={{
                          color: theme.palette.text.primary,
                        }}
                      />
                    )}
                  </InstanceListContainerRowCheck>

                  <InstanceListContainerRowMain>
                    <InstanceListContainerRowMainP>
                      {filter}
                    </InstanceListContainerRowMainP>
                  </InstanceListContainerRowMain>
                </InstanceListContainerRow>
              );
            })}
          </InstanceListContainer>
          <InstanceFooter />
        </InstanceListParent>
      </Popover>

      <ThreadContainerFullWidth>
        <ThreadContainer>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <NewThread
              groupInfo={selectedGroup}
              refreshLatestThreads={getMessages}
              members={members}
              publishCallback={setTempData}
              userInfo={userInfo}
              getSecretKey={getSecretKey}
              myName={userInfo?.name}
              isPrivate={isPrivate}
            />
            <ComposeContainerBlank
              sx={{
                height: 'auto',
              }}
            >
              {selectedGroup && !currentThread && (
                <ComposeContainer
                  onClick={() => {
                    setIsOpenFilterList(true);
                  }}
                  ref={anchorElInstanceFilter}
                >
                  <SortIcon />

                  <SelectInstanceContainerFilterInner>
                    <ComposeP>Sort by</ComposeP>
                    <ArrowDownIcon src={ArrowDownSVG} />
                  </SelectInstanceContainerFilterInner>
                </ComposeContainer>
              )}
            </ComposeContainerBlank>
          </Box>

          <Spacer height="30px" />

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <AllThreadP>{filterMode}</AllThreadP>

            <RefreshIcon
              onClick={refetchThreadsLists}
              sx={{
                cursor: 'pointer',
                color: theme.palette.text.primary,
              }}
            />
          </Box>

          <Spacer height="30px" />

          {combinedListTempAndReal.map((thread) => {
            const hasViewedRecent =
              viewedThreads[
                `qmail_threads_${thread?.threadData?.groupId}_${thread?.threadId}`
              ];

            const shouldAppearLighter =
              hasViewedRecent &&
              filterMode === 'Recently active' &&
              thread?.threadData?.createdAt < hasViewedRecent?.timestamp;

            return (
              <SingleThreadParent
                sx={{
                  flexWrap: 'wrap',
                  gap: '15px',
                  height: 'auto',
                }}
                onClick={() => {
                  setCurrentThread(thread);
                  if (thread?.threadId && thread?.threadData?.name) {
                    updateThreadActivity({
                      threadId: thread?.threadId,
                      qortalName: thread?.threadData?.name,
                      groupId: groupId,
                      thread: thread,
                    });
                  }
                }}
              >
                <Avatar
                  sx={{
                    height: '50px',
                    width: '50px',
                  }}
                  src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${thread?.threadData?.name}/qortal_avatar?async=true`}
                  alt={thread?.threadData?.name}
                >
                  {thread?.threadData?.name?.charAt(0)}
                </Avatar>

                <ThreadInfoColumn>
                  <ThreadInfoColumnNameP>
                    <ThreadInfoColumnbyP>by </ThreadInfoColumnbyP>
                    {thread?.threadData?.name}
                  </ThreadInfoColumnNameP>

                  <ThreadInfoColumnTime>
                    {formatTimestamp(thread?.threadData?.createdAt)}
                  </ThreadInfoColumnTime>
                </ThreadInfoColumn>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    width: '100%',
                  }}
                >
                  <ThreadSingleTitle
                    sx={{
                      fontWeight: shouldAppearLighter && 300,
                    }}
                  >
                    {thread?.threadData?.title}
                  </ThreadSingleTitle>

                  <Spacer height="10px" />

                  {filterMode === 'Recently active' && (
                    <div
                      style={{
                        alignItems: 'center',
                        display: 'flex',
                      }}
                    >
                      <ThreadSingleLastMessageP>
                        <ThreadSingleLastMessageSpanP>
                          {t('group:last_message', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                          :{' '}
                        </ThreadSingleLastMessageSpanP>
                        {formatDate(thread?.created)}
                      </ThreadSingleLastMessageP>
                    </div>
                  )}
                </div>

                <CustomButton
                  onClick={() => {
                    setTimeout(() => {
                      executeEvent('threadFetchMode', {
                        mode: 'last-page',
                      });
                    }, 300);
                  }}
                  sx={{
                    alignItems: 'center',
                    borderRadius: '8px',
                    bottom: '2px',
                    cursor: 'pointer',
                    display: 'flex',
                    gap: '10px',
                    padding: '5px',
                    position: 'absolute',
                    right: '2px',
                    minWidth: 'unset',
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: '12px',
                    }}
                  >
                    {t('core:page.last', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>

                  <ArrowForwardIosIcon
                    sx={{
                      color: theme.palette.text.primary,
                      fontSize: '12px',
                    }}
                  />
                </CustomButton>
              </SingleThreadParent>
            );
          })}

          <Box
            sx={{
              width: '100%',
              justifyContent: 'center',
            }}
          >
            {listOfThreadsToDisplay.length >= 20 &&
              filterMode !== 'Recently active' && (
                <LazyLoad
                  onLoadMore={() => getAllThreads(groupId, filterMode, false)}
                ></LazyLoad>
              )}
          </Box>
        </ThreadContainer>
      </ThreadContainerFullWidth>

      <LoadingSnackbar
        open={isLoading}
        info={{
          message: t('group:message.success.loading_threads', {
            postProcess: 'capitalizeFirstChar',
          }),
        }}
      />
    </GroupContainer>
  );
};
