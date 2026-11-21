import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  GlobalStyles,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Radio,
  RadioGroup,
  Switch,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  type DragOverEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import PhoneIcon from '@mui/icons-material/Phone';
import { HubsIcon } from '../../assets/Icons/HubsIcon';
import { MessagingIcon } from '../../assets/Icons/MessagingIcon';
import { ContextMenu } from '../ContextMenu';
import { prefetchReticulumGroupAboutMetadata } from './ReticulumGroupAbout';
import { getBaseApiReact } from '../../App';
import { formatEmailDate } from './qmailUtils';
import CampaignIcon from '@mui/icons-material/Campaign';
import MarkChatUnreadIcon from '@mui/icons-material/MarkChatUnread';
import LockIcon from '@mui/icons-material/Lock';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import { CustomButton } from '../../styles/App-styles';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import AccessibilityNewOutlinedIcon from '@mui/icons-material/AccessibilityNewOutlined';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import {
  groupAnnouncementSelector,
  groupChatTimestampSelector,
  groupPropertySelector,
  groupsAnnHasUnreadAtom,
  groupChatHasUnreadAtom,
  groupsOwnerNamesSelector,
  isRunningPublicNodeAtom,
  memberGroupsWithReticulumChatAtom,
  memberGroupsAtom,
  qortalGroupMeshCallActiveAtom,
  qortalGroupMeshCallMaxParticipantsAtom,
  qortalGroupMeshCallParticipantCountAtom,
  qortalGroupSelfGcallRoomIdAtom,
  reticulumHighlightOwnMessagesAtom,
  reticulumLegacyThreadsEnabledAtom,
  reticulumChatTextScaleAtom,
  timestampEnterDataSelector,
  notificationSettingsCacheAtom,
  muteExpiryTickAtom,
  unreadWelcomeEventIdsAtom,
  globalNotificationFormAtom,
  DEFAULT_GLOBAL_NOTIF_FORM,
} from '../../atoms/global';
import { timeDifferenceForNotificationChats } from './Group';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  isScopeMuted,
  groupHasUnreadConsideringMute,
  getGroupUnreadCountConsideringMute,
  getWelcomeUnreadCount,
  DEFAULT_NOTIFICATION_SETTINGS,
  applyNotificationSettingsToAllGroups,
  setGlobalNotificationSettings,
  wipeAllChannelOverrides,
  getNotificationDeliveryMethod,
  setNotificationDeliveryMethod,
  getDefaultNotificationDeliveryMethod,
  type PushLevel,
  type NotificationDeliveryMethod,
} from '../../utils/qChatNotificationSettings';
import { AvatarPreviewModal } from '../Chat/AvatarPreviewModal';
import { getClickableAvatarSx } from '../Chat/clickableAvatarStyles';
import {
  meshCallActiveForMemberGroup,
  meshCallMaxParticipantsForMemberGroup,
  meshCallParticipantCountForMemberGroup,
} from '../../lib/group-call/qortalGroupIdKey';
import {
  orderReticulumGroups,
  persistReticulumGroupOrder,
  readReticulumGroupOrder,
  subscribeToReticulumGroupOrder,
} from './reticulumGroupRail';
import {
  readGroupSortMode,
  subscribeToGroupSortMode,
  persistGroupSortMode,
  type GroupSortMode,
} from './SortGroupsSubmenu';
import { QChatWhatsNewDialog } from './QChatWhatsNewDialog';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import {
  ReticulumUnreadCountBadge,
  RETICULUM_NOTIFICATION_RED,
} from '../common/ReticulumUnreadCountBadge';

const RETICULUM_ACTIVE_BLUE_DARK = '#2563eb';
const RETICULUM_ACTIVE_BLUE_LIGHT = '#5090e1';
const RETICULUM_CALL_GREEN = '#22c55e';
const GROUP_RAIL_TOOLTIP_MODIFIERS = [
  {
    name: 'flip',
    enabled: false,
  },
];

/** Atom values, doubling as key suffixes under reticulum:settings.text_size */
const reticulumTextScaleOptions = ['default', 'medium', 'high'] as const;

