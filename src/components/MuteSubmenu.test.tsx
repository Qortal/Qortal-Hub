import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createStore, Provider } from 'jotai';
import { MuteSubmenu } from './MuteSubmenu';
import {
  notificationSettingsCacheAtom,
  muteExpiryTickAtom,
} from '../atoms/global';
import type { GroupNotificationStore } from '../utils/qChatNotificationSettings';

vi.mock('react-contexify', () => ({
  Item: ({ children, onClick }: any) => (
    <div data-testid="contexify-item" onClick={onClick}>
      {children}
    </div>
  ),
  Submenu: ({ children, label }: any) => (
    <div data-testid="contexify-submenu">
      <div data-testid="contexify-submenu-label">{label}</div>
      {children}
    </div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function renderWithMuteState(
  cache: Record<string, GroupNotificationStore>,
  scope: { groupId: string | number; sectionId?: string; channelId?: string },
  scopeType: 'Group' | 'Section' | 'Channel',
  channelIds?: string[]
) {
  const store = createStore();
  store.set(notificationSettingsCacheAtom, cache);
  store.set(muteExpiryTickAtom, 0);

  return render(
    <Provider store={store}>
      <MuteSubmenu
        scope={scope}
        scopeType={scopeType}
        channelIds={channelIds}
      />
    </Provider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MuteSubmenu', () => {
  it('renders submenu with duration options when not muted', () => {
    renderWithMuteState({}, { groupId: 123 }, 'Group');

    expect(screen.getByTestId('contexify-submenu')).toBeInTheDocument();
    expect(
      screen.getByText('group:context_menu.mute_group')
    ).toBeInTheDocument();
  });

  it('keeps the durations in the group menu even when the only stored override is a mute', () => {
    // Group scope has no channel list, so it cannot know whether every channel
    // is muted: `pruneChannelOverride` drops `mutedUntil: 0`, so an unmuted
    // channel leaves no entry at all. Collapsing to a bare "Unmute" here would
    // turn one muted channel out of five into a menu with no way to mute the
    // rest, which is the bug this guards.
    renderWithMuteState(
      {
        '123': {
          channels: { general: { mutedUntil: null } },
        },
      },
      { groupId: 123 },
      'Group'
    );

    expect(screen.getByTestId('contexify-submenu')).toBeInTheDocument();
    expect(screen.getByText('group:context_menu.unmute')).toBeInTheDocument();
  });

  it('renders unmute item when channel is muted', () => {
    renderWithMuteState(
      {
        '123': {
          channels: { 'ch-1': { mutedUntil: null } },
        },
      },
      { groupId: 123, sectionId: 'sec-1', channelId: 'ch-1' },
      'Channel'
    );

    expect(screen.queryByTestId('contexify-submenu')).not.toBeInTheDocument();
    expect(screen.getByText('group:context_menu.unmute')).toBeInTheDocument();
  });

  it('reads section mute state from the section channels, not the whole group', () => {
    // Only the *other* section's channel is muted. Section A is not muted, so
    // its menu must offer to mute it - previously it read every override in the
    // group, saw "all muted", and offered only "Unmute", which did nothing for A.
    renderWithMuteState(
      {
        '123': {
          channels: { 'ch-b': { mutedUntil: null } },
        },
      },
      { groupId: 123, sectionId: 'sec-a' },
      'Section',
      ['ch-a1', 'ch-a2']
    );

    expect(screen.getByTestId('contexify-submenu')).toBeInTheDocument();
    expect(
      screen.getByText('group:context_menu.mute_section')
    ).toBeInTheDocument();
  });

  it('offers unmute when every channel in the section is muted', () => {
    renderWithMuteState(
      {
        '123': {
          channels: {
            'ch-a1': { mutedUntil: null },
            'ch-a2': { mutedUntil: null },
          },
        },
      },
      { groupId: 123, sectionId: 'sec-a' },
      'Section',
      ['ch-a1', 'ch-a2']
    );

    expect(screen.queryByTestId('contexify-submenu')).not.toBeInTheDocument();
    expect(screen.getByText('group:context_menu.unmute')).toBeInTheDocument();
  });

  it('treats a partially muted section as not muted', () => {
    renderWithMuteState(
      {
        '123': {
          channels: { 'ch-a1': { mutedUntil: null } },
        },
      },
      { groupId: 123, sectionId: 'sec-a' },
      'Section',
      ['ch-a1', 'ch-a2']
    );

    // One muted channel does not make the section muted, because muting the
    // section writes the same value to both.
    expect(screen.getByTestId('contexify-submenu')).toBeInTheDocument();
  });

  it('renders submenu when group mute has expired', () => {
    renderWithMuteState(
      {
        '123': {
          channels: { general: { mutedUntil: Date.now() - 60_000 } },
        },
      },
      { groupId: 123 },
      'Group'
    );

    expect(screen.getByTestId('contexify-submenu')).toBeInTheDocument();
    expect(
      screen.getByText('group:context_menu.mute_group')
    ).toBeInTheDocument();
  });

  it('offers unmute alongside durations when only some channels are muted', () => {
    // Regression: group scope has no channelIds, so `ids` is only the channels
    // carrying an override. One timed mute in a multi-channel group made
    // allMuted true and collapsed the menu to a bare "Unmute", which cleared
    // every override and dropped the mute the user had just set.
    renderWithMuteState(
      {
        '123': {
          channels: {
            announcements: { mutedUntil: Date.now() + 15 * 60_000 },
            general: { mutedUntil: 0 },
          },
        },
      },
      { groupId: 123 },
      'Group'
    );

    // The duration submenu is still offered.
    expect(screen.getByTestId('contexify-submenu')).toBeInTheDocument();
    // And there is a way back out of the partial mute.
    expect(
      screen.getByText('group:context_menu.unmute')
    ).toBeInTheDocument();
  });

  it('collapses to a bare unmute item only for a section, which knows its channels', () => {
    // A section names its channels, so "every one of them is muted" is a fact
    // it can rely on and the single Unmute is the right menu. Group scope cannot
    // make that claim — see the group test above — so it never collapses.
    renderWithMuteState(
      {
        '123': {
          channels: {
            announcements: { mutedUntil: null },
            general: { mutedUntil: null },
          },
        },
      },
      { groupId: 123, sectionId: 'sec-1' },
      'Section',
      ['announcements', 'general']
    );

    expect(
      screen.queryByTestId('contexify-submenu')
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('group:context_menu.unmute')
    ).toBeInTheDocument();
  });
});
