import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  ButtonBase,
  CircularProgress,
  IconButton,
  InputBase,
  Popover,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import RefreshIcon from '@mui/icons-material/Refresh';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import PushPinRoundedIcon from '@mui/icons-material/PushPinRounded';
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { extractComponents } from '../Chat/MessageDisplay';
import {
  balanceAtom,
  infoSnackGlobalAtom,
  navigationControllerAtom,
  openSnackGlobalAtom,
  qortBalanceLoadingAtom,
  settingsLocalLastUpdatedAtom,
  sortablePinnedAppsAtom,
  txListAtom,
  userInfoAtom,
} from '../../atoms/global';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { QORTAL_PROTOCOL } from '../../constants/constants';
import { getBaseApiReactForAvatar } from '../../utils/globalApi';
import {
  APP_NAV_BAR_HEIGHT,
  type CustomTitleBarRightNavProps,
} from './CustomTitleBar';
import { QMailStatus } from '../QMailStatus';
import { GeneralNotifications } from '../GeneralNotifications';
import { TaskManager } from '../TaskManager/TaskManager';
import { GlobalActions } from '../GlobalActions/GlobalActions';
import { ChatWidgetReopenIcon } from '../Profile/ChatWidgetReopenIcon';
import { SubscriptionsStatus } from './SubscriptionsStatus';
import { AppBookmarksButton } from '../Apps/AppBookmarks';
import { saveToLocalStorage } from '../Apps/AppsNavBarDesktop';

export const QORTAL_GROUP_CALL_NAV_SLOT_ID = 'qortal-group-call-nav-slot';
export const DIRECT_VOICE_CALL_NAV_SLOT_ID = 'direct-voice-call-nav-slot';

type GlobalQortalNavBarProps = {
  desktopViewMode: string;
  utilityNav?: CustomTitleBarRightNavProps | null;
};

/** Hub-owned surfaces in the app tab strip (e.g. Q-Chat), not arbitrary Q-Apps */
const INTERNAL_TAB_SERVICE = 'INTERNAL';

type SelectedTab = {
  tabId: string;
  name: string;
  service: string;
  identifier?: string;
  path?: string;
  internal?: string;
  refreshFunc?: (tabId?: string) => void;
} | null;

type NavUserInfo = {
  address?: string;
  name?: string | null;
  primaryName?: string | null;
} | null;

const QAppsNavIcon = ({ color = 'currentColor' }: { color?: string }) => (
  <Box
    aria-hidden="true"
    sx={{
      display: 'grid',
      gap: '3px',
      gridTemplateColumns: 'repeat(2, 1fr)',
      height: 14,
      width: 14,
    }}
  >
    {Array.from({ length: 4 }).map((_, index) => (
      <Box
        key={index}
        sx={{
          backgroundColor: color,
          borderRadius: '50%',
          height: 4,
          width: 4,
        }}
      />
    ))}
  </Box>
);