export const ReticulumChatSettingsDialog = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) => {
  const { t } = useTranslation(['core', 'reticulum', 'group']);
  const theme = useTheme();
  const memberGroups = useAtomValue(memberGroupsAtom);
  const [activeSection, setActiveSection] = useState<
    'text-size' | 'messages' | 'notifications' | 'legacy-threads'
  >('text-size');
  const [accessibilityExpanded, setAccessibilityExpanded] = useState(true);
  const [notificationsExpanded, setNotificationsExpanded] = useState(true);
  const [legacyExpanded, setLegacyExpanded] = useState(true);
  const [committedNotifForm, setNotifForm] = useAtom(
    globalNotificationFormAtom
  );
  const [draftNotifForm, setDraftNotifForm] = useState(committedNotifForm);
  const [deliveryMethod, setDeliveryMethod] =
    useState<NotificationDeliveryMethod>('native');
  const [deliveryMethodLoaded, setDeliveryMethodLoaded] = useState(false);
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    if (open && !deliveryMethodLoaded) {
      setDraftNotifForm(committedNotifForm);
      getNotificationDeliveryMethod().then((method) => {
        setDeliveryMethod(method);
        setDeliveryMethodLoaded(true);
      });
    } else if (!open) {
      setDeliveryMethod(getDefaultNotificationDeliveryMethod());
      setDeliveryMethodLoaded(false);
    }
  }, [open, deliveryMethodLoaded, committedNotifForm]);
  const notifFormChanged =
    draftNotifForm.pushLevel !== DEFAULT_GLOBAL_NOTIF_FORM.pushLevel ||
    draftNotifForm.suppressEveryoneHere !==
      DEFAULT_GLOBAL_NOTIF_FORM.suppressEveryoneHere ||
    draftNotifForm.notifyOnReplies !==
      DEFAULT_GLOBAL_NOTIF_FORM.notifyOnReplies ||
    draftNotifForm.notifyOnReactions !==
      DEFAULT_GLOBAL_NOTIF_FORM.notifyOnReactions ||
    draftNotifForm.notifyOnWelcomePosts !==
      DEFAULT_GLOBAL_NOTIF_FORM.notifyOnWelcomePosts ||
    draftNotifForm.hideMutedChannels !==
      DEFAULT_GLOBAL_NOTIF_FORM.hideMutedChannels;
  const applyDisabled =
    draftNotifForm.pushLevel === committedNotifForm.pushLevel &&
    draftNotifForm.suppressEveryoneHere ===
      committedNotifForm.suppressEveryoneHere &&
    draftNotifForm.notifyOnReplies === committedNotifForm.notifyOnReplies &&
    draftNotifForm.notifyOnReactions === committedNotifForm.notifyOnReactions &&
    draftNotifForm.notifyOnWelcomePosts ===
      committedNotifForm.notifyOnWelcomePosts &&
    draftNotifForm.hideMutedChannels === committedNotifForm.hideMutedChannels;
  const [textScale, setTextScale] = useAtom(reticulumChatTextScaleAtom);
  const [highlightOwnMessages, setHighlightOwnMessages] = useAtom(
    reticulumHighlightOwnMessagesAtom
  );
  const [legacyThreadsEnabled, setLegacyThreadsEnabled] = useAtom(
    reticulumLegacyThreadsEnabledAtom
  );
  const navButtonSx = (selected: boolean) => ({
    alignItems: 'center',
    backgroundColor: selected ? theme.palette.action.hover : 'transparent',
    border: '1px solid transparent',
    borderLeft: `${selected ? 3 : 0}px solid ${
      selected ? theme.palette.primary.main : 'transparent'
    }`,
    borderRadius: '7px',
    color: selected ? theme.palette.text.primary : theme.palette.text.secondary,
    display: 'flex',
    fontSize: 14,
    fontWeight: 550,
    gap: '10px',
    height: 40,
    justifyContent: 'flex-start',
    px: 1.5,
    py: 0,
    textTransform: 'none',
    whiteSpace: 'nowrap',
    width: '100%',
    '&:hover': {
      backgroundColor: selected
        ? theme.palette.action.selected
        : theme.palette.action.hover,
    },
  });
  const categoryButtonSx = {
    alignItems: 'center',
    color: 'text.secondary',
    display: 'flex',
    fontSize: 11,
    fontWeight: 650,
    height: 32,
    justifyContent: 'space-between',
    letterSpacing: '0.08em',
    lineHeight: '16px',
    px: 0,
    textTransform: 'uppercase',
    width: '100%',
    '&:hover': {
      color: 'text.primary',
    },
  };

  return (
    <Dialog
      fullWidth
      maxWidth={false}
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          fontFamily: 'Inter, system-ui, Segoe UI, sans-serif',
          backgroundImage: 'none',
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '10px',
          boxShadow: '0 24px 70px rgba(0,0,0,0.45)',
          maxWidth: 'calc(100vw - 32px)',
          height: 'min(530px, calc(100vh - 32px))',
          width: 700,
          '& button, & input, & textarea': {
            fontFamily: 'inherit',
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          color: 'text.primary',
          fontFamily: 'Inter',
          fontSize: 30,
          fontWeight: 750,
          lineHeight: '36px',
          pb: 1.5,
          pt: { xs: 2.5, sm: 3.5 },
          px: { xs: 2.5, sm: 4 },
        }}
      >
        {t('core:settings', { postProcess: 'capitalizeFirstChar' })}
      </DialogTitle>
      <Box
        sx={{
          borderTop: `1px solid ${theme.palette.divider}`,
          display: 'flex',
          flex: 1,
          minHeight: 0,
        }}
      >
        <Box
          sx={{
            borderRight: `1px solid ${theme.palette.divider}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
            backgroundColor: 'rgba(255,255,255,0.018)',
            p: '20px',
            width: 220,
          }}
        >
          <ButtonBase
            aria-expanded={accessibilityExpanded}
            onClick={() => setAccessibilityExpanded((expanded) => !expanded)}
            sx={categoryButtonSx}
          >
            <span>{t('reticulum:settings.category.accessibility')}</span>
            {accessibilityExpanded ? (
              <ExpandMoreRoundedIcon sx={{ fontSize: 18 }} />
            ) : (
              <ChevronRightRoundedIcon sx={{ fontSize: 18 }} />
            )}
          </ButtonBase>
          {accessibilityExpanded && (
            <>
              <ButtonBase
                onClick={() => setActiveSection('text-size')}
                sx={navButtonSx(activeSection === 'text-size')}
              >
                <AccessibilityNewOutlinedIcon sx={{ fontSize: 19 }} />{' '}
                {t('reticulum:settings.nav.text_size')}
              </ButtonBase>
              <ButtonBase
                onClick={() => setActiveSection('messages')}
                sx={navButtonSx(activeSection === 'messages')}
              >
                <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 19 }} />{' '}
                {t('reticulum:settings.nav.messages')}
              </ButtonBase>
            </>
          )}
          <ButtonBase
            aria-expanded={notificationsExpanded}
            onClick={() => setNotificationsExpanded((expanded) => !expanded)}
            sx={{ ...categoryButtonSx, mt: 2.25 }}
          >
            <span>{t('reticulum:settings.nav.notifications')}</span>
            {notificationsExpanded ? (
              <ExpandMoreRoundedIcon sx={{ fontSize: 18 }} />
            ) : (
              <ChevronRightRoundedIcon sx={{ fontSize: 18 }} />
            )}
          </ButtonBase>
          {notificationsExpanded && (
            <ButtonBase
              onClick={() => setActiveSection('notifications')}
              sx={navButtonSx(activeSection === 'notifications')}
            >
              <NotificationsNoneRoundedIcon sx={{ fontSize: 19 }} />{' '}
              {t('reticulum:settings.nav.notifications')}
            </ButtonBase>
          )}
          <ButtonBase
            aria-expanded={legacyExpanded}
            onClick={() => setLegacyExpanded((expanded) => !expanded)}
            sx={{ ...categoryButtonSx, mt: 2.25 }}
          >
            <span>{t('reticulum:settings.category.legacy')}</span>
            {legacyExpanded ? (
              <ExpandMoreRoundedIcon sx={{ fontSize: 18 }} />
            ) : (
              <ChevronRightRoundedIcon sx={{ fontSize: 18 }} />
            )}
          </ButtonBase>
          {legacyExpanded && (
            <ButtonBase
              onClick={() => setActiveSection('legacy-threads')}
              sx={navButtonSx(activeSection === 'legacy-threads')}
            >
              <ForumRoundedIcon sx={{ fontSize: 19 }} />{' '}
              {t('reticulum:settings.nav.threads')}
            </ButtonBase>
          )}
        </Box>
        <DialogContent
          sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: '28px' }}
        >
          {activeSection === 'text-size' ? (
            <>
              <Typography
                component="h2"
                sx={{
                  color: 'text.primary',
                  fontSize: 20,
                  fontWeight: 650,
                  lineHeight: '26px',
                }}
              >
                {t('reticulum:settings.text_size.title')}
              </Typography>
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: 14,
                  fontWeight: 400,
                  lineHeight: '20px',
                  maxWidth: 460,
                  mt: 0.75,
                }}
              >
                {t('reticulum:settings.text_size.description')}
              </Typography>
              <Box sx={{ display: 'grid', gap: 1, mt: 2.5 }}>
                {reticulumTextScaleOptions.map((option) => {
                  const selected = textScale === option;
                  return (
                    <ButtonBase
                      key={option}
                      onClick={() => setTextScale(option)}
                      sx={{
                        alignItems: 'center',
                        backgroundColor: selected
                          ? theme.palette.action.hover
                          : 'background.default',
                        border: `1px solid ${selected ? theme.palette.primary.main : theme.palette.divider}`,
                        borderRadius: '10px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        minHeight: 64,
                        p: 1.25,
                        textAlign: 'left',
                      }}
                    >
                      <Box>
                        <Typography
                          sx={{
                            color: 'text.primary',
                            fontSize: 14,
                            fontWeight: 600,
                            lineHeight: '20px',
                          }}
                        >
                          {t(`reticulum:settings.text_size.${option}.label`)}
                        </Typography>
                        <Typography
                          sx={{
                            color: 'text.secondary',
                            fontSize: 13,
                            mt: 0.25,
                          }}
                        >
                          {t(`reticulum:settings.text_size.${option}.detail`)}
                        </Typography>
                      </Box>
                      <Box
                        sx={{
                          backgroundColor: selected
                            ? theme.palette.primary.main
                            : 'transparent',
                          border: `1px solid ${selected ? theme.palette.primary.main : theme.palette.text.secondary}`,
                          borderRadius: '50%',
                          height: 16,
                          width: 16,
                        }}
                      />
                    </ButtonBase>
                  );
                })}
              </Box>
            </>
          ) : activeSection === 'messages' ? (
            <>
              <Typography
                component="h2"
                sx={{
                  color: 'text.primary',
                  fontSize: 20,
                  fontWeight: 650,
                  lineHeight: '26px',
                }}
              >
                {t('reticulum:settings.messages.title')}
              </Typography>
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: 14,
                  fontWeight: 400,
                  lineHeight: '20px',
                  maxWidth: 460,
                  mt: 0.75,
                }}
              >
                {t('reticulum:settings.messages.description')}
              </Typography>
              <Box
                sx={{
                  alignItems: 'center',
                  backgroundColor: 'background.default',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '10px',
                  display: 'flex',
                  gap: 2,
                  justifyContent: 'space-between',
                  mt: 2.5,
                  px: 2,
                  py: 1.5,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      color: 'text.primary',
                      fontSize: 14,
                      fontWeight: 600,
                      lineHeight: '20px',
                    }}
                  >
                    {t('reticulum:settings.messages.highlight_own.label')}
                  </Typography>
                  <Typography
                    sx={{
                      color: 'text.secondary',
                      fontSize: 13,
                      lineHeight: '18px',
                      mt: 0.25,
                    }}
                  >
                    {t('reticulum:settings.messages.highlight_own.description')}
                  </Typography>
                </Box>
                <Switch
                  checked={highlightOwnMessages === true}
                  inputProps={{
                    'aria-label': t(
                      'reticulum:settings.messages.highlight_own.label'
                    ),
                  }}
                  onChange={(_, checked) => setHighlightOwnMessages(checked)}
                />
              </Box>
            </>
          ) : activeSection === 'notifications' ? (
            <>
              <Typography
                component="h2"
                sx={{
                  color: 'text.primary',
                  fontSize: 20,
                  fontWeight: 650,
                  lineHeight: '26px',
                }}
              >
                {t('reticulum:settings.notifications.title')}
              </Typography>
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: 14,
                  fontWeight: 400,
                  lineHeight: '20px',
                  maxWidth: 460,
                  mt: 0.75,
                }}
              >
                {t('reticulum:settings.notifications.description')}
              </Typography>
              <RadioGroup
                value={draftNotifForm.pushLevel}
                onChange={(_, value: string) =>
                  setDraftNotifForm((prev) => ({
                    ...prev,
                    pushLevel: value as PushLevel,
                  }))
                }
                sx={{
                  display: 'flex',
                  gap: 0,
                  mt: 2.5,
                }}
              >
                <FormControlLabel
                  value="all"
                  control={<Radio size="small" />}
                  label={
                    <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                      {t('group:notification_settings.all_messages')}
                    </Typography>
                  }
                  sx={{
                    m: 0,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: '8px',
                    '&:hover': {
                      backgroundColor: theme.palette.action.hover,
                    },
                  }}
                />
                <FormControlLabel
                  value="mentions"
                  control={<Radio size="small" />}
                  label={
                    <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                      {t('group:notification_settings.only_mentions')}
                    </Typography>
                  }
                  sx={{
                    m: 0,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: '8px',
                    '&:hover': {
                      backgroundColor: theme.palette.action.hover,
                    },
                  }}
                />
                <FormControlLabel
                  value="none"
                  control={<Radio size="small" />}
                  label={
                    <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                      {t('group:notification_settings.none')}
                    </Typography>
                  }
                  sx={{
                    m: 0,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: '8px',
                    '&:hover': {
                      backgroundColor: theme.palette.action.hover,
                    },
                  }}
                />
              </RadioGroup>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0,
                  mt: 1.5,
                }}
              >
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={draftNotifForm.suppressEveryoneHere}
                      disabled={draftNotifForm.pushLevel === 'all'}
                      onChange={(_, checked) => {
                        if (draftNotifForm.pushLevel === 'all') return;
                        setDraftNotifForm((prev) => ({
                          ...prev,
                          suppressEveryoneHere: checked,
                        }));
                      }}
                    />
                  }
                  label={
                    <Typography
                      sx={{
                        fontSize: 14,
                        fontWeight: 600,
                        opacity: draftNotifForm.pushLevel === 'all' ? 0.4 : 1,
                      }}
                    >
                      {t('group:notification_settings.suppress_everyone_here')}
                    </Typography>
                  }
                  sx={{
                    m: 0,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: '8px',
                    '&:hover': {
                      backgroundColor: theme.palette.action.hover,
                    },
                  }}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={draftNotifForm.notifyOnReplies}
                      disabled={draftNotifForm.pushLevel === 'all'}
                      onChange={(_, checked) => {
                        if (draftNotifForm.pushLevel === 'all') return;
                        setDraftNotifForm((prev) => ({
                          ...prev,
                          notifyOnReplies: checked,
                        }));
                      }}
                    />
                  }
                  label={
                    <Typography
                      sx={{
                        fontSize: 14,
                        fontWeight: 600,
                        opacity: draftNotifForm.pushLevel === 'all' ? 0.4 : 1,
                      }}
                    >
                      {t('group:notification_settings.notify_on_replies')}
                    </Typography>
                  }
                  sx={{
                    m: 0,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: '8px',
                    '&:hover': {
                      backgroundColor: theme.palette.action.hover,
                    },
                  }}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={draftNotifForm.notifyOnReactions}
                      disabled={draftNotifForm.pushLevel === 'all'}
                      onChange={(_, checked) => {
                        if (draftNotifForm.pushLevel === 'all') return;
                        setDraftNotifForm((prev) => ({
                          ...prev,
                          notifyOnReactions: checked,
                        }));
                      }}
                    />
                  }
                  label={
                    <Typography
                      sx={{
                        fontSize: 14,
                        fontWeight: 600,
                        opacity: draftNotifForm.pushLevel === 'all' ? 0.4 : 1,
                      }}
                    >
                      {t('group:notification_settings.notify_on_reactions')}
                    </Typography>
                  }
                  sx={{
                    m: 0,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: '8px',
                    '&:hover': {
                      backgroundColor: theme.palette.action.hover,
                    },
                  }}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={draftNotifForm.notifyOnWelcomePosts}
                      disabled={draftNotifForm.pushLevel === 'all'}
                      onChange={(_, checked) => {
                        if (draftNotifForm.pushLevel === 'all') return;
                        setDraftNotifForm((prev) => ({
                          ...prev,
                          notifyOnWelcomePosts: checked,
                        }));
                      }}
                    />
                  }
                  label={
                    <Typography
                      sx={{
                        fontSize: 14,
                        fontWeight: 600,
                        opacity: draftNotifForm.pushLevel === 'all' ? 0.4 : 1,
                      }}
                    >
                      {t('group:notification_settings.notify_on_welcome_posts')}
                    </Typography>
                  }
                  sx={{
                    m: 0,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: '8px',
                    '&:hover': {
                      backgroundColor: theme.palette.action.hover,
                    },
                  }}
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={draftNotifForm.hideMutedChannels}
                      onChange={(_, checked) =>
                        setDraftNotifForm((prev) => ({
                          ...prev,
                          hideMutedChannels: checked,
                        }))
                      }
                    />
                  }
                  label={
                    <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                      {t('group:notification_settings.hide_muted_channels')}
                    </Typography>
                  }
                  sx={{
                    m: 0,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: '8px',
                    '&:hover': {
                      backgroundColor: theme.palette.action.hover,
                    },
                  }}
                />
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  gap: 2,
                  mt: 3,
                  alignItems: 'center',
                }}
              >
                <Button
                  variant="contained"
                  disabled={applying || applyDisabled}
                  onClick={async () => {
                    setApplying(true);
                    try {
                      const groupIds = memberGroups
                        .map((g: { groupId: number | string }) => g.groupId)
                        .filter((id) => id != null && id !== '' && id !== '0');
                      // New model: the global defaults are the source of truth.
                      // Applying sets them as the new defaults and wipes all
                      // channel overrides so every channel inherits them.
                      await setGlobalNotificationSettings({
                        pushLevel: draftNotifForm.pushLevel,
                        suppressEveryoneHere:
                          draftNotifForm.suppressEveryoneHere,
                        notifyOnReplies: draftNotifForm.notifyOnReplies,
                        notifyOnReactions: draftNotifForm.notifyOnReactions,
                      });
                      await wipeAllChannelOverrides(groupIds);
                      setNotifForm(draftNotifForm);
                      onClose();
                    } finally {
                      setApplying(false);
                    }
                  }}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 600,
                    color: 'common.white',
                  }}
                >
                  {t('reticulum:settings.notifications.apply_button')}
                </Button>
                {notifFormChanged && (
                  <Button
                    variant="text"
                    disabled={applying}
                    onClick={async () => {
                      setApplying(true);
                      try {
                        const groupIds = memberGroups
                          .map((g: { groupId: number | string }) => g.groupId)
                          .filter(
                            (id) => id != null && id !== '' && id !== '0'
                          );
                        await setGlobalNotificationSettings({
                          pushLevel: DEFAULT_GLOBAL_NOTIF_FORM.pushLevel,
                          suppressEveryoneHere:
                            DEFAULT_GLOBAL_NOTIF_FORM.suppressEveryoneHere,
                          notifyOnReplies:
                            DEFAULT_GLOBAL_NOTIF_FORM.notifyOnReplies,
                          notifyOnReactions:
                            DEFAULT_GLOBAL_NOTIF_FORM.notifyOnReactions,
                        });
                        await wipeAllChannelOverrides(groupIds);
                        setNotifForm(DEFAULT_GLOBAL_NOTIF_FORM);
                        onClose();
                      } finally {
                        setApplying(false);
                      }
                    }}
                    sx={{
                      textTransform: 'none',
                      fontWeight: 600,
                    }}
                  >
                    {t('reticulum:settings.notifications.revert_button')}
                  </Button>
                )}
              </Box>
              <Typography
                sx={{
                  color: 'text.primary',
                  fontSize: 16,
                  fontWeight: 650,
                  mt: 3,
                  mb: 0.5,
                }}
              >
                {t('reticulum:settings.notifications.delivery_title')}
              </Typography>
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: 13,
                  mb: 1,
                }}
              >
                {t('reticulum:settings.notifications.delivery_description')}
              </Typography>
              <RadioGroup
                value={deliveryMethod}
                onChange={(_, value: string) => {
                  const method = value as NotificationDeliveryMethod;
                  setDeliveryMethod(method);
                  void setNotificationDeliveryMethod(method);
                }}
                sx={{ display: 'flex', gap: 0 }}
              >
                <FormControlLabel
                  value="native"
                  control={<Radio size="small" />}
                  label={
                    <Tooltip
                      title={t(
                        'reticulum:settings.notifications.delivery_native_tooltip'
                      )}
                      placement="right"
                    >
                      <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                        {t('reticulum:settings.notifications.delivery_native')}
                      </Typography>
                    </Tooltip>
                  }
                  sx={{
                    m: 0,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: '8px',
                    '&:hover': {
                      backgroundColor: theme.palette.action.hover,
                    },
                  }}
                />
                <FormControlLabel
                  value="ephemeral"
                  control={<Radio size="small" />}
                  label={
                    <Tooltip
                      title={t(
                        'reticulum:settings.notifications.delivery_ephemeral_tooltip'
                      )}
                      placement="right"
                    >
                      <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                        {t(
                          'reticulum:settings.notifications.delivery_ephemeral'
                        )}
                      </Typography>
                    </Tooltip>
                  }
                  sx={{
                    m: 0,
                    px: 1.5,
                    py: 0.75,
                    borderRadius: '8px',
                    '&:hover': {
                      backgroundColor: theme.palette.action.hover,
                    },
                  }}
                />
              </RadioGroup>
            </>
          ) : activeSection === 'legacy-threads' ? (
            <>
              <Typography
                component="h2"
                sx={{
                  color: 'text.primary',
                  fontSize: 20,
                  fontWeight: 650,
                  lineHeight: '26px',
                }}
              >
                {t('reticulum:settings.legacy.title')}
              </Typography>
              <Typography
                sx={{
                  color: 'text.secondary',
                  fontSize: 14,
                  fontWeight: 400,
                  lineHeight: '20px',
                  maxWidth: 460,
                  mt: 0.75,
                }}
              >
                {t('reticulum:settings.legacy.description')}
              </Typography>
              <Box
                sx={{
                  alignItems: 'center',
                  backgroundColor: 'background.default',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '10px',
                  display: 'flex',
                  gap: 2,
                  justifyContent: 'space-between',
                  mt: 2.5,
                  px: 2,
                  py: 1.5,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      color: 'text.primary',
                      fontSize: 14,
                      fontWeight: 600,
                      lineHeight: '20px',
                    }}
                  >
                    {t('reticulum:settings.legacy.toggle.label')}
                  </Typography>
                  <Typography
                    sx={{
                      color: 'text.secondary',
                      fontSize: 13,
                      lineHeight: '18px',
                      mt: 0.25,
                    }}
                  >
                    {t('reticulum:settings.legacy.toggle.description')}
                  </Typography>
                </Box>
                <Switch
                  checked={legacyThreadsEnabled === true}
                  inputProps={{
                    'aria-label': t('reticulum:settings.legacy.toggle.aria'),
                  }}
                  onChange={(_, checked) => setLegacyThreadsEnabled(checked)}
                />
              </Box>
              <Typography
                sx={{
                  color: theme.palette.error.main,
                  fontSize: 13,
                  lineHeight: '19px',
                  mt: 1.5,
                }}
              >
                {t('reticulum:settings.legacy.warning')}
              </Typography>
            </>
          ) : null}
        </DialogContent>
      </Box>
    </Dialog>
  );
};

type GroupDragInsertionPosition = 'before' | 'after';

type GroupDragTarget = {
  activeId: string;
  overId: string;
  position: GroupDragInsertionPosition;
};

const groupDragInsertionPosition = (
  event: DragEndEvent | DragOverEvent
): GroupDragInsertionPosition => {
  const translated = event.active.rect.current.translated;
  if (!translated || !event.over) return 'before';
  const activeMiddle = translated.top + translated.height / 2;
  const overMiddle = event.over.rect.top + event.over.rect.height / 2;
  return activeMiddle > overMiddle ? 'after' : 'before';
};

const moveGroupByInsertion = <T,>(
  items: T[],
  sourceIndex: number,
  targetIndex: number,
  position: GroupDragInsertionPosition
) => {
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  const rawIndex = targetIndex + (position === 'after' ? 1 : 0);
  const insertionIndex = Math.max(
    0,
    Math.min(rawIndex - (sourceIndex < rawIndex ? 1 : 0), next.length)
  );
  next.splice(insertionIndex, 0, moved);
  return next;
};

function GroupDropIndicator({
  position,
}: {
  position: GroupDragInsertionPosition;
}) {
  const theme = useTheme();
  return (
    <Box
      aria-hidden
      sx={{
        backgroundColor:
          theme.palette.mode === 'dark'
            ? RETICULUM_ACTIVE_BLUE_DARK
            : RETICULUM_ACTIVE_BLUE_LIGHT,
        borderRadius: '999px',
        boxShadow: '0 0 0 1px rgba(37, 99, 235, 0.22)',
        height: 2,
        left: 6,
        pointerEvents: 'none',
        position: 'absolute',
        right: 6,
        ...(position === 'before' ? { top: -4 } : { bottom: -4 }),
        zIndex: 7,
      }}
    />
  );
}

const ReticulumDmMorphIcon = ({
  active,
  color,
}: {
  active: boolean;
  color: string;
}) => (
  <Box
    component="span"
    className="reticulum-dm-morph-icon"
    sx={{
      color,
      display: 'inline-flex',
      height: 25,
      overflow: 'hidden',
      position: 'relative',
      transition: 'color 150ms ease',
      width: 25,
      '@keyframes reticulumDmLand': {
        '0%': { opacity: 0, transform: 'translateY(-30px) scale(0.96)' },
        '55%': { opacity: 1 },
        '100%': { opacity: 1, transform: 'translateY(0) scale(1)' },
      },
      '@keyframes reticulumDmExit': {
        '0%': { opacity: 1, transform: 'translateY(0) scale(1)' },
        '100%': { opacity: 0, transform: 'translateY(30px) scale(0.94)' },
      },
      '@keyframes reticulumQortalDrop': {
        '0%': { opacity: 0, transform: 'translateY(-30px) scale(0.94)' },
        '55%': { opacity: 1 },
        '100%': { opacity: 1, transform: 'translateY(0) scale(1)' },
      },
      '@keyframes reticulumQortalExit': {
        '0%': { opacity: 1, transform: 'translateY(0) scale(1)' },
        '100%': { opacity: 0, transform: 'translateY(30px) scale(0.94)' },
      },
      '& svg': {
        display: 'block',
        height: '100%',
        inset: 0,
        overflow: 'visible',
        position: 'absolute',
        transformBox: 'fill-box',
        transformOrigin: '50% 50%',
        width: '100%',
      },
      '& .reticulum-dm-front': {
        animation: active
          ? 'reticulumDmExit 360ms cubic-bezier(0.3, 0, 0.2, 1) both'
          : 'reticulumDmLand 420ms cubic-bezier(0.2, 0.9, 0.2, 1) both',
        opacity: active ? 0 : 1,
        transform: active
          ? 'translateY(30px) scale(0.94)'
          : 'translateY(0) scale(1)',
      },
      '& .reticulum-dm-back': {
        animation: active
          ? 'reticulumQortalDrop 420ms cubic-bezier(0.2, 0.9, 0.2, 1) both'
          : 'reticulumQortalExit 360ms cubic-bezier(0.3, 0, 0.2, 1) both',
        opacity: active ? 1 : 0,
        transform: active
          ? 'translateY(0) scale(1)'
          : 'translateY(30px) scale(0.94)',
      },
    }}
  >
    <svg
      aria-hidden="true"
      className="reticulum-dm-front"
      focusable="false"
      viewBox="0 0 32 32"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      >
        <path d="M4.8 15.9 26.4 5.7 20 26.2l-4.4-8.1-6.8 5.2 2.3-7.3z" />
        <path d="M11.2 16 20 10.2" opacity="0.55" />
      </g>
    </svg>
    <svg
      aria-hidden="true"
      className="reticulum-dm-back"
      focusable="false"
      viewBox="0 0 32 32"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.45"
      >
        <path d="M16 3.8 25.7 9.4v11.2L16 26.2l-9.7-5.6V9.4z" opacity="0.95" />
        <path d="M16 8.2 22 11.7v7L16 22.2l-6-3.5v-7z" />
        <path d="M13.2 20.5 16 22.1l2.6-1.5" />
        <path d="M20.7 18.1 27.4 22.5" />
      </g>
    </svg>
  </Box>
);

const GroupListInner = ({
  selectGroupFunc,
  setDesktopSideView,
  desktopSideView,
  directChatHasUnread,
  directChatUnreadCount,
  chatMode,
  selectedGroup,
  getUserSettings,
  setOpenAddGroup,
  setOpenFindGroup,
  setIsOpenBlockedUserModal,
  myAddress,
  reticulumChatEnabled,
}) => {
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'reticulum',
  ]);
  const [isRunningPublicNode] = useAtom(isRunningPublicNodeAtom);
  const [reticulumSettingsOpen, setReticulumSettingsOpen] = useState(false);
  const [reticulumWhatsNewOpen, setReticulumWhatsNewOpen] = useState(false);
  const groups = useAtomValue(memberGroupsWithReticulumChatAtom);
  const groupChatHasUnread = useAtomValue(groupChatHasUnreadAtom);
  const groupsAnnHasUnread = useAtomValue(groupsAnnHasUnreadAtom);
  const muteSettingsCache = useAtomValue(notificationSettingsCacheAtom);
  useAtomValue(muteExpiryTickAtom);
  const railMode = Boolean(reticulumChatEnabled);
  const [manualGroupOrder, setManualGroupOrder] = useState<string[]>(
    readReticulumGroupOrder
  );

  useEffect(() => {
    const unsubscribe = subscribeToReticulumGroupOrder(setManualGroupOrder);
    return unsubscribe;
  }, []);
  const [sortMode, setSortMode] = useState<GroupSortMode>(readGroupSortMode);

  useEffect(() => {
    const unsubscribe = subscribeToGroupSortMode(setSortMode);
    return unsubscribe;
  }, []);
  const [groupDragTarget, setGroupDragTarget] =
    useState<GroupDragTarget | null>(null);
  const groupDragTargetRef = useRef<GroupDragTarget | null>(null);
  const groupDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const orderedGroups = useMemo(() => {
    if (!railMode) {
      if (sortMode === 'alphabetical') {
        return [...groups].sort((a: any, b: any) =>
          String(a?.groupName || '').localeCompare(String(b?.groupName || ''))
        );
      }
      return groups;
    }
    if (sortMode === 'manual') {
      return orderReticulumGroups(groups, manualGroupOrder);
    }
    if (sortMode === 'alphabetical') {
      return [...groups].sort((a: any, b: any) =>
        String(a?.groupName || '').localeCompare(String(b?.groupName || ''))
      );
    }
    return groups;
  }, [groups, manualGroupOrder, railMode, sortMode]);
  const orderedGroupIds = useMemo(
    () => orderedGroups.map((group: any) => String(group?.groupId)),
    [orderedGroups]
  );

  const persistManualGroupOrder = useCallback((nextOrder: string[]) => {
    setManualGroupOrder(nextOrder);
    persistReticulumGroupOrder(nextOrder);
  }, []);

  const handleGroupDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = orderedGroupIds.indexOf(String(active.id));
      const newIndex = orderedGroupIds.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      persistManualGroupOrder(
        moveGroupByInsertion(
          orderedGroupIds,
          oldIndex,
          newIndex,
          groupDragInsertionPosition(event)
        )
      );
      if (sortMode !== 'manual') {
        setSortMode('manual');
        persistGroupSortMode('manual');
      }
    },
    [orderedGroupIds, persistManualGroupOrder, sortMode]
  );

  const updateGroupDragTarget = useCallback(
    (nextTarget: GroupDragTarget | null) => {
      const currentTarget = groupDragTargetRef.current;
      if (
        currentTarget?.activeId === nextTarget?.activeId &&
        currentTarget?.overId === nextTarget?.overId &&
        currentTarget?.position === nextTarget?.position
      ) {
        return;
      }
      groupDragTargetRef.current = nextTarget;
      setGroupDragTarget(nextTarget);
    },
    []
  );

  const handleGroupDragOver = useCallback(
    (event: DragOverEvent) => {
      if (!event.over || event.active.id === event.over.id) {
        updateGroupDragTarget(null);
        return;
      }
      updateGroupDragTarget({
        activeId: String(event.active.id),
        overId: String(event.over.id),
        position: groupDragInsertionPosition(event),
      });
    },
    [updateGroupDragTarget]
  );

  if (railMode) {
    return (
      <Box
        data-tour="hub-group-rail"
        sx={{
          alignItems: 'center',
          background: theme.palette.background.surface,
          borderRight: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          height: '100%',
          padding: '10px 9px',
          width: '72px',
        }}
      >
        <GlobalStyles
          styles={{
            '.MuiTooltip-tooltip': {
              backgroundColor:
                theme.palette.mode === 'dark'
                  ? `color-mix(in srgb, ${theme.palette.background.surface} 70%, #000) !important`
                  : `${theme.palette.grey[100]} !important`,
              border: `1px solid ${theme.palette.divider} !important`,
              borderRadius: '6px',
              boxShadow: '0 8px 18px rgba(0, 0, 0, 0.28)',
              color: theme.palette.text.primary,
              fontSize: '14px !important',
              fontWeight: 600,
              padding: '8px 12px !important',
            },
            '.MuiTooltip-arrow': {
              color:
                theme.palette.mode === 'dark'
                  ? `color-mix(in srgb, ${theme.palette.background.surface} 70%, #000) !important`
                  : `${theme.palette.grey[100]} !important`,
            },
          }}
        />
        <Tooltip
          placement="right"
          title={
            desktopSideView === 'directs'
              ? t('group:group.group_other', {
                  postProcess: 'capitalizeFirstChar',
                })
              : t('group:dm.direct_messages')
          }
        >
          <ButtonBase
            data-tour="hub-direct-messages"
            onClick={() => {
              setDesktopSideView('directs');
            }}
            sx={{
              alignItems: 'center',
              backgroundColor:
                desktopSideView === 'directs'
                  ? theme.palette.action.selected
                  : 'transparent',
              borderRadius: '8px',
              display: 'flex',
              height: 42,
              justifyContent: 'center',
              mb: 1,
              position: 'relative',
              width: 42,
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
              },
              '&:hover .reticulum-dm-morph-icon': {
                color: theme.palette.primary.main,
              },
            }}
          >
            {directChatHasUnread && (
              <ReticulumUnreadCountBadge
                count={directChatUnreadCount}
                outlineColor={theme.palette.background.surface}
                sx={{
                  bottom: -2,
                  position: 'absolute',
                  right: -2,
                  zIndex: 2,
                }}
              />
            )}
            <ReticulumDmMorphIcon
              active={desktopSideView === 'directs'}
              color={
                desktopSideView === 'directs'
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary
              }
            />
          </ButtonBase>
        </Tooltip>
        <Box
          sx={{
            borderTop: '1px solid',
            borderColor: 'divider',
            mb: 1,
            width: 34,
          }}
        />

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flex: 1,
            flexDirection: 'column',
            gap: '6px',
            minHeight: 0,
            overflowX: 'visible',
            overflowY: 'auto',
            scrollbarWidth: 'none',
            width: '100%',
            msOverflowStyle: 'none',
            '&::-webkit-scrollbar': {
              display: 'none',
              height: 0,
              width: 0,
            },
            '&::-webkit-scrollbar-corner': {
              display: 'none',
            },
          }}
        >
          <DndContext
            collisionDetection={closestCenter}
            onDragCancel={() => updateGroupDragTarget(null)}
            onDragEnd={(event) => {
              updateGroupDragTarget(null);
              handleGroupDragEnd(event);
            }}
            onDragOver={handleGroupDragOver}
            sensors={groupDndSensors}
          >
            <SortableContext
              items={orderedGroupIds}
              strategy={verticalListSortingStrategy}
            >
              <List
                className="group-list"
                dense
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  overflow: 'visible',
                  p: 0,
                  width: '100%',
                }}
              >
                {orderedGroups.map((group: any) => (
                  <GroupItem
                    selectGroupFunc={selectGroupFunc}
                    key={group.groupId}
                    group={group}
                    dropPosition={
                      groupDragTarget?.activeId !== String(group.groupId) &&
                      groupDragTarget?.overId === String(group.groupId)
                        ? groupDragTarget.position
                        : undefined
                    }
                    selectedGroupId={selectedGroup?.groupId ?? null}
                    getUserSettings={getUserSettings}
                    myAddress={myAddress}
                    reticulumChatEnabled={reticulumChatEnabled}
                    railMode
                    desktopSideView={desktopSideView}
                  />
                ))}
              </List>
            </SortableContext>
          </DndContext>
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            borderTop: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            mt: 1.25,
            pb: 1,
            pt: 1.75,
            width: '100%',
          }}
        >
          <Tooltip placement="right" title={t('reticulum:rail.find_groups')}>
            <ButtonBase
              data-tour="hub-group-discovery"
              aria-label={t('reticulum:rail.find_groups')}
              onClick={() => {
                setOpenFindGroup(true);
              }}
              sx={{
                alignItems: 'center',
                borderRadius: '8px',
                color: theme.palette.text.secondary,
                display: 'flex',
                height: 34,
                justifyContent: 'center',
                width: 34,
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                  color: theme.palette.text.primary,
                },
              }}
            >
              <SearchRoundedIcon sx={{ fontSize: 24 }} />
            </ButtonBase>
          </Tooltip>

          <Tooltip
            placement="right"
            title={t('group:action.create_group', {
              postProcess: 'capitalizeEachFirstChar',
            })}
          >
            <ButtonBase
              aria-label={t('group:action.create_group', {
                postProcess: 'capitalizeEachFirstChar',
              })}
              onClick={() => {
                setOpenAddGroup(true);
              }}
              sx={{
                alignItems: 'center',
                borderRadius: '8px',
                color: theme.palette.text.secondary,
                display: 'flex',
                height: 34,
                justifyContent: 'center',
                width: 34,
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                  color: theme.palette.text.primary,
                },
              }}
            >
              <AddCircleOutlineIcon sx={{ fontSize: 24 }} />
            </ButtonBase>
          </Tooltip>

          <Tooltip placement="right" title={t('reticulum:rail.group_settings')}>
            <ButtonBase
              aria-label={t('reticulum:rail.group_settings')}
              onClick={() => {
                setReticulumSettingsOpen(true);
              }}
              sx={{
                alignItems: 'center',
                borderRadius: '8px',
                color: theme.palette.text.secondary,
                display: 'flex',
                height: 34,
                justifyContent: 'center',
                width: 34,
                '&:hover': {
                  backgroundColor: theme.palette.action.hover,
                  color: theme.palette.text.primary,
                },
              }}
            >
              <SettingsOutlinedIcon sx={{ fontSize: 24 }} />
            </ButtonBase>
          </Tooltip>

          <ButtonBase
            aria-label={t('reticulum:rail.whats_new')}
            onClick={() => setReticulumWhatsNewOpen(true)}
            sx={{
              borderRadius: '5px',
              color: theme.palette.text.secondary,
              fontSize: 10.5,
              fontWeight: 650,
              lineHeight: 1,
              mb: 0.25,
              px: 0.75,
              py: 0.5,
              transition: 'color 150ms ease, background-color 150ms ease',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                color: theme.palette.common.white,
              },
            }}
          >
            v3.0.3
          </ButtonBase>
        </Box>
        <ReticulumChatSettingsDialog
          open={reticulumSettingsOpen}
          onClose={() => setReticulumSettingsOpen(false)}
        />
        <QChatWhatsNewDialog
          onClose={() => setReticulumWhatsNewOpen(false)}
          open={reticulumWhatsNewOpen}
        />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        alignItems: 'flex-start',
        background: theme.palette.background.surface,
        borderRadius: '0 12px 12px 0',
        borderLeft: '1px solid',
        borderColor: 'divider',
        boxShadow: '6px 0 20px rgba(0,0,0,0.18), 2px 0 8px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '0',
        width: '400px',
      }}
    >
      <Box
        sx={{
          alignItems: 'stretch',
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          gap: '10px',
          justifyContent: 'center',
          padding: '14px 12px',
          width: '100%',
        }}
      >
        <ButtonBase
          onClick={() => {
            setDesktopSideView('groups');
          }}
          sx={{
            position: 'relative',
            borderRadius: '12px',
            flex: 1,
            minWidth: 0,
            padding: '14px 12px',
            backgroundColor:
              desktopSideView === 'groups'
                ? theme.palette.action.selected
                : 'transparent',
            transition: 'background-color 0.15s ease',
            '&:hover': {
              backgroundColor:
                desktopSideView === 'groups'
                  ? theme.palette.action.selected
                  : theme.palette.action.hover,
            },
          }}
        >
          {(groupChatHasUnread || groupsAnnHasUnread) && (
            <Box
              sx={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 14,
                height: 14,
                borderRadius: '50%',
                backgroundColor: theme.palette.primary.main,
                border: `2px solid ${theme.palette.background.paper}`,
              }}
              aria-hidden
            />
          )}
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <HubsIcon
              height={26}
              width={26}
              color={
                groupChatHasUnread || groupsAnnHasUnread
                  ? theme.palette.primary.main
                  : desktopSideView === 'groups'
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary
              }
            />
            <Typography
              sx={{
                color:
                  groupChatHasUnread || groupsAnnHasUnread
                    ? theme.palette.primary.main
                    : desktopSideView === 'groups'
                      ? theme.palette.text.primary
                      : theme.palette.text.secondary,
                fontFamily: 'Inter',
                fontSize: '13px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {t('group:group.group_other', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            setDesktopSideView('directs');
          }}
          sx={{
            position: 'relative',
            borderRadius: '12px',
            flex: 1,
            minWidth: 0,
            padding: '14px 12px',
            backgroundColor:
              desktopSideView === 'directs'
                ? theme.palette.action.selected
                : 'transparent',
            transition: 'background-color 0.15s ease',
            '&:hover': {
              backgroundColor:
                desktopSideView === 'directs'
                  ? theme.palette.action.selected
                  : theme.palette.action.hover,
            },
          }}
        >
          {directChatHasUnread && (
            <Box
              sx={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 14,
                height: 14,
                borderRadius: '50%',
                backgroundColor: theme.palette.primary.main,
                border: `2px solid ${theme.palette.background.paper}`,
              }}
              aria-hidden
            />
          )}
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              justifyContent: 'center',
              width: '100%',
            }}
          >
            <MessagingIcon
              height={26}
              width={26}
              color={
                directChatHasUnread
                  ? theme.palette.primary.main
                  : desktopSideView === 'directs'
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary
              }
            />
            <Typography
              sx={{
                color: directChatHasUnread
                  ? theme.palette.primary.main
                  : desktopSideView === 'directs'
                    ? theme.palette.text.primary
                    : theme.palette.text.secondary,
                fontFamily: 'Inter',
                fontSize: '13px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {t('group:group.dm', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </Box>
        </ButtonBase>
      </Box>

      <Box
        sx={{
          alignItems: 'flex-start',
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          left: chatMode === 'directs' && '-1000px',
          overflowY: 'auto',
          padding: '12px 8px',
          position: chatMode === 'directs' && 'fixed',
          visibility: chatMode === 'directs' && 'hidden',
          width: '100%',
        }}
      >
        <List
          sx={{
            width: '100%',
            padding: 0,
          }}
          className="group-list"
          dense={false}
        >
          {orderedGroups.map((group: any) => (
            <GroupItem
              selectGroupFunc={selectGroupFunc}
              key={group.groupId}
              group={group}
              selectedGroupId={selectedGroup?.groupId ?? null}
              getUserSettings={getUserSettings}
              myAddress={myAddress}
              reticulumChatEnabled={reticulumChatEnabled}
              desktopSideView={desktopSideView}
            />
          ))}
        </List>
      </Box>

      <Box
        sx={{
          borderTop: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          gap: '10px',
          justifyContent: 'center',
          padding: '16px 12px',
          width: '100%',
        }}
      >
        <CustomButton
          onClick={() => {
            setOpenAddGroup(true);
          }}
          sx={{
            flex: 1,
            gap: '8px',
            padding: '10px 16px',
          }}
        >
          <AddCircleOutlineIcon
            sx={{
              color: theme.palette.text.primary,
              fontSize: '20px',
            }}
          />
          {t('group:group.group', { postProcess: 'capitalizeFirstChar' })}
        </CustomButton>

        {!isRunningPublicNode && (
          <CustomButton
            onClick={() => {
              setIsOpenBlockedUserModal(true);
            }}
            sx={{
              minWidth: 'unset',
              padding: '10px',
            }}
          >
            <PersonOffIcon
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '22px',
              }}
            />
          </CustomButton>
        )}
      </Box>
    </Box>
  );
};

