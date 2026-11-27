import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Avatar,
  Box,
  Button,
  Dialog,
  DialogContent,
  Skeleton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import PublicRoundedIcon from '@mui/icons-material/PublicRounded';
import { getBaseApiReact } from '../../App';
import { userInfoAtom } from '../../atoms/global';
import { QORTAL_PROTOCOL } from '../../constants/constants';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { WrapperUserAction } from '../WrapperUserAction';
import { getNameInfo } from './groupApi';
import { GroupScoreBadge } from './ReticulumGroupLevel';
import {
  getCommunityLevel,
  getLegacyLevel,
  useReticulumGroupScore,
} from './reticulumGroupScore';
import qortalWhiteLogo from '../../assets/sidebar/qortal-logo-white.png';

const GROUP_META_TTL = 5 * 60 * 1000;
const metadataCache = new Map<string, { data: any; fetchedAt: number }>();
const inflightMetadata = new Map<string, Promise<any>>();

export { getCommunityLevel, getLegacyLevel };

const getMetadata = async (group: any, force = false) => {
  const id = String(group?.groupId ?? '');
  if (!id) return group;
  const cached = metadataCache.get(id);
  if (!force && cached && Date.now() - cached.fetchedAt < GROUP_META_TTL) {
    return { ...group, ...cached.data };
  }
  if (!force && inflightMetadata.has(id)) return inflightMetadata.get(id);
  const request = fetch(`${getBaseApiReact()}/groups/${id}`)
    .then(async (response) => {
      if (response.status === 404) throw new Error('GROUP_NOT_FOUND');
      if (!response.ok) throw new Error('Unable to load group details');
      const data = await response.json();
      metadataCache.set(id, { data, fetchedAt: Date.now() });
      return { ...group, ...data };
    })
    .catch((error) => ({
      ...group,
      __reticulumGroupLoadError: true,
      __reticulumGroupMissing: error?.message === 'GROUP_NOT_FOUND',
    }))
    .finally(() => inflightMetadata.delete(id));
  inflightMetadata.set(id, request);
  return request;
};

export const getReticulumGroupMetadata = (groupOrId: any, force = false) =>
  getMetadata(
    typeof groupOrId === 'object' ? groupOrId : { groupId: groupOrId },
    force
  );

export const prefetchReticulumGroupAboutMetadata = (group: any) => {
  if (!group?.groupId) return;
  void getMetadata(group);
};

const truncateInvite = (value: string) =>
  value.length > 34 ? `${value.slice(0, 18)}...${value.slice(-12)}` : value;

const yearsAgo = (timestamp?: number | string) => {
  const years = getLegacyLevel(timestamp);
  return years == null ? null : years;
};

const formatCreatedDate = (
  timestamp: number | string | undefined,
  t: TFunction
) => {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0)
    return t('core:unknown', { postProcess: 'capitalizeFirstChar' });
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
};