function normalizeQortalInput(value: string) {
  const trimmed = (value || '').trim();
  if (!trimmed) return '';
  if (/^qortal:\/\//i.test(trimmed)) return trimmed;
  return `${QORTAL_PROTOCOL}${trimmed}`;
}

function shortenAddress(address?: string) {
  if (!address) return '';
  if (address.length <= 18) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function formatQortBalance(balance: unknown) {
  const numericBalance =
    typeof balance === 'number'
      ? balance
      : typeof balance === 'string'
        ? Number(balance)
        : NaN;

  if (!Number.isFinite(numericBalance)) return '--';
  return numericBalance.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function AuthenticatedUserAvatar({
  avatarUrl,
  primaryName,
  size,
  onAvatarError,
  borderRadius = '50%',
}: {
  avatarUrl: string | null;
  primaryName: string;
  size: number;
  onAvatarError: () => void;
  borderRadius?: string | number;
}) {
  return (
    <Avatar
      src={avatarUrl ?? undefined}
      onError={onAvatarError}
      sx={{
        bgcolor: (theme) =>
          theme.palette.mode === 'dark'
            ? alpha(theme.palette.common.white, 0.08)
            : alpha(theme.palette.common.black, 0.06),
        color: 'inherit',
        fontSize: size > 40 ? 24 : 16,
        fontWeight: 700,
        height: size,
        width: size,
        borderRadius,
      }}
    >
      {primaryName ? (
        primaryName.charAt(0).toUpperCase()
      ) : (
        <PersonRoundedIcon sx={{ fontSize: size > 40 ? 30 : 20 }} />
      )}
    </Avatar>
  );
}

function AuthenticatedUserMenu({
  userInfo,
  balance,
  isBalanceLoading,
  buttonSx,
  tooltipSlotProps,
  tooltipTitle,
  onCopied,
  onCopyFailed,
}: {
  userInfo: NavUserInfo;
  balance: unknown;
  isBalanceLoading: boolean;
  buttonSx: Record<string, any>;
  tooltipSlotProps: Record<string, any>;
  tooltipTitle: (text: string) => React.ReactNode;
  onCopied: () => void;
  onCopyFailed: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const address = userInfo?.address || '';
  const primaryName = (userInfo?.name || userInfo?.primaryName || '').trim();
  const formattedBalance = formatQortBalance(balance);
  const avatarUrl =
    primaryName && !avatarError
      ? `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${encodeURIComponent(
          primaryName
        )}/qortal_avatar?async=true`
      : null;
  const open = Boolean(anchorEl);
  const popoverId = open ? 'authenticated-user-menu' : undefined;
  const isDarkMode = theme.palette.mode === 'dark';

  useEffect(() => {
    setAvatarError(false);
  }, [primaryName]);

  const handleCopyAddress = useCallback(() => {
    if (!address || !navigator.clipboard?.writeText) {
      onCopyFailed();
      return;
    }

    navigator.clipboard
      .writeText(address)
      .then(onCopied)
      .catch((error) => {
        console.error('Failed to copy address:', error);
        onCopyFailed();
      });
  }, [address, onCopied, onCopyFailed]);

  const handleSendQort = useCallback(() => {
    const anchorRect = anchorEl?.getBoundingClientRect();
    setAnchorEl(null);
    executeEvent('openPaymentInternal', {
      anchorRect,
    });
  }, [anchorEl]);

  const accountButton = (
    <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}>
      <IconButton
        size="small"
        aria-describedby={popoverId}
        aria-label={t('core:message.generic.account_menu', {
          defaultValue: 'Account menu',
        })}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        sx={{
          ...buttonSx,
          backgroundColor: 'transparent',
          border: 'none',
          borderRadius: '50%',
          overflow: 'hidden',
          padding: 0,
          '&:hover': {
            backgroundColor: 'transparent',
            transform: 'translateY(-1px)',
            boxShadow: 'none',
          },
          '&:focus-visible': {
            outline: `1px solid ${theme.palette.primary.main}`,
            outlineOffset: '2px',
          },
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            background: isDarkMode
              ? 'linear-gradient(145deg, rgba(92,99,112,0.95), rgba(35,39,48,0.98))'
              : 'linear-gradient(145deg, rgba(255,255,255,1), rgba(224,230,239,0.98))',
            border: `1px solid ${
              isDarkMode
                ? alpha(theme.palette.common.white, 0.22)
                : alpha(theme.palette.common.white, 0.92)
            }`,
            borderRadius: '50%',
            boxShadow: isDarkMode
              ? `0 0 0 1px ${alpha(
                  theme.palette.common.black,
                  0.42
                )}, 0 1px 5px rgba(0,0,0,0.2)`
              : `0 0 0 1px ${alpha(
                  theme.palette.common.black,
                  0.08
                )}, 0 1px 5px rgba(15,23,42,0.12)`,
            color: theme.palette.text.primary,
            display: 'flex',
            height: 27,
            justifyContent: 'center',
            overflow: 'hidden',
            transition:
              'border-color 140ms ease, box-shadow 140ms ease, transform 120ms ease',
            width: 27,
            '&:hover': {
              borderColor: isDarkMode
                ? alpha(theme.palette.common.white, 0.34)
                : theme.palette.common.white,
              boxShadow: isDarkMode
                ? `0 0 0 1px ${alpha(
                    theme.palette.primary.light,
                    0.28
                  )}, 0 3px 9px rgba(0,0,0,0.24)`
                : `0 0 0 1px ${alpha(
                    theme.palette.primary.main,
                    0.16
                  )}, 0 3px 9px rgba(15,23,42,0.14)`,
            },
          }}
        >
          <AuthenticatedUserAvatar
            avatarUrl={avatarUrl}
            primaryName={primaryName}
            size={27}
            onAvatarError={() => setAvatarError(true)}
          />
        </Box>
      </IconButton>
    </Box>
  );

  return (
    <>
      {primaryName ? (
        <Tooltip
          title={tooltipTitle(primaryName)}
          placement="bottom"
          arrow
          slotProps={tooltipSlotProps}
        >
          {accountButton}
        </Tooltip>
      ) : (
        accountButton
      )}

      <Popover
        id={popoverId}
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              background: isDarkMode
                ? 'linear-gradient(145deg, rgba(43,47,56,0.99), rgba(28,31,38,0.995))'
                : 'linear-gradient(180deg, rgba(252,253,255,0.995), rgba(244,247,251,0.995))',
              border: `1px solid ${theme.palette.border.subtle}`,
              borderRadius: '12px',
              boxShadow: isDarkMode
                ? '0 18px 42px rgba(0,0,0,0.36)'
                : '0 18px 42px rgba(15,23,42,0.14)',
              mt: 1,
              overflow: 'hidden',
              width: 310,
            },
          },
        }}
      >
        <Box sx={{ p: 1.5 }}>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: 1.25,
              minWidth: 0,
              pb: 1.25,
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                background: isDarkMode
                  ? 'linear-gradient(145deg, rgba(95,103,118,0.36), rgba(49,55,67,0.42))'
                  : alpha(theme.palette.text.primary, 0.045),
                border: `1px solid ${theme.palette.border.subtle}`,
                borderRadius: '12px',
                boxShadow: isDarkMode
                  ? '0 2px 10px rgba(0,0,0,0.22)'
                  : '0 2px 10px rgba(15,23,42,0.12)',
                color: theme.palette.text.primary,
                display: 'flex',
                height: 54,
                justifyContent: 'center',
                overflow: 'hidden',
                width: 54,
              }}
            >
              <AuthenticatedUserAvatar
                avatarUrl={avatarUrl}
                primaryName={primaryName}
                size={54}
                borderRadius="10px"
                onAvatarError={() => setAvatarError(true)}
              />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: 15,
                  fontWeight: 700,
                  lineHeight: 1.25,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {primaryName ||
                  t('core:message.generic.no_primary_name', {
                    defaultValue: 'No primary name',
                  })}
              </Typography>
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: 12,
                  lineHeight: 1.35,
                  mt: 0.35,
                }}
              >
                {t('core:message.generic.authenticated_account', {
                  defaultValue: 'Authenticated account',
                })}
              </Typography>
            </Box>
          </Box>

          <Box
            sx={{
              alignItems: 'center',
              background: isDarkMode
                ? 'linear-gradient(145deg, rgba(92,99,112,0.13), rgba(43,48,58,0.32))'
                : 'linear-gradient(180deg, rgba(255,255,255,0.86), rgba(238,242,248,0.8))',
              border: `1px solid ${theme.palette.border.subtle}`,
              borderRadius: '10px',
              display: 'flex',
              gap: 1,
              justifyContent: 'space-between',
              mb: 1,
              mt: 1,
              p: '10px 11px',
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: 1,
                  mb: 0.65,
                  textTransform: 'uppercase',
                }}
              >
                {t('core:balance', {
                  defaultValue: 'Balance',
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
              <Typography
                sx={{
                  color: theme.palette.text.primary,
                  fontSize: 18,
                  fontWeight: 800,
                  lineHeight: 1.1,
                  whiteSpace: 'nowrap',
                }}
              >
                {formattedBalance}
              </Typography>
            </Box>
            <Box
              sx={{
                alignItems: 'center',
                border: `1px solid ${theme.palette.border.subtle}`,
                borderRadius: '9px',
                color: theme.palette.text.primary,
                display: 'inline-flex',
                flexShrink: 0,
                fontSize: 12,
                fontWeight: 800,
                height: 32,
                justifyContent: 'center',
                minWidth: 48,
                px: 1,
              }}
            >
              {isBalanceLoading ? (
                <CircularProgress
                  size={16}
                  thickness={5}
                  sx={{ color: theme.palette.text.secondary }}
                />
              ) : (
                'QORT'
              )}
            </Box>
          </Box>

          <Box
            sx={{
              backgroundColor: isDarkMode
                ? alpha(theme.palette.common.white, 0.04)
                : alpha(theme.palette.common.black, 0.035),
              border: `1px solid ${theme.palette.border.subtle}`,
              borderRadius: '10px',
              p: 1,
            }}
          >
            <Typography
              sx={{
                color: theme.palette.text.secondary,
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1,
                mb: 0.75,
                textTransform: 'uppercase',
              }}
            >
              {t('core:message.generic.address', {
                defaultValue: 'Address',
              })}
            </Typography>
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: 0.75,
                minWidth: 0,
              }}
            >
              <Typography
                title={address}
                sx={{
                  color: theme.palette.text.primary,
                  flex: 1,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: 12.5,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {shortenAddress(address)}
              </Typography>
              <IconButton
                size="small"
                aria-label={t('core:message.generic.copy_address', {
                  defaultValue: 'Copy address',
                })}
                onClick={handleCopyAddress}
                sx={{
                  borderRadius: '8px',
                  color: theme.palette.text.secondary,
                  height: 28,
                  width: 28,
                  '&:hover': {
                    backgroundColor: theme.palette.action.hover,
                    color: theme.palette.text.primary,
                  },
                }}
              >
                <ContentCopyRoundedIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Box>
          </Box>

          <ButtonBase
            onClick={handleSendQort}
            sx={{
              alignItems: 'center',
              border: `1px solid ${theme.palette.border.subtle}`,
              borderRadius: '10px',
              color: theme.palette.text.primary,
              display: 'flex',
              gap: 1,
              justifyContent: 'flex-start',
              mt: 1,
              p: '10px 11px',
              textAlign: 'left',
              width: '100%',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
                borderColor: theme.palette.border.main,
              },
            }}
          >
            <SendRoundedIcon
              sx={{ color: theme.palette.text.secondary, fontSize: 18 }}
            />
            <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
              {t('core:action.send_qort', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          </ButtonBase>
        </Box>
      </Popover>
    </>
  );
}

export function GlobalQortalNavBar({
  desktopViewMode,
  utilityNav = null,
}: GlobalQortalNavBarProps) {
  const theme = useTheme();
  const navigationController = useAtomValue(navigationControllerAtom);
  const balance = useAtomValue(balanceAtom);
  const qortBalanceLoading = useAtomValue(qortBalanceLoadingAtom);
  const txList = useAtomValue(txListAtom);
  const userInfo = useAtomValue(userInfoAtom);
  const sortablePinnedApps = useAtomValue(sortablePinnedAppsAtom);
  const setOpenSnackGlobal = useSetAtom(openSnackGlobalAtom);
  const setInfoSnackGlobal = useSetAtom(infoSnackGlobalAtom);
  const setSortablePinnedApps = useSetAtom(sortablePinnedAppsAtom);
  const setSettingsLocalLastUpdated = useSetAtom(settingsLocalLastUpdatedAtom);
  const { t } = useTranslation(['core', 'question']);
  const [selectedTab, setSelectedTab] = useState<SelectedTab>(null);
  const [inputValue, setInputValue] = useState('');
  const [isInputHovered, setIsInputHovered] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const isInputFocusedRef = useRef(false);
  const lastTabsTokenRef = useRef(0);
  const navClearLockUntilRef = useRef(0);
  const inputElementRef = useRef<HTMLInputElement | null>(null);

  const setTabsToNav = useCallback((e: CustomEvent) => {
    const nextToken = Number(e.detail?.data?.tabsToken || 0);
    if (Date.now() < navClearLockUntilRef.current) {
      return;
    }
    if (lastTabsTokenRef.current > 0 && !nextToken) {
      return;
    }
    if (nextToken && nextToken <= lastTabsTokenRef.current) {
      return;
    }
    if (nextToken) {
      lastTabsTokenRef.current = nextToken;
    }
    const nextSelectedTab = e.detail?.data?.selectedTab;
    setSelectedTab(nextSelectedTab ? { ...nextSelectedTab } : null);
  }, []);

  useEffect(() => {
    subscribeToEvent('setTabsToNav', setTabsToNav);

    return () => {
      unsubscribeFromEvent('setTabsToNav', setTabsToNav);
    };
  }, [setTabsToNav]);

  useEffect(() => {
    const handleClearNavInput = () => {
      setInputValue('');
      setIsInputFocused(false);
      isInputFocusedRef.current = false;
      if (inputElementRef.current) {
        inputElementRef.current.blur();
      }
    };

    subscribeToEvent('clearNavInput', handleClearNavInput);

    return () => {
      unsubscribeFromEvent('clearNavInput', handleClearNavInput);
    };
  }, []);

  useEffect(() => {
    const handleForceNavClear = (e: CustomEvent) => {
      const nextToken = Number(e.detail?.data?.tabsToken || 0);
      if (nextToken) {
        lastTabsTokenRef.current = nextToken;
      }
      navClearLockUntilRef.current = Date.now() + 250;
      setSelectedTab(null);
      setInputValue('');
      setIsInputFocused(false);
      isInputFocusedRef.current = false;
      if (inputElementRef.current) {
        inputElementRef.current.blur();
      }
    };

    subscribeToEvent('forceNavClear', handleForceNavClear);

    return () => {
      unsubscribeFromEvent('forceNavClear', handleForceNavClear);
    };
  }, []);

  const currentNavigation = selectedTab?.tabId
    ? navigationController?.[selectedTab.tabId]
    : null;

  const currentLink = useMemo(() => {
    return currentNavigation?.currentLink || '';
  }, [currentNavigation]);
  const bookmarkSelectedTab = useMemo(() => {
    const parsedLink = currentLink
      ? extractComponents(normalizeQortalInput(currentLink))
      : null;
    if (!parsedLink) return selectedTab;
    return {
      ...(selectedTab || {}),
      service: parsedLink.service,
      name: parsedLink.name,
      identifier: parsedLink.identifier,
      path: parsedLink.path,
    };
  }, [currentLink, selectedTab]);
  const pinnedCandidate = useMemo(() => {
    if (!bookmarkSelectedTab?.service || !bookmarkSelectedTab?.name) {
      return null;
    }
    if (
      bookmarkSelectedTab.internal ||
      bookmarkSelectedTab.service === INTERNAL_TAB_SERVICE
    ) {
      return null;
    }

    return {
      name: bookmarkSelectedTab.name,
      service: bookmarkSelectedTab.service.toUpperCase(),
    };
  }, [bookmarkSelectedTab]);
  const isCurrentAppPinned = useMemo(() => {
    if (!pinnedCandidate) return false;
    return !!sortablePinnedApps?.some(
      (item) =>
        item?.name?.toLowerCase() === pinnedCandidate.name.toLowerCase() &&
        item?.service?.toUpperCase() === pinnedCandidate.service
    );
  }, [pinnedCandidate, sortablePinnedApps]);

  useEffect(() => {
    if (isInputFocusedRef.current) return;
    if (
      (desktopViewMode === 'apps' || desktopViewMode === 'dev') &&
      currentLink
    ) {
      setInputValue(currentLink);
      return;
    }
    setInputValue('');
  }, [currentLink, desktopViewMode]);

  const handleOpenInput = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    const isExplicitQortalLink = /^qortal:\/\//i.test(trimmed);
    const parsedLink = isExplicitQortalLink
      ? extractComponents(normalizeQortalInput(trimmed))
      : null;

    if (parsedLink) {
      const { service, name, identifier, path } = parsedLink;
      executeEvent('addTab', { data: { service, name, identifier, path } });
      executeEvent('open-apps-mode', {});
      return;
    }

    executeEvent('openAppsLibrarySearch', {
      data: {
        query: trimmed,
      },
    });
    executeEvent('open-apps-mode', {});
  }, [inputValue]);

  const canCopyCurrentLink = Boolean(currentLink);
  const canPinCurrentApp = Boolean(pinnedCandidate);
  const handleCopyCurrentLink = useCallback(() => {
    if (!currentLink) return;
    if (!navigator.clipboard?.writeText) {
      setInfoSnackGlobal({
        compact: true,
        duration: 3200,
        message: t('question:message.error.copy_clipboard', {
          defaultValue: 'Failed to copy to clipboard',
          postProcess: 'capitalizeFirstChar',
        }),
        type: 'error',
      });
      setOpenSnackGlobal(true);
      return;
    }
    navigator.clipboard
      .writeText(currentLink)
      .then(() => {
        setInfoSnackGlobal({
          compact: true,
          duration: 3000,
          message: t('core:message.generic.link_copied', {
            defaultValue: 'Link copied to clipboard.',
          }),
          type: 'success',
        });
        setOpenSnackGlobal(true);
      })
      .catch((error) => {
        console.error('Failed to copy link:', error);
        setInfoSnackGlobal({
          compact: true,
          duration: 3200,
          message: t('question:message.error.copy_clipboard', {
            defaultValue: 'Failed to copy to clipboard',
            postProcess: 'capitalizeFirstChar',
          }),
          type: 'error',
        });
        setOpenSnackGlobal(true);
      });
  }, [currentLink, setInfoSnackGlobal, setOpenSnackGlobal, t]);
  const handleTogglePinnedApp = useCallback(() => {
    if (!pinnedCandidate) return;

    setSortablePinnedApps((prev) => {
      const isPinned = prev?.some(
        (item) =>
          item?.name?.toLowerCase() === pinnedCandidate.name.toLowerCase() &&
          item?.service?.toUpperCase() === pinnedCandidate.service
      );
      const updatedApps = isPinned
        ? prev.filter(
            (item) =>
              !(
                item?.name?.toLowerCase() ===
                  pinnedCandidate.name.toLowerCase() &&
                item?.service?.toUpperCase() === pinnedCandidate.service
              )
          )
        : [...prev, pinnedCandidate];

      saveToLocalStorage('ext_saved_settings', 'sortablePinnedApps', updatedApps);
      return updatedApps;
    });
    setSettingsLocalLastUpdated(Date.now());
  }, [pinnedCandidate, setSettingsLocalLastUpdated, setSortablePinnedApps]);

  const handleCopyAddressSuccess = useCallback(() => {
    setInfoSnackGlobal({
      compact: true,
      duration: 3000,
      message: t('core:message.generic.address_copied', {
        defaultValue: 'Address copied to clipboard.',
      }),
      type: 'success',
    });
    setOpenSnackGlobal(true);
  }, [setInfoSnackGlobal, setOpenSnackGlobal, t]);

  const handleCopyAddressFailed = useCallback(() => {
    setInfoSnackGlobal({
      compact: true,
      duration: 3200,
      message: t('question:message.error.copy_clipboard', {
        defaultValue: 'Failed to copy to clipboard',
        postProcess: 'capitalizeFirstChar',
      }),
      type: 'error',
    });
    setOpenSnackGlobal(true);
  }, [setInfoSnackGlobal, setOpenSnackGlobal, t]);

  const isInternalTabSelected = selectedTab?.service === INTERNAL_TAB_SERVICE;
  const canGoBack =
    !!selectedTab?.tabId &&
    !!currentNavigation?.hasBack &&
    !isInternalTabSelected;
  const canRefresh =
    !!selectedTab?.tabId &&
    (desktopViewMode === 'apps' || desktopViewMode === 'dev') &&
    !isInternalTabSelected;
  const isAppsMode = desktopViewMode === 'apps';
  const isDevMode = desktopViewMode === 'dev';
  const isHomeMode = desktopViewMode === 'home';
  const chromeBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(33, 36, 42, 0.95)'
      : 'rgba(223, 228, 235, 0.96)';
  const navShadow =
    theme.palette.mode === 'dark'
      ? `inset 0 -1px 0 ${theme.palette.border.subtle}`
      : `inset 0 -1px 0 ${theme.palette.border.subtle}`;
  const inputBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(28, 31, 37, 0.98)'
      : 'rgba(232, 236, 241, 0.96)';
  const inputHoverBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(41, 45, 52, 0.99)'
      : 'rgba(214, 220, 228, 0.98)';
  const inputFocusBackground =
    theme.palette.mode === 'dark'
      ? 'rgba(46, 51, 59, 1)'
      : 'rgba(214, 220, 228, 1)';
  const hoverBorderColor =
    theme.palette.mode === 'dark'
      ? theme.palette.border.main
      : theme.palette.border.main;
  const focusBorderColor =
    theme.palette.mode === 'dark'
      ? 'rgba(130, 185, 255, 0.28)'
      : 'rgba(41, 121, 218, 0.2)';
  const inputHoverShadow = 'none';
  const inputFocusShadow = theme.palette.mode === 'dark' ? 'none' : 'none';
  const buttonHoverBackground =
    theme.palette.mode === 'dark'
      ? theme.palette.action.hover
      : theme.palette.action.hover;
  const inputTextDefaultColor = theme.palette.text.secondary;
  const inputTextHoverColor =
    theme.palette.mode === 'dark'
      ? 'rgba(236, 240, 246, 0.96)'
      : 'rgba(0, 0, 0, 0.78)';
  const inputTextFocusColor = theme.palette.text.primary;
  const inputTextColor = isInputFocused
    ? inputTextFocusColor
    : isInputHovered
      ? inputTextHoverColor
      : inputTextDefaultColor;
  const placeholderColor = isInputFocused
    ? inputTextHoverColor
    : theme.palette.text.secondary;
  const selectionBackground = theme.palette.primary.main;
  const selectionColor =
    theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.92)' : '#ffffff';
  const showStyledLinkPreview =
    !isInputFocused && !!inputValue && /^qortal:\/\//i.test(inputValue);
  const protocolMatch = inputValue.match(/^(qortal:\/\/)/i);
  const protocolText = protocolMatch?.[0] || '';
  const remainderText = protocolText
    ? inputValue.slice(protocolText.length)
    : '';
  const protocolColor =
    theme.palette.mode === 'dark'
      ? isInputHovered
        ? 'rgba(242, 246, 252, 0.98)'
        : 'rgba(224, 224, 224, 0.92)'
      : isInputHovered
        ? 'rgba(0, 0, 0, 0.82)'
        : 'rgba(0, 0, 0, 0.74)';
  const remainderColor =
    theme.palette.mode === 'dark'
      ? isInputHovered
        ? 'rgba(218, 226, 238, 0.94)'
        : 'rgba(176, 176, 176, 0.9)'
      : isInputHovered
        ? 'rgba(0, 0, 0, 0.66)'
        : 'rgba(0, 0, 0, 0.56)';
  const linkTextMetrics = {
    fontSize: '13.5px',
    fontWeight: 400,
    letterSpacing: 'normal',
    lineHeight: '20px',
  } as const;
  const tooltipSlotProps = {
    tooltip: {
      sx: {
        color: theme.palette.text.primary,
        backgroundColor: theme.palette.background.paper,
      },
    },
    arrow: {
      sx: {
        color: theme.palette.text.primary,
      },
    },
  } as const;
  const tooltipTitle = (text: string) => (
    <span
      style={{ fontSize: '14px', fontWeight: 700, textTransform: 'uppercase' }}
    >
      {text}
    </span>
  );
  const utilityModuleButtonSx = {
    alignItems: 'center',
    border: `1px solid ${theme.palette.border.subtle}`,
    borderRadius: '10px',
    color: theme.palette.text.secondary,
    display: 'inline-flex',
    height: 32,
    justifyContent: 'center',
    minWidth: 32,
    transition:
      'background-color 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
    width: 32,
    '&:hover': {
      backgroundColor: buttonHoverBackground,
      borderColor: hoverBorderColor,
      color: theme.palette.text.primary,
      transform: 'translateY(-1px)',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    },
    '&:active': {
      transform: 'translateY(0)',
      boxShadow: 'none',
    },
    '&:focus-visible': {
      outline: `1px solid ${theme.palette.primary.main}`,
      outlineOffset: '2px',
    },
  } as const;
  const utilityModuleIconSx = {
    fontSize: 20,
  } as const;
  const utilitySectionSx = {
    alignItems: 'center',
    display: 'flex',
    flexShrink: 0,
    gap: 0.75,
    ml: 0.125,
    pl: 0.25,
  } as const;
  const hasActiveTasks = !!txList?.some((item: any) => item && !item.done);
  const utilityLayoutTransition = {
    duration: 0.22,
    ease: [0.22, 1, 0.36, 1],
  } as const;

  return (
    <>
      <Box
        sx={{
          alignItems: 'center',
          backdropFilter: 'blur(10px)',
          backgroundColor: chromeBackground,
          borderBottom: `1px solid ${theme.palette.border.subtle}`,
          boxShadow: navShadow,
          display: 'flex',
          height: `${APP_NAV_BAR_HEIGHT}px`,
          transition: `background-color 180ms ease, box-shadow 180ms ease`,
          width: '100%',
        }}
      >
        <Box
          component={motion.div}
          layout
          transition={utilityLayoutTransition}
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: 1.25,
            height: '100%',
            maxWidth: '100%',
            pl: { xs: '12px', sm: '16px', md: '20px' },
            pr: { xs: 1.5, sm: 2, md: 2.25 },
            width: '100%',
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexShrink: 0,
              gap: 0.5,
              pr: 1.25,
              position: 'relative',
              '&::after': {
                backgroundColor: theme.palette.border.subtle,
                content: '""',
                height: 18,
                position: 'absolute',
                right: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                width: '1px',
              },
            }}
          >
            <ButtonBase
              disableRipple
              onClick={() => {
                if (isDevMode) {
                  executeEvent('devModeNavigateBack', {});
                  return;
                }
                if (!selectedTab?.tabId) return;
                executeEvent(`navigateBackApp-${selectedTab.tabId}`, {});
              }}
              disabled={!canGoBack}
              sx={{
                alignItems: 'center',
                borderRadius: '9px',
                color: theme.palette.text.primary,
                display: 'flex',
                height: 32,
                justifyContent: 'center',
                opacity: canGoBack ? 1 : 0.32,
                transition:
                  'background-color 140ms ease, color 140ms ease, opacity 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                width: 32,
                '&:hover:not(.Mui-disabled)': {
                  backgroundColor: buttonHoverBackground,
                  transform: 'translateY(-1px)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                },
                '&:active:not(.Mui-disabled)': {
                  transform: 'translateY(0)',
                  boxShadow: 'none',
                },
                '&:focus-visible': {
                  outline: `1px solid ${theme.palette.primary.main}`,
                  outlineOffset: '2px',
                },
              }}
            >
              <ArrowBackIosNewRoundedIcon sx={{ fontSize: 15 }} />
            </ButtonBase>

            <ButtonBase
              disableRipple
              onClick={() => {
                if (isHomeMode) {
                  executeEvent('open-apps-mode', {});
                  return;
                }
                executeEvent('open-home-mode', {});
              }}
              sx={{
                alignItems: 'center',
                borderRadius: '9px',
                color: theme.palette.text.primary,
                display: 'flex',
                height: 32,
                justifyContent: 'center',
                opacity: isHomeMode || isAppsMode || isDevMode ? 1 : 0.92,
                transition:
                  'background-color 140ms ease, color 140ms ease, opacity 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                width: 32,
                backgroundColor:
                  isHomeMode || isAppsMode || isDevMode
                    ? buttonHoverBackground
                    : 'transparent',
                '&:hover': {
                  backgroundColor: buttonHoverBackground,
                  transform: 'translateY(-1px)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                },
                '&:active': {
                  transform: 'translateY(0)',
                  boxShadow: 'none',
                },
                '&:focus-visible': {
                  outline: `1px solid ${theme.palette.primary.main}`,
                  outlineOffset: '2px',
                },
              }}
            >
              {isAppsMode || isDevMode ? (
                <HomeRoundedIcon sx={{ fontSize: 19 }} />
              ) : (
                <QAppsNavIcon color={theme.palette.text.primary} />
              )}
            </ButtonBase>

            <ButtonBase
              disableRipple
              onClick={() => {
                if (!selectedTab?.tabId) return;
                if (selectedTab?.refreshFunc) {
                  selectedTab.refreshFunc(selectedTab?.tabId);
                  return;
                }
                executeEvent('refreshApp', {
                  tabId: selectedTab.tabId,
                });
              }}
              disabled={!canRefresh}
              sx={{
                alignItems: 'center',
                borderRadius: '9px',
                color: theme.palette.text.primary,
                display: 'flex',
                height: 32,
                justifyContent: 'center',
                opacity: canRefresh ? 1 : 0.32,
                transition:
                  'background-color 140ms ease, color 140ms ease, opacity 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                width: 32,
                '&:hover:not(.Mui-disabled)': {
                  backgroundColor: buttonHoverBackground,
                  transform: 'translateY(-1px)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                },
                '&:active:not(.Mui-disabled)': {
                  transform: 'translateY(0)',
                  boxShadow: 'none',
                },
                '&:focus-visible': {
                  outline: `1px solid ${theme.palette.primary.main}`,
                  outlineOffset: '2px',
                },
              }}
            >
              <RefreshIcon sx={{ fontSize: 18 }} />
            </ButtonBase>

            <Box
              sx={{
                borderLeft: `1px solid ${theme.palette.border.subtle}`,
                display: 'flex',
                ml: 0.75,
                pl: 1,
              }}
            >
              <AppBookmarksButton
                address={userInfo?.address}
                chromeBackground={chromeBackground}
                selectedTab={bookmarkSelectedTab}
                tooltipSlotProps={tooltipSlotProps}
                tooltipTitle={tooltipTitle}
                buttonSx={{
                  alignItems: 'center',
                  borderRadius: '9px',
                  display: 'flex',
                  height: 32,
                  justifyContent: 'center',
                  transition:
                    'background-color 140ms ease, color 140ms ease, opacity 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                  width: 32,
                  '&:hover:not(.Mui-disabled)': {
                    backgroundColor: buttonHoverBackground,
                    transform: 'translateY(-1px)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  },
                  '&:active:not(.Mui-disabled)': {
                    transform: 'translateY(0)',
                    boxShadow: 'none',
                  },
                  '&:focus-visible': {
                    outline: `1px solid ${theme.palette.primary.main}`,
                    outlineOffset: '2px',
                  },
                }}
              />
            </Box>
          </Box>

          <Box
            component={motion.div}
            layout
            transition={utilityLayoutTransition}
            onMouseEnter={() => setIsInputHovered(true)}
            onMouseLeave={() => setIsInputHovered(false)}
            sx={{
              alignItems: 'center',
              backgroundColor: inputBackground,
              border: `1px solid ${theme.palette.border.subtle}`,
              borderRadius: '10px',
              display: 'flex',
              flex: 1,
              gap: 1,
              height: 32,
              minWidth: 0,
              px: 1.25,
              boxShadow: 'none',
              transition:
                'background-color 180ms ease, border-color 180ms ease, box-shadow 200ms ease',
              '&:hover': {
                backgroundColor: inputHoverBackground,
                borderColor: hoverBorderColor,
                boxShadow: inputHoverShadow,
              },
              '&:focus-within': {
                backgroundColor: inputFocusBackground,
                borderColor: focusBorderColor,
                boxShadow: `0 0 0 1px ${focusBorderColor}`,
              },
            }}
          >
            <SearchIcon
              sx={{
                color: theme.palette.text.secondary,
                fontSize: 17,
              }}
            />
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flex: 1,
                minWidth: 0,
                position: 'relative',
              }}
            >
              {showStyledLinkPreview && (
                <Box
                  aria-hidden
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    inset: 0,
                    overflow: 'hidden',
                    pointerEvents: 'none',
                    position: 'absolute',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      color: protocolColor,
                      display: 'inline-flex',
                      alignItems: 'center',
                      height: '20px',
                      transition: 'color 220ms ease',
                      ...linkTextMetrics,
                    }}
                  >
                    {protocolText}
                  </Box>
                  <Box
                    component="span"
                    sx={{
                      alignItems: 'center',
                      color: remainderColor,
                      display: 'inline-flex',
                      height: '20px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      transition: 'color 220ms ease',
                      ...linkTextMetrics,
                    }}
                  >
                    {remainderText}
                  </Box>
                </Box>
              )}
              <InputBase
                inputRef={inputElementRef}
                value={inputValue}
                onBlur={() => {
                  isInputFocusedRef.current = false;
                  setIsInputFocused(false);
                }}
                onChange={(e) => setInputValue(e.target.value)}
                onFocus={() => {
                  isInputFocusedRef.current = true;
                  setIsInputFocused(true);
                  window.setTimeout(() => {
                    inputElementRef.current?.select();
                  }, 0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleOpenInput();
                  }
                }}
                placeholder="Search Q-Apps or enter qortal://"
                sx={{
                  color: inputTextColor,
                  flex: 1,
                  minWidth: 0,
                  transition: 'color 220ms ease',
                  ...linkTextMetrics,
                  '& .MuiInputBase-input': {
                    appearance: 'none',
                    boxSizing: 'border-box',
                    color: showStyledLinkPreview ? 'transparent' : 'inherit',
                    display: 'block',
                    height: '20px',
                    lineHeight: '20px',
                    margin: 0,
                    padding: 0,
                    transition: 'color 220ms ease',
                    ...linkTextMetrics,
                    '::selection': {
                      backgroundColor: selectionBackground,
                      color: selectionColor,
                    },
                  },
                  '& .MuiInputBase-input::placeholder': {
                    color: placeholderColor,
                    opacity: 1,
                    transition: 'color 220ms ease',
                  },
                }}
              />
            </Box>
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                flex: '0 0 90px',
                gap: 0.75,
                height: 26,
                justifyContent: 'flex-end',
                maxWidth: 90,
                minWidth: 90,
                width: 90,
              }}
            >
              <Tooltip
                title={tooltipTitle(t('core:action.copy_link'))}
                placement="bottom"
                arrow
                slotProps={tooltipSlotProps}
              >
                <Box
                  component="span"
                  sx={{
                    display: 'inline-flex',
                    visibility: canCopyCurrentLink ? 'visible' : 'hidden',
                  }}
                >
                  <ButtonBase
                    disableRipple
                    aria-label={t('core:action.copy_link')}
                    onClick={handleCopyCurrentLink}
                    tabIndex={canCopyCurrentLink ? 0 : -1}
                    sx={{
                      alignItems: 'center',
                      borderRadius: '8px',
                      color: theme.palette.text.secondary,
                      display: 'flex',
                      flexShrink: 0,
                      height: 26,
                      justifyContent: 'center',
                      minWidth: 26,
                      transition:
                        'background-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                      width: 26,
                      '&:hover': {
                        backgroundColor: buttonHoverBackground,
                        color: theme.palette.text.primary,
                        transform: 'translateY(-1px)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                      },
                      '&:active': {
                        transform: 'translateY(0)',
                        boxShadow: 'none',
                      },
                      '&:focus-visible': {
                        outline: `1px solid ${theme.palette.primary.main}`,
                        outlineOffset: '2px',
                      },
                    }}
                  >
                    <ContentCopyRoundedIcon
                      sx={{
                        display: 'block',
                        flexShrink: 0,
                        fontSize: 15,
                      }}
                    />
                  </ButtonBase>
                </Box>
              </Tooltip>

              <Tooltip
                title={tooltipTitle(
                  isCurrentAppPinned
                    ? t('core:action.unpin', {
                        postProcess: 'capitalizeFirstChar',
                      })
                    : t('core:action.pin', {
                        postProcess: 'capitalizeFirstChar',
                      })
                )}
                placement="bottom"
                arrow
                slotProps={tooltipSlotProps}
              >
                <Box
                  component="span"
                  sx={{
                    display: 'inline-flex',
                    visibility: canPinCurrentApp ? 'visible' : 'hidden',
                  }}
                >
                  <ButtonBase
                    disableRipple
                    aria-label={
                      isCurrentAppPinned
                        ? t('core:action.unpin', {
                            postProcess: 'capitalizeFirstChar',
                          })
                        : t('core:action.pin', {
                            postProcess: 'capitalizeFirstChar',
                          })
                    }
                    onClick={handleTogglePinnedApp}
                    tabIndex={canPinCurrentApp ? 0 : -1}
                    sx={{
                      alignItems: 'center',
                      borderRadius: '8px',
                      color: isCurrentAppPinned
                        ? theme.palette.primary.main
                        : theme.palette.text.secondary,
                      display: 'flex',
                      flexShrink: 0,
                      height: 26,
                      justifyContent: 'center',
                      minWidth: 26,
                      transition:
                        'background-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                      width: 26,
                      '&:hover': {
                        backgroundColor: buttonHoverBackground,
                        color: isCurrentAppPinned
                          ? theme.palette.primary.main
                          : theme.palette.text.primary,
                        transform: 'translateY(-1px)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                      },
                      '&:active': {
                        transform: 'translateY(0)',
                        boxShadow: 'none',
                      },
                      '&:focus-visible': {
                        outline: `1px solid ${theme.palette.primary.main}`,
                        outlineOffset: '2px',
                      },
                    }}
                  >
                    <PushPinRoundedIcon
                      sx={{
                        display: 'block',
                        flexShrink: 0,
                        fontSize: 16,
                        transform: isCurrentAppPinned
                          ? 'rotate(-18deg)'
                          : 'rotate(0deg)',
                        transition: 'transform 140ms ease',
                      }}
                    />
                  </ButtonBase>
                </Box>
              </Tooltip>

              <ButtonBase
                disableRipple
                onClick={handleOpenInput}
                sx={{
                  alignItems: 'center',
                  borderRadius: '8px',
                  color: theme.palette.text.secondary,
                  display: 'flex',
                  flexShrink: 0,
                  height: 26,
                  justifyContent: 'center',
                  minWidth: 26,
                  transition:
                    'background-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease',
                  width: 26,
                  '&:hover': {
                    backgroundColor: buttonHoverBackground,
                    color: theme.palette.text.primary,
                    transform: 'translateY(-1px)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  },
                  '&:active': {
                    transform: 'translateY(0)',
                    boxShadow: 'none',
                  },
                  '&:focus-visible': {
                    outline: `1px solid ${theme.palette.primary.main}`,
                    outlineOffset: '2px',
                  },
                }}
              >
                <ArrowOutwardIcon
                  sx={{
                    display: 'block',
                    flexShrink: 0,
                    fontSize: 17,
                  }}
                />
              </ButtonBase>
            </Box>
          </Box>
          <Box
            id={QORTAL_GROUP_CALL_NAV_SLOT_ID}
            component={motion.div}
            layout
            transition={utilityLayoutTransition}
            sx={{
              alignItems: 'center',
              display: 'inline-flex',
              flexShrink: 0,
              minWidth: 0,
            }}
          />
          <Box
            id={DIRECT_VOICE_CALL_NAV_SLOT_ID}
            component={motion.div}
            layout
            transition={utilityLayoutTransition}
            sx={{
              alignItems: 'center',
              display: 'inline-flex',
              flexShrink: 0,
              minWidth: 0,
            }}
          />
          {utilityNav && (
            <Box
              component={motion.div}
              layout
              transition={utilityLayoutTransition}
              sx={utilitySectionSx}
            >
              <GlobalActions />
              <Box
                component={motion.span}
                layout
                transition={utilityLayoutTransition}
                sx={{ display: 'inline-flex', flexShrink: 0 }}
              >
                <ChatWidgetReopenIcon
                  inTitleBar
                  buttonSx={utilityModuleButtonSx}
                  iconSx={utilityModuleIconSx}
                />
              </Box>
              <Box
                component={motion.span}
                layout
                transition={utilityLayoutTransition}
                sx={{ display: 'inline-flex', flexShrink: 0 }}
              >
                <QMailStatus
                  compact
                  buttonSx={utilityModuleButtonSx}
                  iconSx={utilityModuleIconSx}
                  tooltipPlacement="bottom"
                />
              </Box>
              {utilityNav.extState === 'authenticated' && (
                <Box
                  component={motion.span}
                  layout
                  transition={utilityLayoutTransition}
                  sx={{ display: 'inline-flex', flexShrink: 0 }}
                >
                  <SubscriptionsStatus
                    compact
                    buttonSx={utilityModuleButtonSx}
                    iconSx={utilityModuleIconSx}
                    tooltipPlacement="bottom"
                  />
                </Box>
              )}
              {utilityNav.extState === 'authenticated' && (
                <Box
                  component={motion.span}
                  layout
                  transition={utilityLayoutTransition}
                  sx={{ display: 'inline-flex', flexShrink: 0 }}
                >
                  <GeneralNotifications
                    address={utilityNav.userInfo?.address}
                    tooltipPlacement="bottom"
                    compact
                    buttonSx={utilityModuleButtonSx}
                    iconSx={utilityModuleIconSx}
                  />
                </Box>
              )}
              {hasActiveTasks && (
                <Box
                  component={motion.span}
                  layout
                  transition={utilityLayoutTransition}
                  sx={{ display: 'inline-flex', flexShrink: 0 }}
                >
                  <TaskManager
                    getUserInfo={utilityNav.getUserInfo}
                    buttonSx={utilityModuleButtonSx}
                    iconSx={utilityModuleIconSx}
                    tooltipSlotProps={tooltipSlotProps}
                    tooltipTitle={tooltipTitle(
                      t('core:message.generic.ongoing_transactions')
                    )}
                  />
                </Box>
              )}
              {utilityNav.extState === 'authenticated' && (
                <Box
                  component={motion.span}
                  layout
                  transition={utilityLayoutTransition}
                  sx={{ display: 'inline-flex', flexShrink: 0 }}
                >
                  <AuthenticatedUserMenu
                    userInfo={utilityNav.userInfo}
                    balance={balance}
                    isBalanceLoading={qortBalanceLoading}
                    buttonSx={utilityModuleButtonSx}
                    tooltipSlotProps={tooltipSlotProps}
                    tooltipTitle={tooltipTitle}
                    onCopied={handleCopyAddressSuccess}
                    onCopyFailed={handleCopyAddressFailed}
                  />
                </Box>
              )}
              <Tooltip
                title={tooltipTitle(t('core:action.logout'))}
                placement="bottom"
                arrow
                slotProps={tooltipSlotProps}
              >
                <Box
                  component={motion.span}
                  layout
                  transition={utilityLayoutTransition}
                  sx={{ display: 'inline-flex', flexShrink: 0 }}
                >
                  <IconButton
                    size="small"
                    onClick={utilityNav.onLogout}
                    sx={utilityModuleButtonSx}
                    aria-label={t('core:action.logout')}
                  >
                    <LogoutRoundedIcon sx={utilityModuleIconSx} />
                  </IconButton>
                </Box>
              </Tooltip>
            </Box>
          )}
        </Box>
      </Box>
    </>
  );
}
