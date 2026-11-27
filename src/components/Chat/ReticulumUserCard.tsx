import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  Avatar,
  Box,
  Button,
  Divider,
  IconButton,
  Menu,
  Popover,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import NorthEastRoundedIcon from '@mui/icons-material/NorthEastRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import { getBaseApiReact } from '../../App';
import { getNameInfo } from '../Group/groupApi';
import { executeEvent } from '../../utils/events';
import { formatQortAmount } from '../../utils/numberFunctions';
import { statusDotColor } from '../../hooks/usePresence';
import { usePresenceStatusLabel } from '../common/accountStatus';
import { MinterAvatarOrnament } from './MinterAvatarOrnament';
import { AvatarPreviewModal } from './AvatarPreviewModal';
import { ReticulumRoleBadge } from './ReticulumRoleBadge';
import { useTranslation } from 'react-i18next';
import {
  ReticulumHideUserAction,
  type ReticulumSilenceContext,
} from './ReticulumHideUserAction';

export type ReticulumUserCardData = {
  address: string;
  avatarUrl?: string;
  isMinterResolved: boolean;
  isOwn: boolean;
  minterLevel?: number | null;
  name?: string;
  onAvatarPreview?: (event: MouseEvent, src: string) => void;
  role?: 'admin' | 'owner';
  roleColor?: string;
  status: string | null;
};

type ReticulumUserCardProps = {
  anchorEl: HTMLElement | null;
  anchorPlacement?: 'above' | 'below';
  anchorPosition?: { left: number; top: number };
  boundaryHeight?: number;
  data: ReticulumUserCardData;
  onClose: () => void;
  silenceContext?: ReticulumSilenceContext;
};

type CardProfile = {
  balance: string | number | null;
  name: string;
};

const shortenAddress = (address: string) =>
  address.length <= 14
    ? address
    : `${address.slice(0, 6)}...${address.slice(-6)}`;

