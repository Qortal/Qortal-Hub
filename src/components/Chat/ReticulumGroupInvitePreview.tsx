import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Skeleton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import { useAtomValue } from 'jotai';
import { QORTAL_APP_CONTEXT, getBaseApiReact } from '../../App';
import { getFee } from '../../background/background';
import { memberGroupsAtom } from '../../atoms/global';
import { getReticulumGroupMetadata } from '../Group/ReticulumGroupAbout';
import { getNameInfo } from '../Group/groupApi';
import { GroupScoreBadge } from '../Group/ReticulumGroupLevel';
import {
  getReticulumGroupScoreColor,
  useReticulumGroupScore,
} from '../Group/reticulumGroupScore';
import qortalOfficialLogo from '../../assets/sidebar/qortal-logo-official.webp';
import { parseQortalUseGroupLink } from '../../utils/qortalGroupLinks';
import { useTranslation } from 'react-i18next';

const inviteActionStorageKey = (groupId: string) =>
  `reticulum-group-invite-action:${groupId}`;

const readStoredInviteAction = (
  groupId: string
): 'idle' | 'joined' | 'pending' => {
  try {
    const stored = window.localStorage.getItem(inviteActionStorageKey(groupId));
    return stored === 'joined' || stored === 'pending' ? stored : 'idle';
  } catch {
    return 'idle';
  }
};

const persistInviteAction = (
  groupId: string,
  nextState: 'idle' | 'joined' | 'pending'
) => {
  try {
    if (nextState === 'idle') {
      window.localStorage.removeItem(inviteActionStorageKey(groupId));
    } else {
      window.localStorage.setItem(inviteActionStorageKey(groupId), nextState);
    }
  } catch {
    // Invite actions remain usable when persistent browser storage is unavailable.
  }
};

const textWithoutCodeBlocks = (source: string) => {
  if (!source) return '';
  if (typeof DOMParser === 'undefined') return source;
  const documentNode = new DOMParser().parseFromString(source, 'text/html');
  const walker = documentNode.createTreeWalker(
    documentNode.body,
    NodeFilter.SHOW_TEXT
  );
  const output: string[] = [];
  let node = walker.nextNode();
  while (node) {
    const element = node.parentElement;
    if (!element?.closest('code, pre')) output.push(node.textContent || '');
    node = walker.nextNode();
  }
  return output.join(' ');
};

