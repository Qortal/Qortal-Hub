import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import {
  Avatar,
  Box,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Typography,
  useTheme,
} from '@mui/material';
import MarkChatUnreadIcon from '@mui/icons-material/MarkChatUnread';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import LockIcon from '@mui/icons-material/Lock';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import {
  groupChatHasUnreadAtom,
  groupChatTimestampsAtom,
  groupsOwnerNamesAtom,
  groupsPropertiesAtom,
  memberGroupsAtom,
  userInfoAtom,
} from '../../atoms/global';
import { sortArrayByTimestampAndGroupName } from '../../utils/time';
import { getBaseApiReact } from '../../App';
import { executeEvent } from '../../utils/events';
import { formatEmailDate } from './QMailMessages';
import { getClickableAvatarSx } from '../Chat/clickableAvatarStyles';
import { MiniDirectThread } from '../Chat/MiniDirectThread';
import { MiniGroupThread } from '../Chat/MiniGroupThread';

export type ChatWidgetTab = 'messages' | 'groups';

export interface GlobalChatWidgetProps {
  directs: any[];
  getUserAvatarUrl: (name?: string) => string;
  directChatHasUnread: boolean;
  timestampEnterData: Record<string, number>;
  timeDifferenceForNotificationChats: number;
  myAddress: string;
  directAvatarLoaded: Record<string, boolean>;
  setDirectAvatarLoaded: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  getTimestampEnterChat: () => Promise<any>;
  getSecretKeyForGroup: (group: any) => Promise<any>;
  onClose?: () => void;
}

