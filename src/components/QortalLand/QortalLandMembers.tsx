import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import Groups2RoundedIcon from '@mui/icons-material/Groups2Rounded';
import LocalFloristRoundedIcon from '@mui/icons-material/LocalFloristRounded';
import NightlifeRoundedIcon from '@mui/icons-material/NightlifeRounded';
import {
  Avatar,
  Box,
  Collapse,
  IconButton,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { useAtomValue } from 'jotai';
import { useEffect, useMemo, useState } from 'react';
import { getBaseApiReact } from '../../App';
import { reticulumChatTextScaleAtom } from '../../atoms/global';
import { useOnlineAddresses } from '../../hooks/usePresence';
import { PresenceStatusBadge } from '../common/PresenceStatusBadge';
import { getGroupMembers } from '../Group/groupApi';
import {
  QORTAL_LAND_PRESENCE_EVENT,
  getQortalLandPresence,
  type QortalLandPresenceMember,
  type QortalLandPresenceSnapshot,
} from './qortalLandPresence';
import { QortalLandAvailabilityTags } from './QortalLandAvailabilityTags';

type GroupMember = {
  member: string;
  primaryName?: string;
  name?: string;
};

type Props = {
  groupId: number;
  myAddress: string;
};

const shortAddress = (address: string): string =>
  address.length > 15
    ? `${address.slice(0, 7)}...${address.slice(-5)}`
    : address;

const displayName = (member: GroupMember): string =>
  member.primaryName?.trim() ||
  member.name?.trim() ||
  shortAddress(member.member);

const roomLabel = (roomId: string): 'lounge' | 'park' =>
  roomId === 'park' ? 'park' : 'lounge';

export function QortalLandMembers({ groupId, myAddress }: Props) {
  const theme = useTheme();
  const onlineAddresses = useOnlineAddresses();
  const textScale = useAtomValue(reticulumChatTextScaleAtom);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [landPresence, setLandPresence] = useState<QortalLandPresenceMember[]>(
    () => getQortalLandPresence(groupId)?.members ?? []
  );
  const [expanded, setExpanded] = useState({
    lounge: true,
    park: true,
    online: true,
  });

  useEffect(() => {
    let cancelled = false;
    void getGroupMembers(groupId)
      .then((result) => {
        if (!cancelled) setMembers(result?.members || []);
      })
      .catch((error) => {
        console.error('[QortalLand] Failed to load member list:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  useEffect(() => {
    setLandPresence(getQortalLandPresence(groupId)?.members ?? []);
    const onPresence = (event: Event) => {
      const snapshot = (event as CustomEvent<QortalLandPresenceSnapshot>)
        .detail;
      if (snapshot?.groupId !== groupId) return;
      setLandPresence(snapshot.members);
    };
    window.addEventListener(QORTAL_LAND_PRESENCE_EVENT, onPresence);
    return () =>
      window.removeEventListener(QORTAL_LAND_PRESENCE_EVENT, onPresence);
  }, [groupId]);

  const knownMembers = useMemo(() => {
    const byAddress = new Map(members.map((member) => [member.member, member]));
    if (myAddress && !byAddress.has(myAddress)) {
      byAddress.set(myAddress, { member: myAddress });
    }
    return byAddress;
  }, [members, myAddress]);

  const presenceBySession = useMemo(() => {
    const bySession = new Map<string, QortalLandPresenceMember>();
    for (const presence of landPresence) {
      if (!presence.sessionId) continue;
      const key = `${presence.address}:${presence.sessionId}`;
      const previous = bySession.get(key);
      if (!previous || presence.lastSeenAt > previous.lastSeenAt) {
        bySession.set(key, presence);
      }
    }
    return bySession;
  }, [landPresence]);

  const landAddresses = useMemo(
    () =>
      new Set(
        [...presenceBySession.values()].map((presence) => presence.address)
      ),
    [presenceBySession]
  );

  const sessionCountByAddress = useMemo(() => {
    const counts = new Map<string, number>();
    for (const presence of presenceBySession.values()) {
      counts.set(presence.address, (counts.get(presence.address) ?? 0) + 1);
    }
    return counts;
  }, [presenceBySession]);

  const sections = useMemo(() => {
    const lounge: Array<{
      member: GroupMember;
      presence: QortalLandPresenceMember;
    }> = [];
    const park: Array<{
      member: GroupMember;
      presence: QortalLandPresenceMember;
    }> = [];
    for (const presence of presenceBySession.values()) {
      const member = knownMembers.get(presence.address) || {
        member: presence.address,
      };
      (roomLabel(presence.roomId) === 'park' ? park : lounge).push({
        member,
        presence,
      });
    }
    const online = [...knownMembers.values()]
      .filter(
        (member) =>
          onlineAddresses.has(member.member) &&
          !landAddresses.has(member.member)
      )
      .map((member) => ({ member, presence: null }));
    const sortByPresenceThenName = (
      left: { member: GroupMember },
      right: { member: GroupMember }
    ) => {
      const leftIsPresent =
        landAddresses.has(left.member.member) ||
        onlineAddresses.has(left.member.member);
      const rightIsPresent =
        landAddresses.has(right.member.member) ||
        onlineAddresses.has(right.member.member);
      if (leftIsPresent !== rightIsPresent) return leftIsPresent ? -1 : 1;
      return displayName(left.member).localeCompare(
        displayName(right.member),
        undefined,
        {
          sensitivity: 'base',
        }
      );
    };
    lounge.sort(sortByPresenceThenName);
    park.sort(sortByPresenceThenName);
    online.sort(sortByPresenceThenName);
    return { lounge, park, online };
  }, [knownMembers, landAddresses, onlineAddresses, presenceBySession]);

  const rowFontSize =
    textScale === 'high' ? 15 : textScale === 'medium' ? 14 : 13;
  const sectionData = [
    { key: 'lounge' as const, label: 'Lounge', icon: <NightlifeRoundedIcon /> },
    { key: 'park' as const, label: 'Park', icon: <LocalFloristRoundedIcon /> },
    {
      key: 'online' as const,
      label: 'Group Online',
      icon: <Groups2RoundedIcon />,
    },
  ];

  return (
    <Box
      sx={{
        backgroundColor: 'background.surface',
        color: 'text.primary',
        height: '100%',
        overflowY: 'auto',
        px: 1.25,
        py: 1,
      }}
    >
      {sectionData.map(({ key, label, icon }) => {
        const rows = sections[key];
        return (
          <Box key={key} sx={{ mb: 0.75 }}>
            <Box
              onClick={() =>
                setExpanded((current) => ({ ...current, [key]: !current[key] }))
              }
              sx={{
                alignItems: 'center',
                borderRadius: '7px',
                cursor: 'pointer',
                display: 'flex',
                minHeight: 38,
                px: 0.75,
                '&:hover': {
                  backgroundColor: alpha(theme.palette.text.primary, 0.055),
                },
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  color: 'text.secondary',
                  display: 'flex',
                  mr: 0.75,
                  '& .MuiSvgIcon-root': { fontSize: 17 },
                }}
              >
                {icon}
              </Box>
              <Typography
                sx={{
                  flex: 1,
                  fontSize: 11,
                  fontWeight: 750,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                {label}
              </Typography>
              <Typography
                sx={{ color: 'text.secondary', fontSize: 11, mr: 0.25 }}
              >
                {rows.length}
              </Typography>
              <IconButton
                aria-label={`${expanded[key] ? 'Collapse' : 'Expand'} ${label}`}
                size="small"
                sx={{
                  color: 'text.secondary',
                  p: 0.25,
                  transform: expanded[key] ? 'rotate(0deg)' : 'rotate(-90deg)',
                  transition: 'transform 140ms ease',
                }}
              >
                <ExpandMoreRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
            <Collapse in={expanded[key]}>
              {rows.length === 0 ? (
                <Typography
                  sx={{
                    color: 'text.disabled',
                    fontSize: 12,
                    px: 1,
                    py: 0.8,
                  }}
                >
                  Nobody here
                </Typography>
              ) : (
                rows.map(({ member, presence }) => {
                  const name = displayName(member);
                  const sessionCount =
                    sessionCountByAddress.get(member.member) ?? 0;
                  return (
                    <Box
                      key={
                        presence
                          ? `${member.member}:${presence.sessionId}`
                          : member.member
                      }
                      sx={{
                        alignItems: 'center',
                        borderRadius: '7px',
                        display: 'flex',
                        gap: 1,
                        minHeight: 48,
                        px: 0.75,
                        '&:hover': {
                          backgroundColor: alpha(
                            theme.palette.text.primary,
                            0.045
                          ),
                        },
                      }}
                    >
                      <PresenceStatusBadge
                        online
                        status={presence?.afk ? 'idle' : 'online'}
                      >
                        <Avatar
                          alt={name}
                          src={
                            member.primaryName
                              ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${encodeURIComponent(member.primaryName)}/qortal_avatar?async=true`
                              : undefined
                          }
                          sx={{
                            bgcolor: alpha(theme.palette.primary.main, 0.18),
                            color: 'text.primary',
                            fontSize: 13,
                            height: 32,
                            width: 32,
                          }}
                        >
                          {name.slice(0, 1).toUpperCase()}
                        </Avatar>
                      </PresenceStatusBadge>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          noWrap
                          title={name}
                          sx={{ fontSize: rowFontSize, fontWeight: 650 }}
                        >
                          {name}
                        </Typography>
                        {presence && sessionCount > 1 && (
                          <Typography
                            noWrap
                            sx={{
                              color: 'text.secondary',
                              fontSize: 10.5,
                              lineHeight: 1.15,
                            }}
                          >
                            {sessionCount} active sessions
                          </Typography>
                        )}
                      </Box>
                      <QortalLandAvailabilityTags availability={presence} />
                    </Box>
                  );
                })
              )}
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );
}