export const ReticulumGroupAboutModal = () => {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group', 'reticulum']);
  const userInfo = useAtomValue(userInfoAtom);
  const [requestedGroup, setRequestedGroup] = useState<any>(null);
  const [details, setDetails] = useState<any>(null);
  const [ownerName, setOwnerName] = useState('');
  const [avatarLoaded, setAvatarLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const descriptionRef = useRef<HTMLParagraphElement | null>(null);
  const [descriptionOverflowing, setDescriptionOverflowing] = useState(false);

  useEffect(() => {
    const open = (event: CustomEvent) =>
      setRequestedGroup(event.detail?.group ?? null);
    subscribeToEvent('openReticulumGroupAbout', open);
    return () => unsubscribeFromEvent('openReticulumGroupAbout', open);
  }, []);

  useEffect(() => {
    let active = true;
    setDetails(null);
    setOwnerName('');
    setAvatarLoaded(false);
    setCopied(false);
    if (!requestedGroup?.groupId) return undefined;
    getMetadata(requestedGroup).then(async (next) => {
      if (!active) return;
      setDetails(next);
      const resolvedOwnerName =
        next?.ownerPrimaryName ||
        (next?.owner ? await getNameInfo(next.owner).catch(() => '') : '');
      if (active) setOwnerName(resolvedOwnerName || '');
    });
    return () => {
      active = false;
    };
  }, [requestedGroup]);

  const data = details || requestedGroup;
  const ownerAddress = String(data?.owner || '').trim();
  const groupId = data?.groupId;
  const groupName =
    data?.groupName || data?.name || t('reticulum:group_fallback_name');
  const memberCount = data?.memberCount;
  const created = data?.created ?? data?.creationTimestamp ?? data?.createdAt;
  const legacyLevel = getLegacyLevel(created);
  const communityLevel = getCommunityLevel(memberCount);
  const inviteLink = groupId
    ? `${QORTAL_PROTOCOL}use-group/action-join/groupid-${groupId}`
    : '';
  const description = data?.description ?? data?.groupDescription ?? '';
  const isOpen =
    data?.isOpen === true ||
    data?.groupType === 0 ||
    data?.groupType === 'OPEN';
  const groupScore = useReticulumGroupScore(groupId);
  const avatarUrl =
    ownerName && groupId
      ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${ownerName}/qortal_group_avatar_${groupId}?async=true`
      : undefined;

  const measureDescription = useCallback(() => {
    const element = descriptionRef.current;
    if (!element) return;
    setDescriptionOverflowing(element.scrollHeight > element.clientHeight + 1);
  }, []);

  useEffect(() => {
    measureDescription();
    const observer =
      typeof ResizeObserver === 'undefined' || !descriptionRef.current
        ? null
        : new ResizeObserver(measureDescription);
    if (observer && descriptionRef.current)
      observer.observe(descriptionRef.current);
    return () => observer?.disconnect();
  }, [description, measureDescription]);

  const copyInvite = useCallback(async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [inviteLink]);

  const close = () => setRequestedGroup(null);
  const statRows = [
    {
      id: 'owner',
      label: t('group:group.owner'),
      value:
        ownerName ||
        data?.owner ||
        t('core:unknown', { postProcess: 'capitalizeFirstChar' }),
    },
    {
      id: 'group-type',
      label: t('group:group.type'),
      value: t(
        isOpen ? 'reticulum:group_type.open' : 'reticulum:group_type.closed',
        { postProcess: 'capitalizeFirstChar' }
      ),
    },
    {
      id: 'created',
      label: t('reticulum:about.created'),
      value: formatCreatedDate(created, t),
    },
  ];

  return (
    <Dialog
      open={Boolean(requestedGroup)}
      onClose={close}
      maxWidth={false}
      PaperProps={{
        sx: {
          background:
            theme.palette.mode === 'dark'
              ? 'linear-gradient(180deg, #1b1e23 0%, #15181d 100%)'
              : theme.palette.background.paper,
          border: `1px solid ${
            theme.palette.mode === 'dark'
              ? '#343a44'
              : alpha(theme.palette.text.primary, 0.2)
          }`,
          borderRadius: '12px',
          boxShadow:
            theme.palette.mode === 'dark'
              ? '0 22px 56px rgba(0, 0, 0, 0.5)'
              : '0 22px 56px rgba(0, 0, 0, 0.22)',
          maxHeight: 'calc(100vh - 32px)',
          m: 2,
          width: 'min(480px, calc(100vw - 32px))',
        },
      }}
    >
      <DialogContent sx={{ p: 3 }}>
        {!details ? (
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            <Skeleton height={76} variant="circular" width={76} />
            <Skeleton height={30} width="54%" />
            <Skeleton height={20} width="34%" />
            <Skeleton height={90} />
          </Box>
        ) : (
          <>
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flexDirection: 'column',
                textAlign: 'center',
              }}
            >
              <Avatar
                alt={groupName}
                imgProps={{
                  onError: () => setAvatarLoaded(false),
                  onLoad: () => setAvatarLoaded(true),
                }}
                src={avatarUrl}
                sx={{
                  backgroundColor: 'rgba(255,255,255,0.045)',
                  fontSize: 28,
                  fontWeight: 800,
                  height: 82,
                  mb: 1.25,
                  width: 82,
                }}
              >
                {!avatarLoaded ? (
                  <Box
                    alt=""
                    aria-hidden
                    component="img"
                    src={qortalWhiteLogo}
                    sx={{
                      height: '42%',
                      objectFit: 'contain',
                      opacity: 0.15,
                      width: '42%',
                    }}
                  />
                ) : null}
              </Avatar>
              <Typography
                sx={{ fontSize: 24, fontWeight: 750, lineHeight: 1.2 }}
              >
                {groupName}
              </Typography>
              <Box sx={{ mt: 1.15 }}>
                <GroupScoreBadge
                  popoverAlign="center"
                  score={groupScore}
                  size="full"
                />
              </Box>
              <Box
                sx={{
                  alignItems: 'center',
                  color: 'text.secondary',
                  display: 'inline-flex',
                  gap: 0.75,
                  mt: 0.85,
                }}
              >
                {isOpen ? (
                  <PublicRoundedIcon sx={{ fontSize: 17 }} />
                ) : (
                  <LockRoundedIcon sx={{ fontSize: 17 }} />
                )}
                <Typography sx={{ fontSize: 13 }}>
                  {t(
                    isOpen
                      ? 'reticulum:invite.open_group'
                      : 'reticulum:invite.closed_group',
                    { postProcess: 'capitalizeFirstChar' }
                  )}
                </Typography>
              </Box>
            </Box>

            {description && (
              <Tooltip
                arrow
                disableHoverListener={!descriptionOverflowing}
                title={description}
              >
                <Typography
                  ref={descriptionRef}
                  sx={{
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 3,
                    color: 'text.secondary',
                    display: '-webkit-box',
                    fontSize: 14,
                    lineHeight: 1.45,
                    mt: 2,
                    overflow: 'hidden',
                    textAlign: 'center',
                  }}
                >
                  {description}
                </Typography>
              </Tooltip>
            )}

            <Box
              sx={{
                borderTop: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.085)' : alpha(theme.palette.text.primary, 0.16)}`,
                display: 'grid',
                gap: 1.1,
                mt: 2,
                pt: 1.75,
              }}
            >
              {statRows.map(({ id, label, value }) => (
                <Box
                  key={id}
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 2,
                  }}
                >
                  <Typography
                    sx={{
                      color: 'text.secondary',
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {label}
                  </Typography>
                  {id === 'owner' && ownerAddress ? (
                    <Box sx={{ maxWidth: '58%', minWidth: 0 }}>
                      <WrapperUserAction
                        address={ownerAddress}
                        name={ownerName || ownerAddress}
                        reticulumUserCard={{
                          address: ownerAddress,
                          isMinterResolved: false,
                          isOwn: ownerAddress === userInfo?.address,
                          name: ownerName || undefined,
                          role: 'owner',
                          roleColor: '#FFB35D',
                          status: null,
                        }}
                        trigger="hover"
                      >
                        <Typography
                          sx={{
                            color: '#FFB35D',
                            fontSize: 13,
                            fontWeight: 600,
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {value}
                        </Typography>
                      </WrapperUserAction>
                    </Box>
                  ) : (
                    <Typography
                      sx={{
                        color: id === 'owner' ? '#FFB35D' : 'text.primary',
                        fontSize: 13,
                        fontWeight: 600,
                        maxWidth: '58%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {value}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>

            <Box
              sx={{
                alignItems: 'center',
                borderTop: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.085)' : alpha(theme.palette.text.primary, 0.16)}`,
                display: 'flex',
                gap: 1,
                justifyContent: 'space-between',
                mt: 2,
                pt: 1.75,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    color: 'text.secondary',
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                  }}
                >
                  {t('reticulum:about.group_invite_link', {
                    postProcess: 'capitalizeAll',
                  })}
                </Typography>
                <Typography
                  title={inviteLink}
                  sx={{
                    fontSize: 12,
                    mt: 0.2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {truncateInvite(inviteLink)}
                </Typography>
              </Box>
              <Tooltip
                title={t(
                  copied
                    ? 'reticulum:about.copied'
                    : 'reticulum:copy_invite_link',
                  { postProcess: 'capitalizeFirstChar' }
                )}
              >
                <Button
                  onClick={copyInvite}
                  size="small"
                  sx={{ flexShrink: 0, minWidth: 36, mt: 0.35, p: 0.75 }}
                >
                  {copied ? (
                    <CheckRoundedIcon fontSize="small" />
                  ) : (
                    <ContentCopyRoundedIcon fontSize="small" />
                  )}
                </Button>
              </Tooltip>
            </Box>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
