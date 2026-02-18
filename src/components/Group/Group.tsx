import { Box, Typography, useTheme } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatGroup } from '../Chat/ChatGroup';
import { CreateCommonSecret } from '../Chat/CreateCommonSecret';
import { base64ToUint8Array } from '../../qdn/encryption/group-encryption';
import { uint8ArrayToObject } from '../../encryption/encryption';
import { AddGroup } from './AddGroup';

import { AuthenticatedContainerInnerRight } from '../../styles/App-styles';
import { Spacer } from '../../common/Spacer';
import { ManageMembers } from './ManageMembers';
import {
  clearAllQueues,
  getBaseApiReact,
  pauseAllQueues,
  resumeAllQueues,
} from '../../App';
import { ChatDirect } from '../Chat/ChatDirect';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import { LoadingButton } from '@mui/lab';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import { GroupAnnouncements } from '../Chat/GroupAnnouncements';
import { GroupForum } from '../Chat/GroupForum';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { WebSocketActive } from './WebsocketActive';
import {
  getGroupAdmins,
  getGroupMembers,
  getNameInfo,
  getPublishesFromAdmins,
} from './groupApi';
import { timeDifferenceForNotificationChats } from './groupConstants';
import { decryptResource } from './groupDataPublishes';
import { requestQueueMemberNames } from './groupQueues';
import type { GroupProps } from './groupTypes';
import { areKeysEqual, validateSecretKey } from './groupValidation';
import { useMessageQueue } from '../../messaging/MessageQueueContext';
import { HomeDesktop } from './HomeDesktop';
import { DesktopHeader } from '../Desktop/DesktopHeader';
import { AppsDesktop } from '../Apps/AppsDesktop';
import { AppsDevMode } from '../Apps/AppsDevMode';
import { DesktopSideBar } from '../Desktop/DesktopLeftSideBar';
import { AdminSpace } from '../Chat/AdminSpace';
import {
  addressInfoControllerAtom,
  groupAnnouncementsAtom,
  groupChatTimestampsAtom,
  groupsOwnerNamesAtom,
  groupsPropertiesAtom,
  isOpenBlockedModalAtom,
  isRunningPublicNodeAtom,
  memberGroupsAtom,
  mutedGroupsAtom,
  myGroupsWhereIAmAdminAtom,
  selectedGroupIdAtom,
  timestampEnterDataAtom,
} from '../../atoms/global';
import { sortArrayByTimestampAndGroupName } from '../../utils/time';
import { BlockedUsersModal } from './BlockedUsersModal';
import { WalletsAppWrapper } from './WalletsAppWrapper';
import { useTranslation } from 'react-i18next';
import { GroupList } from './GroupList';
import { useAtom, useSetAtom } from 'jotai';
import { requestQueueGroupJoinRequests } from './GroupJoinRequests';
import {
  TIME_MINUTES_10_IN_MILLISECONDS,
  TIME_MINUTES_2_IN_MILLISECONDS,
  TIME_DAYS_1_IN_MILLISECONDS,
} from '../../constants/constants';
import { useWebsocketStatus } from './useWebsocketStatus';
import { AvatarPreviewModal } from '../Chat/AvatarPreviewModal';
import { getClickableAvatarSx } from '../Chat/clickableAvatarStyles';
import { DirectsSidebar } from './DirectsSidebar';

// Re-export for backward compatibility with existing imports from Group.tsx
export {
  getAllPublishesFromAdmins,
  getGroupAdmins,
  getGroupAdminsAddress,
  getNameInfo,
  getNames,
  getNamesForAdmins,
  getGroupMembers,
  getPublishesFromAdmins,
} from './groupApi';
export { timeDifferenceForNotificationChats } from './groupConstants';
export {
  addDataPublishesFunc,
  decryptResource,
  getDataPublishesFunc,
} from './groupDataPublishes';
export {
  requestQueueAdminMemberNames,
  requestQueueMemberNames,
} from './groupQueues';
export type { GroupProps } from './groupTypes';
export { validateSecretKey } from './groupValidation';

