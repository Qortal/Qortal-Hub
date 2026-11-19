import { useState, useEffect } from 'react';
import { useAtomValue } from 'jotai';
import { Item, Separator, Submenu } from 'react-contexify';
import { Box, Checkbox, Radio, Typography } from '@mui/material';
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useTranslation } from 'react-i18next';
import {
  type EffectiveNotificationSettings,
  type PushLevel,
  type ScopeDescriptor,
  getEffectiveNotificationSettings,
  getGroupNotificationStore,
  getScopeChannelIds,
  resolveScopedNotificationSettings,
  setScopeNotificationSettings,
  DEFAULT_NOTIFICATION_SETTINGS,
} from '../utils/qChatNotificationSettings';
import { globalNotificationFormAtom } from '../atoms/global';

export interface NotificationSettingsSubmenuProps {
  scope: ScopeDescriptor;
  /**
   * Channels the scope contains, when the caller knows them.
   *
   * A group or section menu has no override of its own, so its displayed state
   * has to be derived from its channels. Without this the menu resolved global
   * defaults and showed "Mentions" even when every channel was set to "None".
   */
  channelIds?: readonly string[];
}

export function NotificationSettingsSubmenu({
  scope,
  channelIds,
}: NotificationSettingsSubmenuProps) {
  const [settings, setSettings] = useState<EffectiveNotificationSettings>(
    DEFAULT_NOTIFICATION_SETTINGS
  );
  // Fields the channels in scope disagree on. Each shows no selection rather
  // than picking one and looking right when it is wrong.
  const [mixedFields, setMixedFields] = useState<
    Array<keyof EffectiveNotificationSettings>
  >([]);
  const globalNotifForm = useAtomValue(globalNotificationFormAtom);
  const { t } = useTranslation(['group']);

  useEffect(() => {
    let cancelled = false;
    // A channel menu has a single target and needs no scope resolution.
    if (scope.channelId == null) {
      const resolveScope = async () => {
        // Callers that already know the channels pass them; the group menu does
        // not, so ask. A null result means the lookup failed, in which case the
        // previous state is better than a guess.
        const ids =
          channelIds ??
          (await getScopeChannelIds(scope.groupId, scope.sectionId));
        if (cancelled || ids == null) return;
        const store = await getGroupNotificationStore(scope.groupId);
        if (cancelled) return;
        const resolved = resolveScopedNotificationSettings(
          store,
          ids,
          globalNotifForm
        );
        setSettings(resolved.settings);
        setMixedFields(resolved.mixedFields);
      };
      void resolveScope().catch(() => {
        // Leaving the previous state is better than claiming the wrong one.
      });
      return () => {
        cancelled = true;
      };
    }
    setMixedFields([]);
    void getEffectiveNotificationSettings(
      scope.groupId,
      scope.sectionId,
      scope.channelId,
      globalNotifForm
    ).then((result) => {
      if (!cancelled) setSettings(result);
    });
    return () => {
      cancelled = true;
    };
  }, [
    scope.groupId,
    scope.sectionId,
    scope.channelId,
    globalNotifForm,
    channelIds,
  ]);

  const updateSettings = (partial: Partial<EffectiveNotificationSettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    // A bulk write makes the scope uniform again, so the mixed markers no longer
    // apply.
    setMixedFields([]);
    void setScopeNotificationSettings(scope, partial).catch(() => {
      setSettings(settings);
    });
  };

  // With mixed channel states no single radio is the saved answer, so none is
  // shown. Picking one writes it to every channel in scope.
  const checkedLevel = (level: PushLevel) =>
    !mixedFields.includes('pushLevel') && settings.pushLevel === level;

  return (
    <Submenu
      label={
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.5 }}>
          <NotificationsRoundedIcon sx={{ fontSize: 18 }} />
          <Typography
            component="span"
            sx={{ fontSize: '14px', fontWeight: 600 }}
          >
            {t('group:context_menu.notification_settings')}
          </Typography>
        </Box>
      }
      arrow={<ChevronRightRoundedIcon sx={{ fontSize: 20 }} />}
    >
      <Item
        closeOnClick={false}
        onClick={() => updateSettings({ pushLevel: 'all' })}
      >
        <Radio
          size="small"
          checked={checkedLevel('all')}
          sx={{
            mr: 1.5,
            pointerEvents: 'none',
            padding: 0,
            '& .MuiSvgIcon-root': { fontSize: 18 },
          }}
        />
        <Typography component="span" sx={{ fontSize: '14px', fontWeight: 600 }}>
          {t('group:notification_settings.all_messages')}
        </Typography>
      </Item>
      <Item
        closeOnClick={false}
        onClick={() => updateSettings({ pushLevel: 'mentions' })}
      >
        <Radio
          size="small"
          checked={checkedLevel('mentions')}
          sx={{
            mr: 1.5,
            pointerEvents: 'none',
            padding: 0,
            '& .MuiSvgIcon-root': { fontSize: 18 },
          }}
        />
        <Typography component="span" sx={{ fontSize: '14px', fontWeight: 600 }}>
          {t('group:notification_settings.only_mentions')}
        </Typography>
      </Item>
      <Item
        closeOnClick={false}
        onClick={() => updateSettings({ pushLevel: 'none' })}
      >
        <Radio
          size="small"
          checked={checkedLevel('none')}
          sx={{
            mr: 1.5,
            pointerEvents: 'none',
            padding: 0,
            '& .MuiSvgIcon-root': { fontSize: 18 },
          }}
        />
        <Typography component="span" sx={{ fontSize: '14px', fontWeight: 600 }}>
          {t('group:notification_settings.none')}
        </Typography>
      </Item>
      <Separator />
      <Item
        closeOnClick={false}
        onClick={() => {
          if (settings.pushLevel === 'all') return;
          updateSettings({
            suppressEveryoneHere: !settings.suppressEveryoneHere,
          });
        }}
      >
        <Checkbox
          size="small"
          checked={settings.suppressEveryoneHere}
          indeterminate={mixedFields.includes('suppressEveryoneHere')}
          disabled={settings.pushLevel === 'all'}
          sx={{
            mr: 1.5,
            pointerEvents: 'none',
            padding: 0,
            '& .MuiSvgIcon-root': { fontSize: 18 },
          }}
        />
        <Typography
          component="span"
          sx={{
            fontSize: '14px',
            fontWeight: 600,
            opacity: settings.pushLevel === 'all' ? 0.4 : 1,
          }}
        >
          {t('group:notification_settings.suppress_everyone_here')}
        </Typography>
      </Item>
      <Item
        closeOnClick={false}
        onClick={() => {
          if (settings.pushLevel === 'all') return;
          updateSettings({ notifyOnReplies: !settings.notifyOnReplies });
        }}
      >
        <Checkbox
          size="small"
          checked={settings.notifyOnReplies}
          indeterminate={mixedFields.includes('notifyOnReplies')}
          disabled={settings.pushLevel === 'all'}
          sx={{
            mr: 1.5,
            pointerEvents: 'none',
            padding: 0,
            '& .MuiSvgIcon-root': { fontSize: 18 },
          }}
        />
        <Typography
          component="span"
          sx={{
            fontSize: '14px',
            fontWeight: 600,
            opacity: settings.pushLevel === 'all' ? 0.4 : 1,
          }}
        >
          {t('group:notification_settings.notify_on_replies')}
        </Typography>
      </Item>
      <Item
        closeOnClick={false}
        onClick={() => {
          if (settings.pushLevel === 'all') return;
          updateSettings({ notifyOnReactions: !settings.notifyOnReactions });
        }}
      >
        <Checkbox
          size="small"
          checked={settings.notifyOnReactions}
          indeterminate={mixedFields.includes('notifyOnReactions')}
          disabled={settings.pushLevel === 'all'}
          sx={{
            mr: 1.5,
            pointerEvents: 'none',
            padding: 0,
            '& .MuiSvgIcon-root': { fontSize: 18 },
          }}
        />
        <Typography
          component="span"
          sx={{
            fontSize: '14px',
            fontWeight: 600,
            opacity: settings.pushLevel === 'all' ? 0.4 : 1,
          }}
        >
          {t('group:notification_settings.notify_on_reactions')}
        </Typography>
      </Item>
      {scope.sectionId == null && scope.channelId == null && (
        <Item
          closeOnClick={false}
          onClick={() => {
            if (settings.pushLevel === 'all') return;
            updateSettings({
              notifyOnWelcomePosts: !settings.notifyOnWelcomePosts,
            });
          }}
        >
          <Checkbox
            size="small"
            checked={settings.notifyOnWelcomePosts}
            disabled={settings.pushLevel === 'all'}
            sx={{
              mr: 1.5,
              pointerEvents: 'none',
              padding: 0,
              '& .MuiSvgIcon-root': { fontSize: 18 },
            }}
          />
          <Typography
            component="span"
            sx={{
              fontSize: '14px',
              fontWeight: 600,
              opacity: settings.pushLevel === 'all' ? 0.4 : 1,
            }}
          >
            {t('group:notification_settings.notify_on_welcome_posts')}
          </Typography>
        </Item>
      )}
    </Submenu>
  );
}