export function GlobalChatWidget({
  directs,
  getUserAvatarUrl,
  directChatHasUnread,
  timestampEnterData,
  timeDifferenceForNotificationChats,
  myAddress,
  directAvatarLoaded,
  setDirectAvatarLoaded,
  getTimestampEnterChat,
  getSecretKeyForGroup,
  onClose,
}: GlobalChatWidgetProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group']);
  const memberGroups = useAtomValue(memberGroupsAtom) ?? [];
  const groupsProperties = useAtomValue(groupsPropertiesAtom) ?? {};
  const groupsOwnerNames = useAtomValue(groupsOwnerNamesAtom) ?? {};
  const groupChatTimestamps = useAtomValue(groupChatTimestampsAtom) ?? {};
  const groupChatHasUnread = useAtomValue(groupChatHasUnreadAtom);
  const myName = useAtomValue(userInfoAtom)?.name;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ChatWidgetTab>('messages');
  const [selectedDirect, setSelectedDirect] = useState<any>(null);
  const [selectedGroup, setSelectedGroup] = useState<any>(null);

  const WIDGET_MIN_WIDTH = 280;
  const WIDGET_MAX_WIDTH = 720;
  const WIDGET_MIN_HEIGHT = 240;
  const WIDGET_MAX_HEIGHT = 800;
  const BAR_HEIGHT = 52;
  const RIGHT_SIDEBAR_OFFSET = 56;
  const [widgetWidth, setWidgetWidth] = useState(380);
  const [widgetHeight, setWidgetHeight] = useState(560);
  const resizeStartRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const [windowSize, setWindowSize] = useState(() =>
    typeof window !== 'undefined'
      ? { w: window.innerWidth, h: window.innerHeight }
      : { w: 800, h: 600 }
  );
  const [bottomX, setBottomX] = useState(() => {
    if (typeof window === 'undefined') return 0;
    const maxX = Math.max(0, window.innerWidth - 380 - 56);
    return Math.max(0, Math.min(maxX, maxX / 2));
  });
  const [draggingX, setDraggingX] = useState<number | null>(null);
  const didDragRef = useRef(false);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        width: widgetWidth,
        height: widgetHeight,
      };
      const onMouseMove = (e: MouseEvent) => {
        const start = resizeStartRef.current;
        if (!start) return;
        const deltaX = e.clientX - start.x;
        const deltaY = e.clientY - start.y;
        const maxW = Math.min(WIDGET_MAX_WIDTH, typeof window !== 'undefined' ? window.innerWidth - RIGHT_SIDEBAR_OFFSET - 48 : WIDGET_MAX_WIDTH);
        const maxH = Math.min(WIDGET_MAX_HEIGHT, typeof window !== 'undefined' ? window.innerHeight - 120 : WIDGET_MAX_HEIGHT);
        setWidgetWidth((w) =>
          Math.min(maxW, Math.max(WIDGET_MIN_WIDTH, start.width - deltaX))
        );
        setWidgetHeight((h) =>
          Math.min(maxH, Math.max(WIDGET_MIN_HEIGHT, start.height - deltaY))
        );
      };
      const onMouseUp = () => {
        resizeStartRef.current = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'nwse-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [widgetWidth, widgetHeight]
  );

  const handleResizeStartHeightOnly = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        width: widgetWidth,
        height: widgetHeight,
      };
      const onMouseMove = (e: MouseEvent) => {
        const start = resizeStartRef.current;
        if (!start) return;
        const deltaY = e.clientY - start.y;
        const maxH = Math.min(WIDGET_MAX_HEIGHT, typeof window !== 'undefined' ? window.innerHeight - 120 : WIDGET_MAX_HEIGHT);
        setWidgetHeight((h) =>
          Math.min(maxH, Math.max(WIDGET_MIN_HEIGHT, start.height - deltaY))
        );
      };
      const onMouseUp = () => {
        resizeStartRef.current = null;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [widgetHeight]
  );

  const totalHeight = BAR_HEIGHT + (open ? widgetHeight : 0);
  const maxX = Math.max(0, windowSize.w - widgetWidth - RIGHT_SIDEBAR_OFFSET);
  const bottomY = windowSize.h - totalHeight;

  const rndPosition = useMemo(
    (): { x: number; y: number } => ({
      x: draggingX !== null ? draggingX : bottomX,
      y: bottomY,
    }),
    [draggingX, bottomX, bottomY]
  );

  const positionRef = useRef(rndPosition);
  positionRef.current = rndPosition;

  useEffect(() => {
    const onResize = () =>
      setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setBottomX((prev) => Math.max(0, Math.min(maxX, prev)));
  }, [windowSize, widgetWidth, maxX]);

  const handleRndDragStart = useCallback(() => {
    didDragRef.current = false;
    setDraggingX(positionRef.current.x);
  }, []);

  const handleRndDrag = useCallback(
    (_e: unknown, d: { x: number }) => {
      didDragRef.current = true;
      setDraggingX(Math.max(0, Math.min(maxX, d.x)));
    },
    [maxX]
  );

  const handleRndDragStop = useCallback(
    (_e: unknown, d: { x: number }) => {
      setDraggingX(null);
      setBottomX(Math.max(0, Math.min(maxX, d.x)));
    },
    [maxX]
  );

  const handleBarClick = useCallback(() => {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    setOpen((o) => !o);
  }, []);

  /** Same logic as Group.tsx: isPrivate for the currently selected group in the widget */
  const selectedGroupIsPrivate = useMemo(() => {
    if (!selectedGroup?.groupId) return null;
    if (selectedGroup.groupId === '0') return false;
    const prop = groupsProperties[selectedGroup.groupId];
    if (!prop) return null;
    if (prop?.isOpen === true) return false;
    if (prop?.isOpen === false) return true;
    return null;
  }, [selectedGroup?.groupId, groupsProperties]);

  const sortedDirects = [...(directs || [])].sort(
    (a, b) => (b?.timestamp || 0) - (a?.timestamp || 0)
  );
  /** Same sort as GroupList / SET_GROUPS: timestamp descending, then alphabetically by groupName */
  const sortedGroups = useMemo(
    () => sortArrayByTimestampAndGroupName([...(memberGroups || [])]),
    [memberGroups]
  );

  const showThread = selectedDirect != null || selectedGroup != null;
  const showList = !showThread;

  const handleOpenInApp = () => {
    setOpen(false);
    executeEvent('openGroupMessage', {});
  };

  /** Hide widget when there are no directs or groups (no new atoms: check directs prop + memberGroups here) */
  const hasDirectsOrGroups =
    (directs?.length ?? 0) > 0 || (memberGroups?.length ?? 0) > 0;
  if (!hasDirectsOrGroups) {
    return null;
  }

  return (
    <Rnd
      position={rndPosition}
      size={{ width: widgetWidth, height: totalHeight }}
      minWidth={WIDGET_MIN_WIDTH}
      minHeight={BAR_HEIGHT}
      maxWidth={windowSize.w - 48}
      disableDragging={false}
      enableResizing={false}
      dragAxis="x"
      bounds="window"
      dragHandleClassName="global-chat-widget-drag-handle"
      onDragStart={handleRndDragStart}
      onDrag={handleRndDrag}
      onDragStop={handleRndDragStop}
      enableUserSelectHack={true}
      cancel=".global-chat-widget-no-drag"
      style={{
        zIndex: 1300,
        transition:
          draggingX === null
            ? 'left 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)'
            : 'none',
      }}
    >
      <Box
        sx={{
          width: '100%',
          height: '100%',
          minWidth: WIDGET_MIN_WIDTH,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          overflow: 'hidden',
          borderRadius: '8px 8px 0 0',
          boxShadow: `0 -4px 24px ${theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.12)'}, 0 -1px 0 ${theme.palette.divider}`,
          border: '1px solid',
          borderBottom: 'none',
          borderColor: theme.palette.divider,
          backgroundColor: theme.palette.background.surface,
        }}
      >
      {/* Corner resize handles: at the very top of the widget, only when expanded */}
      {open && (
        <>
          <Box
            component="div"
            role="button"
            onMouseDown={handleResizeStart}
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 24,
              height: 24,
              zIndex: 20,
              cursor: 'nwse-resize',
              borderRadius: '8px 0 0 0',
            }}
            aria-label={t('core:action.resize', { postProcess: 'capitalizeFirstChar' })}
          />
          <Box
            component="div"
            role="button"
            onMouseDown={handleResizeStartHeightOnly}
            sx={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: 24,
              height: 24,
              zIndex: 20,
              cursor: 'ns-resize',
              borderRadius: '0 8px 0 0',
            }}
            aria-label={t('core:action.resize', { postProcess: 'capitalizeFirstChar' })}
          />
        </>
      )}
      {/* Bar: always visible at very bottom, click to expand/collapse — also Rnd drag handle */}
      <Box
        component="button"
        type="button"
        className="global-chat-widget-drag-handle"
        onClick={handleBarClick}
        sx={{
          width: '100%',
          minWidth: WIDGET_MIN_WIDTH,
          maxWidth: widgetWidth,
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
          padding: '8px 14px',
          backgroundColor: 'transparent',
          color: theme.palette.text.primary,
          transition: 'background-color 0.2s ease',
          '&:hover': {
            backgroundColor: theme.palette.action.hover,
          },
        }}
        aria-label={
          open
            ? t('core:action.close', { postProcess: 'capitalizeFirstChar' })
            : t('group:group.messaging', {
                postProcess: 'capitalizeFirstChar',
              })
        }
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            minWidth: 0,
            flex: 1,
          }}
        >
          <Avatar
            sx={{
              width: 36,
              height: 36,
              flexShrink: 0,
              backgroundColor: theme.palette.background.default,
              color: theme.palette.text.primary,
              boxShadow: theme.shadows[1],
              border: `1px solid ${theme.palette.divider}`,
            }}
            alt={myName || ''}
            src={getUserAvatarUrl(myName)}
          >
            {(myName || '')?.charAt(0) || '?'}
          </Avatar>
          <Typography
            sx={{
              fontFamily: 'Inter',
              fontSize: '15px',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: theme.palette.text.primary,
            }}
            noWrap
          >
            {t('group:group.messaging', {
              postProcess: 'capitalizeFirstChar',
            })}
          </Typography>
          {(directChatHasUnread || groupChatHasUnread) && !open && (
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                backgroundColor: theme.palette.primary.main,
                border: `2px solid ${theme.palette.background.paper}`,
                flexShrink: 0,
                boxShadow: `0 0 0 2px ${theme.palette.primary.main}40`,
                animation: 'unread-pulse 1.5s ease-in-out infinite',
                '@keyframes unread-pulse': {
                  '0%, 100%': {
                    boxShadow: `0 0 0 2px ${theme.palette.primary.main}40`,
                    transform: 'scale(1)',
                  },
                  '50%': {
                    boxShadow: `0 0 0 6px ${theme.palette.primary.main}30`,
                    transform: 'scale(1.1)',
                  },
                },
              }}
              aria-hidden
            />
          )}
        </Box>
        <Box className="global-chat-widget-no-drag" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {onClose && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              sx={{
                color: theme.palette.text.secondary,
                borderRadius: '10px',
                cursor: 'pointer',
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                  color: theme.palette.text.primary,
                },
              }}
              aria-label={t('core:action.close', {
                postProcess: 'capitalizeFirstChar',
              })}
            >
              <CloseRoundedIcon sx={{ fontSize: 22 }} />
            </IconButton>
          )}
          <IconButton
            size="small"
            sx={{
              width: 34,
              height: 34,
              borderRadius: '10px',
              cursor: 'pointer',
              color: theme.palette.text.secondary,
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.text.primary,
              },
            }}
            aria-hidden
          >
            {open ? (
              <KeyboardArrowUpRoundedIcon
                sx={{ fontSize: 20, transform: 'rotate(180deg)' }}
              />
            ) : (
              <KeyboardArrowUpRoundedIcon sx={{ fontSize: 18 }} />
            )}
          </IconButton>
        </Box>
      </Box>

      {/* Panel always mounted so scroll position and state (tab, selection) are preserved when minimized */}
      <Box
        sx={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: theme.palette.background.surface,
          borderTop: '1px solid',
          borderColor: theme.palette.divider,
          ...(open
            ? {
                height: widgetHeight,
                minHeight: WIDGET_MIN_HEIGHT,
                maxHeight: 'min(800px, calc(100vh - 120px))',
                overflow: 'hidden',
                visibility: 'visible',
                opacity: 1,
              }
            : {
                height: 0,
                minHeight: 0,
                maxHeight: 0,
                overflow: 'hidden',
                visibility: 'hidden',
                opacity: 0,
                pointerEvents: 'none',
              }),
        }}
      >
          {showThread ? (
            selectedDirect != null ? (
              <MiniDirectThread
                direct={selectedDirect}
                myAddress={myAddress}
                myName={myName}
                onBack={() => setSelectedDirect(null)}
                onOpenInApp={() => {
                  setOpen(false);
                  executeEvent('openDirectMessageInternal', {
                    address: selectedDirect?.address,
                    name: selectedDirect?.name,
                  });
                }}
                getTimestampEnterChat={getTimestampEnterChat}
                getUserAvatarUrl={getUserAvatarUrl}
              />
            ) : selectedGroup != null ? (
              <MiniGroupThread
                group={selectedGroup}
                isPrivate={selectedGroupIsPrivate}
                getSecretKeyForGroup={getSecretKeyForGroup}
                myAddress={myAddress}
                myName={myName}
                onBack={() => setSelectedGroup(null)}
                onOpenInApp={() => {
                  setOpen(false);
                  executeEvent('openGroupMessage', {
                    from: selectedGroup?.groupId,
                  });
                }}
                getTimestampEnterChat={getTimestampEnterChat}
                getUserAvatarUrl={getUserAvatarUrl}
              />
            ) : null
          ) : (
            <>
              <Box
                sx={{
                  display: 'flex',
                  padding: '8px 12px 0',
                  gap: '4px',
                  borderBottom: '1px solid',
                  borderColor: theme.palette.divider,
                  flexShrink: 0,
                }}
              >
                <Box
                  onClick={() => setTab('messages')}
                  sx={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 1,
                    padding: '10px 12px',
                    borderRadius: '12px 12px 0 0',
                    cursor: 'pointer',
                    backgroundColor:
                      tab === 'messages'
                        ? theme.palette.action.selected
                        : 'transparent',
                    transition: 'background-color 0.15s ease',
                    '&:hover': {
                      backgroundColor:
                        tab === 'messages'
                          ? theme.palette.action.selected
                          : theme.palette.action.hover,
                    },
                  }}
                >
                  <ForumRoundedIcon
                    sx={{
                      fontSize: 20,
                      color:
                        tab === 'messages'
                          ? directChatHasUnread
                            ? theme.palette.primary.main
                            : theme.palette.text.primary
                          : theme.palette.text.secondary,
                    }}
                  />
                  <Typography
                    sx={{
                      fontFamily: 'Inter',
                      fontSize: '14px',
                      fontWeight: 600,
                      color:
                        tab === 'messages'
                          ? directChatHasUnread
                            ? theme.palette.primary.main
                            : theme.palette.text.primary
                          : theme.palette.text.secondary,
                    }}
                  >
                    {t('group:group.dm', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  {directChatHasUnread && (
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: theme.palette.primary.main,
                        flexShrink: 0,
                      }}
                    />
                  )}
                </Box>
                <Box
                  onClick={() => setTab('groups')}
                  sx={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 1,
                    padding: '10px 12px',
                    borderRadius: '12px 12px 0 0',
                    cursor: 'pointer',
                    backgroundColor:
                      tab === 'groups'
                        ? theme.palette.action.selected
                        : 'transparent',
                    transition: 'background-color 0.15s ease',
                    '&:hover': {
                      backgroundColor:
                        tab === 'groups'
                          ? theme.palette.action.selected
                          : theme.palette.action.hover,
                    },
                  }}
                >
                  <GroupsRoundedIcon
                    sx={{
                      fontSize: 20,
                      color:
                        tab === 'groups'
                          ? groupChatHasUnread
                            ? theme.palette.primary.main
                            : theme.palette.text.primary
                          : theme.palette.text.secondary,
                    }}
                  />
                  <Typography
                    sx={{
                      fontFamily: 'Inter',
                      fontSize: '14px',
                      fontWeight: 600,
                      color:
                        tab === 'groups'
                          ? groupChatHasUnread
                            ? theme.palette.primary.main
                            : theme.palette.text.primary
                          : theme.palette.text.secondary,
                    }}
                  >
                    {t('group:group.group_other', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                  </Typography>
                  {groupChatHasUnread && (
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: theme.palette.primary.main,
                        flexShrink: 0,
                      }}
                    />
                  )}
                </Box>
              </Box>

              <List
                sx={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '12px 8px',
                  backgroundColor: theme.palette.background.surface,
                  '&::-webkit-scrollbar': { width: 8 },
                  '&::-webkit-scrollbar-thumb': {
                    backgroundColor: theme.palette.action.hover,
                    borderRadius: 4,
                  },
                }}
                className="group-list"
                dense={false}
              >
                {tab === 'messages' && (
                  <>
                    {sortedDirects.length === 0 ? (
                      <Box
                        sx={{
                          padding: 4,
                          textAlign: 'center',
                          color: theme.palette.text.secondary,
                          fontFamily: 'Inter',
                          fontSize: '14px',
                        }}
                      >
                        {t('core:message.generic.no_messages', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Box>
                    ) : (
                      sortedDirects.map((direct: any) => {
                        const avatarUrl = getUserAvatarUrl(direct?.name);
                        const avatarKey =
                          direct?.address ||
                          direct?.name ||
                          `${direct?.timestamp}-${direct?.sender}`;
                        const isAvatarLoaded = Boolean(
                          avatarUrl &&
                            avatarKey &&
                            directAvatarLoaded[avatarKey]
                        );
                        const hasUnread =
                          direct?.sender !== myAddress &&
                          direct?.timestamp &&
                          ((!timestampEnterData[direct?.address] &&
                            Date.now() - direct?.timestamp <
                              timeDifferenceForNotificationChats) ||
                            (timestampEnterData[direct?.address] ?? 0) <
                              direct?.timestamp);

                        return (
                          <ListItem
                            key={direct?.timestamp + direct?.sender}
                            onClick={() => {
                              (window as any)
                                .sendMessage('addTimestampEnterChat', {
                                  timestamp: Date.now(),
                                  groupId: direct?.address,
                                })
                                .catch((error: any) => {
                                  console.error(
                                    'Failed to add timestamp:',
                                    error?.message || 'An error occurred'
                                  );
                                });
                              setSelectedDirect(direct);
                              getTimestampEnterChat();
                            }}
                            sx={{
                              borderRadius: '10px',
                              cursor: 'pointer',
                              marginBottom: '6px',
                              padding: '12px 14px',
                              width: '100%',
                              backgroundColor:
                                selectedDirect?.address === direct?.address
                                  ? theme.palette.action.selected
                                  : 'transparent',
                              borderLeft:
                                selectedDirect?.address === direct?.address
                                  ? `3px solid ${theme.palette.primary.main}`
                                  : '3px solid transparent',
                              transition:
                                'background-color 0.15s ease, border-color 0.15s ease',
                              '&:hover': {
                                backgroundColor:
                                  selectedDirect?.address === direct?.address
                                    ? theme.palette.action.selected
                                    : theme.palette.action.hover,
                              },
                            }}
                          >
                            <ListItemAvatar sx={{ minWidth: 44, marginRight: 0 }}>
                              <Avatar
                                sx={{
                                  height: 40,
                                  width: 40,
                                  background: theme.palette.background.default,
                                  color: theme.palette.text.primary,
                                  ...getClickableAvatarSx(
                                    theme,
                                    isAvatarLoaded
                                  ),
                                }}
                                alt={direct?.name || direct?.address}
                                src={avatarUrl}
                                imgProps={{
                                  onLoad: () => {
                                    if (!avatarKey) return;
                                    setDirectAvatarLoaded((prev) =>
                                      prev[avatarKey]
                                        ? prev
                                        : { ...prev, [avatarKey]: true }
                                    );
                                  },
                                  onError: () => {
                                    if (!avatarKey) return;
                                    setDirectAvatarLoaded((prev) =>
                                      prev[avatarKey] === false
                                        ? prev
                                        : { ...prev, [avatarKey]: false }
                                    );
                                  },
                                }}
                              >
                                {(direct?.name || direct?.address)?.charAt(0)}
                              </Avatar>
                            </ListItemAvatar>
                            <ListItemText
                              primary={direct?.name || direct?.address}
                              secondary={
                                !direct?.timestamp
                                  ? t('core:message.generic.no_messages', {
                                      postProcess: 'capitalizeFirstChar',
                                    })
                                  : (() => {
                                      const senderLabel =
                                        direct?.sender === myAddress
                                          ? t('group:last_message_you', {
                                              postProcess:
                                                'capitalizeFirstChar',
                                            })
                                          : direct?.name || direct?.address;
                                      return t('group:last_message_from', {
                                        sender: senderLabel,
                                        date: formatEmailDate(direct.timestamp),
                                      });
                                    })()
                              }
                              primaryTypographyProps={{
                                sx: {
                                  color: hasUnread
                                    ? theme.palette.primary.main
                                    : theme.palette.text.primary,
                                  fontFamily: 'Inter',
                                  fontSize: '15px',
                                  fontWeight: 600,
                                  lineHeight: 1.3,
                                },
                              }}
                              secondaryTypographyProps={{
                                sx: {
                                  color: theme.palette.text.secondary,
                                  fontFamily: 'Inter',
                                  fontSize: '12px',
                                  lineHeight: 1.4,
                                  marginTop: '3px',
                                },
                              }}
                              sx={{
                                flex: 1,
                                minWidth: 0,
                                margin: 0,
                                overflow: 'hidden',
                              }}
                            />
                            {hasUnread && (
                              <MarkChatUnreadIcon
                                sx={{
                                  color: theme.palette.primary.main,
                                  fontSize: '18px',
                                  flexShrink: 0,
                                  marginLeft: 1,
                                }}
                              />
                            )}
                          </ListItem>
                        );
                      })
                    )}
                  </>
                )}

                {tab === 'groups' && (
                  <>
                    {sortedGroups.length === 0 ? (
                      <Box
                        sx={{
                          padding: 4,
                          textAlign: 'center',
                          color: theme.palette.text.secondary,
                          fontFamily: 'Inter',
                          fontSize: '14px',
                        }}
                      >
                        No groups
                      </Box>
                    ) : (
                      sortedGroups.map((group: any) => {
                        const groupName =
                          group?.groupName ||
                          group?.name ||
                          (group?.groupId === '0'
                            ? 'General'
                            : `Group ${group?.groupId}`);
                        const ownerName =
                          groupsOwnerNames[group?.groupId] ??
                          group?.ownerName ??
                          group?.name;
                        const avatarUrl =
                          ownerName && group?.groupId
                            ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${ownerName}/qortal_group_avatar_${group?.groupId}?async=true`
                            : null;
                        const isSelected =
                          selectedGroup?.groupId === group?.groupId;
                        const groupChatTimestamp =
                          groupChatTimestamps[group?.groupId];
                        const groupEnterTimestamp =
                          timestampEnterData[group?.groupId];
                        const hasUnreadGroup =
                          group?.data &&
                          groupChatTimestamp &&
                          group?.sender !== myAddress &&
                          group?.timestamp &&
                          ((groupEnterTimestamp == null &&
                            Date.now() - group?.timestamp <
                              timeDifferenceForNotificationChats) ||
                            (groupEnterTimestamp ?? 0) < group?.timestamp);
                        const groupProperty = groupsProperties[group?.groupId];
                        const isPrivateGroup = groupProperty?.isOpen === false;
                        return (
                          <ListItem
                            key={group?.groupId}
                            onClick={() => {
                              (window as any)
                                .sendMessage('addTimestampEnterChat', {
                                  timestamp: Date.now(),
                                  groupId: group?.groupId,
                                })
                                .catch((error: any) => {
                                  console.error(
                                    'Failed to add timestamp:',
                                    error?.message || 'An error occurred'
                                  );
                                });
                              setSelectedGroup(group);
                              getTimestampEnterChat();
                            }}
                            sx={{
                              borderRadius: '10px',
                              cursor: 'pointer',
                              marginBottom: '6px',
                              padding: '12px 14px',
                              width: '100%',
                              backgroundColor: isSelected
                                ? theme.palette.action.selected
                                : 'transparent',
                              borderLeft: isSelected
                                ? `3px solid ${theme.palette.primary.main}`
                                : '3px solid transparent',
                              transition:
                                'background-color 0.15s ease, border-color 0.15s ease',
                              '&:hover': {
                                backgroundColor: isSelected
                                  ? theme.palette.action.selected
                                  : theme.palette.action.hover,
                              },
                            }}
                          >
                            <ListItemAvatar sx={{ minWidth: 44, marginRight: 0 }}>
                              <Avatar
                                sx={{
                                  height: 40,
                                  width: 40,
                                  background: theme.palette.background.default,
                                  color: theme.palette.text.primary,
                                  ...getClickableAvatarSx(theme, !!avatarUrl),
                                }}
                                src={avatarUrl || undefined}
                                imgProps={{
                                  onLoad: () => {},
                                  onError: () => {},
                                }}
                              >
                                {groupName?.charAt(0)?.toUpperCase() || 'G'}
                              </Avatar>
                            </ListItemAvatar>
                            <ListItemText
                              primary={
                                group?.groupId === '0' ? 'General' : groupName
                              }
                              secondary={
                                !group?.timestamp
                                  ? t('core:message.generic.no_messages', {
                                      postProcess: 'capitalizeFirstChar',
                                    })
                                  : (() => {
                                      const senderLabel =
                                        group?.sender === myAddress
                                          ? t('group:last_message_you', {
                                              postProcess:
                                                'capitalizeFirstChar',
                                            })
                                          : group?.senderName ||
                                            (group?.sender
                                              ? `${String(group.sender).slice(0, 6)}…`
                                              : t('group:last_message', {
                                                  postProcess:
                                                    'capitalizeFirstChar',
                                                }));
                                      return t('group:last_message_from', {
                                        sender: senderLabel,
                                        date: formatEmailDate(group.timestamp),
                                      });
                                    })()
                              }
                              primaryTypographyProps={{
                                sx: {
                                  color: hasUnreadGroup
                                    ? theme.palette.primary.main
                                    : theme.palette.text.primary,
                                  fontFamily: 'Inter',
                                  fontSize: '15px',
                                  fontWeight: 600,
                                  lineHeight: 1.3,
                                },
                              }}
                              secondaryTypographyProps={{
                                sx: {
                                  color: theme.palette.text.secondary,
                                  fontFamily: 'Inter',
                                  fontSize: '12px',
                                  lineHeight: 1.4,
                                  marginTop: '3px',
                                },
                              }}
                              sx={{
                                flex: 1,
                                minWidth: 0,
                                margin: 0,
                                overflow: 'hidden',
                              }}
                            />
                            <Box
                              sx={{
                                alignItems: 'center',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '4px',
                                flexShrink: 0,
                                justifyContent: 'center',
                                marginLeft: 1,
                              }}
                            >
                              {hasUnreadGroup && (
                                <MarkChatUnreadIcon
                                  sx={{
                                    color:
                                      theme.palette.other?.unread ??
                                      theme.palette.primary.main,
                                    fontSize: '18px',
                                  }}
                                />
                              )}
                              {isPrivateGroup && (
                                <LockIcon
                                  sx={{
                                    color: theme.palette.other?.positive ?? theme.palette.text.secondary,
                                    fontSize: '18px',
                                  }}
                                  titleAccess={t('group:group.private', {
                                    postProcess: 'capitalizeFirstChar',
                                  })}
                                />
                              )}
                            </Box>
                          </ListItem>
                        );
                      })
                    )}
                  </>
                )}
              </List>
            </>
          )}
        </Box>
      </Box>
    </Rnd>
  );
}
