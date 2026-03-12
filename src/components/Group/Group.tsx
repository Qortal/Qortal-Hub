import { Box, Paper, Typography, useTheme } from '@mui/material';
import {
  lazy,
  Profiler,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChatGroup } from '../Chat/ChatGroup';
import { CreateCommonSecret } from '../Chat/CreateCommonSecret';
import { base64ToUint8Array } from '../../qdn/encryption/group-encryption';
import { uint8ArrayToObject } from '../../encryption/encryption';
import { Spacer } from '../../common/Spacer';
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
import { WebSocketNotifications } from './WebsocketNotifications';
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
  chatWidgetClosedAtom,
  enabledDevModeAtom,
  groupAnnouncementsAtom,
  groupChatTimestampsAtom,
  groupsOwnerNamesAtom,
  groupsPropertiesAtom,
  isDisabledEditorEnterAtom,
  isOpenBlockedModalAtom,
  isRunningPublicNodeAtom,
  memberGroupsAtom,
  mutedGroupsAtom,
  myGroupsWhereIAmAdminAtom,
  selectedGroupIdAtom,
  timestampEnterDataAtom,
  userInfoAtom,
} from '../../atoms/global';
import { sortArrayByTimestampAndGroupName } from '../../utils/time';
import { WalletsAppWrapper } from './WalletsAppWrapper';
import { useTranslation } from 'react-i18next';
import { GroupList } from './GroupList';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import {
  TIME_MINUTES_10_IN_MILLISECONDS,
  TIME_MINUTES_2_IN_MILLISECONDS,
  TIME_DAYS_1_IN_MILLISECONDS,
} from '../../constants/constants';
import { useWebsocketStatus } from './useWebsocketStatus';
import { useQMailFetch } from '../../hooks/useQMailFetch';
import { DirectsSidebar } from './DirectsSidebar';
import { GlobalChatWidget } from './GlobalChatWidget';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import {
  AdminRowBox,
  CenterBox,
  ChatContentBox,
  EncryptionKeyMessageDiv,
  FloatingButtonContainerBox,
  GroupRightSidebar,
  InnerChatBox,
  MainContentBox,
  NewChatOverlay,
  NoSelectionTypography,
  NotPartAdminListBox,
  NotPartGroupDiv,
  RootBox,
  SelectedDirectOverlay,
  SelectedGroupWrapper,
} from './Group.styles';

const LazyAddGroup = lazy(() =>
  import('./AddGroup').then((m) => ({ default: m.AddGroup }))
);
const LazyManageMembers = lazy(() =>
  import('./ManageMembers').then((m) => ({ default: m.ManageMembers }))
);
const LazyBlockedUsersModal = lazy(() =>
  import('./BlockedUsersModal').then((m) => ({ default: m.BlockedUsersModal }))
);

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

/** Subscribes to memberGroupsAtom and runs effects (Group does not subscribe). */
function MemberGroupsEffects({
  getGroupsWhereIAmAMember,
  getGroupsProperties,
  myAddress,
  groupsPropertiesRef,
  hasInitializedWebsocketRef,
}: {
  getGroupsWhereIAmAMember: (groups: any[]) => Promise<void>;
  getGroupsProperties: (address: string) => void;
  myAddress: string;
  groupsPropertiesRef: React.MutableRefObject<Record<string, unknown>>;
  hasInitializedWebsocketRef: React.MutableRefObject<boolean>;
}) {
  const memberGroups = useAtomValue(memberGroupsAtom);
  useEffect(() => {
    if (!myAddress) return;
    if (
      !areKeysEqual(
        memberGroups?.map((grp: any) => grp?.groupId),
        Object.keys(groupsPropertiesRef.current || {})
      )
    ) {
      getGroupsProperties(myAddress);
      getGroupsWhereIAmAMember(memberGroups || []);
    }
  }, [
    memberGroups,
    myAddress,
    getGroupsWhereIAmAMember,
    getGroupsProperties,
    groupsPropertiesRef,
  ]);
  useEffect(() => {
    if (
      !myAddress ||
      hasInitializedWebsocketRef.current ||
      !memberGroups?.length
    )
      return;
    window.sendMessage('setupGroupWebsocket', {}).catch((error: Error) => {
      console.error(
        'Failed to setup group websocket:',
        error?.message || 'An error occurred'
      );
    });
    hasInitializedWebsocketRef.current = true;
  }, [myAddress, memberGroups, hasInitializedWebsocketRef]);
  return null;
}