GroupListInner.displayName = 'GroupList';

export const GroupList = memo(GroupListInner);

interface GroupItemProps {
  selectGroupFunc: (group: any) => void;
  group: any;
  dropPosition?: GroupDragInsertionPosition;
  selectedGroupId: string | null;
  getUserSettings: () => Promise<any>;
  myAddress: string;
  reticulumChatEnabled?: boolean;
  railMode?: boolean;
  desktopSideView: string;
}

const GroupItem = memo(
  ({
    selectGroupFunc,
    group,
    dropPosition,
    selectedGroupId,
    getUserSettings,
    myAddress,
    reticulumChatEnabled = false,
    railMode = false,
    desktopSideView,
  }: GroupItemProps) => {
    const theme = useTheme();
    const { t } = useTranslation(['core', 'group']);
    const muteSettingsCache = useAtomValue(notificationSettingsCacheAtom);
    const welcomeUnreadMap = useAtomValue(unreadWelcomeEventIdsAtom);
    useAtomValue(muteExpiryTickAtom);
    const globalNotifForm = useAtomValue(globalNotificationFormAtom);
    const { attributes, listeners, setNodeRef, isDragging } = useSortable({
      id: String(group?.groupId),
      disabled: !railMode,
    });
    const ownerName = useAtomValue(groupsOwnerNamesSelector(group?.groupId));
    const announcement = useAtomValue(
      groupAnnouncementSelector(group?.groupId)
    );
    const groupProperty = useAtomValue(groupPropertySelector(group?.groupId));
    const groupChatTimestamp = useAtomValue(
      groupChatTimestampSelector(group?.groupId)
    );
    const timestampEnterData = useAtomValue(
      timestampEnterDataSelector(group?.groupId)
    );
    const meshCallActiveByGroup = useAtomValue(qortalGroupMeshCallActiveAtom);
    const meshCallParticipantCountByGroup = useAtomValue(
      qortalGroupMeshCallParticipantCountAtom
    );
    const meshCallMaxParticipantsByGroup = useAtomValue(
      qortalGroupMeshCallMaxParticipantsAtom
    );
    const selfGcallRoomId = useAtomValue(qortalGroupSelfGcallRoomIdAtom);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [previewSrc, setPreviewSrc] = useState(null);
    const [loadedAvatarUrl, setLoadedAvatarUrl] = useState<string | null>(null);
    const [isGroupTooltipOpen, setIsGroupTooltipOpen] = useState(false);
    const [isGroupContextMenuOpen, setIsGroupContextMenuOpen] = useState(false);
    const avatarUrl = useMemo(() => {
      if (!ownerName) return null;
      return `${getBaseApiReact()}/arbitrary/THUMBNAIL/${ownerName}/qortal_group_avatar_${group?.groupId}?async=true`;
    }, [ownerName, group?.groupId]);
    const isAvatarLoaded = Boolean(avatarUrl) && loadedAvatarUrl === avatarUrl;

    useEffect(() => {
      if (railMode) prefetchReticulumGroupAboutMetadata(group);
    }, [group, railMode]);

    const selectGroupHandler = useCallback(() => {
      selectGroupFunc(group);
    }, [group, selectGroupFunc]);

    const stopEvent = useCallback((event) => {
      event.stopPropagation();
      if (event.nativeEvent?.stopImmediatePropagation) {
        event.nativeEvent.stopImmediatePropagation();
      }
    }, []);

    const handleAvatarClick = useCallback(
      (event) => {
        if (!avatarUrl || !isAvatarLoaded) return;
        event.preventDefault();
        stopEvent(event);
        setPreviewSrc(avatarUrl);
        setIsPreviewOpen(true);
      },
      [avatarUrl, isAvatarLoaded, stopEvent]
    );

    const handleClosePreview = useCallback(() => {
      setIsPreviewOpen(false);
      setPreviewSrc(null);
    }, [setIsPreviewOpen, setPreviewSrc]);

    const isSelected = group?.groupId === selectedGroupId;
    const groupMuteSettings = muteSettingsCache[String(group?.groupId)];
    const welcomeUnreadCount = getWelcomeUnreadCount(
      welcomeUnreadMap,
      String(group?.groupId)
    );
    const notifyOnWelcomePosts =
      groupMuteSettings?.notifyOnWelcomePosts ??
      globalNotifForm.notifyOnWelcomePosts ??
      true;
    const reticulumFilteredUnreadCount = Math.max(
      0,
      getGroupUnreadCountConsideringMute(
        groupMuteSettings,
        group?.reticulumChatSummary,
        welcomeUnreadCount,
        globalNotifForm
      )
    );
    const reticulumReplyCount = Math.max(
      0,
      Number(group?.reticulumChatSummary?.replyCount || 0)
    );
    const hasReticulumUnread = reticulumFilteredUnreadCount > 0;
    const hasReticulumMention =
      (group?.reticulumChatSummary?.hasUnreadMention === true ||
        (group?.reticulumChatSummary?.mentionCount ?? 0) > 0) &&
      (notifyOnWelcomePosts ||
        (group?.reticulumChatSummary?.mentionCount ?? 0) - welcomeUnreadCount >
          0);
    const isGroupMuted = groupMuteSettings
      ? isScopeMuted(groupMuteSettings) &&
        !groupHasUnreadConsideringMute(
          groupMuteSettings,
          group?.reticulumChatSummary,
          welcomeUnreadCount,
          globalNotifForm
        )
      : false;

    const gcallRoomIdForRow =
      group?.groupId &&
      group.groupId !== '0' &&
      Number.isFinite(Number(group.groupId))
        ? `gcall-qortal-${Number(group.groupId)}`
        : null;
    const imInThisGroupGcall =
      Boolean(gcallRoomIdForRow) && selfGcallRoomId === gcallRoomIdForRow;
    const meshShowsCall = meshCallActiveForMemberGroup(
      meshCallActiveByGroup,
      group?.groupId
    );
    const meshCallParticipantCount = meshCallParticipantCountForMemberGroup(
      meshCallParticipantCountByGroup,
      group?.groupId
    );
    const meshCallMaxParticipants = meshCallMaxParticipantsForMemberGroup(
      meshCallMaxParticipantsByGroup,
      group?.groupId
    );
    const showGroupCallIndicator =
      Boolean(gcallRoomIdForRow) && (imInThisGroupGcall || meshShowsCall);
    const isClosedGroup =
      groupProperty?.isOpen === false ||
      group?.isOpen === false ||
      Number(group?.groupType) === 1 ||
      group?.groupType === 'CLOSED';
    const isOpenGroup = !isClosedGroup;

    if (railMode) {
      const groupLabel =
        group.groupId === '0' ? 'General' : group.groupName || 'Group';
      const fallbackAvatarBackground =
        theme.palette.mode === 'dark'
          ? 'rgba(7, 10, 17, 0.82)'
          : 'rgba(49, 58, 72, 0.88)';
      const avatarNode = ownerName ? (
        <Avatar
          sx={{
            backgroundColor: isAvatarLoaded
              ? 'transparent'
              : fallbackAvatarBackground,
            boxShadow: isAvatarLoaded
              ? 'none'
              : 'inset 0 0 0 1px rgba(255, 255, 255, 0.1)',
            boxSizing: 'border-box',
            color: theme.palette.common.white,
            display: 'flex',
            fontWeight: 800,
            height: 38,
            m: 'auto',
            width: 38,
            zIndex: 1,
            '& .MuiAvatar-img': {
              height: '100%',
              width: '100%',
            },
          }}
          alt={group?.groupName?.charAt(0)}
          src={avatarUrl || undefined}
          imgProps={{
            onLoad: () => {
              setLoadedAvatarUrl(avatarUrl);
            },
            onError: () => {
              setLoadedAvatarUrl((currentUrl) =>
                currentUrl === avatarUrl ? null : currentUrl
              );
            },
          }}
        >
          {group?.groupName?.charAt(0).toUpperCase()}
        </Avatar>
      ) : (
        <Avatar
          alt={group?.groupName?.charAt(0)}
          sx={{
            backgroundColor: fallbackAvatarBackground,
            boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.1)',
            boxSizing: 'border-box',
            color: theme.palette.common.white,
            display: 'flex',
            fontWeight: 800,
            height: 38,
            m: 'auto',
            width: 38,
            zIndex: 1,
          }}
        >
          {group?.groupName?.charAt(0).toUpperCase() || 'G'}
        </Avatar>
      );

      return (
        <Tooltip
          disableFocusListener
          disableHoverListener
          disableTouchListener
          open={isGroupTooltipOpen && !isGroupContextMenuOpen && !isDragging}
          placement="right"
          title={
            <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.65 }}>
              {isOpenGroup ? (
                <PublicRoundedIcon
                  sx={{
                    color:
                      theme.palette.mode === 'dark' ? '#a9c9ff' : '#315d97',
                    fontSize: 17,
                  }}
                />
              ) : (
                <LockIcon
                  sx={{
                    color:
                      theme.palette.mode === 'dark' ? '#f1a0a8' : '#933642',
                    fontSize: 16,
                  }}
                />
              )}
              <Typography
                sx={{ color: 'inherit', fontSize: 14, fontWeight: 600 }}
              >
                {groupLabel}
              </Typography>
            </Box>
          }
          slotProps={{
            popper: {
              modifiers: GROUP_RAIL_TOOLTIP_MODIFIERS,
            },
            tooltip: {
              sx: {
                backgroundColor:
                  theme.palette.mode === 'dark'
                    ? isOpenGroup
                      ? 'rgba(27, 58, 112, 0.92)'
                      : 'rgba(79, 27, 34, 0.94)'
                    : theme.palette.background.paper,
                border: `1px solid ${
                  theme.palette.mode === 'dark'
                    ? isOpenGroup
                      ? 'rgba(107, 164, 255, 0.34)'
                      : 'rgba(243, 126, 136, 0.3)'
                    : isOpenGroup
                      ? 'rgba(49, 93, 151, 0.3)'
                      : 'rgba(147, 54, 66, 0.3)'
                }`,
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? '0 8px 18px rgba(0, 0, 0, 0.3)'
                    : '0 8px 18px rgba(20, 28, 42, 0.18)',
                color:
                  theme.palette.mode === 'dark'
                    ? isOpenGroup
                      ? '#d7e6ff'
                      : '#ffd8dc'
                    : isOpenGroup
                      ? '#244f83'
                      : '#822b37',
                px: 0.85,
                py: 0.6,
              },
            },
          }}
        >
          <ListItem
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            onClick={() => {
              setIsGroupTooltipOpen(false);
              selectGroupHandler();
            }}
            onContextMenuCapture={() => setIsGroupTooltipOpen(false)}
            onMouseEnter={() => setIsGroupTooltipOpen(true)}
            onMouseLeave={() => setIsGroupTooltipOpen(false)}
            onPointerDownCapture={() => setIsGroupTooltipOpen(false)}
            sx={{
              alignItems: 'center',
              backgroundColor: isSelected
                ? desktopSideView === 'groups'
                  ? theme.palette.mode === 'dark'
                    ? RETICULUM_ACTIVE_BLUE_DARK
                    : RETICULUM_ACTIVE_BLUE_LIGHT
                  : theme.palette.mode === 'dark'
                    ? `${RETICULUM_ACTIVE_BLUE_DARK}66`
                    : `${RETICULUM_ACTIVE_BLUE_LIGHT}66`
                : 'transparent',
              borderRadius: '8px',
              boxSizing: 'border-box',
              cursor: 'pointer',
              display: 'grid',
              flexShrink: 0,
              height: 52,
              justifyContent: 'center',
              minHeight: 52,
              placeItems: 'center',
              mb: 0,
              opacity: isDragging ? 0.58 : 1,
              overflow: 'visible',
              p: 0,
              position: 'relative',
              width: 52,
              zIndex: isDragging ? 4 : 'auto',
              '&:hover': {
                backgroundColor: isSelected
                  ? desktopSideView === 'groups'
                    ? theme.palette.mode === 'dark'
                      ? RETICULUM_ACTIVE_BLUE_DARK
                      : RETICULUM_ACTIVE_BLUE_LIGHT
                    : theme.palette.mode === 'dark'
                      ? `${RETICULUM_ACTIVE_BLUE_DARK}66`
                      : `${RETICULUM_ACTIVE_BLUE_LIGHT}66`
                  : theme.palette.action.hover,
              },
            }}
          >
            {dropPosition && <GroupDropIndicator position={dropPosition} />}
            <ContextMenu
              getUserSettings={getUserSettings}
              groupId={group.groupId}
              myAddress={myAddress}
              onMenuOpenChange={setIsGroupContextMenuOpen}
              reticulumGroup={group}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  height: '100%',
                  justifyContent: 'center',
                  left: 0,
                  margin: 'auto',
                  overflow: 'visible',
                  position: 'relative',
                  right: 0,
                  width: '100%',
                }}
              >
                {avatarNode}

                {(groupHasUnreadConsideringMute(
                  groupMuteSettings,
                  group?.reticulumChatSummary,
                  welcomeUnreadCount,
                  globalNotifForm
                ) ||
                  (!reticulumChatEnabled &&
                    group?.data &&
                    groupChatTimestamp &&
                    group?.sender !== myAddress &&
                    group?.timestamp &&
                    ((!timestampEnterData &&
                      Date.now() - group?.timestamp <
                        timeDifferenceForNotificationChats) ||
                      timestampEnterData < group?.timestamp))) && (
                  <ReticulumUnreadCountBadge
                    count={reticulumReplyCount > 0 ? reticulumReplyCount : null}
                    outlineColor={theme.palette.background.surface}
                    size={reticulumReplyCount > 0 ? 18 : 8}
                    sx={{
                      bottom: reticulumReplyCount > 0 ? -2 : 1,
                      position: 'absolute',
                      right: reticulumReplyCount > 0 ? -2 : 1,
                      zIndex: 2,
                    }}
                  />
                )}

                {hasReticulumMention &&
                  groupHasUnreadConsideringMute(
                    groupMuteSettings,
                    group?.reticulumChatSummary,
                    welcomeUnreadCount,
                    globalNotifForm
                  ) && (
                    <AlternateEmailIcon
                      sx={{
                        backgroundColor: theme.palette.background.surface,
                        borderRadius: '50%',
                        color: RETICULUM_NOTIFICATION_RED,
                        fontSize: 16,
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        zIndex: 2,
                      }}
                    />
                  )}

                {!reticulumChatEnabled &&
                  announcement &&
                  !announcement?.seentimestamp && (
                    <CampaignIcon
                      sx={{
                        backgroundColor: theme.palette.background.surface,
                        borderRadius: '50%',
                        color: theme.palette.other.unread,
                        fontSize: 16,
                        left: 0,
                        position: 'absolute',
                        top: 0,
                        zIndex: 2,
                      }}
                    />
                  )}

                {showGroupCallIndicator && (
                  <Tooltip
                    title={
                      imInThisGroupGcall
                        ? t('core:group_list_call_youre_in', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : t('core:group_list_call_active', {
                            postProcess: 'capitalizeFirstChar',
                          })
                    }
                    placement="right"
                  >
                    <ButtonBase
                      aria-label={
                        imInThisGroupGcall
                          ? t('core:group_list_call_youre_in', {
                              postProcess: 'capitalizeFirstChar',
                            })
                          : t('core:group_list_call_active', {
                              postProcess: 'capitalizeFirstChar',
                            })
                      }
                      onClick={(event) => {
                        stopEvent(event);
                        selectGroupHandler();
                      }}
                      onPointerEnter={() => setIsGroupTooltipOpen(false)}
                      sx={{
                        alignItems: 'center',
                        backgroundColor: RETICULUM_CALL_GREEN,
                        border: `3px solid ${theme.palette.background.surface}`,
                        borderRadius: '50%',
                        bottom: -5,
                        boxShadow: '0 2px 5px rgba(0,0,0,0.34)',
                        color: theme.palette.common.white,
                        display: 'flex',
                        height: 23,
                        justifyContent: 'center',
                        left: -4,
                        position: 'absolute',
                        transition:
                          'background-color 120ms ease, transform 120ms ease',
                        width: 23,
                        zIndex: 3,
                        '&:hover': {
                          backgroundColor: '#32d468',
                          transform: 'scale(1.08)',
                        },
                      }}
                    >
                      <PhoneIcon sx={{ fontSize: 14 }} />
                    </ButtonBase>
                  </Tooltip>
                )}
              </Box>
            </ContextMenu>

            <AvatarPreviewModal
              open={isPreviewOpen}
              src={previewSrc}
              alt={group?.groupName}
              onClose={handleClosePreview}
            />
          </ListItem>
        </Tooltip>
      );
    }

    return (
      <ListItem
        onClick={selectGroupHandler}
        sx={{
          borderRadius: '10px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          marginBottom: '6px',
          padding: '12px 14px',
          width: '100%',
          backgroundColor: isSelected
            ? theme.palette.action.selected
            : 'transparent',
          borderLeft: isSelected
            ? `3px solid ${theme.palette.primary.main}`
            : '3px solid transparent',
          transition: 'background-color 0.15s ease, border-color 0.15s ease',
          '&:hover': {
            backgroundColor: isSelected
              ? theme.palette.action.selected
              : theme.palette.action.hover,
          },
        }}
      >
        <ContextMenu getUserSettings={getUserSettings} groupId={group.groupId}>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: '20px',
              width: '100%',
            }}
          >
            <ListItemAvatar sx={{ minWidth: 44, marginRight: 0 }}>
              {ownerName ? (
                <Avatar
                  sx={{
                    height: 40,
                    width: 40,
                    ...getClickableAvatarSx(theme, isAvatarLoaded),
                  }}
                  alt={group?.groupName?.charAt(0)}
                  src={avatarUrl || undefined}
                  onClick={handleAvatarClick}
                  onMouseDown={(event) => {
                    if (isAvatarLoaded) {
                      stopEvent(event);
                    }
                  }}
                  onTouchStart={(event) => {
                    if (isAvatarLoaded) {
                      stopEvent(event);
                    }
                  }}
                  imgProps={{
                    onLoad: () => {
                      setLoadedAvatarUrl(avatarUrl);
                    },
                    onError: () => {
                      setLoadedAvatarUrl((currentUrl) =>
                        currentUrl === avatarUrl ? null : currentUrl
                      );
                    },
                  }}
                >
                  {group?.groupName?.charAt(0).toUpperCase()}
                </Avatar>
              ) : (
                <Avatar
                  alt={group?.groupName?.charAt(0)}
                  sx={{ height: 40, width: 40 }}
                >
                  {group?.groupName?.charAt(0).toUpperCase() || 'G'}
                </Avatar>
              )}
            </ListItemAvatar>

            <ListItemText
              primary={group.groupId === '0' ? 'General' : group.groupName}
              secondary={
                !group?.timestamp
                  ? t('core:message.generic.no_messages', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : t('group:last_message_date', {
                      date: formatEmailDate(group?.timestamp),
                    })
              }
              primaryTypographyProps={{
                sx: {
                  color: theme.palette.text.primary,
                  fontFamily: 'Inter',
                  fontSize: '15px',
                  fontWeight: 600,
                  lineHeight: 1.3,
                },
              }}
              secondaryTypographyProps={{
                sx: {
                  color:
                    theme.palette.mode === 'dark'
                      ? 'rgb(200, 200, 200)'
                      : theme.palette.text.secondary,
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

            {!reticulumChatEnabled &&
              announcement &&
              !announcement?.seentimestamp && (
                <CampaignIcon
                  sx={{
                    color: theme.palette.other.unread,
                    fontSize: '20px',
                    flexShrink: 0,
                  }}
                />
              )}

            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                flexShrink: 0,
                justifyContent: 'center',
                marginLeft: '4px',
              }}
            >
              {(groupHasUnreadConsideringMute(
                groupMuteSettings,
                group?.reticulumChatSummary,
                welcomeUnreadCount,
                globalNotifForm
              ) ||
                (!reticulumChatEnabled &&
                  group?.data &&
                  groupChatTimestamp &&
                  group?.sender !== myAddress &&
                  group?.timestamp &&
                  ((!timestampEnterData &&
                    Date.now() - group?.timestamp <
                      timeDifferenceForNotificationChats) ||
                    timestampEnterData < group?.timestamp))) && (
                <MarkChatUnreadIcon
                  sx={{
                    color: hasReticulumUnread
                      ? RETICULUM_NOTIFICATION_RED
                      : theme.palette.other.unread,
                    fontSize: '18px',
                  }}
                />
              )}

              {hasReticulumMention &&
                groupHasUnreadConsideringMute(
                  groupMuteSettings,
                  group?.reticulumChatSummary,
                  welcomeUnreadCount,
                  globalNotifForm
                ) && (
                  <AlternateEmailIcon
                    sx={{
                      color: RETICULUM_NOTIFICATION_RED,
                      fontSize: '18px',
                    }}
                  />
                )}

              {groupProperty?.isOpen === false && (
                <LockIcon
                  sx={{
                    color: theme.palette.other.positive,
                    fontSize: '18px',
                  }}
                />
              )}

              {showGroupCallIndicator && (
                <Box
                  sx={{
                    alignItems: 'center',
                    color: RETICULUM_CALL_GREEN,
                    display: 'flex',
                    gap: '3px',
                    flexShrink: 0,
                  }}
                  title={
                    imInThisGroupGcall
                      ? t('core:group_list_call_youre_in', {
                          postProcess: 'capitalizeFirstChar',
                        })
                      : t('core:group_list_call_active', {
                          postProcess: 'capitalizeFirstChar',
                        })
                  }
                >
                  <PhoneIcon
                    sx={{
                      color: 'inherit',
                      fontSize: '18px',
                      flexShrink: 0,
                    }}
                  />
                  {meshCallParticipantCount !== null && (
                    <Typography
                      component="span"
                      sx={{
                        color: 'inherit',
                        fontFamily: 'Inter',
                        fontSize: '11px',
                        fontWeight: 700,
                        lineHeight: 1,
                        minWidth: '7px',
                      }}
                    >
                      {meshCallParticipantCount}
                      {meshCallMaxParticipants !== null
                        ? `/${meshCallMaxParticipants}`
                        : ''}
                    </Typography>
                  )}
                </Box>
              )}
            </Box>
          </Box>
        </ContextMenu>

        <AvatarPreviewModal
          open={isPreviewOpen}
          src={previewSrc}
          alt={group?.groupName}
          onClose={handleClosePreview}
        />
      </ListItem>
    );
  }
);
