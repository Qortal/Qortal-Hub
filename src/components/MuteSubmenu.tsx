import { Item, Submenu, contextMenu } from 'react-contexify';
import { Box, Typography } from '@mui/material';
import NotificationsOffIcon from '@mui/icons-material/NotificationsOff';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useTranslation } from 'react-i18next';
import { useAtomValue } from 'jotai';
import { notificationSettingsCacheAtom } from '../atoms/global';
import {
  type ScopeDescriptor,
  type GroupNotificationStore,
  setScopeMuted,
  unmuteScope,
} from '../utils/qChatNotificationSettings';

export type MuteScopeType = 'Group' | 'Section' | 'Channel';

export interface MuteSubmenuProps {
  scope: ScopeDescriptor;
  scopeType: MuteScopeType;
  /**
   * Channels the scope contains, when the caller knows them.
   *
   * A section mute is stored by writing to each of its channels, so the section's
   * displayed state has to be read back from those same channels. Without this
   * the menu looked at every override in the group, which meant a section whose
   * only muted channel was in a different section offered "Unmute" and could not
   * be muted from its own menu.
   */
  channelIds?: readonly string[];
}

const DURATIONS = [
  { key: 'mute.for_15_minutes', ms: 15 * 60 * 1000 },
  { key: 'mute.for_1_hour', ms: 60 * 60 * 1000 },
  { key: 'mute.for_3_hours', ms: 3 * 60 * 60 * 1000 },
  { key: 'mute.for_8_hours', ms: 8 * 60 * 60 * 1000 },
  { key: 'mute.for_24_hours', ms: 24 * 60 * 60 * 1000 },
  { key: 'mute.until_i_turn_it_back_on', ms: null as number | null },
];

function activeMutedUntil(v: number | null | undefined): boolean {
  return v === null || (v !== undefined && v > Date.now());
}

/**
 * Collect the mute state of the channels a scope covers.
 *
 * A section mute is stored by writing the same `mutedUntil` to each of the
 * section's channels, so reading it back has to look at exactly those channels.
 * `channelIds` is how the caller says which ones; without it a section fell back
 * to every override in the group, so a section whose only muted channel was
 * elsewhere offered "Unmute" and had no way to mute itself.
 */
function collectScopeMuteState(
  groupStore: GroupNotificationStore | undefined,
  channelIds: readonly string[] | undefined,
  channelId?: string
): {
  allMuted: boolean;
  anyMuted: boolean;
  sharedUntil: number | null | undefined;
} {
  if (!groupStore)
    return { allMuted: false, anyMuted: false, sharedUntil: undefined };

  if (channelId != null) {
    const v = groupStore.channels?.[String(channelId)]?.mutedUntil;
    const muted = activeMutedUntil(v);
    return { allMuted: muted, anyMuted: muted, sharedUntil: v };
  }

  // Group scope: every stored override is in scope by definition. Section scope
  // passes its channels explicitly.
  const ids = channelIds ?? Object.keys(groupStore.channels ?? {});
  if (ids.length === 0)
    return { allMuted: false, anyMuted: false, sharedUntil: undefined };

  const vals = ids.map((id) => groupStore.channels?.[id]?.mutedUntil);
  // A channel with no override inherits "not muted" version of the default.
  const allMuted = vals.every((v) => activeMutedUntil(v));
  // Partial state must not be reported as fully muted. Group scope has no
  // channelIds, so `ids` is only the channels carrying an override: one timed
  // mute in a five-channel group made `allMuted` true and collapsed the menu to
  // a bare "Unmute", which then cleared every override and dropped the mute the
  // user had just set. "Some are muted" needs its own branch that offers both.
  const anyMuted = vals.some((v) => activeMutedUntil(v));
  const first = vals[0];
  const sharedUntil = vals.every((v) => v === first) ? first : undefined;
  return { allMuted, anyMuted, sharedUntil };
}

export function MuteSubmenu({
  scope,
  scopeType,
  channelIds,
}: MuteSubmenuProps) {
  const { t } = useTranslation(['group']);
  const cache = useAtomValue(notificationSettingsCacheAtom);

  const groupSettings = cache[String(scope.groupId)];

  const { allMuted, anyMuted, sharedUntil } = collectScopeMuteState(
    groupSettings,
    channelIds,
    scope.channelId
  );

  const mutedHoursLeft =
    sharedUntil != null && sharedUntil > 0
      ? Math.max(0, (sharedUntil - Date.now()) / (1000 * 60 * 60))
      : null;

  function formatHours(h: number): string {
    const rounded = Math.round(h * 100) / 100;
    if (Number.isInteger(rounded)) return String(rounded);
    return String(parseFloat(rounded.toFixed(2)));
  }

  const mutedForLabel =
    mutedHoursLeft != null
      ? (() => {
          const rounded = Math.round(mutedHoursLeft * 100) / 100;
          return `${formatHours(mutedHoursLeft)} ${rounded === 1 ? 'hour' : 'hours'}`;
        })()
      : null;

  const labelKey = `group:context_menu.mute_${scopeType.toLowerCase()}`;
  const showTimer = mutedForLabel != null && scopeType === 'Channel';

  if (allMuted) {
    return (
      <Item
        onClick={() => {
          void unmuteScope(scope).catch(console.error);
          contextMenu.hideAll();
        }}
      >
        <Box sx={{ alignItems: 'flex-start', display: 'flex', gap: 1.5 }}>
          <NotificationsOffIcon sx={{ fontSize: 18, mt: 0.25 }} />
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography
              component="span"
              sx={{ fontSize: '14px', fontWeight: 600 }}
            >
              {t('group:context_menu.unmute')}
            </Typography>
            {showTimer && (
              <Typography
                component="span"
                sx={{ color: 'text.secondary', fontSize: '12px' }}
              >
                {t('group:context_menu.muted_for', {
                  hours: mutedForLabel,
                })}
              </Typography>
            )}
          </Box>
        </Box>
      </Item>
    );
  }

  return (
    <Submenu
      label={
        <Box sx={{ alignItems: 'center', display: 'flex', gap: 1.5 }}>
          <NotificationsOffIcon sx={{ fontSize: 18 }} />
          <Typography
            component="span"
            sx={{ fontSize: '14px', fontWeight: 600 }}
          >
            {t(labelKey)}
          </Typography>
        </Box>
      }
      arrow={<ChevronRightRoundedIcon sx={{ fontSize: 20 }} />}
    >
      {/* Partial mute: some channels in scope are muted and some are not.
          Offer Unmute as well as the durations, or the only way back out is to
          mute everything first. */}
      {anyMuted && (
        <Item
          onClick={() => {
            void unmuteScope(scope).catch(console.error);
            contextMenu.hideAll();
          }}
        >
          <Typography
            component="span"
            sx={{ fontSize: '14px', fontWeight: 600 }}
          >
            {t('group:context_menu.unmute')}
          </Typography>
        </Item>
      )}
      {DURATIONS.map(({ key, ms }) => (
        <Item
          key={key}
          onClick={() => {
            const until = ms === null ? null : Date.now() + ms;
            void setScopeMuted(scope, until).catch(console.error);
            contextMenu.hideAll();
          }}
        >
          <Typography
            component="span"
            sx={{ fontSize: '14px', fontWeight: 600 }}
          >
            {t(`group:${key}`)}
          </Typography>
        </Item>
      ))}
    </Submenu>
  );
}