export const Group = ({
  myAddress,
  setIsOpenDrawerProfile,
  setDesktopViewMode,
  desktopViewMode,
}: GroupProps) => {
  const [desktopSideView, setDesktopSideView] = useState('groups');
  const [chatWidgetClosed, setChatWidgetClosed] = useAtom(chatWidgetClosedAtom);
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
  const memberGroupsRef = useRef<any[]>([]);
  const [directs, setDirects] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [adminsWithNames, setAdminsWithNames] = useState([]);
  const [members, setMembers] = useState([]);
  const [groupOwner, setGroupOwner] = useState(null);
  const [triedToFetchSecretKey, setTriedToFetchSecretKey] = useState(false);
  const [openAddGroup, setOpenAddGroup] = useState(false);
  const [openManageMembers, setOpenManageMembers] = useState(false);
  const setMemberGroups = useSetAtom(memberGroupsAtom);
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
  const [, setIsOpenDrawer] = useState(false);
  const [isOpenBlockedModal, setIsOpenBlockedUserModal] = useAtom(
    isOpenBlockedModalAtom
  );
  const [hideCommonKeyPopup, setHideCommonKeyPopup] = useState(false);
  const [isLoadingGroupMessage, setIsLoadingGroupMessage] = useState('');
  const setMutedGroups = useSetAtom(mutedGroupsAtom);
  const [mobileViewMode, setMobileViewMode] = useState('home');
  const [, setMobileViewModeKeepOpen] = useState('');
  const timestampEnterDataRef = useRef({});
  const selectedGroupRef = useRef(null);
  const selectedDirectRef = useRef(null);
  const groupSectionRef = useRef(null);
  const isLoadingOpenSectionFromNotification = useRef(false);
  const settimeoutForRefetchSecretKey = useRef(null);
  const secretKeyRef = useRef(null);
  const { clearStatesMessageQueueProvider } = useMessageQueue();
  const initiatedGetMembers = useRef(false);
  const [groupChatTimestamps, setGroupChatTimestamps] = useAtom(
    groupChatTimestampsAtom
  );
  const setIsEnabledDevMode = useSetAtom(enabledDevModeAtom);
  const setIsDisabledEditorEnter = useSetAtom(isDisabledEditorEnterAtom);

  useEffect(() => {
    const isDevModeFromStorage = localStorage.getItem('isEnabledDevMode');
    if (isDevModeFromStorage) {
      setIsEnabledDevMode(JSON.parse(isDevModeFromStorage));
    }
    try {
      const val = localStorage.getItem('settings-disable-editor-enter');
      if (val) {
        const parsedVal = JSON.parse(val);
        if (parsedVal === false || parsedVal === true) {
          setIsDisabledEditorEnter(parsedVal);
        }
      }
    } catch (error) {
      console.log(error);
    }
  }, []);
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
  const theme = useTheme();
  useWebsocketStatus();
  const [groupsProperties, setGroupsProperties] = useAtom(groupsPropertiesAtom);
  const setGroupsOwnerNames = useSetAtom(groupsOwnerNamesAtom);
  const userInfo = useAtomValue(userInfoAtom);
  useQMailFetch(userInfo?.name, userInfo?.address);

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

  const toggleSideViewDirects = useCallback(() => {
    if (isOpenSideViewGroups) {
      setIsOpenSideViewGroups(false);
    }
    setIsOpenSideViewDirects((prev) => !prev);
  }, [isOpenSideViewGroups]);

  const toggleSideViewGroups = useCallback(() => {
    if (isOpenSideViewDirects) {
      setIsOpenSideViewDirects(false);
    }
    setIsOpenSideViewGroups((prev) => !prev);
  }, [isOpenSideViewDirects]);

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

  useEffect(() => {
    secretKeyRef.current = secretKey;
  }, [secretKey]);

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

  const refreshHomeDataFunc = useCallback(() => {
    setGroupSection('default');
    setTimeout(() => {
      setGroupSection('home');
    }, 300);
  }, []);

  const getGroupAnnouncements = useCallback(async () => {
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
  }, [t]);

  useEffect(() => {
    if (myAddress) {
      getGroupAnnouncements();
      getTimestampEnterChat();
    }
  }, [myAddress, getGroupAnnouncements, getTimestampEnterChat]);

  const getGroupOwner = useCallback(async (groupId) => {
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
  }, []);

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
          secretKeyRef.current &&
          lastFetchedSecretKey.current &&
          Date.now() - lastFetchedSecretKey.current <
            TIME_MINUTES_10_IN_MILLISECONDS
        ) {
          return secretKeyRef.current;
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
        console.log('error', error);
        if (
          error === 'Unable to decrypt data' ||
          error === 'Unable to decrypt'
        ) {
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

  /** Fetch secret key for an arbitrary group (e.g. for widget). Same flow as full chat: try cache, then network; cache on success; retry on decrypt failure. */
  const getSecretKeyForGroup = useCallback(
    async (group: { groupId: string } | null): Promise<any> => {
      if (!group?.groupId) return null;
      const groupIdStr = String(group.groupId);
      try {
        // 1. Try cached key (same as full chat when it would use storage)
        const cached: any = await window
          .sendMessage('getGroupDataSingle', { groupId: groupIdStr })
          .catch(() => null);
        if (cached?.secretKeyData && !cached?.error) {
          try {
            const decryptedKey: any = await decryptResource(
              cached.secretKeyData,
              null
            );
            const dataint8Array = base64ToUint8Array(decryptedKey.data);
            const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
            if (validateSecretKey(decryptedKeyToObject))
              return decryptedKeyToObject;
          } catch {
            // Cached key invalid or decrypt failed, fall through to fetch
          }
        }

        // 2. Fetch from network (same as full getSecretKey)
        const groupIdNum = Number(group.groupId);
        const { names, addresses, both } = await getGroupAdmins(groupIdNum);
        if (!names?.length) return null;
        const publish = await getPublishesFromAdmins(names, groupIdStr);
        if (publish === false) {
          return new Promise((resolve) => {
            setTimeout(
              () => resolve(getSecretKeyForGroup(group)),
              TIME_MINUTES_2_IN_MILLISECONDS
            );
          });
        }
        const res = await fetch(
          `${getBaseApiReact()}/arbitrary/DOCUMENT_PRIVATE/${publish.name}/${publish.identifier}?encoding=base64&rebuild=true`
        );
        const data = await res.text();
        const decryptedKey: any = await decryptResource(data, null);
        const dataint8Array = base64ToUint8Array(decryptedKey.data);
        const decryptedKeyToObject = uint8ArrayToObject(dataint8Array);
        if (!validateSecretKey(decryptedKeyToObject)) return null;

        // 3. Cache for next time (same as full chat setGroupData)
        window
          .sendMessage('setGroupData', {
            groupId: groupIdStr,
            secretKeyData: data,
            secretKeyResource: publish,
            admins: { names, addresses, both },
          })
          .catch(() => {});

        return decryptedKeyToObject;
      } catch (e) {
        if (e === 'Unable to decrypt data') {
          return new Promise((resolve) => {
            setTimeout(
              () => resolve(getSecretKeyForGroup(group)),
              TIME_MINUTES_2_IN_MILLISECONDS
            );
          });
        }
        console.error(e);
        return null;
      }
    },
    []
  );

  const getAdminsForPublic = useCallback(async (selectedGroup) => {
    try {
      const { names, addresses, both } = await getGroupAdmins(
        selectedGroup?.groupId
      );
      setAdmins(addresses);
      setAdminsWithNames(both);
    } catch (error) {
      console.log(error);
    }
  }, []);

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
  }, [
    selectedGroup,
    isPrivate,
    getSecretKey,
    getGroupOwner,
    getAdminsForPublic,
  ]);

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

  const getLatestRegularChat = useCallback(async (groups) => {
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
  }, []);

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

      // Use ownerPrimaryName from API when present (no fallback — missing means no primary name)
      const ownerNamesFromApi: Record<string, string> = {};
      Object.keys(transformToObject).forEach((key) => {
        const item = transformToObject[key];
        if (item?.ownerPrimaryName) {
          ownerNamesFromApi[key] = item.ownerPrimaryName;
          groupsOwnerNamesRef.current[key] = item.ownerPrimaryName;
        }
      });
      if (Object.keys(ownerNamesFromApi).length > 0) {
        setGroupsOwnerNames((prev) => ({ ...prev, ...ownerNamesFromApi }));
      }
    } catch (error) {
      console.log(error);
    }
  }, []);

  const getGroupsWhereIAmAMember = useCallback(
    async (_groups) => {
      if (!myAddress) return;
      try {
        const response = await fetch(
          `${getBaseApiReact()}/groups/member/${myAddress}?adminOnly=true`
        );
        if (!response.ok) return;
        const data = await response.json();
        const groupsAsAdmin = Array.isArray(data) ? data : (data?.groups ?? []);
        setMyGroupsWhereIAmAdmin(groupsAsAdmin);
      } catch (error) {
        console.error(error);
      }
    },
    [myAddress]
  );

  useEffect(() => {
    // Handler function for incoming messages
    const messageHandler = (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const message = event.data;
      if (message?.action === 'SET_GROUPS') {
        const sortedFiltered = sortArrayByTimestampAndGroupName(
          message.payload || []
        ).filter((item: any) => item?.groupId !== '0');
        setMemberGroups(sortedFiltered);
        memberGroupsRef.current = sortedFiltered;
        getLatestRegularChat(sortedFiltered);

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

  const getMembers = useCallback(async (groupId) => {
    try {
      const res = await getGroupMembers(groupId);
      if (groupId !== selectedGroupRef.current?.groupId) return;
      setMembers(res);
    } catch (error) {
      console.log(error);
    }
  }, []);

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

  const notifyAdmin = useCallback(
    async (admin) => {
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
    },
    [selectedGroup?.groupName, t]
  );

  const isUnread = useMemo(() => {
    if (!selectedGroup) return false;
    return (
      groupAnnouncements?.[selectedGroup?.groupId]?.seentimestamp === false
    );
  }, [groupAnnouncements, selectedGroup]);

  const openDirectChatFromNotification = useCallback(
    (e) => {
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
    },
    [directs, selectedDirect?.address, getTimestampEnterChat]
  );

  const openDirectChatFromInternal = useCallback(
    (e) => {
      const directAddress = e.detail?.address;
      const name = e.detail?.name;
      const findDirect = directs?.find(
        (direct) => direct?.address === directAddress || direct?.name === name
      );

      if (findDirect) {
        setDesktopViewMode('chat');
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
        setDesktopViewMode('chat');
        setDesktopSideView('directs');
        setNewChat(true);
        setTimeout(() => {
          executeEvent('setDirectToValueNewChat', {
            directToValue: name || directAddress,
          });
        }, 500);
      }
    },
    [directs, getTimestampEnterChat]
  );

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
  }, [
    directs,
    selectedDirect,
    openDirectChatFromNotification,
    openDirectChatFromInternal,
  ]);

  const handleMarkAsRead = useCallback(
    (e) => {
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
    },
    [getGroupAnnouncements, getTimestampEnterChat]
  );

  useEffect(() => {
    subscribeToEvent('markAsRead', handleMarkAsRead);

    return () => {
      unsubscribeFromEvent('markAsRead', handleMarkAsRead);
    };
  }, [handleMarkAsRead]);

  const resetAllStatesAndRefs = useCallback(() => {
    // Reset all useState values to their initial states
    setSecretKey(null);
    secretKeyRef.current = null;
    lastFetchedSecretKey.current = null;
    setSecretKeyPublishDate(null);
    setSecretKeyDetails(null);
    setNewEncryptionNotification(null);
    setMemberCountFromSecretKeyData(null);
    setIsForceShowCreationKeyPopup(false);
    setSelectedGroup(null);
    setSelectedDirect(null);
    setMemberGroups([]);
    memberGroupsRef.current = [];
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
  }, []);

  const logoutEventFunc = useCallback(() => {
    resetAllStatesAndRefs();
    clearStatesMessageQueueProvider();
  }, [resetAllStatesAndRefs, clearStatesMessageQueueProvider]);

  useEffect(() => {
    subscribeToEvent('logout-event', logoutEventFunc);

    return () => {
      unsubscribeFromEvent('logout-event', logoutEventFunc);
    };
  }, [logoutEventFunc]);

  const openAppsMode = useCallback(() => {
    setDesktopViewMode('apps');
  }, []);

  useEffect(() => {
    subscribeToEvent('open-apps-mode', openAppsMode);

    return () => {
      unsubscribeFromEvent('open-apps-mode', openAppsMode);
    };
  }, [openAppsMode]);

  const openDevMode = useCallback(() => {
    setDesktopViewMode('dev');
  }, []);

  useEffect(() => {
    subscribeToEvent('open-dev-mode', openDevMode);

    return () => {
      unsubscribeFromEvent('open-dev-mode', openDevMode);
    };
  }, [openDevMode]);

  const openGroupChatFromNotification = useCallback(
    (e) => {
      if (isLoadingOpenSectionFromNotification.current) return;

      const groupId = e.detail?.from;
      const findGroup = memberGroupsRef.current?.find(
        (group: any) => +group?.groupId === +groupId
      );
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
        secretKeyRef.current = null;
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
    },
    [selectedGroup?.groupId, getTimestampEnterChat]
  );

  useEffect(() => {
    subscribeToEvent('openGroupMessage', openGroupChatFromNotification);

    return () => {
      unsubscribeFromEvent('openGroupMessage', openGroupChatFromNotification);
    };
  }, [openGroupChatFromNotification]);

  const openGroupAnnouncementFromNotification = useCallback(
    (e) => {
      const groupId = e.detail?.from;

      const findGroup = memberGroupsRef.current?.find(
        (group: any) => +group?.groupId === +groupId
      );
      if (findGroup?.groupId === selectedGroup?.groupId) return;
      if (findGroup) {
        setChatMode('groups');
        setSelectedGroup(null);
        setSecretKey(null);
        secretKeyRef.current = null;
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
    },
    [selectedGroup?.groupId, getGroupAnnouncements]
  );

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
  }, [openGroupAnnouncementFromNotification]);

  const openThreadNewPostFunc = useCallback(
    (e) => {
      const data = e.detail?.data;
      const { groupId } = data;
      const findGroup = memberGroupsRef.current?.find(
        (group: any) => +group?.groupId === +groupId
      );
      if (findGroup?.groupId === selectedGroup?.groupId) {
        setGroupSection('forum');
        setDefaultThread(data);

        return;
      }
      if (findGroup) {
        setChatMode('groups');
        setSelectedGroup(null);
        setSecretKey(null);
        secretKeyRef.current = null;
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
    },
    [selectedGroup?.groupId, getGroupAnnouncements]
  );

  useEffect(() => {
    subscribeToEvent('openThreadNewPost', openThreadNewPostFunc);

    return () => {
      unsubscribeFromEvent('openThreadNewPost', openThreadNewPostFunc);
    };
  }, [openThreadNewPostFunc]);

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

  const goToHome = useCallback(async () => {
    setDesktopViewMode('home');

    await new Promise((res) => {
      setTimeout(() => {
        res(null);
      }, 200);
    });
  }, []);

  const goToAnnouncements = useCallback(async () => {
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
  }, [getGroupAnnouncements]);

  const openDrawerGroups = useCallback(() => {
    setIsOpenDrawer(true);
  }, []);

  const goToThreads = useCallback(() => {
    setSelectedDirect(null);
    setNewChat(false);
    setGroupSection('forum');
  }, []);

  const goToChat = useCallback(async () => {
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
  }, [getTimestampEnterChat]);

  const loadingGroupSnackbarInfo = useMemo(
    () => ({
      message:
        isLoadingGroupMessage ||
        t('group:message.generic.setting_group', {
          postProcess: 'capitalizeFirstChar',
        }),
    }),
    [isLoadingGroupMessage, t]
  );

  const loadingGroupsSnackbarInfo = useMemo(
    () => ({
      message: t('group:message.generic.setting_group', {
        postProcess: 'capitalizeFirstChar',
      }),
    }),
    [t]
  );

  const notPartOfKeys = useMemo(() => {
    return (
      isPrivate &&
      !admins.includes(myAddress) &&
      !secretKey &&
      triedToFetchSecretKey
    );
  }, [isPrivate, admins, myAddress, secretKey, triedToFetchSecretKey]);

  const closeChatDirect = useCallback(() => {
    setSelectedDirect(null);
    setNewChat(false);
  }, []);

  const handleNotifyAdminClick = useCallback(
    (e: { currentTarget: HTMLElement | null }) => {
      const address = e.currentTarget?.getAttribute('data-admin-address');
      const admin = adminsWithNames.find((a) => a?.address === address);
      if (admin) notifyAdmin(admin);
    },
    [adminsWithNames, notifyAdmin]
  );

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
    secretKeyRef.current = null;
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
      <WebSocketNotifications myAddress={myAddress} userName={userInfo?.name} />

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />

      <RootBox>
        <MemberGroupsEffects
          getGroupsWhereIAmAMember={getGroupsWhereIAmAMember}
          getGroupsProperties={getGroupsProperties}
          myAddress={myAddress}
          groupsPropertiesRef={groupsPropertiesRef}
          hasInitializedWebsocketRef={hasInitializedWebsocket}
        />
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
          isGroups={isOpenSideViewGroups}
          isDirects={isOpenSideViewDirects}
          setDesktopViewMode={setDesktopViewMode}
          lastQappViewMode={lastQappViewMode}
        />

        {desktopViewMode === 'chat' && desktopSideView !== 'directs' && (
          <GroupList
            selectGroupFunc={selectGroupFunc}
            setDesktopSideView={setDesktopSideView}
            desktopSideView={desktopSideView}
            directChatHasUnread={directChatHasUnread}
            chatMode={chatMode}
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
            timeDifferenceForNotificationChats={
              timeDifferenceForNotificationChats
            }
            myAddress={myAddress}
            openAvatarPreview={openAvatarPreview}
            avatarPreviewData={avatarPreviewData}
            closeAvatarPreview={closeAvatarPreview}
            isRunningPublicNode={isRunningPublicNode}
            setIsOpenBlockedUserModal={setIsOpenBlockedUserModal}
          />
        )}

        <MainContentBox>
          {openAddGroup && (
            <Suspense fallback={null}>
              <LazyAddGroup
                address={myAddress}
                open={openAddGroup}
                setOpen={setOpenAddGroup}
              />
            </Suspense>
          )}

          {newChat && (
            <>
              <NewChatOverlay isChatMode={desktopViewMode === 'chat'}>
                <ChatDirect
                  myAddress={myAddress}
                  isNewChat={newChat}
                  selectedDirect={undefined}
                  setSelectedDirect={setSelectedDirect}
                  setNewChat={setNewChat}
                  getTimestampEnterChat={getTimestampEnterChat}
                  close={closeChatDirect}
                  setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
                />
              </NewChatOverlay>
            </>
          )}
          {desktopViewMode === 'chat' && !selectedGroup && (
            <CenterBox>
              <NoSelectionTypography>
                {t('group:message.generic.no_selection', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </NoSelectionTypography>
            </CenterBox>
          )}

          <SelectedGroupWrapper
            isVisible={desktopViewMode === 'chat' && !!selectedGroup}
          >
            <DesktopHeader
              isPrivate={isPrivate}
              selectedGroup={selectedGroup}
              groupSection={groupSection}
              isUnread={isUnread}
              goToAnnouncements={goToAnnouncements}
              goToChat={goToChat}
              goToThreads={goToThreads}
              setOpenManageMembers={setOpenManageMembers}
              directChatHasUnread={directChatHasUnread}
              chatMode={chatMode}
              openDrawerGroups={openDrawerGroups}
              goToHome={goToHome}
              setIsOpenDrawerProfile={setIsOpenDrawerProfile}
              mobileViewMode={mobileViewMode}
              setMobileViewMode={setMobileViewMode}
              setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
              hasUnreadDirects={directChatHasUnread}
              isHome={groupSection === 'home'}
              isGroups={desktopSideView === 'groups'}
              isDirects={desktopSideView === 'directs'}
              setDesktopSideView={setDesktopSideView}
              hasUnreadAnnouncements={isUnread}
              isAnnouncement={groupSection === 'announcement'}
              isChat={groupSection === 'chat'}
              setGroupSection={setGroupSection}
              isForum={groupSection === 'forum'}
            />

            <ChatContentBox>
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
                  getTimestampEnterChatParent={getTimestampEnterChat}
                />
              )}
              {isPrivate &&
                firstSecretKeyInCreation &&
                triedToFetchSecretKey &&
                !secretKeyPublishDate && (
                  <EncryptionKeyMessageDiv>
                    <Typography>
                      {t('group:message.generic.encryption_key', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                  </EncryptionKeyMessageDiv>
                )}

              {notPartOfKeys ? (
                <>
                  {secretKeyPublishDate ||
                  (!secretKeyPublishDate && !firstSecretKeyInCreation) ? (
                    <NotPartGroupDiv>
                      <Paper
                        elevation={0}
                        sx={{
                          maxWidth: 480,
                          p: 3,
                          textAlign: 'center',
                          border: `1px solid ${theme.palette.divider}`,
                          borderRadius: 2,
                          mb: 3,
                        }}
                      >
                        <LockOutlinedIcon
                          sx={{
                            fontSize: 48,
                            color: theme.palette.text.secondary,
                            mb: 2,
                          }}
                        />
                        <Typography
                          variant="subtitle1"
                          sx={{
                            color: theme.palette.text.primary,
                            fontWeight: 500,
                            mb: 1.5,
                          }}
                        >
                          {t('group:message.generic.not_part_group', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            color: theme.palette.warning.main,
                            fontWeight: 600,
                            px: 1,
                          }}
                        >
                          {t('group:message.generic.only_encrypted', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                      </Paper>
                      <Typography
                        variant="body2"
                        sx={{
                          color: theme.palette.text.secondary,
                          mb: 2,
                          textAlign: 'center',
                        }}
                      >
                        {t('group:message.error.notify_admins', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                      <NotPartAdminListBox>
                        {adminsWithNames.map((admin) => (
                          <AdminRowBox key={admin?.address}>
                            <Typography
                              variant="body1"
                              sx={{
                                fontWeight: 500,
                                color: theme.palette.text.primary,
                              }}
                            >
                              {admin?.name}
                            </Typography>
                            <LoadingButton
                              data-admin-address={admin?.address}
                              loading={isLoadingNotifyAdmin}
                              loadingPosition="start"
                              size="small"
                              variant="contained"
                              onClick={handleNotifyAdminClick}
                              sx={{
                                textTransform: 'none',
                                fontWeight: 600,
                              }}
                            >
                              {t('core:action.notify', {
                                postProcess: 'capitalizeFirstChar',
                              })}
                            </LoadingButton>
                          </AdminRowBox>
                        ))}
                      </NotPartAdminListBox>
                    </NotPartGroupDiv>
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
                    hide={groupSection !== 'announcement'}
                    isPrivate={isPrivate}
                  />
                  <GroupForum
                    myAddress={myAddress}
                    selectedGroup={selectedGroup}
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
                      hide={groupSection !== 'adminSpace'}
                      isAdmin={admins.includes(myAddress)}
                    />
                  )}
                </>
              )}

              <FloatingButtonContainerBox>
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
              </FloatingButtonContainerBox>
            </ChatContentBox>

            {openManageMembers && (
              <Suspense fallback={null}>
                <LazyManageMembers
                  selectedGroup={selectedGroup}
                  address={myAddress}
                  open={openManageMembers}
                  setOpen={setOpenManageMembers}
                  isAdmin={admins.includes(myAddress)}
                  isOwner={groupOwner?.owner === myAddress}
                />
              </Suspense>
            )}
          </SelectedGroupWrapper>
          {isOpenBlockedModal && (
            <Suspense fallback={null}>
              <LazyBlockedUsersModal />
            </Suspense>
          )}

          {selectedDirect && !newChat && (
            <>
              <SelectedDirectOverlay isChatMode={desktopViewMode === 'chat'}>
                <InnerChatBox>
                  <ChatDirect
                    myAddress={myAddress}
                    isNewChat={newChat}
                    selectedDirect={selectedDirect}
                    setSelectedDirect={setSelectedDirect}
                    setNewChat={setNewChat}
                    getTimestampEnterChat={getTimestampEnterChat}
                    close={closeChatDirect}
                    setMobileViewModeKeepOpen={setMobileViewModeKeepOpen}
                  />
                </InnerChatBox>
              </SelectedDirectOverlay>
            </>
          )}

          <AppsDesktop
            mode={appsMode}
            setMode={setAppsMode}
            show={desktopViewMode === 'apps'}
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
            isGroups={isOpenSideViewGroups}
            isDirects={isOpenSideViewDirects}
            setDesktopViewMode={setDesktopViewMode}
            desktopViewMode={desktopViewMode}
            isApps={desktopViewMode === 'apps'}
          />

          <HomeDesktop
            refreshHomeDataFunc={refreshHomeDataFunc}
            myAddress={myAddress}
            isLoadingGroups={isLoadingGroups}
            setGroupSection={setGroupSection}
            setSelectedGroup={setSelectedGroup}
            getTimestampEnterChat={getTimestampEnterChat}
            setOpenManageMembers={setOpenManageMembers}
            setOpenAddGroup={setOpenAddGroup}
            setMobileViewMode={setMobileViewMode}
            setDesktopViewMode={setDesktopViewMode}
            desktopViewMode={desktopViewMode}
          />
        </MainContentBox>

        <GroupRightSidebar
          hide={
            desktopViewMode === 'apps' ||
            desktopViewMode === 'dev' ||
            desktopViewMode === 'chat'
          }
        />

        <LoadingSnackbar
          open={isLoadingGroup}
          info={loadingGroupSnackbarInfo}
        />

        <LoadingSnackbar
          open={isLoadingGroups}
          info={loadingGroupsSnackbarInfo}
        />
        <WalletsAppWrapper />

        {!chatWidgetClosed && (
          <GlobalChatWidget
            directs={directs}
            getUserAvatarUrl={getUserAvatarUrl}
            directChatHasUnread={directChatHasUnread}
            timestampEnterData={timestampEnterData}
            timeDifferenceForNotificationChats={
              timeDifferenceForNotificationChats
            }
            myAddress={myAddress}
            directAvatarLoaded={directAvatarLoaded}
            setDirectAvatarLoaded={setDirectAvatarLoaded}
            getTimestampEnterChat={getTimestampEnterChat}
            getSecretKeyForGroup={getSecretKeyForGroup}
            onClose={() => setChatWidgetClosed(true)}
          />
        )}
      </RootBox>
    </>
  );
};