export const parseReticulumGroupInviteLinks = (source: string) => {
  const text = textWithoutCodeBlocks(source);
  const candidates =
    text.match(/qortal:\/\/use-group\/action-join\/[^\s<>"']+/gi) || [];
  const seen = new Set<string>();
  return candidates
    .filter((link) => {
      const key = link.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((link) => {
      const parsed = parseQortalUseGroupLink(link);
      const groupId = parsed?.action === 'join' ? String(parsed.groupId) : null;
      return { link, groupId, validSyntax: Boolean(groupId) };
    });
};

function InvalidInvitePreview() {
  return (
    <Box
      sx={{
        alignItems: 'center',
        backgroundColor: 'rgba(255,83,100,0.045)',
        border: '1px solid rgba(255,83,100,0.36)',
        borderLeft: '3px solid #c9616c',
        borderRadius: '9px',
        display: 'flex',
        gap: 1,
        maxWidth: 'min(420px, 100%)',
        mt: 1,
        p: 1.25,
      }}
    >
      <ErrorOutlineRoundedIcon sx={{ color: '#d97a83', fontSize: 20 }} />
      <Box>
        <Typography
          sx={{
            color: 'text.secondary',
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.1em',
          }}
        >
          INVALID GROUP INVITATION
        </Typography>
        <Typography sx={{ fontSize: 13, mt: 0.2 }}>
          Ruh-roh, looks like your invite link is not right.
        </Typography>
      </Box>
    </Box>
  );
}

function InviteCard({ groupId }: { groupId: string }) {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group', 'reticulum']);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const memberGroups = useAtomValue(memberGroupsAtom);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'error'>(
    'loading'
  );
  const [group, setGroup] = useState<any>(null);
  const [ownerName, setOwnerName] = useState('');
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [actionState, setActionState] = useState<'idle' | 'joined' | 'pending'>(
    () => readStoredInviteAction(groupId)
  );
  const descriptionRef = useRef<HTMLParagraphElement | null>(null);
  const [descriptionOverflowing, setDescriptionOverflowing] = useState(false);

  const load = useCallback(
    async (force = false) => {
      setState('loading');
      const next = await getReticulumGroupMetadata(groupId, force);
      if (next?.__reticulumGroupMissing) {
        setState('invalid');
        return;
      }
      if (next?.__reticulumGroupLoadError && !next?.groupName) {
        setState('error');
        return;
      }
      setGroup(next);
      setState('ready');
      const resolvedOwner =
        next?.ownerPrimaryName ||
        (next?.owner ? await getNameInfo(next.owner).catch(() => '') : '');
      setOwnerName(resolvedOwner || '');
    },
    [groupId]
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const element = descriptionRef.current;
    if (!element) return;
    const measure = () => {
      const nextOverflowing = element.scrollHeight > element.clientHeight + 1;
      setDescriptionOverflowing((current) =>
        current === nextOverflowing ? current : nextOverflowing
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [group?.description, group?.groupDescription]);

  const isMember = useMemo(
    () =>
      (memberGroups || []).some(
        (entry: any) => String(entry?.groupId) === String(groupId)
      ),
    [groupId, memberGroups]
  );
  const isOpen =
    group?.isOpen === true ||
    group?.groupType === 0 ||
    group?.groupType === 'OPEN';
  const description = group?.description ?? group?.groupDescription ?? '';
  const memberCount = Number(group?.memberCount) || 0;
  const groupScore = useReticulumGroupScore(groupId);
  const groupScoreColor = groupScore
    ? getReticulumGroupScoreColor(groupScore.score)
    : 'rgba(151,161,178,0.38)';
  const avatarUrl = ownerName
    ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${ownerName}/qortal_group_avatar_${groupId}?async=true`
    : undefined;

  const updateActionState = useCallback(
    (nextState: 'idle' | 'joined' | 'pending') => {
      persistInviteAction(groupId, nextState);
      setActionState(nextState);
    },
    [groupId]
  );

  useEffect(() => {
    if (isMember && actionState !== 'joined') {
      updateActionState('joined');
    }
  }, [actionState, isMember, updateActionState]);

  const join = useCallback(async () => {
    if (!group || isJoining || isMember || actionState !== 'idle') return;
    try {
      setIsJoining(true);
      const fee = await getFee('JOIN_GROUP');
      await show({
        message: isOpen
          ? t('reticulum:join_group_question', {
              postProcess: 'capitalizeFirstChar',
            })
          : t('reticulum:invite.apply_question', {
              postProcess: 'capitalizeFirstChar',
            }),
        publishFee: `${fee.fee} QORT`,
      });
      const response = await window.sendMessage('joinGroup', {
        groupId: Number(groupId),
      });
      if (response?.error) throw new Error(response.error);
      updateActionState(isOpen ? 'joined' : 'pending');
    } catch (error) {
      console.error('Unable to join group from invite preview', error);
    } finally {
      setIsJoining(false);
    }
  }, [
    actionState,
    group,
    groupId,
    isJoining,
    isMember,
    isOpen,
    show,
    updateActionState,
  ]);

  if (state === 'invalid') return <InvalidInvitePreview />;
  if (state === 'error') {
    return (
      <Box sx={{ color: 'text.secondary', fontSize: 12, mt: 1 }}>
        Unable to load group invitation.{' '}
        <Button onClick={() => void load(true)} size="small">
          Retry
        </Button>
      </Box>
    );
  }
  if (state === 'loading' || !group) {
    return (
      <Box
        sx={{
          border: '1px solid rgba(255,255,255,0.09)',
          borderLeft: '3px solid #2563eb',
          borderRadius: '8px',
          boxSizing: 'border-box',
          display: 'grid',
          gap: 0.75,
          minHeight: 192,
          mt: 1,
          p: 1.15,
          width: 'min(510px, 100%)',
        }}
      >
        <Skeleton height={10} width="32%" />
        <Box sx={{ display: 'flex', gap: 2.1 }}>
          <Skeleton height={77} variant="rounded" width={77} />
          <Box sx={{ flex: 1 }}>
            <Skeleton height={21} width="52%" />
            <Skeleton height={33} width="86%" />
          </Box>
        </Box>
      </Box>
    );
  }

  const actionLabel =
    isMember || actionState === 'joined'
      ? t('reticulum:invite.joined', {
          postProcess: 'capitalizeFirstChar',
        })
      : actionState === 'pending'
        ? t('reticulum:invite.pending', {
            postProcess: 'capitalizeFirstChar',
          })
        : isOpen
          ? t('group:action.join_group', {
              postProcess: 'capitalizeFirstChar',
            })
          : t('reticulum:invite.apply', {
              postProcess: 'capitalizeFirstChar',
            });
  const actionDisabled = isMember || actionState !== 'idle' || isJoining;
  return (
    <Box
      sx={{
        backgroundColor: 'background.paper',
        backgroundImage:
          theme.palette.mode === 'dark'
            ? 'linear-gradient(180deg, rgba(17,20,25,0.76) 0%, rgba(13,16,20,0.76) 100%)'
            : 'none',
        border: '1px solid',
        borderColor: 'divider',
        borderLeft: isOpen
          ? `3px solid ${groupScoreColor}`
          : `1px solid ${theme.palette.divider}`,
        borderRadius: '8px',
        boxShadow: '0 6px 15px rgba(0,0,0,0.18)',
        boxSizing: 'border-box',
        minHeight: 192,
        mt: 1,
        overflow: 'hidden',
        width: 'min(510px, 100%)',
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          borderBottom: '1px solid',
          borderColor: 'divider',
          color: 'text.secondary',
          display: 'flex',
          fontSize: 12,
          fontWeight: 700,
          height: 45,
          letterSpacing: '0.1em',
          px: 2.25,
        }}
      >
        <Typography
          sx={{
            color: 'inherit',
            fontSize: 'inherit',
            fontWeight: 'inherit',
            letterSpacing: 'inherit',
          }}
        >
          GROUP INVITATION
        </Typography>
      </Box>
      <Box
        sx={{
          alignItems: 'center',
          boxSizing: 'border-box',
          display: 'flex',
          height: 147,
          px: 2.25,
          py: 1.6,
        }}
      >
        <Box
          sx={{
            alignItems: 'flex-start',
            display: 'flex',
            gap: 2.1,
            width: '100%',
          }}
        >
          <Avatar
            alt={group.groupName}
            imgProps={{
              onError: () => setAvatarLoaded(false),
              onLoad: () => setAvatarLoaded(true),
            }}
            src={avatarUrl}
            sx={{
              backgroundColor: 'action.hover',
              border: 0,
              borderRadius: '19px',
              flexShrink: 0,
              fontSize: 23,
              fontWeight: 800,
              height: 77,
              width: 77,
            }}
          >
            {!avatarLoaded ? (
              <Box
                alt=""
                aria-hidden
                component="img"
                src={qortalOfficialLogo}
                sx={{
                  height: '42%',
                  objectFit: 'contain',
                  opacity: theme.palette.mode === 'dark' ? 0.28 : 0.5,
                  width: '42%',
                }}
              />
            ) : null}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: 0.65,
                minWidth: 0,
              }}
            >
              <Typography
                sx={{
                  fontSize: 18,
                  fontWeight: 650,
                  lineHeight: 1.2,
                  minWidth: 0,
                }}
                noWrap
              >
                {group.groupName}
              </Typography>
              {isOpen ? (
                <PublicRoundedIcon
                  aria-label={t('reticulum:invite.open_group', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  sx={{ color: 'text.secondary', flexShrink: 0, fontSize: 16 }}
                />
              ) : (
                <LockRoundedIcon
                  aria-label={t('reticulum:invite.closed_group', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  sx={{ color: 'text.secondary', flexShrink: 0, fontSize: 16 }}
                />
              )}
            </Box>
            {description && (
              <Tooltip
                arrow
                disableHoverListener={!descriptionOverflowing}
                title={
                  <Box
                    sx={{
                      maxHeight: 180,
                      maxWidth: 360,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {description}
                  </Box>
                }
              >
                <Typography
                  ref={descriptionRef}
                  tabIndex={descriptionOverflowing ? 0 : -1}
                  sx={{
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                    color: 'text.secondary',
                    display: '-webkit-box',
                    fontSize: 12,
                    letterSpacing: '0.01em',
                    lineHeight: 1.45,
                    mt: 0.45,
                    overflow: 'hidden',
                  }}
                >
                  {description}
                </Typography>
              </Tooltip>
            )}
            <Box sx={{ mt: 0.8 }}>
              <GroupScoreBadge score={groupScore} size="compact" />
            </Box>
            <Box
              sx={{
                alignItems: 'center',
                color: 'text.secondary',
                display: 'flex',
                gap: 0.5,
                mt: 0.85,
              }}
            >
              <GroupsRoundedIcon sx={{ fontSize: 14 }} />
              <Typography sx={{ fontSize: 12.5 }}>
                {memberCount} {memberCount === 1 ? 'member' : 'members'}
              </Typography>
            </Box>
          </Box>
          <Button
            disabled={actionDisabled}
            onClick={() => void join()}
            variant="contained"
            sx={{
              alignSelf: 'flex-start',
              borderRadius: '6px',
              flexShrink: 0,
              fontSize: 12,
              fontWeight: 600,
              minHeight: 38,
              minWidth: 88,
              mt: 2.65,
              textTransform: 'none',
            }}
          >
            {isJoining ? (
              <CircularProgress size={17} sx={{ color: 'inherit' }} />
            ) : (
              actionLabel
            )}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

export function ReticulumGroupInvitePreviews({ source }: { source: string }) {
  const invites = useMemo(
    () => parseReticulumGroupInviteLinks(source),
    [source]
  );
  if (invites.length === 0) return null;
  return (
    <>
      {invites.map((invite) =>
        invite.validSyntax && invite.groupId ? (
          <InviteCard groupId={invite.groupId} key={invite.link} />
        ) : (
          <InvalidInvitePreview key={invite.link} />
        )
      )}
    </>
  );
}