export const Group = ({
  myAddress,
  userInfo,
  balance,
  setIsOpenDrawerProfile,
  setDesktopViewMode,
  desktopViewMode,
}: GroupProps) => {
  const [desktopSideView, setDesktopSideView] = useState('groups');
  const [lastQappViewMode, setLastQappViewMode] = useState('apps');
  const [secretKey, setSecretKey] = useState(null);
  const [secretKeyPublishDate, setSecretKeyPublishDate] = useState(null);
  const lastFetchedSecretKey = useRef(null);
  const [secretKeyDetails, setSecretKeyDetails] = useState(null);
  const [newEncryptionNotification, setNewEncryptionNotification] =
    useState(null);
  const [memberCountFromSecretKeyData, setMemberCountFromSecretKeyData] =
    useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [selectedDirect, setSelectedDirect] = useState(null);
  const hasInitializedWebsocket = useRef(false);
  const [groups, setGroups] = useState([]);
  const [directs, setDirects] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [adminsWithNames, setAdminsWithNames] = useState([]);
  const [members, setMembers] = useState([]);
  const [groupOwner, setGroupOwner] = useState(null);
  const [triedToFetchSecretKey, setTriedToFetchSecretKey] = useState(false);
  const [openAddGroup, setOpenAddGroup] = useState(false);
  const [openManageMembers, setOpenManageMembers] = useState(false);
  const setMemberGroups = useSetAtom(memberGroupsAtom);
  const lastGroupNotification = useRef<null | number>(null);
  const [timestampEnterData, setTimestampEnterData] = useAtom(
    timestampEnterDataAtom
  );
  const groupsPropertiesRef = useRef({});
  const [chatMode, setChatMode] = useState('groups');
  const [newChat, setNewChat] = useState(false);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const [isLoadingNotifyAdmin, setIsLoadingNotifyAdmin] = useState(false);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [isLoadingGroup, setIsLoadingGroup] = useState(false);
  const [firstSecretKeyInCreation, setFirstSecretKeyInCreation] =
    useState(false);
  const [groupSection, setGroupSection] = useState('home');
  const [groupAnnouncements, setGroupAnnouncements] = useAtom(
    groupAnnouncementsAtom
  );
  const [defaultThread, setDefaultThread] = useState(null);
  const [isOpenDrawer, setIsOpenDrawer] = useState(false);
  const setIsOpenBlockedUserModal = useSetAtom(isOpenBlockedModalAtom);
  const [hideCommonKeyPopup, setHideCommonKeyPopup] = useState(false);
  const [isLoadingGroupMessage, setIsLoadingGroupMessage] = useState('');
  const setMutedGroups = useSetAtom(mutedGroupsAtom);
  const [mobileViewMode, setMobileViewMode] = useState('home');
  const [mobileViewModeKeepOpen, setMobileViewModeKeepOpen] = useState('');
  const timestampEnterDataRef = useRef({});
  const selectedGroupRef = useRef(null);
  const selectedDirectRef = useRef(null);
  const groupSectionRef = useRef(null);
  const checkGroupInterval = useRef(null);
  const isLoadingOpenSectionFromNotification = useRef(false);
  const setupGroupWebsocketInterval = useRef(null);
  const settimeoutForRefetchSecretKey = useRef(null);
  const { clearStatesMessageQueueProvider } = useMessageQueue();
  const initiatedGetMembers = useRef(false);
  const [groupChatTimestamps, setGroupChatTimestamps] = useAtom(
    groupChatTimestampsAtom
  );
  const [isRunningPublicNode] = useAtom(isRunningPublicNodeAtom);
  const [avatarPreviewData, setAvatarPreviewData] = useState<{
    alt: string;
    src: string;
  } | null>(null);
  const [directAvatarLoaded, setDirectAvatarLoaded] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (desktopViewMode === 'apps' || desktopViewMode === 'dev') {
      setLastQappViewMode(desktopViewMode);
    }
  }, [desktopViewMode]);

  const [appsMode, setAppsMode] = useState('home');
  const [appsModeDev, setAppsModeDev] = useState('home');
  const [isOpenSideViewDirects, setIsOpenSideViewDirects] = useState(false);
  const [isOpenSideViewGroups, setIsOpenSideViewGroups] = useState(false);
  const [isForceShowCreationKeyPopup, setIsForceShowCreationKeyPopup] =
    useState(false);
  const groupsOwnerNamesRef = useRef({});
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  useWebsocketStatus();
  const [groupsProperties, setGroupsProperties] = useAtom(groupsPropertiesAtom);
  const setGroupsOwnerNames = useSetAtom(groupsOwnerNamesAtom);

  const setUserInfoForLevels = useSetAtom(addressInfoControllerAtom);
  const setMyGroupsWhereIAmAdmin = useSetAtom(myGroupsWhereIAmAdminAtom);
  const isPrivate = useMemo(() => {
    if (selectedGroup?.groupId === '0') return false;
    if (!selectedGroup?.groupId || !groupsProperties[selectedGroup?.groupId])
      return null;
    if (groupsProperties[selectedGroup?.groupId]?.isOpen === true) return false;
    if (groupsProperties[selectedGroup?.groupId]?.isOpen === false) return true;
    return null;
  }, [selectedGroup]);

  const setSelectedGroupId = useSetAtom(selectedGroupIdAtom);

  const toggleSideViewDirects = () => {
    if (isOpenSideViewGroups) {
      setIsOpenSideViewGroups(false);
    }
    setIsOpenSideViewDirects((prev) => !prev);
  };
  const toggleSideViewGroups = () => {
    if (isOpenSideViewDirects) {
      setIsOpenSideViewDirects(false);
    }
    setIsOpenSideViewGroups((prev) => !prev);
  };

  useEffect(() => {
    timestampEnterDataRef.current = timestampEnterData;
  }, [timestampEnterData]);

  useEffect(() => {
    groupSectionRef.current = groupSection;
  }, [groupSection]);
  useEffect(() => {
    selectedGroupRef.current = selectedGroup;
    setSelectedGroupId(selectedGroup?.groupId);
  }, [selectedGroup]);
  useEffect(() => {
    selectedDirectRef.current = selectedDirect;
  }, [selectedDirect]);

  // Track view modes to prevent marking messages as read when not viewing chat
  const desktopViewModeRef = useRef(desktopViewMode);
  const mobileViewModeRef = useRef(mobileViewMode);

  useEffect(() => {
    desktopViewModeRef.current = desktopViewMode;
  }, [desktopViewMode]);

  useEffect(() => {
    mobileViewModeRef.current = mobileViewMode;
  }, [mobileViewMode]);

  // Track previous view mode to detect when user returns to chat
  const prevDesktopViewModeRef = useRef(desktopViewMode);
  const prevMobileViewModeRef = useRef(mobileViewMode);

  // Mark messages as read when user returns to chat view
  useEffect(() => {
    const wasInChatMode =
      prevDesktopViewModeRef.current === 'chat' ||
      prevMobileViewModeRef.current === 'chat';
    const isNowInChatMode =
      desktopViewMode === 'chat' || mobileViewMode === 'chat';

    // Only update timestamp when user RETURNS to chat (wasn't in chat, now is in chat)
    if (!wasInChatMode && isNowInChatMode) {
      // Update timestamp for selected group chat
      if (selectedGroupRef.current && groupSectionRef.current === 'chat') {
        window
          .sendMessage('addTimestampEnterChat', {
            timestamp: Date.now(),
            groupId: selectedGroupRef.current.groupId,
          })
          .then(() => {
            // Refresh the timestamp data to update UI
            setTimeout(() => {
              getTimestampEnterChat();
            }, 600);
          })
          .catch((error) => {
            console.error(
              'Failed to add timestamp:',
              error.message || 'An error occurred'
            );
          });
      }

      // Update timestamp for selected direct chat
      if (selectedDirectRef.current) {
        window
          .sendMessage('addTimestampEnterChat', {
            timestamp: Date.now(),
            groupId: selectedDirectRef.current.address,
          })
          .then(() => {
            // Refresh the timestamp data to update UI
            setTimeout(() => {
              getTimestampEnterChat();
            }, 600);
          })
          .catch((error) => {
            console.error(
              'Failed to add timestamp:',
              error.message || 'An error occurred'
            );
          });
      }
    }

    // Update previous view mode refs
    prevDesktopViewModeRef.current = desktopViewMode;
    prevMobileViewModeRef.current = mobileViewMode;
  }, [desktopViewMode, mobileViewMode]);

  const getUserSettings = useCallback(async () => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getUserSettings', {
            key: 'mutedGroups',
          })
          .then((response) => {
            if (!response?.error) {
              setMutedGroups(response || []);
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
      console.error(error);
    }
  }, [setMutedGroups]);

  useEffect(() => {
    getUserSettings();
  }, [getUserSettings]);

  const getTimestampEnterChat = useCallback(async () => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getTimestampEnterChat')
          .then((response) => {
            if (!response?.error) {
              setTimestampEnterData(response);
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
  }, []);

  const refreshHomeDataFunc = () => {
    setGroupSection('default');
    setTimeout(() => {
      setGroupSection('home');
    }, 300);
  };

  const getGroupAnnouncements = async () => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getGroupNotificationTimestamp')
          .then((response) => {
            if (!response?.error) {
              setGroupAnnouncements(response);
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

  useEffect(() => {
    if (myAddress) {
      getGroupAnnouncements();
      getTimestampEnterChat();
    }
  }, [myAddress]);

  const getGroupOwner = async (groupId) => {
    if (groupId == '0') return; // general group has id=0
    try {
      const url = `${getBaseApiReact()}/groups/${groupId}`;
      const response = await fetch(url);
      const data = await response.json();

      const name = await getNameInfo(data?.owner);
      if (name) {
        data.name = name;
      }
      setGroupOwner(data);
    } catch (error) {
      console.log(error);
    }
  };

  const directChatHasUnread = useMemo(() => {
    let hasUnread = false;
    directs.forEach((direct) => {
      if (
        direct?.sender !== myAddress &&
        direct?.timestamp &&
        ((!timestampEnterData[direct?.address] &&
          Date.now() - direct?.timestamp <
            timeDifferenceForNotificationChats) ||
          timestampEnterData[direct?.address] < direct?.timestamp)
      ) {
        hasUnread = true;
      }
    });
    return hasUnread;
  }, [timestampEnterData, directs, myAddress]);

  const groupChatHasUnread = useMemo(() => {
    let hasUnread = false;
    groups.forEach((group) => {
      if (group?.groupId === '0') {
        return;
      }
      if (
        group?.data &&
        group?.sender !== myAddress &&
        group?.timestamp &&
        groupChatTimestamps[group?.groupId] &&
        ((!timestampEnterData[group?.groupId] &&
          Date.now() - group?.timestamp < timeDifferenceForNotificationChats) ||
          timestampEnterData[group?.groupId] < group?.timestamp)
      ) {
        hasUnread = true;
      }
    });
    return hasUnread;
  }, [timestampEnterData, groups, myAddress, groupChatTimestamps]);

  const groupsAnnHasUnread = useMemo(() => {
    let hasUnread = false;
    groups.forEach((group) => {
      if (
        groupAnnouncements[group?.groupId] &&
        !groupAnnouncements[group?.groupId]?.seentimestamp
      ) {
        hasUnread = true;
      }
    });
    return hasUnread;
  }, [groupAnnouncements, groups]);

  const groupsFilteredForList = useMemo(
    () => groups.filter((g) => g.groupId !== '0'),
    [groups]
  );

  const getSecretKey = useCallback(
    async (loadingGroupParam?: boolean, secretKeyToPublish?: boolean) => {
      try {
        setIsLoadingGroupMessage(
          t('auth:message.generic.locating_encryption_keys', {
            postProcess: 'capitalizeFirstChar',
          })
        );
        pauseAllQueues();

        let dataFromStorage;
        let publishFromStorage;
        let adminsFromStorage;

        if (
          secretKeyToPublish &&
          secretKey &&
          lastFetchedSecretKey.current &&
          Date.now() - lastFetchedSecretKey.current <
            TIME_MINUTES_10_IN_MILLISECONDS
        ) {
          return secretKey;
        }

        if (loadingGroupParam) {
          setIsLoadingGroup(true);
        }

        if (selectedGroup?.groupId !== selectedGroupRef.current.groupId) {
          if (settimeoutForRefetchSecretKey.current) {
            clearTimeout(settimeoutForRefetchSecretKey.current);
          }
          return;
        }

        const prevGroupId = selectedGroupRef.current.groupId;

        const { names, addresses, both } =
          adminsFromStorage || (await getGroupAdmins(selectedGroup?.groupId));
        setAdmins(addresses);
        setAdminsWithNames(both);

        if (!names.length) throw new Error('Network error');

        const publish =
          publishFromStorage ||
          (await getPublishesFromAdmins(names, selectedGroup?.groupId));

        if (prevGroupId !== selectedGroupRef.current.groupId) {
          if (settimeoutForRefetchSecretKey.current) {
            clearTimeout(settimeoutForRefetchSecretKey.current);
          }
          return;
        }

        if (publish === false) {
          setTriedToFetchSecretKey(true);
          settimeoutForRefetchSecretKey.current = setTimeout(() => {
            getSecretKey();
          }, TIME_MINUTES_2_IN_MILLISECONDS);
          return false;
        }

        setSecretKeyPublishDate(publish?.updated || publish?.created);

        let data;
        if (dataFromStorage) {
          data = dataFromStorage;
        } else {
          setIsLoadingGroupMessage(
            t('auth:message.generic.downloading_encryption_keys', {
              postProcess: 'capitalizeFirstChar',
            })
          );
          const res = await fetch(
            `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${publish.identifier}?encoding=base64&rebuild=true`
          );
          data = await res.text();
        }

        const decryptedKey: any = await decryptResource(data, null);
        const dataint8Array = base64ToUint8Array(decryptedKey.data);
        const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);

        if (!validateSecretKey(decryptedKeyToObject)) {
          throw new Error('SecretKey is not valid');
        }

        setSecretKeyDetails(publish);
        setSecretKey(decryptedKeyToObject);
        lastFetchedSecretKey.current = Date.now();
        setMemberCountFromSecretKeyData(decryptedKey.count);

        window
          .sendMessage('setGroupData', {
            groupId: selectedGroup?.groupId,
            secretKeyData: data,
            secretKeyResource: publish,
            admins: { names, addresses, both },
          })
          .catch((error) => {
            console.error(
              'Failed to set group data:',
              error.message || 'An error occurred'
            );
          });

        if (decryptedKeyToObject) {
          setTriedToFetchSecretKey(true);
          setFirstSecretKeyInCreation(false);
          return decryptedKeyToObject;
        } else {
          setTriedToFetchSecretKey(true);
        }
      } catch (error) {
        if (error === 'Unable to decrypt data') {
          setTriedToFetchSecretKey(true);
          settimeoutForRefetchSecretKey.current = setTimeout(() => {
            getSecretKey();
          }, TIME_MINUTES_2_IN_MILLISECONDS);
        }
      } finally {
        setIsLoadingGroup(false);
        setIsLoadingGroupMessage('');
        resumeAllQueues();
      }
    },
    [
      secretKey,
      selectedGroup?.groupId,
      setIsLoadingGroup,
      setIsLoadingGroupMessage,
      setSecretKey,
      setSecretKeyDetails,
      setTriedToFetchSecretKey,
      setFirstSecretKeyInCreation,
      setMemberCountFromSecretKeyData,
      setAdmins,
      setAdminsWithNames,
      setSecretKeyPublishDate,
    ]
  );

  const getAdminsForPublic = async (selectedGroup) => {
    try {
      const { names, addresses, both } = await getGroupAdmins(
        selectedGroup?.groupId
      );
      setAdmins(addresses);
      setAdminsWithNames(both);
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    if (selectedGroup && isPrivate !== null) {
      if (isPrivate) {
        setTriedToFetchSecretKey(false);
        getSecretKey(true);
      }

      getGroupOwner(selectedGroup?.groupId);
    }
    if (isPrivate === false) {
      setTriedToFetchSecretKey(true);
      if (selectedGroup?.groupId !== '0') {
        getAdminsForPublic(selectedGroup);
      }
    }
  }, [selectedGroup, isPrivate]);

  const getCountNewMesg = async (groupId, after) => {
    try {
      const response = await fetch(
        `${getBaseApiReact()}/chat/messages?after=${after}&txGroupId=${groupId}&haschatreference=false&encoding=BASE64&limit=1`
      );
      const data = await response.json();
      if (data && data[0]) return data[0].timestamp;
    } catch (error) {
      console.log(error);
    }
  };

  const getLatestRegularChat = async (groups) => {
    try {
      const groupData = {};

      const getGroupData = groups.map(async (group) => {
        if (!group.groupId || !group?.timestamp) return null;
        if (
          !groupData[group.groupId] ||
          groupData[group.groupId] < group.timestamp
        ) {
          const hasMoreRecentMsg = await getCountNewMesg(
            group.groupId,
            timestampEnterDataRef.current[group?.groupId] ||
              Date.now() - TIME_DAYS_1_IN_MILLISECONDS
          );
          if (hasMoreRecentMsg) {
            groupData[group.groupId] = hasMoreRecentMsg;
          }
        } else {
          return null;
        }
      });

      await Promise.all(getGroupData);
      setGroupChatTimestamps(groupData);
    } catch (error) {
      console.log(error);
    }
  };

  const getOwnerNameForGroup = async (owner: string, groupId: string) => {
    if (groupId == '0') return; // general group has id=0
    try {
      if (!owner) return;
      if (groupsOwnerNamesRef.current[groupId]) return;
      const name = await requestQueueMemberNames.enqueue(() => {
        return getNameInfo(owner);
      });
      if (name) {
        groupsOwnerNamesRef.current[groupId] = name;
        setGroupsOwnerNames((prev) => {
          return { ...prev, [groupId]: name };
        });
      }
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    groupsPropertiesRef.current = groupsProperties;
  }, [groupsProperties]);

  const getGroupsProperties = useCallback(async (address) => {
    try {
      const url = `${getBaseApiReact()}/groups/member/${address}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Cannot get group properties');
      const data = await response.json();
      const transformToObject = data.reduce((result, item) => {
        result[item.groupId] = item;
        return result;
      }, {});
      setGroupsProperties(transformToObject);
      Object.keys(transformToObject).forEach((key) => {
        getOwnerNameForGroup(transformToObject[key]?.owner || '', key);
      });
    } catch (error) {
      console.log(error);
    }
  }, []);

  const getGroupsWhereIAmAMember = useCallback(async (groups) => {
    try {
      let groupsAsAdmin = [];
      const getAllGroupsAsAdmin = groups
        .filter((item) => item.groupId !== '0')
        .map(async (group) => {
          const isAdminResponse = await requestQueueGroupJoinRequests.enqueue(
            () => {
              return fetch(
                `${getBaseApiReact()}/groups/members/${group.groupId}?limit=0&onlyAdmins=true`
              );
            }
          );
          const isAdminData = await isAdminResponse.json();

          const findMyself = isAdminData?.members?.find(
            (member) => member.member === myAddress
          );

          if (findMyself) {
            groupsAsAdmin.push(group);
          }
          return true;
        });

      await Promise.all(getAllGroupsAsAdmin);
      setMyGroupsWhereIAmAdmin(groupsAsAdmin);
    } catch (error) {
      console.error();
    }
  }, []);

  useEffect(() => {
    if (!myAddress) return;
    if (
      !areKeysEqual(
        groups?.map((grp) => grp?.groupId),
        Object.keys(groupsPropertiesRef.current)
      )
    ) {
      getGroupsProperties(myAddress);
      getGroupsWhereIAmAMember(groups);
    }
  }, [groups, myAddress]);

  useEffect(() => {
    // Handler function for incoming messages
    const messageHandler = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const message = event.data;
      if (message?.action === 'SET_GROUPS') {
        // Update the component state with the received 'sendqort' state
        setGroups(sortArrayByTimestampAndGroupName(message.payload));
        getLatestRegularChat(message.payload);
        setMemberGroups(
          message.payload?.filter((item) => item?.groupId !== '0')
        );

        // Only mark messages as read if user is actually viewing the chat
        if (
          selectedGroupRef.current &&
          groupSectionRef.current === 'chat' &&
          (desktopViewModeRef.current === 'chat' ||
            mobileViewModeRef.current === 'chat')
        ) {
          window
            .sendMessage('addTimestampEnterChat', {
              timestamp: Date.now(),
              groupId: selectedGroupRef.current.groupId,
            })
            .catch((error) => {
              console.error(
                'Failed to add timestamp:',
                error.message || 'An error occurred'
              );
            });
        }

        // Only mark direct messages as read if user is actually viewing the chat
        if (
          selectedDirectRef.current &&
          (desktopViewModeRef.current === 'chat' ||
            mobileViewModeRef.current === 'chat')
        ) {
          window
            .sendMessage('addTimestampEnterChat', {
              timestamp: Date.now(),
              groupId: selectedDirectRef.current.address,
            })
            .catch((error) => {
              console.error(
                'Failed to add timestamp:',
                error.message || 'An error occurred'
              );
            });
        }

        setTimeout(() => {
          getTimestampEnterChat();
        }, 600);
      }

      if (message?.action === 'SET_GROUP_ANNOUNCEMENTS') {
        // Update the component state with the received 'sendqort' state
        setGroupAnnouncements(message.payload);

        // Only mark announcements as read if user is actually viewing the announcement section
        if (
          selectedGroupRef.current &&
          groupSectionRef.current === 'announcement' &&
          (desktopViewModeRef.current === 'chat' ||
            mobileViewModeRef.current === 'group')
        ) {
          window
            .sendMessage('addGroupNotificationTimestamp', {
              timestamp: Date.now(),
              groupId: selectedGroupRef.current.groupId,
            })
            .catch((error) => {
              console.error(
                'Failed to add group notification timestamp:',
                error.message || 'An error occurred'
              );
            });

          setTimeout(() => {
            getGroupAnnouncements();
          }, 200);
        }
      }

      if (message?.action === 'SET_DIRECTS') {
        // Update the component state with the received 'sendqort' state
        setDirects(message.payload);
      } else if (message?.action === 'PLAY_NOTIFICATION_SOUND') {
        // audio.play();
      }
    };

    // Attach the event listener
    window.addEventListener('message', messageHandler);

    // Clean up the event listener on component unmount
    return () => {
      window.removeEventListener('message', messageHandler);
    };
  }, []);

  useEffect(() => {
    if (
      !myAddress ||
      hasInitializedWebsocket.current ||
      !groups ||
      groups?.length === 0
    )
      return;

    window.sendMessage('setupGroupWebsocket', {}).catch((error) => {
      console.error(
        'Failed to setup group websocket:',
        error.message || 'An error occurred'
      );
    });

    hasInitializedWebsocket.current = true;
  }, [myAddress, groups]);

  const getMembers = async (groupId) => {
    try {
      const res = await getGroupMembers(groupId);
      if (groupId !== selectedGroupRef.current?.groupId) return;
      setMembers(res);
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    if (
      !initiatedGetMembers.current &&
      selectedGroup?.groupId &&
      secretKey &&
      admins.includes(myAddress) &&
      selectedGroup?.groupId !== '0'
    ) {
      // getAdmins(selectedGroup?.groupId);
      getMembers(selectedGroup?.groupId);
      initiatedGetMembers.current = true;
    }
  }, [selectedGroup?.groupId, secretKey, myAddress, admins]);

  const shouldReEncrypt = useMemo(() => {
    if (triedToFetchSecretKey && !secretKeyPublishDate) return true;
    if (
      !secretKeyPublishDate ||
      !memberCountFromSecretKeyData ||
      members?.length === 0
    )
      return false;
    const isDiffMemberNumber =
      memberCountFromSecretKeyData !== members?.memberCount &&
      newEncryptionNotification?.decryptedData?.data?.numberOfMembers !==
        members?.memberCount;

    if (isDiffMemberNumber) return true;

    const latestJoined = members?.members.reduce((maxJoined, current) => {
      return current.joined > maxJoined ? current.joined : maxJoined;
    }, members?.members[0].joined);

    if (
      secretKeyPublishDate < latestJoined &&
      newEncryptionNotification?.data?.timestamp < latestJoined
    ) {
      return true;
    }
    return false;
  }, [
    memberCountFromSecretKeyData,
    members,
    secretKeyPublishDate,
    newEncryptionNotification,
    triedToFetchSecretKey,
  ]);

  const notifyAdmin = async (admin) => {
    try {
      setIsLoadingNotifyAdmin(true);
      await new Promise((res, rej) => {
        window
          .sendMessage('notifyAdminRegenerateSecretKey', {
            adminAddress: admin.address,
            groupName: selectedGroup?.groupName,
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
      setInfoSnack({
        type: 'success',
        message: 'Successfully sent notification.',
      });
      setOpenSnack(true);
    } catch (error) {
      setInfoSnack({
        type: 'error',
        message: 'Unable to send notification',
      });
    } finally {
      setIsLoadingNotifyAdmin(false);
    }
  };

  const isUnreadChat = useMemo(() => {
    const findGroup = groups
      .filter((group) => group?.sender !== myAddress)
      .find((gr) => gr?.groupId === selectedGroup?.groupId);
    if (!findGroup) return false;
    if (!findGroup?.data) return false;
    return (
      findGroup?.timestamp &&
      groupChatTimestamps[findGroup?.groupId] &&
      ((!timestampEnterData[selectedGroup?.groupId] &&
        Date.now() - findGroup?.timestamp <
          timeDifferenceForNotificationChats) ||
        timestampEnterData?.[selectedGroup?.groupId] < findGroup?.timestamp)
    );
  }, [timestampEnterData, selectedGroup, groupChatTimestamps]);

  const isUnread = useMemo(() => {
    if (!selectedGroup) return false;
    return (
      groupAnnouncements?.[selectedGroup?.groupId]?.seentimestamp === false
    );
  }, [groupAnnouncements, selectedGroup, myAddress]);

  const openDirectChatFromNotification = (e) => {
    if (isLoadingOpenSectionFromNotification.current) return;
    isLoadingOpenSectionFromNotification.current = true;
    const directAddress = e.detail?.from;

    const findDirect = directs?.find(
      (direct) => direct?.address === directAddress
    );
    if (findDirect?.address === selectedDirect?.address) {
      isLoadingOpenSectionFromNotification.current = false;
      return;
    }
    if (findDirect) {
      setDesktopSideView('directs');
      setDesktopViewMode('home');
      setSelectedDirect(null);

      setNewChat(false);

      window
        .sendMessage('addTimestampEnterChat', {
          timestamp: Date.now(),
          groupId: findDirect.address,
        })
        .catch((error) => {
          console.error(
            'Failed to add timestamp:',
            error.message || 'An error occurred'
          );
        });

      setTimeout(() => {
        setSelectedDirect(findDirect);
        getTimestampEnterChat();
        isLoadingOpenSectionFromNotification.current = false;
      }, 200);
    } else {
      isLoadingOpenSectionFromNotification.current = false;
    }
  };

  const openDirectChatFromInternal = (e) => {
    const directAddress = e.detail?.address;
    const name = e.detail?.name;
    const findDirect = directs?.find(
      (direct) => direct?.address === directAddress || direct?.name === name
    );

    if (findDirect) {
      setDesktopSideView('directs');
      setSelectedDirect(null);

      setNewChat(false);

      window
        .sendMessage('addTimestampEnterChat', {
          timestamp: Date.now(),
          groupId: findDirect.address,
        })
        .catch((error) => {
          console.error(
            'Failed to add timestamp:',
            error.message || 'An error occurred'
          );
        });

      setTimeout(() => {
        setSelectedDirect(findDirect);
        getTimestampEnterChat();
      }, 200);
    } else {
      setDesktopSideView('directs');
      setNewChat(true);
      setTimeout(() => {
        executeEvent('setDirectToValueNewChat', {
          directToValue: name || directAddress,
        });
      }, 500);
    }
  };

  useEffect(() => {
    subscribeToEvent('openDirectMessageInternal', openDirectChatFromInternal);

    return () => {
      unsubscribeFromEvent(
        'openDirectMessageInternal',
        openDirectChatFromInternal
      );
    };
  }, [directs, selectedDirect]);

  useEffect(() => {
    subscribeToEvent('openDirectMessage', openDirectChatFromNotification);

    return () => {
      unsubscribeFromEvent('openDirectMessage', openDirectChatFromNotification);
    };
  }, [directs, selectedDirect]);

  const handleMarkAsRead = (e) => {
    const { groupId } = e.detail;
    window
      .sendMessage('addTimestampEnterChat', {
        timestamp: Date.now(),
        groupId,
      })
      .catch((error) => {
        console.error(
          'Failed to add timestamp:',
          error.message || 'An error occurred'
        );
      });

    window
      .sendMessage('addGroupNotificationTimestamp', {
        timestamp: Date.now(),
        groupId,
      })
      .catch((error) => {
        console.error(
          'Failed to add group notification timestamp:',
          error.message || 'An error occurred'
        );
      });

    setTimeout(() => {
      getGroupAnnouncements();
      getTimestampEnterChat();
    }, 200);
  };

  useEffect(() => {
    subscribeToEvent('markAsRead', handleMarkAsRead);

    return () => {
      unsubscribeFromEvent('markAsRead', handleMarkAsRead);
    };
  }, []);

  const resetAllStatesAndRefs = () => {
    // Reset all useState values to their initial states
    setSecretKey(null);
    lastFetchedSecretKey.current = null;
    setSecretKeyPublishDate(null);
    setSecretKeyDetails(null);
    setNewEncryptionNotification(null);
    setMemberCountFromSecretKeyData(null);
    setIsForceShowCreationKeyPopup(false);
    setSelectedGroup(null);
    setSelectedDirect(null);
    setGroups([]);
    setDirects([]);
    setAdmins([]);
    setAdminsWithNames([]);
    setMembers([]);
    setGroupOwner(null);
    setTriedToFetchSecretKey(false);
    setHideCommonKeyPopup(false);
    setOpenAddGroup(false);
    setOpenManageMembers(false);
    setTimestampEnterData({});
    setChatMode('groups');
    setNewChat(false);
    setOpenSnack(false);
    setInfoSnack(null);
    setIsLoadingNotifyAdmin(false);
    setIsLoadingGroups(false);
    setIsLoadingGroup(false);
    setFirstSecretKeyInCreation(false);
    setGroupSection('home');
    setGroupAnnouncements({});
    setDefaultThread(null);
    setMobileViewMode('home');
    // Reset all useRef values to their initial states
    hasInitializedWebsocket.current = false;
    selectedGroupRef.current = null;
    selectedDirectRef.current = null;
    groupSectionRef.current = null;
    isLoadingOpenSectionFromNotification.current = false;
    settimeoutForRefetchSecretKey.current = null;
    initiatedGetMembers.current = false;
    setDesktopViewMode('home');
  };

  const logoutEventFunc = () => {
    resetAllStatesAndRefs();
    clearStatesMessageQueueProvider();
  };

  useEffect(() => {
    subscribeToEvent('logout-event', logoutEventFunc);

    return () => {
      unsubscribeFromEvent('logout-event', logoutEventFunc);
    };
  }, []);

  const openAppsMode = () => {
    setDesktopViewMode('apps');
  };

  useEffect(() => {
    subscribeToEvent('open-apps-mode', openAppsMode);

    return () => {
      unsubscribeFromEvent('open-apps-mode', openAppsMode);
    };
  }, []);

  const openDevMode = () => {
    setDesktopViewMode('dev');
  };

  useEffect(() => {
    subscribeToEvent('open-dev-mode', openDevMode);

    return () => {
      unsubscribeFromEvent('open-dev-mode', openDevMode);
    };
  }, []);

  const openGroupChatFromNotification = (e) => {
    if (isLoadingOpenSectionFromNotification.current) return;

    const groupId = e.detail?.from;
    const findGroup = groups?.find((group) => +group?.groupId === +groupId);
    if (findGroup?.groupId === selectedGroup?.groupId) {
      isLoadingOpenSectionFromNotification.current = false;
      setChatMode('groups');
      setDesktopViewMode('chat');
      return;
    }
    if (findGroup) {
      setChatMode('groups');
      setSelectedGroup(null);
      setSelectedDirect(null);

      setNewChat(false);
      setSecretKey(null);
      setGroupOwner(null);
      lastFetchedSecretKey.current = null;
      initiatedGetMembers.current = false;
      setSecretKeyPublishDate(null);
      setAdmins([]);
      setSecretKeyDetails(null);
      setAdminsWithNames([]);
      setMembers([]);
      setMemberCountFromSecretKeyData(null);
      setIsForceShowCreationKeyPopup(false);
      setTriedToFetchSecretKey(false);
      setFirstSecretKeyInCreation(false);
      setGroupSection('chat');
      setDesktopViewMode('chat');

      window
        .sendMessage('addTimestampEnterChat', {
          timestamp: Date.now(),
          groupId: findGroup.groupId,
        })
        .catch((error) => {
          console.error(
            'Failed to add timestamp:',
            error.message || 'An error occurred'
          );
        });

      setTimeout(() => {
        setSelectedGroup(findGroup);
        setMobileViewMode('group');
        setDesktopSideView('groups');
        getTimestampEnterChat();
        isLoadingOpenSectionFromNotification.current = false;
      }, 350);
    } else {
      isLoadingOpenSectionFromNotification.current = false;
    }
  };

  useEffect(() => {
    subscribeToEvent('openGroupMessage', openGroupChatFromNotification);

    return () => {
      unsubscribeFromEvent('openGroupMessage', openGroupChatFromNotification);
    };
  }, [groups, selectedGroup]);

  const openGroupAnnouncementFromNotification = (e) => {
    const groupId = e.detail?.from;

    const findGroup = groups?.find((group) => +group?.groupId === +groupId);
    if (findGroup?.groupId === selectedGroup?.groupId) return;
    if (findGroup) {
      setChatMode('groups');
      setSelectedGroup(null);
      setSecretKey(null);
      setGroupOwner(null);
      lastFetchedSecretKey.current = null;
      initiatedGetMembers.current = false;
      setSecretKeyPublishDate(null);
      setAdmins([]);
      setSecretKeyDetails(null);
      setAdminsWithNames([]);
      setMembers([]);
      setMemberCountFromSecretKeyData(null);
      setIsForceShowCreationKeyPopup(false);
      setTriedToFetchSecretKey(false);
      setFirstSecretKeyInCreation(false);
      setGroupSection('announcement');
      setDesktopViewMode('chat');
      window
        .sendMessage('addGroupNotificationTimestamp', {
          timestamp: Date.now(),
          groupId: findGroup.groupId,
        })
        .catch((error) => {
          console.error(
            'Failed to add group notification timestamp:',
            error.message || 'An error occurred'
          );
        });

      setTimeout(() => {
        setSelectedGroup(findGroup);
        setMobileViewMode('group');
        setDesktopSideView('groups');
        getGroupAnnouncements();
      }, 350);
    }
  };

  useEffect(() => {
    subscribeToEvent(
      'openGroupAnnouncement',
      openGroupAnnouncementFromNotification
    );

    return () => {
      unsubscribeFromEvent(
        'openGroupAnnouncement',
        openGroupAnnouncementFromNotification
      );
    };
  }, [groups, selectedGroup]);

  const openThreadNewPostFunc = (e) => {
    const data = e.detail?.data;
    const { groupId } = data;
    const findGroup = groups?.find((group) => +group?.groupId === +groupId);
    if (findGroup?.groupId === selectedGroup?.groupId) {
      setGroupSection('forum');
      setDefaultThread(data);

      return;
    }
    if (findGroup) {
      setChatMode('groups');
      setSelectedGroup(null);
      setSecretKey(null);
      setGroupOwner(null);
      lastFetchedSecretKey.current = null;
      initiatedGetMembers.current = false;
      setSecretKeyPublishDate(null);
      setAdmins([]);
      setSecretKeyDetails(null);
      setAdminsWithNames([]);
      setMembers([]);
      setMemberCountFromSecretKeyData(null);
      setIsForceShowCreationKeyPopup(false);
      setTriedToFetchSecretKey(false);
      setFirstSecretKeyInCreation(false);
      setGroupSection('forum');
      setDefaultThread(data);
      setDesktopViewMode('chat');
      setTimeout(() => {
        setSelectedGroup(findGroup);
        setMobileViewMode('group');
        setDesktopSideView('groups');
        getGroupAnnouncements();
      }, 350);
    }
  };

  useEffect(() => {
    subscribeToEvent('openThreadNewPost', openThreadNewPostFunc);

    return () => {
      unsubscribeFromEvent('openThreadNewPost', openThreadNewPostFunc);
    };
  }, [groups, selectedGroup]);

  const handleSecretKeyCreationInProgress = useCallback(() => {
    setFirstSecretKeyInCreation(true);
  }, []);

  const getUserAvatarUrl = useCallback((name?: string) => {
    return name
      ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${name}/qortal_avatar?async=true`
      : '';
  }, []);

  const openAvatarPreview = useCallback(
    (src: string | null, alt?: string) => {
      if (!src) return;
      setAvatarPreviewData({
        src,
        alt: alt || '',
      });
    },
    [setAvatarPreviewData]
  );

  const closeAvatarPreview = useCallback(() => {
    setAvatarPreviewData(null);
  }, [setAvatarPreviewData]);

  const goToHome = async () => {
    setDesktopViewMode('home');

    await new Promise((res) => {
      setTimeout(() => {
        res(null);
      }, 200);
    });
  };

  const goToAnnouncements = async () => {
    setGroupSection('default');
    await new Promise((res) => {
      setTimeout(() => {
        res(null);
      }, 200);
    });
    setSelectedDirect(null);
    setNewChat(false);
    setGroupSection('announcement');
    window
      .sendMessage('addGroupNotificationTimestamp', {
        timestamp: Date.now(),
        groupId: selectedGroupRef.current.groupId,
      })
      .catch((error) => {
        console.error(
          'Failed to add group notification timestamp:',
          error.message || 'An error occurred'
        );
      });

    setTimeout(() => {
      getGroupAnnouncements();
    }, 200);
  };

  const openDrawerGroups = () => {
    setIsOpenDrawer(true);
  };

  const goToThreads = () => {
    setSelectedDirect(null);
    setNewChat(false);
    setGroupSection('forum');
  };

  const goToChat = async () => {
    setGroupSection('default');
    await new Promise((res) => {
      setTimeout(() => {
        res(null);
      }, 200);
    });
    setGroupSection('chat');
    setNewChat(false);
    setSelectedDirect(null);
    if (selectedGroupRef.current) {
      window
        .sendMessage('addTimestampEnterChat', {
          timestamp: Date.now(),
          groupId: selectedGroupRef.current.groupId,
        })
        .catch((error) => {
          console.error(
            'Failed to add timestamp:',
            error.message || 'An error occurred'
          );
        });

      setTimeout(() => {
        getTimestampEnterChat();
      }, 200);
    }
  };

  const theme = useTheme();

  const selectGroupFunc = useCallback((group) => {
    setMobileViewMode('group');
    setDesktopSideView('groups');
    initiatedGetMembers.current = false;
    clearAllQueues();
    setSelectedDirect(null);
    setTriedToFetchSecretKey(false);
    setNewChat(false);
    setSelectedGroup(null);
    setUserInfoForLevels({});
    setSecretKey(null);
    lastFetchedSecretKey.current = null;
    setSecretKeyPublishDate(null);
    setAdmins([]);
    setSecretKeyDetails(null);
    setAdminsWithNames([]);
    setGroupOwner(null);
    setMembers([]);
    setMemberCountFromSecretKeyData(null);
    setHideCommonKeyPopup(false);
    setFirstSecretKeyInCreation(false);
    setGroupSection('chat');
    setIsOpenDrawer(false);
    setIsForceShowCreationKeyPopup(false);
    setTimeout(() => {
      setSelectedGroup(group);
    }, 200);
  }, []);

  return (
    <>
      <WebSocketActive
        myAddress={myAddress}
        setIsLoadingGroups={setIsLoadingGroups}
      />

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />

      <Box
        style={{
          alignItems: 'flex-start',
          display: 'flex',
          flexDirection: 'row',
          height: '100%',
          width: '100%',
        }}
      >
        <DesktopSideBar
          desktopViewMode={desktopViewMode}
          toggleSideViewGroups={toggleSideViewGroups}
          toggleSideViewDirects={toggleSideViewDirects}
          goToHome={goToHome}
          mode={appsMode}
          setMode={setAppsMode}
          setDesktopSideView={setDesktopSideView}
          hasUnreadDirects={directChatHasUnread}
          isApps={desktopViewMode === 'apps'}
          myName={userInfo?.name}
          isGroups={isOpenSideViewGroups}
          isDirects={isOpenSideViewDirects}
          hasUnreadGroups={groupChatHasUnread || groupsAnnHasUnread}
          setDesktopViewMode={setDesktopViewMode}
          lastQappViewMode={lastQappViewMode}
        />

        {desktopViewMode === 'chat' && desktopSideView !== 'directs' && (
          <GroupList
            selectGroupFunc={selectGroupFunc}
            setDesktopSideView={setDesktopSideView}
            groupChatHasUnread={groupChatHasUnread}
            groupsAnnHasUnread={groupsAnnHasUnread}
            desktopSideView={desktopSideView}
            directChatHasUnread={directChatHasUnread}
            chatMode={chatMode}
            groups={groupsFilteredForList}
            selectedGroup={selectedGroup}
            getUserSettings={getUserSettings}
            setOpenAddGroup={setOpenAddGroup}
            setIsOpenBlockedUserModal={setIsOpenBlockedUserModal}
            myAddress={myAddress}
          />
        )}

        {desktopViewMode === 'chat' && desktopSideView === 'directs' && (
          <DirectsSidebar
            setDesktopSideView={setDesktopSideView}
            groupChatHasUnread={groupChatHasUnread}
            groupsAnnHasUnread={groupsAnnHasUnread}
            desktopSideView={desktopSideView}
            directChatHasUnread={directChatHasUnread}
            directs={directs}
            getUserAvatarUrl={getUserAvatarUrl}
            directAvatarLoaded={directAvatarLoaded}
            setDirectAvatarLoaded={setDirectAvatarLoaded}
            setSelectedDirect={setSelectedDirect}
            setNewChat={setNewChat}
            setIsOpenDrawer={setIsOpenDrawer}
            getTimestampEnterChat={getTimestampEnterChat}
            selectedDirect={selectedDirect}
            timestampEnterData={timestampEnterData}
            timeDifferenceForNotificationChats={timeDifferenceForNotificationChats}
            myAddress={myAddress}
            openAvatarPreview={openAvatarPreview}
            avatarPreviewData={avatarPreviewData}
            closeAvatarPreview={closeAvatarPreview}
            isRunningPublicNode={isRunningPublicNode}
            setIsOpenBlockedUserModal={setIsOpenBlockedUserModal}
          />
        )}

        <Box
          sx={{
            width: '100%',
            height: '100%',
            position: 'relative',
          }}
        >
          <AddGroup
            address={myAddress}
            open={openAddGroup}
            setOpen={setOpenAddGroup}
          />

          {newChat && (
            <>
              <Box
                sx={{
                  background: theme.palette.background.surface,
                  bottom: !(desktopViewMode === 'chat') ? 'unset' : '0px',
                  left: !(desktopViewMode === 'chat') ? '-100000px' : '0px',
                  opacity: !(desktopViewMode === 'chat') ? 0 : 1,
                  position: 'absolute',
                  right: !(desktopViewMode === 'chat') ? 'unset' : '0px',
                  top: !(desktopViewMode === 'chat') ? 'unset' : '0px',
                  zIndex: 5,
                }}
              >
                <ChatDirect
                  myAddress={myAddress}
                  myName={userInfo?.name}
                  isNewChat={newChat}
                  selectedDirect={undefined}
                  setSelectedDirect={setSelectedDirect}
                  setNewChat={setNewChat}
                  getTimestampEnterChat={getTimestampEnterChat}
                  balance={balance}
                  close={() => {
                    setSelectedDirect(null);
                    setNewChat(false);
                  }}
                  setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
                />
              </Box>
            </>
          )}
          {desktopViewMode === 'chat' && !selectedGroup && (
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                height: '100%',
                justifyContent: 'center',
                width: '100%',
              }}
            >
              <Typography
                sx={{
                  fontSize: '14px',
                  fontWeight: 400,
                  color: theme.palette.text.primary,
                }}
              >
                {t('group:message.generic.no_selection', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Box>
          )}

          <div
            style={{
              width: '100%',
              display: selectedGroup ? 'block' : 'none',
              opacity: !(desktopViewMode === 'chat' && selectedGroup) ? 0 : 1,
              position: !(desktopViewMode === 'chat' && selectedGroup)
                ? 'absolute'
                : 'relative',
              left: !(desktopViewMode === 'chat' && selectedGroup)
                ? '-100000px'
                : '0px',
            }}
          >
            <DesktopHeader
              isPrivate={isPrivate}
              selectedGroup={selectedGroup}
              groupSection={groupSection}
              isUnread={isUnread}
              goToAnnouncements={goToAnnouncements}
              isUnreadChat={isUnreadChat}
              goToChat={goToChat}
              goToThreads={goToThreads}
              setOpenManageMembers={setOpenManageMembers}
              groupChatHasUnread={groupChatHasUnread}
              groupsAnnHasUnread={groupsAnnHasUnread}
              directChatHasUnread={directChatHasUnread}
              chatMode={chatMode}
              openDrawerGroups={openDrawerGroups}
              goToHome={goToHome}
              setIsOpenDrawerProfile={setIsOpenDrawerProfile}
              mobileViewMode={mobileViewMode}
              setMobileViewMode={setMobileViewMode}
              setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
              hasUnreadGroups={groupChatHasUnread || groupsAnnHasUnread}
              hasUnreadDirects={directChatHasUnread}
              myName={userInfo?.name || null}
              isHome={groupSection === 'home'}
              isGroups={desktopSideView === 'groups'}
              isDirects={desktopSideView === 'directs'}
              setDesktopSideView={setDesktopSideView}
              hasUnreadAnnouncements={isUnread}
              isAnnouncement={groupSection === 'announcement'}
              isChat={groupSection === 'chat'}
              hasUnreadChat={isUnreadChat}
              setGroupSection={setGroupSection}
              isForum={groupSection === 'forum'}
            />

            <Box
              sx={{
                display: 'flex',
                flexGrow: 1,
                height: 'calc(100vh - 70px)',
                position: 'relative',
              }}
            >
              {triedToFetchSecretKey && (
                <ChatGroup
                  myAddress={myAddress}
                  selectedGroup={selectedGroup?.groupId}
                  getSecretKey={getSecretKey}
                  secretKey={secretKey}
                  isPrivate={isPrivate}
                  setSecretKey={setSecretKey}
                  handleNewEncryptionNotification={setNewEncryptionNotification}
                  hide={groupSection !== 'chat' || !!selectedDirect || newChat}
                  hideView={!(desktopViewMode === 'chat' && selectedGroup)}
                  handleSecretKeyCreationInProgress={
                    handleSecretKeyCreationInProgress
                  }
                  triedToFetchSecretKey={triedToFetchSecretKey}
                  myName={userInfo?.name}
                  balance={balance}
                  getTimestampEnterChatParent={getTimestampEnterChat}
                />
              )}
              {isPrivate &&
                firstSecretKeyInCreation &&
                triedToFetchSecretKey &&
                !secretKeyPublishDate && (
                  <div
                    style={{
                      alignItems: 'flex-start',
                      display: 'flex',
                      flexDirection: 'column',
                      height: '100%',
                      padding: '20px',
                      width: '100%',
                    }}
                  >
                    <Typography>
                      {t('group:message.generic.encryption_key', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                  </div>
                )}

              {isPrivate &&
              !admins.includes(myAddress) &&
              !secretKey &&
              triedToFetchSecretKey ? (
                <>
                  {secretKeyPublishDate ||
                  (!secretKeyPublishDate && !firstSecretKeyInCreation) ? (
                    <div
                      style={{
                        alignItems: 'flex-start',
                        display: 'flex',
                        flexDirection: 'column',
                        height: 'calc(100vh - 70px)',
                        overflow: 'auto',
                        padding: '20px',
                        width: '100%',
                      }}
                    >
                      <Typography>
                        {t('group:message.generic.not_part_group', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>

                      <Spacer height="25px" />

                      <Typography>
                        <strong>
                          {t('group:message.generic.only_encrypted', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </strong>
                      </Typography>

                      <Spacer height="25px" />

                      <Typography>
                        {t('group:message.generic.notify_admins', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>

                      <Spacer height="25px" />

                      {adminsWithNames.map((admin) => {
                        return (
                          <Box
                            sx={{
                              display: 'flex',
                              gap: '20px',
                              padding: '15px',
                              alignItems: 'center',
                            }}
                          >
                            <Typography>{admin?.name}</Typography>
                            <LoadingButton
                              loading={isLoadingNotifyAdmin}
                              loadingPosition="start"
                              variant="contained"
                              onClick={() => notifyAdmin(admin)}
                            >
                              {t('core:action.notify', {
                                postProcess: 'capitalizeFirstChar',
                              })}
                            </LoadingButton>
                          </Box>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              ) : admins.includes(myAddress) &&
                !secretKey &&
                isPrivate &&
                triedToFetchSecretKey ? null : !triedToFetchSecretKey ? null : (
                <>
                  <GroupAnnouncements
                    myAddress={myAddress}
                    selectedGroup={selectedGroup?.groupId}
                    getSecretKey={getSecretKey}
                    secretKey={secretKey}
                    setSecretKey={setSecretKey}
                    isAdmin={admins.includes(myAddress)}
                    handleNewEncryptionNotification={
                      setNewEncryptionNotification
                    }
                    myName={userInfo?.name}
                    hide={groupSection !== 'announcement'}
                    isPrivate={isPrivate}
                  />
                  <GroupForum
                    myAddress={myAddress}
                    selectedGroup={selectedGroup}
                    userInfo={userInfo}
                    getSecretKey={getSecretKey}
                    secretKey={secretKey}
                    setSecretKey={setSecretKey}
                    isAdmin={admins.includes(myAddress)}
                    hide={groupSection !== 'forum'}
                    defaultThread={defaultThread}
                    setDefaultThread={setDefaultThread}
                    isPrivate={isPrivate}
                  />
                  {groupSection === 'adminSpace' && (
                    <AdminSpace
                      adminsWithNames={adminsWithNames}
                      selectedGroup={selectedGroup?.groupId}
                      isOwner={groupOwner?.owner === myAddress}
                      myAddress={myAddress}
                      userInfo={userInfo}
                      hide={groupSection !== 'adminSpace'}
                      isAdmin={admins.includes(myAddress)}
                      balance={balance}
                    />
                  )}
                </>
              )}

              <Box
                sx={{
                  bottom: '25px',
                  display: 'flex',
                  position: 'absolute',
                  right: '25px',
                  zIndex: 100,
                }}
              >
                {((isPrivate &&
                  admins.includes(myAddress) &&
                  shouldReEncrypt &&
                  triedToFetchSecretKey &&
                  !firstSecretKeyInCreation &&
                  !hideCommonKeyPopup) ||
                  isForceShowCreationKeyPopup) && (
                  <CreateCommonSecret
                    isForceShowCreationKeyPopup={isForceShowCreationKeyPopup}
                    setHideCommonKeyPopup={setHideCommonKeyPopup}
                    groupId={selectedGroup?.groupId}
                    secretKey={secretKey}
                    secretKeyDetails={secretKeyDetails}
                    myAddress={myAddress}
                    isOwner={groupOwner?.owner === myAddress}
                    userInfo={userInfo}
                    setIsForceShowCreationKeyPopup={
                      setIsForceShowCreationKeyPopup
                    }
                    noSecretKey={
                      admins.includes(myAddress) &&
                      !secretKey &&
                      triedToFetchSecretKey
                    }
                  />
                )}
              </Box>
            </Box>

            {openManageMembers && (
              <ManageMembers
                selectedGroup={selectedGroup}
                address={myAddress}
                open={openManageMembers}
                setOpen={setOpenManageMembers}
                isAdmin={admins.includes(myAddress)}
                isOwner={groupOwner?.owner === myAddress}
              />
            )}
          </div>
          <BlockedUsersModal />

          {selectedDirect && !newChat && (
            <>
              <Box
                sx={{
                  background: theme.palette.background.default,
                  bottom: !(desktopViewMode === 'chat') ? 'unset' : '0px',
                  left: !(desktopViewMode === 'chat') ? '-100000px' : '0px',
                  opacity: !(desktopViewMode === 'chat') ? 0 : 1,
                  position: 'absolute',
                  right: !(desktopViewMode === 'chat') ? 'unset' : '0px',
                  top: !(desktopViewMode === 'chat') ? 'unset' : '0px',
                  zIndex: 5,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    flexGrow: 1,
                    height: '100%',
                    position: 'relative',
                  }}
                >
                  <ChatDirect
                    myAddress={myAddress}
                    isNewChat={newChat}
                    selectedDirect={selectedDirect}
                    setSelectedDirect={setSelectedDirect}
                    setNewChat={setNewChat}
                    getTimestampEnterChat={getTimestampEnterChat}
                    myName={userInfo?.name}
                    close={() => {
                      setSelectedDirect(null);

                      setNewChat(false);
                    }}
                    setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
                  />
                </Box>
              </Box>
            </>
          )}

          <AppsDesktop
            toggleSideViewGroups={toggleSideViewGroups}
            toggleSideViewDirects={toggleSideViewDirects}
            goToHome={goToHome}
            mode={appsMode}
            setMode={setAppsMode}
            setDesktopSideView={setDesktopSideView}
            hasUnreadDirects={directChatHasUnread}
            show={desktopViewMode === 'apps'}
            myName={userInfo?.name}
            myAddress={userInfo?.address}
            isGroups={isOpenSideViewGroups}
            isDirects={isOpenSideViewDirects}
            hasUnreadGroups={groupChatHasUnread || groupsAnnHasUnread}
            setDesktopViewMode={setDesktopViewMode}
            isApps={desktopViewMode === 'apps'}
            desktopViewMode={desktopViewMode}
          />

          <AppsDevMode
            toggleSideViewGroups={toggleSideViewGroups}
            toggleSideViewDirects={toggleSideViewDirects}
            goToHome={goToHome}
            mode={appsModeDev}
            setMode={setAppsModeDev}
            setDesktopSideView={setDesktopSideView}
            hasUnreadDirects={directChatHasUnread}
            show={desktopViewMode === 'dev'}
            myName={userInfo?.name}
            isGroups={isOpenSideViewGroups}
            isDirects={isOpenSideViewDirects}
            hasUnreadGroups={groupChatHasUnread || groupsAnnHasUnread}
            setDesktopViewMode={setDesktopViewMode}
            desktopViewMode={desktopViewMode}
            isApps={desktopViewMode === 'apps'}
          />

          <HomeDesktop
            name={userInfo?.name}
            refreshHomeDataFunc={refreshHomeDataFunc}
            myAddress={myAddress}
            isLoadingGroups={isLoadingGroups}
            balance={balance}
            userInfo={userInfo}
            groups={groups}
            setGroupSection={setGroupSection}
            setSelectedGroup={setSelectedGroup}
            getTimestampEnterChat={getTimestampEnterChat}
            setOpenManageMembers={setOpenManageMembers}
            setOpenAddGroup={setOpenAddGroup}
            setMobileViewMode={setMobileViewMode}
            setDesktopViewMode={setDesktopViewMode}
            desktopViewMode={desktopViewMode}
          />
        </Box>

        <AuthenticatedContainerInnerRight
          sx={{
            marginLeft: 'auto',
            width: '31px',
            padding: '5px',
            display:
              desktopViewMode === 'apps' ||
              desktopViewMode === 'dev' ||
              desktopViewMode === 'chat'
                ? 'none'
                : 'flex',
          }}
        ></AuthenticatedContainerInnerRight>

        <LoadingSnackbar
          open={isLoadingGroup}
          info={{
            message:
              isLoadingGroupMessage ||
              t('group:message.generic.setting_group', {
                postProcess: 'capitalizeFirstChar',
              }),
          }}
        />

        <LoadingSnackbar
          open={isLoadingGroups}
          info={{
            message: t('group:message.generic.setting_group', {
              postProcess: 'capitalizeFirstChar',
            }),
          }}
        />
        <WalletsAppWrapper />
      </Box>
    </>
  );
};
