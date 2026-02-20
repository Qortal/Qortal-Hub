import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import {
  Avatar,
  Box,
  Button,
  ClickAwayListener,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Paper,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import MarkChatUnreadIcon from '@mui/icons-material/MarkChatUnread';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import LockIcon from '@mui/icons-material/Lock';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CircularProgress from '@mui/material/CircularProgress';
import { useTranslation } from 'react-i18next';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  globalChatWidgetBoundsAtom,
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
import { useNameSearch } from '../../hooks/useNameSearch';
import { validateAddress } from '../../utils/validateAddress';
import { appHeighOffset, appHeighOffsetPx } from '../Desktop/CustomTitleBar';

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
  const { t } = useTranslation(['core', 'group', 'auth']);
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
  const [newDmInput, setNewDmInput] = useState('');
  const [newDmSuggestionsOpen, setNewDmSuggestionsOpen] = useState(false);
  const [lastSelectedNameOption, setLastSelectedNameOption] = useState<
    { name: string; address: string } | string | null
  >(null);
  const newDmInputRef = useRef<HTMLDivElement>(null);
  const newDmSearchQuery =
    newDmInput.trim().length >= 1 ? newDmInput.trim() : '';
  const { results: newDmNameResults, isLoading: newDmNameLoading } =
    useNameSearch(newDmSearchQuery, 15);

  const WIDGET_MIN_WIDTH = 280;
  const WIDGET_MAX_WIDTH = 720;
  const WIDGET_MIN_HEIGHT = 240;
  const WIDGET_MAX_HEIGHT = 800;
  const BAR_HEIGHT = 52;

  const storedBounds = useAtomValue(globalChatWidgetBoundsAtom);
  const setStoredBounds = useSetAtom(globalChatWidgetBoundsAtom);
  const initialBounds = useMemo(() => {
    if (typeof window === 'undefined')
      return { x: 0, width: 380, height: 560 };
    const w = window.innerWidth;
    const h = window.innerHeight - appHeighOffset;
    const maxW = Math.min(WIDGET_MAX_WIDTH, w - 48);
    const maxH = Math.min(
      WIDGET_MAX_HEIGHT,
      Math.max(WIDGET_MIN_HEIGHT, h - 120)
    );
    if (!storedBounds)
      return {
        x: Math.max(0, w - 380),
        width: 380,
        height: 560,
      };
    return {
      x: Math.max(0, Math.min(w - storedBounds.width, storedBounds.x)),
      width: Math.min(maxW, Math.max(WIDGET_MIN_WIDTH, storedBounds.width)),
      height: Math.min(maxH, Math.max(WIDGET_MIN_HEIGHT, storedBounds.height)),
    };
  }, [storedBounds]);

  const [widgetWidth, setWidgetWidth] = useState(initialBounds.width);
  const [widgetHeight, setWidgetHeight] = useState(initialBounds.height);
  const [resizing, setResizing] = useState(false);

  const [windowSize, setWindowSize] = useState(() =>
    typeof window !== 'undefined'
      ? { w: window.innerWidth, h: window.innerHeight - appHeighOffset }
      : { w: 800, h: 600 }
  );
  const [bottomX, setBottomX] = useState(initialBounds.x);
  const [draggingX, setDraggingX] = useState<number | null>(null);
  const didDragRef = useRef(false);
  const hasAppliedStoredRef = useRef(false);
  const resizeCaptureRef = useRef<{
    el: HTMLElement;
    pointerId: number;
  } | null>(null);

  const maxWidgetWidth = Math.min(
    WIDGET_MAX_WIDTH,
    windowSize.w - 48
  );
  const maxWidgetHeight = Math.min(
    WIDGET_MAX_HEIGHT,
    Math.max(WIDGET_MIN_HEIGHT, windowSize.h - 120)
  );

  const handleRndResizeStart = useCallback(
    (
      e: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>,
      _dir: unknown,
      _elementRef: HTMLElement
    ) => {
      setResizing(true);
      const target = e.target as HTMLElement;
      const native = e.nativeEvent as PointerEvent & { pointerId?: number };
      // PointerEvent has pointerId; MouseEvent does not - use 1 as fallback for primary mouse
      const pointerId =
        native.pointerId ?? (e.type.startsWith('mouse') ? 1 : undefined);
      if (
        target &&
        pointerId != null &&
        typeof target.setPointerCapture === 'function'
      ) {
        try {
          target.setPointerCapture(pointerId);
          resizeCaptureRef.current = { el: target, pointerId };
        } catch (_) {
          resizeCaptureRef.current = null;
        }
      }
    },
    []
  );

  const handleRndResize = useCallback(
    (
      _e: MouseEvent | TouchEvent,
      _dir: unknown,
      _elementRef: HTMLElement,
      delta: { width: number; height: number }
    ) => {
      setWidgetWidth((prev) =>
        Math.min(maxWidgetWidth, Math.max(WIDGET_MIN_WIDTH, prev + delta.width))
      );
      setWidgetHeight((prev) =>
        Math.min(
          maxWidgetHeight,
          Math.max(WIDGET_MIN_HEIGHT, prev + delta.height)
        )
      );
    },
    [maxWidgetWidth, maxWidgetHeight]
  );

  const handleRndResizeStop = useCallback(
    (
      e: MouseEvent | TouchEvent,
      _dir: unknown,
      elementRef: HTMLElement,
      _delta: unknown,
      position: { x: number; y: number }
    ) => {
      const capture = resizeCaptureRef.current;
      if (capture) {
        try {
          capture.el.releasePointerCapture(capture.pointerId);
        } catch (_) {
          // ignore if already released
        }
        resizeCaptureRef.current = null;
      }
      const w = elementRef.offsetWidth;
      const totalH = elementRef.offsetHeight;
      const contentH = totalH - BAR_HEIGHT;
      const width = Math.min(maxWidgetWidth, Math.max(WIDGET_MIN_WIDTH, w));
      const height = Math.min(
        maxWidgetHeight,
        Math.max(WIDGET_MIN_HEIGHT, contentH)
      );
      const maxXAfter = Math.max(0, windowSize.w - w);
      const x = Math.max(0, Math.min(maxXAfter, position.x ?? 0));
      setWidgetWidth(width);
      setWidgetHeight(height);
      setBottomX(x);
      setResizing(false);
      setStoredBounds({ x, width, height });
    },
    [maxWidgetWidth, maxWidgetHeight, windowSize.w, setStoredBounds]
  );

  const totalHeight = BAR_HEIGHT + (open ? widgetHeight : 0);
  const maxX = Math.max(0, windowSize.w - widgetWidth);
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
      setWindowSize({ w: window.innerWidth, h: window.innerHeight - appHeighOffset });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Apply stored bounds when they become available (e.g. after async hydration)
  useEffect(() => {
    if (!storedBounds || hasAppliedStoredRef.current) return;
    hasAppliedStoredRef.current = true;
    const w = window.innerWidth;
    const h = window.innerHeight - appHeighOffset;
    const maxW = Math.min(WIDGET_MAX_WIDTH, w - 48);
    const maxH = Math.min(
      WIDGET_MAX_HEIGHT,
      Math.max(WIDGET_MIN_HEIGHT, h - 120)
    );
    setWidgetWidth(Math.min(maxW, Math.max(WIDGET_MIN_WIDTH, storedBounds.width)));
    setWidgetHeight(
      Math.min(maxH, Math.max(WIDGET_MIN_HEIGHT, storedBounds.height))
    );
    setBottomX(
      Math.max(0, Math.min(w - storedBounds.width, storedBounds.x))
    );
  }, [storedBounds]);

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
      const x = Math.max(0, Math.min(maxX, d.x));
      setDraggingX(null);
      setBottomX(x);
      setStoredBounds({ x, width: widgetWidth, height: widgetHeight });
    },
    [maxX, widgetWidth, widgetHeight, setStoredBounds]
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

  type NameOrAddressOption = string | { name: string; address: string };
  const newDmNameOptions = useMemo((): NameOrAddressOption[] => {
    const trimmed = newDmInput.trim();
    if (validateAddress(trimmed)) return [trimmed];
    return newDmNameResults ?? [];
  }, [newDmInput, newDmNameResults]);

  const handleStartNewDm = useCallback(() => {
    const trimmed = newDmInput.trim();
    if (!trimmed) return;
    let address: string;
    let name: string;
    if (validateAddress(trimmed)) {
      address = trimmed;
      name = trimmed;
    } else if (
      lastSelectedNameOption &&
      typeof lastSelectedNameOption === 'object'
    ) {
      address = lastSelectedNameOption.address;
      name = lastSelectedNameOption.name;
    } else if (
      newDmNameOptions.length > 0 &&
      typeof newDmNameOptions[0] === 'object'
    ) {
      const first = newDmNameOptions[0] as { name: string; address: string };
      address = first.address;
      name = first.name;
    } else {
      return;
    }
    setSelectedDirect({
      address,
      name,
      timestamp: Date.now(),
      sender: myAddress,
      senderName: myName,
    });
    setNewDmInput('');
    setLastSelectedNameOption(null);
    setNewDmSuggestionsOpen(false);
  }, [newDmInput, lastSelectedNameOption, newDmNameOptions, myAddress, myName]);

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
      maxWidth={maxWidgetWidth}
      maxHeight={BAR_HEIGHT + maxWidgetHeight}
      disableDragging={false}
      enableResizing={
        open ? { top: true, topLeft: true, topRight: true } : false
      }
      resizeHandleStyles={{
        top: { height: 24, top: -12, zIndex: 25, cursor: 'ns-resize' },
        topLeft: {
          width: 28,
          height: 28,
          left: -14,
          top: -14,
          zIndex: 25,
          cursor: 'nwse-resize',
        },
        topRight: {
          width: 28,
          height: 28,
          right: -14,
          top: -14,
          zIndex: 25,
          cursor: 'nwse-resize',
        },
      }}
      resizeHandleWrapperStyle={{ pointerEvents: 'auto' }}
      dragAxis="x"
      bounds="window"
      dragHandleClassName="global-chat-widget-drag-handle"
      onDragStart={handleRndDragStart}
      onDrag={handleRndDrag}
      onDragStop={handleRndDragStop}
      onResizeStart={handleRndResizeStart}
      onResize={handleRndResize}
      onResizeStop={handleRndResizeStop}
      enableUserSelectHack={true}
      cancel=".global-chat-widget-no-drag"
      style={{
        zIndex: 1300,
        transition:
          draggingX === null && !resizing
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
        {/* Bar: always visible at very bottom, click to expand/collapse — also Rnd drag handle. Use div to avoid nesting buttons (IconButtons inside). */}
        <Box
          component="div"
          role="button"
          tabIndex={0}
          className="global-chat-widget-drag-handle"
          onClick={handleBarClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleBarClick();
            }
          }}
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
          <Box
            className="global-chat-widget-no-drag"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
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
                  maxHeight:
                    `min(800px, calc(100vh - ${appHeighOffsetPx} - 120px))`,
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
                    <ClickAwayListener
                      onClickAway={() => setNewDmSuggestionsOpen(false)}
                    >
                      <Box
                        ref={newDmInputRef}
                        sx={{
                          flexShrink: 0,
                          padding: '12px 8px 8px',
                          width: '100%',
                        }}
                      >
                        <Box
                          sx={{
                            position: 'relative',
                            width: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 1,
                          }}
                        >
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1,
                              width: '100%',
                            }}
                          >
                            <TextField
                              fullWidth
                              size="small"
                              variant="outlined"
                              placeholder={t(
                                'auth:message.generic.name_address',
                                {
                                  postProcess: 'capitalizeFirstChar',
                                }
                              )}
                              value={newDmInput}
                              onChange={(e) => {
                                setNewDmInput(e.target.value);
                                setLastSelectedNameOption(null);
                                setNewDmSuggestionsOpen(true);
                              }}
                              onFocus={() => setNewDmSuggestionsOpen(true)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newDmInput.trim()) {
                                  e.preventDefault();
                                  handleStartNewDm();
                                  setNewDmSuggestionsOpen(false);
                                }
                              }}
                              slotProps={{
                                htmlInput: {
                                  'aria-label': t(
                                    'auth:message.generic.name_address',
                                    { postProcess: 'capitalizeFirstChar' }
                                  ),
                                },
                              }}
                              InputProps={{
                                startAdornment: (
                                  <InputAdornment position="start">
                                    <AddRoundedIcon
                                      sx={{
                                        color: theme.palette.primary.main,
                                        fontSize: '20px',
                                      }}
                                    />
                                  </InputAdornment>
                                ),
                                endAdornment: newDmNameLoading ? (
                                  <InputAdornment position="end">
                                    <CircularProgress size={18} />
                                  </InputAdornment>
                                ) : null,
                                sx: {
                                  backgroundColor:
                                    theme.palette.background.paper,
                                  borderRadius: '12px',
                                  fontFamily: 'Inter',
                                  fontSize: '14px',
                                  '& fieldset': {
                                    borderColor: theme.palette.divider,
                                    borderRadius: '12px',
                                  },
                                  '&.Mui-focused fieldset': {
                                    borderWidth: '2px',
                                    borderColor: theme.palette.primary.main,
                                  },
                                },
                              }}
                            />
                            {newDmInput.trim() && (
                              <Button
                                size="small"
                                variant="contained"
                                onClick={() => {
                                  handleStartNewDm();
                                  setNewDmSuggestionsOpen(false);
                                }}
                                disabled={
                                  !newDmInput.trim() ||
                                  (!validateAddress(newDmInput.trim()) &&
                                    !lastSelectedNameOption &&
                                    (newDmNameOptions.length === 0 ||
                                      typeof newDmNameOptions[0] !== 'object'))
                                }
                                sx={{
                                  flexShrink: 0,
                                  borderRadius: '10px',
                                  fontFamily: 'Inter',
                                  fontWeight: 600,
                                  fontSize: '13px',
                                  textTransform: 'none',
                                }}
                              >
                                {t('core:action.new.chat', {
                                  postProcess: 'capitalizeFirstChar',
                                })}
                              </Button>
                            )}
                          </Box>
                          {newDmSuggestionsOpen &&
                            (newDmNameOptions.length > 0 ||
                              newDmNameLoading) && (
                              <Paper
                                elevation={8}
                                sx={{
                                  position: 'absolute',
                                  left: 0,
                                  right: 0,
                                  top: '100%',
                                  marginTop: 4,
                                  maxHeight: 220,
                                  overflow: 'hidden',
                                  overflowY: 'auto',
                                  zIndex: 1400,
                                  borderRadius: '12px',
                                  border: `1px solid ${theme.palette.divider}`,
                                  boxShadow:
                                    theme.palette.mode === 'dark'
                                      ? '0 8px 32px rgba(0,0,0,0.4)'
                                      : '0 8px 32px rgba(0,0,0,0.12)',
                                  '&::-webkit-scrollbar': { width: 6 },
                                  '&::-webkit-scrollbar-thumb': {
                                    backgroundColor: theme.palette.divider,
                                    borderRadius: 3,
                                  },
                                }}
                              >
                                {newDmNameLoading &&
                                newDmNameOptions.length === 0 ? (
                                  <Box
                                    sx={{
                                      py: 2,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      gap: 1,
                                    }}
                                  >
                                    <CircularProgress size={20} />
                                    <Typography
                                      variant="body2"
                                      color="text.secondary"
                                    >
                                      {t('core:loading.generic', {
                                        postProcess: 'capitalizeFirstChar',
                                      })}
                                    </Typography>
                                  </Box>
                                ) : (
                                  <List disablePadding sx={{ py: 0.5 }}>
                                    {newDmNameOptions.map((opt) => {
                                      const label =
                                        typeof opt === 'string'
                                          ? opt
                                          : opt.name;
                                      const key =
                                        typeof opt === 'string'
                                          ? opt
                                          : opt.address;
                                      const initial = (label || '?')
                                        .charAt(0)
                                        .toUpperCase();
                                      return (
                                        <ListItem
                                          key={key}
                                          disablePadding
                                          sx={{ px: 0.5 }}
                                        >
                                          <ListItemButton
                                            onClick={() => {
                                              const valueToSet =
                                                typeof opt === 'string'
                                                  ? opt
                                                  : opt.name;
                                              setNewDmInput(valueToSet);
                                              setLastSelectedNameOption(opt);
                                              setNewDmSuggestionsOpen(false);
                                            }}
                                            sx={{
                                              borderRadius: '8px',
                                              py: 1,
                                              px: 1.25,
                                              '&:hover': {
                                                backgroundColor:
                                                  theme.palette.action.hover,
                                              },
                                            }}
                                          >
                                            <Avatar
                                              sx={{
                                                width: 32,
                                                height: 32,
                                                mr: 1.25,
                                                fontSize: '0.875rem',
                                                fontWeight: 600,
                                                bgcolor:
                                                  theme.palette.primary.main,
                                                color:
                                                  theme.palette.primary
                                                    .contrastText,
                                              }}
                                            >
                                              {initial}
                                            </Avatar>
                                            <ListItemText
                                              primary={label}
                                              primaryTypographyProps={{
                                                fontWeight: 500,
                                                fontSize: '0.875rem',
                                              }}
                                            />
                                          </ListItemButton>
                                        </ListItem>
                                      );
                                    })}
                                  </List>
                                )}
                              </Paper>
                            )}
                        </Box>
                      </Box>
                    </ClickAwayListener>
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
                            <ListItemAvatar
                              sx={{ minWidth: 44, marginRight: 0 }}
                            >
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
                            <ListItemAvatar
                              sx={{ minWidth: 44, marginRight: 0 }}
                            >
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
                                    color:
                                      theme.palette.other?.positive ??
                                      theme.palette.text.secondary,
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