export const ReticulumUserCard = ({
  anchorEl,
  anchorPlacement = 'below',
  anchorPosition,
  boundaryHeight,
  data,
  onClose,
  silenceContext,
}: ReticulumUserCardProps) => {
  const { i18n, t } = useTranslation(['core', 'reticulum']);
  const getPresenceStatusLabel = usePresenceStatusLabel();

  const theme = useTheme();
  const open = Boolean(anchorEl || anchorPosition);
  const [profile, setProfile] = useState<CardProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const [resolvedMinterLevel, setResolvedMinterLevel] = useState<number | null>(
    data.isMinterResolved ? (data.minterLevel ?? null) : null
  );
  const [isMinterResolved, setIsMinterResolved] = useState(
    data.isMinterResolved
  );
  const [isAvatarPreviewOpen, setIsAvatarPreviewOpen] = useState(false);
  const [avatarPreviewSrc, setAvatarPreviewSrc] = useState<string | null>(null);
  const [hideMenuAnchor, setHideMenuAnchor] = useState<HTMLElement | null>(
    null
  );
  const cardContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideContextMenu = (event: globalThis.MouseEvent) => {
      if (!cardContentRef.current?.contains(event.target as Node)) onClose();
    };

    document.addEventListener('contextmenu', closeOnOutsideContextMenu);
    return () =>
      document.removeEventListener('contextmenu', closeOnOutsideContextMenu);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !data.address) return;

    let cancelled = false;
    setIsLoading(true);
    setProfile(null);
    setCopyState('idle');

    void Promise.all([
      getNameInfo(data.address).catch(() => ''),
      fetch(
        `${getBaseApiReact()}/addresses/balance/${encodeURIComponent(data.address)}`
      )
        .then(async (response) => (response.ok ? response.json() : null))
        .catch(() => null),
    ]).then(([registeredName, balance]) => {
      if (cancelled) return;
      setProfile({ balance, name: registeredName || data.name || '' });
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [data.address, data.name, open]);

  useEffect(() => {
    if (!open || !data.address) return;

    if (data.isMinterResolved) {
      setResolvedMinterLevel(data.minterLevel ?? null);
      setIsMinterResolved(true);
      return;
    }

    let cancelled = false;
    setIsMinterResolved(false);
    setResolvedMinterLevel(null);

    void Promise.all([
      fetch(
        `${getBaseApiReact()}/groups/member/${encodeURIComponent(data.address)}`
      )
        .then(async (response) => (response.ok ? response.json() : []))
        .catch(() => []),
      fetch(
        `${getBaseApiReact()}/addresses/${encodeURIComponent(data.address)}`
      )
        .then(async (response) => (response.ok ? response.json() : null))
        .catch(() => null),
    ]).then(([membership, addressInfo]) => {
      if (cancelled) return;

      const groups = Array.isArray(membership)
        ? membership
        : Array.isArray(membership?.groups)
          ? membership.groups
          : [];
      const isMinter = groups.some(
        (group) => String(group?.groupName || '').toUpperCase() === 'MINTER'
      );
      const level = Number(addressInfo?.level);

      setResolvedMinterLevel(isMinter && Number.isFinite(level) ? level : null);
      setIsMinterResolved(true);
    });

    return () => {
      cancelled = true;
    };
  }, [data.address, data.isMinterResolved, data.minterLevel, open]);

  const displayName = profile?.name || data.name || data.address;
  const avatarName = profile?.name || data.name;
  const avatarUrl = avatarName
    ? `${getBaseApiReact()}/arbitrary/THUMBNAIL/${encodeURIComponent(avatarName)}/qortal_avatar?async=true`
    : data.avatarUrl;
  const formattedBalance = useMemo(
    () => formatQortAmount(profile?.balance ?? null, i18n.language),
    [i18n.language, profile?.balance]
  );
  const isMinter = typeof resolvedMinterLevel === 'number';
  const isOwnCard = data.isOwn;
  const statusLabel = getPresenceStatusLabel(data.status);
  const statusColor = statusDotColor(data.status);
  const cardAvatar = (
    <Avatar
      alt={displayName}
      src={avatarUrl}
      sx={{
        backgroundColor: alpha(theme.palette.text.primary, 0.07),
        color: theme.palette.text.primary,
        fontSize: 29,
        fontWeight: 700,
        height: 82,
        width: 82,
      }}
    >
      {displayName.charAt(0)}
    </Avatar>
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data.address);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('idle');
    }
  };

  const handleMessage = () => {
    executeEvent('openDirectMessageInternal', {
      address: data.address,
      name: displayName,
    });
    onClose();
  };

  const handleSendQort = () => {
    executeEvent('openPaymentInternal', {
      address: data.address,
      name: displayName,
    });
    onClose();
  };

  const handleViewProfile = () => {
    executeEvent('openUserLookupDrawer', { addressOrName: data.address });
    onClose();
  };

  const handleAvatarPreview = (event: MouseEvent) => {
    if (!avatarUrl) return;

    event.preventDefault();
    event.stopPropagation();
    if (data.onAvatarPreview) {
      data.onAvatarPreview(event, avatarUrl);
      return;
    }

    setAvatarPreviewSrc(avatarUrl);
    setIsAvatarPreviewOpen(true);
  };

  return (
    <>
      <Popover
        open={open}
        anchorEl={anchorEl}
        anchorPosition={anchorPosition}
        anchorReference={anchorPosition ? 'anchorPosition' : 'anchorEl'}
        onClose={onClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{
          vertical: anchorPlacement === 'above' ? 'bottom' : 'top',
          horizontal: 'left',
        }}
        marginThreshold={12}
        slotProps={{
          paper: {
            sx: {
              background:
                theme.palette.mode === 'dark'
                  ? 'radial-gradient(circle at 35% 0%, rgba(255, 255, 255, 0.035), transparent 48%), linear-gradient(180deg, #1B1E23 0%, #15181D 100%)'
                  : theme.palette.background.paper,
              border: '1px solid #30353D',
              borderRadius: '11px',
              boxShadow:
                'inset 0 0 0 1px rgba(255, 255, 255, 0.035), 0 12px 30px rgba(0, 0, 0, 0.38), 0 3px 8px rgba(0, 0, 0, 0.28)',
              maxWidth: 'calc(100vw - 24px)',
              maxHeight:
                typeof boundaryHeight === 'number'
                  ? Math.max(220, boundaryHeight - 24)
                  : undefined,
              mb: anchorPlacement === 'above' ? 1 : 0,
              mt: anchorPlacement === 'below' ? 1 : 0,
              overflowX: 'hidden',
              overflowY: 'auto',
              position: 'relative',
              width: 'min(440px, calc(100vw - 24px))',
            },
          },
        }}
      >
        <Box
          aria-label={`${displayName} user card`}
          ref={cardContentRef}
          role="dialog"
          sx={{ pb: 1.75, pt: 2.5, px: 2 }}
        >
          <Box
            sx={{
              alignItems: 'flex-start',
              display: 'flex',
              gap: 2.25,
              minHeight: 112,
              position: 'relative',
            }}
          >
            <Box sx={{ minWidth: 98, ml: 1 }}>
              {isMinter ? (
                <MinterAvatarOrnament
                  accentColor={data.role ? data.roleColor : undefined}
                  level={resolvedMinterLevel}
                  size="card"
                >
                  <IconButton
                    aria-label={`Open ${displayName}'s avatar`}
                    onClick={handleAvatarPreview}
                    sx={{ borderRadius: '50%', p: 0 }}
                  >
                    {cardAvatar}
                  </IconButton>
                </MinterAvatarOrnament>
              ) : (
                <IconButton
                  aria-label={`Open ${displayName}'s avatar`}
                  onClick={handleAvatarPreview}
                  sx={{ borderRadius: '50%', p: 0 }}
                >
                  {cardAvatar}
                </IconButton>
              )}
            </Box>

            <Box sx={{ minWidth: 0, pt: 0.15 }}>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: 1,
                  minWidth: 0,
                }}
              >
                <Typography
                  sx={{
                    color: data.roleColor || theme.palette.text.primary,
                    fontSize: 21,
                    fontWeight: 750,
                    lineHeight: '26px',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {displayName}
                </Typography>
                {data.role && (
                  <ReticulumRoleBadge
                    color={data.roleColor}
                    role={data.role}
                    size="card"
                  />
                )}
              </Box>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: 0.85,
                  mt: 0.45,
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    backgroundColor: data.status ? statusColor : 'transparent',
                    border: data.status ? 'none' : `2px solid ${statusColor}`,
                    borderRadius: '50%',
                    boxSizing: 'border-box',
                    height: 10,
                    width: 10,
                  }}
                />
                <Typography
                  sx={{ color: theme.palette.text.secondary, fontSize: 14 }}
                >
                  {statusLabel}
                </Typography>
              </Box>
              <Box sx={{ transform: 'translateY(16px)' }}>
                <Typography sx={cardLabelSx}>
                  {t('reticulum:user_card.qortal_address', {
                    postProcess: 'capitalizeAll',
                  })}
                </Typography>
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: 0.75,
                    mt: 0.55,
                    minWidth: 0,
                  }}
                >
                  <Typography
                    sx={{
                      color: theme.palette.text.primary,
                      fontSize: 14.5,
                      letterSpacing: 0.2,
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {shortenAddress(data.address)}
                  </Typography>
                  <Tooltip
                    title={
                      copyState === 'copied'
                        ? t('reticulum:user_card.address_copied', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : t('reticulum:user_card.copy_address', {
                            postProcess: 'capitalizeFirstChar',
                          })
                    }
                  >
                    <IconButton
                      aria-label={t('reticulum:user_card.copy_full_address', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                      onClick={handleCopy}
                      size="small"
                      sx={{
                        border: `1px solid ${alpha(theme.palette.divider, 0.9)}`,
                        borderRadius: '8px',
                        color: theme.palette.text.primary,
                        height: 28,
                        transform: 'translate(4px, -6px)',
                        width: 28,
                      }}
                    >
                      <ContentCopyRoundedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            </Box>
            <Tooltip
              title={t('reticulum:user_card.view_profile', {
                postProcess: 'capitalizeFirstChar',
              })}
            >
              <IconButton
                aria-label={t('reticulum:user_card.view_profile_of', {
                  name: displayName,
                  postProcess: 'capitalizeFirstChar',
                })}
                onClick={handleViewProfile}
                sx={{
                  border: `1px solid ${alpha(theme.palette.divider, 0.9)}`,
                  borderRadius: '9px',
                  color: theme.palette.primary.main,
                  height: 36,
                  ml: 'auto',
                  width: 36,
                }}
              >
                <OpenInNewRoundedIcon sx={{ fontSize: 22 }} />
              </IconButton>
            </Tooltip>
          </Box>

          <Divider
            sx={{
              borderColor:
                theme.palette.mode === 'dark'
                  ? 'rgba(255, 255, 255, 0.075)'
                  : alpha(theme.palette.text.primary, 0.2),
              mb: 0.5,
              mt: 2.75,
            }}
          />

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              minHeight: 64,
            }}
          >
            <CardStat
              label={t('reticulum:user_card.qort_balance', {
                postProcess: 'capitalizeAll',
              })}
              value={
                isLoading
                  ? t('core:loading_ellipsis', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : formattedBalance === null
                    ? t('core:not_available', { postProcess: 'capitalizeAll' })
                    : t('reticulum:user_card.qort_balance_value', {
                        amount: formattedBalance,
                      })
              }
            />
            <CardStat
              bordered
              label={t('reticulum:user_card.minter_level', {
                postProcess: 'capitalizeAll',
              })}
              value={
                !isMinterResolved
                  ? t('core:loading_ellipsis', {
                      postProcess: 'capitalizeFirstChar',
                    })
                  : !isMinter
                    ? t('core:not_available', { postProcess: 'capitalizeAll' })
                    : t('reticulum:user_card.minter_level_value', {
                        level: resolvedMinterLevel,
                        postProcess: 'capitalizeFirstChar',
                      })
              }
            />
          </Box>

          {!isOwnCard && (
            <>
              <Divider
                sx={{
                  borderColor:
                    theme.palette.mode === 'dark'
                      ? 'rgba(255, 255,255, 0.075)'
                      : alpha(theme.palette.text.primary, 0.2),
                  mb: 1.75,
                  mt: 0.5,
                }}
              />
              <Box
                sx={{
                  display: 'grid',
                  gap: 1.75,
                  gridTemplateColumns: '146px minmax(0, 1fr) 48px',
                }}
              >
                <Button
                  variant="contained"
                  startIcon={<ChatBubbleOutlineRoundedIcon />}
                  onClick={handleMessage}
                  sx={primaryActionSx}
                >
                  {t('reticulum:user_card.message', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<NorthEastRoundedIcon />}
                  onClick={handleSendQort}
                  sx={secondaryActionSx}
                >
                  {t('reticulum:user_card.send_qort', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Button>
                <Button
                  aria-label={t('reticulum:user_card.hide_user', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                  disabled={!silenceContext}
                  variant="outlined"
                  onClick={(event) => setHideMenuAnchor(event.currentTarget)}
                  sx={blockActionSx}
                >
                  <VisibilityOffRoundedIcon />
                </Button>
              </Box>
              {silenceContext && (
                <Menu
                  anchorEl={hideMenuAnchor}
                  open={Boolean(hideMenuAnchor)}
                  onClose={() => setHideMenuAnchor(null)}
                  anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
                  transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                  slotProps={{
                    paper: {
                      sx: {
                        backgroundColor: theme.palette.background.paper,
                        border: `1px solid ${theme.palette.divider}`,
                        borderRadius: '8px',
                        mt: 0.75,
                        minWidth: 210,
                      },
                    },
                  }}
                >
                  <ReticulumHideUserAction
                    address={data.address}
                    context={silenceContext}
                    handleClose={() => {
                      setHideMenuAnchor(null);
                      onClose();
                    }}
                    initiallyShowDurations
                  />
                </Menu>
              )}
            </>
          )}
        </Box>
      </Popover>
      <AvatarPreviewModal
        alt={displayName}
        open={isAvatarPreviewOpen}
        src={avatarPreviewSrc}
        onClose={() => setIsAvatarPreviewOpen(false)}
      />
    </>
  );
};

const CardStat = ({
  bordered = false,
  label,
  value,
}: {
  bordered?: boolean;
  label: string;
  value: string;
}) => {
  const theme = useTheme();
  return (
    <Box
      sx={{
        alignSelf: bordered ? 'center' : undefined,
        borderLeft: bordered
          ? `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.075)' : alpha(theme.palette.text.primary, 0.2)}`
          : undefined,
        display: 'flex',
        flexDirection: 'column',
        height: bordered ? '70%' : undefined,
        justifyContent: 'center',
        minWidth: 0,
        pl: bordered ? 2 : 1.25,
        pr: 1.25,
      }}
    >
      <Typography sx={{ ...cardLabelSx, mt: 0, whiteSpace: 'nowrap' }}>
        {label}
      </Typography>
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: 17,
          fontWeight: 700,
          mt: 0.45,
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
};

const cardLabelSx = {
  color: '#8F96A5',
  fontFamily: 'Inter, sans-serif',
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.16em',
  mt: 1,
};

const primaryActionSx = {
  backgroundColor: '#2563eb',
  border: '1px solid #2563eb',
  borderRadius: '8px',
  color: 'common.white',
  fontSize: 14,
  fontWeight: 700,
  height: 42,
  px: 1.45,
  '& .MuiSvgIcon-root': { fontSize: 18 },
  textTransform: 'none',
  '&:hover': { backgroundColor: '#1e40af', borderColor: '#1e40af' },
};

const secondaryActionSx = {
  borderColor: 'divider',
  borderRadius: '8px',
  boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.035)',
  color: 'text.primary',
  fontSize: 14,
  fontWeight: 700,
  height: 42,
  px: 1.45,
  '& .MuiSvgIcon-root': { fontSize: 18 },
  textTransform: 'none',
  '&:hover': { borderColor: 'text.secondary', backgroundColor: 'action.hover' },
};

const blockActionSx = {
  borderColor: 'error.dark',
  borderRadius: '8px',
  boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.035)',
  color: 'error.main',
  fontSize: 0,
  fontWeight: 700,
  height: 42,
  minWidth: 0,
  px: 0,
  '& .MuiSvgIcon-root': { fontSize: 24 },
  textTransform: 'none',
  '&:hover': {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: 'error.main',
  },
};
