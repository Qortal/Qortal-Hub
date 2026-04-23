import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  ButtonBase,
  Chip,
  CircularProgress,
  Dialog,
  IconButton,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AccountCircleRoundedIcon from '@mui/icons-material/AccountCircleRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import NorthEastRoundedIcon from '@mui/icons-material/NorthEastRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import PersonOffRoundedIcon from '@mui/icons-material/PersonOffRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  infoSnackGlobalAtom,
  isRunningPublicNodeAtom,
  openSnackGlobalAtom,
  userInfoAtom,
} from '../../atoms/global';
import {
  getAddressInfo,
  getNameOrAddress,
} from '../../background/background.ts';
import { getBaseApiReact } from '../../App';
import { getNameInfo } from '../Group/groupApi';
import {
  accountTargetBlocks,
  levelUpBlocks,
  levelUpDays,
  nextLevel,
} from '../Minting/MintingStats.tsx';
import { useBlockedAddresses } from '../../hooks/useBlockUsers';
import { useNameSearch } from '../../hooks/useNameSearch';
import { validateAddress } from '../../utils/validateAddress.ts';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import { formatTimestamp } from '../../utils/time';
import magnifierSvg from '../../assets/user-search/magnifier.svg?raw';
import qortalLogo512 from '../../assets/user-search/qortal-logo-512.png';

type UserLookupProps = {
  isOpenDrawerLookup: boolean;
  setIsOpenDrawerLookup: (open: boolean) => void;
};

type LookupHistoryState = {
  history: string[];
  index: number;
};

type AddressNameEntry = {
  loading: boolean;
  name: string | null;
};

type AddressInfoResult = {
  address: string;
  balance?: number | string;
  blocksMinted?: number;
  blocksMintedAdjustment?: number;
  level?: number;
  name?: string;
  publicKey?: string;
};

type UserSearchIllustrationConfig = {
  magnifierX: number;
  magnifierY: number;
  lensOffsetX: number;
  lensOffsetY: number;
  lensAngleOffset: number;
};

const defaultUserSearchIllustrationConfig: UserSearchIllustrationConfig =
  {
    magnifierX: -9,
    magnifierY: -28,
    lensOffsetX: 5,
    lensOffsetY: -23,
    lensAngleOffset: 18,
  };

function formatAddress(value: string) {
  if (!value || value.length <= 12) return value || '';
  return `${value.slice(0, 6)}....${value.slice(-6)}`;
}

function formatBalance(value: number | string | undefined): string {
  if (value == null || value === '') return '0';
  const numericValue =
    typeof value === 'string' ? parseFloat(value) : Number(value);
  if (Number.isNaN(numericValue)) return '0';
  return numericValue.toLocaleString('en-US', {
    maximumFractionDigits: 4,
    minimumFractionDigits: 2,
  });
}

function formatStatBalance(value: number | string | undefined): string {
  if (value == null || value === '') return '0';
  const numericValue =
    typeof value === 'string' ? parseFloat(value) : Number(value);
  if (Number.isNaN(numericValue)) return '0';
  return numericValue.toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

function UserSearchIllustration({
  glowColor,
  logoSrc,
  magnifierMarkup,
}: {
  glowColor: string;
  logoSrc: string;
  magnifierMarkup: string;
}) {
  const illustrationConfig = defaultUserSearchIllustrationConfig;

  return (
    <Box
      className="user-search-gnel"
      sx={{
        '@keyframes qortalFloat': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        '@keyframes qortalFloatLens': {
          '0%, 100%': {
            transform: `translateY(0px) rotate(${illustrationConfig.lensAngleOffset}deg) scale(1.03)`,
          },
          '50%': {
            transform: `translateY(-6px) rotate(${illustrationConfig.lensAngleOffset}deg) scale(1.03)`,
          },
        },
        '@keyframes magnifierDrift': {
          '0%, 100%': {
            transform: 'rotate(-20deg) translateY(0px) translateX(0px)',
          },
          '50%': {
            transform: 'rotate(-17deg) translateY(-2px) translateX(2px)',
          },
        },
        '@keyframes dotPulse': {
          '0%, 100%': { opacity: 0.16, transform: 'scale(1)' },
          '50%': { opacity: 0.42, transform: 'scale(1.18)' },
        },
        '--user-search-mag-left': {
          xs: `${104 + illustrationConfig.magnifierX}px`,
          md: `${112 + illustrationConfig.magnifierX}px`,
        },
        '--user-search-mag-top': {
          xs: `${12 + illustrationConfig.magnifierY}px`,
          md: `${10 + illustrationConfig.magnifierY}px`,
        },
        '--user-search-mag-size': '154px',
        '--user-search-logo-left': { xs: '58px', md: '66px' },
        '--user-search-logo-top': { xs: '14px', md: '12px' },
        '--user-search-logo-size': { xs: '96px', md: '106px' },
        color: glowColor,
        height: { xs: 182, md: 196 },
        position: 'relative',
        width: { xs: 232, md: 248 },
        '&::before': {
          background: `radial-gradient(circle, ${alpha(glowColor, 0.16)} 0%, ${alpha(
            glowColor,
            0.08
          )} 30%, transparent 74%)`,
          borderRadius: '50%',
          content: '""',
          height: { xs: 136, md: 146 },
          left: { xs: 52, md: 60 },
          position: 'absolute',
          top: { xs: 12, md: 10 },
          width: { xs: 136, md: 146 },
          zIndex: 0,
        },
        '& .user-search-gnel__magnifier': {
          animation: 'magnifierDrift 4.8s ease-in-out infinite',
          filter: `drop-shadow(0 0 18px ${alpha(glowColor, 0.18)})`,
          height: 'var(--user-search-mag-size)',
          left: 'var(--user-search-mag-left)',
          opacity: 0.95,
          position: 'absolute',
          top: 'var(--user-search-mag-top)',
          transform: 'rotate(-20deg)',
          transformOrigin: '50% 50%',
          zIndex: 3,
          width: 'var(--user-search-mag-size)',
          '& svg': {
            display: 'block',
            height: '100%',
            width: '100%',
          },
        },
        '& .user-search-gnel__logo': {
          animation: 'qortalFloat 3.6s ease-in-out infinite',
          filter: `drop-shadow(0 0 14px ${alpha(glowColor, 0.24)})`,
          height: 'var(--user-search-logo-size)',
          left: 'var(--user-search-logo-left)',
          pointerEvents: 'none',
          position: 'absolute',
          top: 'var(--user-search-logo-top)',
          zIndex: 1,
          width: 'var(--user-search-logo-size)',
        },
        '& .user-search-gnel__lens-logo': {
          animation: 'magnifierDrift 4.8s ease-in-out infinite',
          clipPath: 'circle(28px at 56px 55px)',
          height: 'var(--user-search-mag-size)',
          left: 'var(--user-search-mag-left)',
          overflow: 'hidden',
          pointerEvents: 'none',
          position: 'absolute',
          top: 'var(--user-search-mag-top)',
          transform: 'rotate(-20deg)',
          transformOrigin: '50% 50%',
          width: 'var(--user-search-mag-size)',
          zIndex: 2,
        },
        '& .user-search-gnel__lens-logo img': {
          animation: 'qortalFloatLens 3.6s ease-in-out infinite',
          filter: `brightness(1.08) drop-shadow(0 0 10px ${alpha(glowColor, 0.18)})`,
          height: 'calc(var(--user-search-logo-size) * 1.03)',
          left: `calc(var(--user-search-logo-left) - var(--user-search-mag-left) + ${illustrationConfig.lensOffsetX}px)`,
          position: 'absolute',
          top: `calc(var(--user-search-logo-top) - var(--user-search-mag-top) + ${illustrationConfig.lensOffsetY}px)`,
          transformOrigin: 'center center',
          width: 'calc(var(--user-search-logo-size) * 1.03)',
        },
        '& .user-search-gnel__lens-glass': {
          backdropFilter: 'brightness(1.06)',
          background: 'radial-gradient(circle at 42% 36%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 58%, rgba(255,255,255,0.01) 100%)',
          borderRadius: '50%',
          height: 56,
          left: 28,
          position: 'absolute',
          top: 27,
          width: 56,
        },
        '& .user-search-gnel__dots': {
          display: 'flex',
          gap: '6px',
          left: { xs: 118, md: 128 },
          pointerEvents: 'none',
          position: 'absolute',
          top: { xs: 70, md: 68 },
          zIndex: 4,
        },
        '& .user-search-gnel__dots span': {
          animation: 'dotPulse 1.8s ease-in-out infinite',
          background: 'currentColor',
          borderRadius: '50%',
          height: 3,
          opacity: 0.22,
          width: 3,
        },
        '& .user-search-gnel__dots span:nth-of-type(2)': {
          animationDelay: '0.15s',
        },
        '& .user-search-gnel__dots span:nth-of-type(3)': {
          animationDelay: '0.3s',
        },
        '& .user-search-gnel__dots span:nth-of-type(4)': {
          animationDelay: '0.45s',
        },
        '& .user-search-gnel__dots span:nth-of-type(5)': {
          animationDelay: '0.6s',
        },
      }}
    >
      <Box
        className="user-search-gnel__magnifier"
        dangerouslySetInnerHTML={{ __html: magnifierMarkup }}
      />

      <Box
        className="user-search-gnel__logo"
        component="img"
        alt=""
        src={logoSrc}
      />

      <Box className="user-search-gnel__lens-logo" aria-hidden>
        <Box className="user-search-gnel__lens-glass" />
        <Box component="img" alt="" src={logoSrc} />
      </Box>

      <Box className="user-search-gnel__dots">
        <span />
        <span />
        <span />
        <span />
        <span />
      </Box>
      </Box>
    );
}

export const UserLookup = ({
  isOpenDrawerLookup,
  setIsOpenDrawerLookup,
}: UserLookupProps) => {
  const theme = useTheme();
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const currentUser = useAtomValue(userInfoAtom);
  const isRunningPublicNode = useAtomValue(isRunningPublicNodeAtom);
  const setInfoSnack = useSetAtom(infoSnackGlobalAtom);
  const setOpenSnack = useSetAtom(openSnackGlobalAtom);
  const { addToBlockList, isUserBlocked, removeBlockFromList } =
    useBlockedAddresses(true);

  const [nameOrAddress, setNameOrAddress] = useState('');
  const [inputValue, setInputValue] = useState('');
  const { results, isLoading } = useNameSearch(inputValue);
  const [errorMessage, setErrorMessage] = useState('');
  const [addressInfo, setAddressInfo] = useState<AddressInfoResult | null>(null);
  const [nodeStatus, setNodeStatus] = useState<any>(null);
  const [adminInfo, setAdminInfo] = useState<any>(null);
  const [nodeHeightBlock, setNodeHeightBlock] = useState<any>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(false);
  const [isLoadingPayments, setIsLoadingPayments] = useState(false);
  const [payments, setPayments] = useState<any[]>([]);
  const [totalPaymentsCount, setTotalPaymentsCount] = useState(0);
  const [paymentsPage, setPaymentsPage] = useState(0);
  const [paymentsRowsPerPage, setPaymentsRowsPerPage] = useState(5);
  const [addressNamesMap, setAddressNamesMap] = useState<
    Record<string, AddressNameEntry>
  >({});
    const [lookupHistory, setLookupHistory] = useState<LookupHistoryState>({
      history: [],
      index: -1,
    });
    const [isBlockActionPending, setIsBlockActionPending] = useState(false);

    const tRef = useRef(t);
    tRef.current = t;
    const lookupInProgressRef = useRef(false);
    const lastFetchedOwnerRef = useRef<string | null>(null);

  const currentUserName =
    typeof currentUser?.name === 'string' && currentUser.name.trim().length > 0
      ? currentUser.name.trim()
      : '';
  const currentUserAddress =
    typeof currentUser?.address === 'string' ? currentUser.address : '';
  const targetUserName =
    typeof addressInfo?.name === 'string' ? addressInfo.name.trim() : '';
  const isCurrentUserProfile =
    !!addressInfo?.address &&
    (addressInfo.address === currentUserAddress ||
      (targetUserName && targetUserName === currentUserName));
  const isBlocked =
    !!addressInfo?.address && isUserBlocked(addressInfo.address, targetUserName);

  const lookupOptions = useMemo(() => {
    if (!inputValue.trim()) {
      return results?.map((item) => item.name) ?? [];
    }

    if (validateAddress(inputValue)) {
      return [inputValue];
    }

    return results?.map((item) => item.name) ?? [];
  }, [inputValue, results]);

  const pushSnack = useCallback(
    (type: 'error' | 'info' | 'success', message: string) => {
      setInfoSnack({ compact: true, duration: 3200, message, type });
      setOpenSnack(true);
    },
    [setInfoSnack, setOpenSnack]
  );

  const resetLookupState = useCallback(() => {
    setNameOrAddress('');
    setInputValue('');
    setErrorMessage('');
    setPayments([]);
    setTotalPaymentsCount(0);
    setNodeStatus(null);
    setAdminInfo(null);
    setNodeHeightBlock(null);
    setPaymentsPage(0);
    setIsLoadingUser(false);
    setIsLoadingPayments(false);
    setAddressInfo(null);
    setAddressNamesMap({});
    setLookupHistory({ history: [], index: -1 });
    setIsBlockActionPending(false);
    lastFetchedOwnerRef.current = null;
  }, []);

  const closeLookup = useCallback(() => {
    setIsOpenDrawerLookup(false);
    resetLookupState();
  }, [resetLookupState, setIsOpenDrawerLookup]);

  const lookupFunc = useCallback(
    async (
      requestedAddressOrName: string,
      options?: { skipHistoryPush?: boolean }
    ) => {
      const lookupInput = requestedAddressOrName.trim();
      if (!lookupInput || lookupInProgressRef.current) {
        return;
      }

      lookupInProgressRef.current = true;

      try {
        const owner = await getNameOrAddress(lookupInput);

        if (!owner) {
          throw new Error(
            tRef.current('auth:message.error.name_not_existing', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        }

        if (!options?.skipHistoryPush && lastFetchedOwnerRef.current === owner) {
          lookupInProgressRef.current = false;
          return;
        }

        lastFetchedOwnerRef.current = owner;

        setErrorMessage('');
        setIsLoadingUser(true);
        setIsLoadingPayments(true);
        setPayments([]);
        setTotalPaymentsCount(0);
        setAddressInfo(null);
        setNodeStatus(null);
        setAdminInfo(null);
        setNodeHeightBlock(null);
        setPaymentsPage(0);

        const addressInfoResponse = await getAddressInfo(owner);

        if (!addressInfoResponse?.publicKey) {
          throw new Error(
            tRef.current('auth:message.error.address_not_existing', {
              postProcess: 'capitalizeFirstChar',
            })
          );
        }

        const isAddressSearch = validateAddress(lookupInput);
        const registeredName = !isAddressSearch
          ? lookupInput
          : await getNameInfo(owner);
        const baseUrl = getBaseApiReact();

        const balanceResponse = await fetch(`${baseUrl}/addresses/balance/${owner}`);
        const balance = await balanceResponse.json();

        setAddressInfo({
          ...addressInfoResponse,
          address: owner,
          balance,
          name: registeredName,
        });

        if (!options?.skipHistoryPush) {
          setLookupHistory((previous) => {
            const nextHistory = previous.history.slice(0, previous.index + 1);
            nextHistory.push(owner);
            const boundedHistory =
              nextHistory.length > 50 ? nextHistory.slice(-50) : nextHistory;
            return {
              history: boundedHistory,
              index: boundedHistory.length - 1,
            };
          });
        }

        try {
          const statusResponse = await fetch(`${baseUrl}/admin/status`);
          if (statusResponse.ok) {
            const nextNodeStatus = await statusResponse.json();
            setNodeStatus(nextNodeStatus);

            if (nextNodeStatus?.height != null) {
              const blockHeight = nextNodeStatus.height - 1440;
              const blockResponse = await fetch(
                `${baseUrl}/blocks/byheight/${blockHeight}`
              );
              if (blockResponse.ok) {
                setNodeHeightBlock(await blockResponse.json());
              }

              const adminResponse = await fetch(`${baseUrl}/admin/info`);
              if (adminResponse.ok) {
                setAdminInfo(await adminResponse.json());
              }
            }
          }
        } catch {
          // non-fatal
        }

        const paymentsResponse = await fetch(
          `${baseUrl}/transactions/search?txType=PAYMENT&address=${owner}&confirmationStatus=CONFIRMED&limit=500&reverse=true`
        );
        const paymentsData = await paymentsResponse.json();
        const nextPayments = Array.isArray(paymentsData) ? paymentsData : [];
        setPayments(nextPayments);
        setTotalPaymentsCount(nextPayments.length);
      } catch (error: any) {
        setErrorMessage(error?.message || 'Unable to look up this user.');
      } finally {
        lookupInProgressRef.current = false;
        setIsLoadingUser(false);
        setIsLoadingPayments(false);
      }
    },
    []
  );

  const fetchNameForAddress = useCallback((address: string) => {
    if (!address) return;

    setAddressNamesMap((previous) => {
      const existing = previous[address];
      if (existing) {
        return previous;
      }
      return {
        ...previous,
        [address]: { loading: true, name: null },
      };
    });

    getNameInfo(address)
      .then((name) => {
        setAddressNamesMap((previous) => ({
          ...previous,
          [address]: { loading: false, name: name || null },
        }));
      })
      .catch(() => {
        setAddressNamesMap((previous) => ({
          ...previous,
          [address]: { loading: false, name: null },
        }));
      });
  }, []);

  useEffect(() => {
    const addressesToResolve = new Set<string>();
    const currentProfileAddress = addressInfo?.address;

    for (const payment of payments.slice(
      paymentsPage * paymentsRowsPerPage,
      paymentsPage * paymentsRowsPerPage + paymentsRowsPerPage
    )) {
      if (
        payment?.creatorAddress &&
        payment.creatorAddress !== currentProfileAddress &&
        !addressNamesMap[payment.creatorAddress]
      ) {
        addressesToResolve.add(payment.creatorAddress);
      }

      if (
        payment?.recipient &&
        payment.recipient !== currentProfileAddress &&
        !addressNamesMap[payment.recipient]
      ) {
        addressesToResolve.add(payment.recipient);
      }
    }

    addressesToResolve.forEach(fetchNameForAddress);
  }, [
    addressInfo?.address,
    addressNamesMap,
    fetchNameForAddress,
    payments,
    paymentsPage,
    paymentsRowsPerPage,
  ]);

  const openUserLookupDrawerFunc = useCallback(
    (event: CustomEvent) => {
      setIsOpenDrawerLookup(true);
      const requestedAddressOrName = event.detail?.addressOrName;
      if (requestedAddressOrName) {
        setNameOrAddress(requestedAddressOrName);
        setInputValue(requestedAddressOrName);
        void lookupFunc(requestedAddressOrName);
      }
    },
    [lookupFunc, setIsOpenDrawerLookup]
  );

  useEffect(() => {
    subscribeToEvent('openUserLookupDrawer', openUserLookupDrawerFunc);

    return () => {
      unsubscribeFromEvent('openUserLookupDrawer', openUserLookupDrawerFunc);
    };
  }, [openUserLookupDrawerFunc]);

  const goBack = useCallback(() => {
    const previousIndex = lookupHistory.index - 1;
    if (previousIndex < 0) {
      return;
    }

    const previousAddress = lookupHistory.history[previousIndex];
    lastFetchedOwnerRef.current = null;
    setNameOrAddress(previousAddress);
    setInputValue(previousAddress);
    setLookupHistory((previous) => ({ ...previous, index: previousIndex }));
    void lookupFunc(previousAddress, { skipHistoryPush: true });
  }, [lookupFunc, lookupHistory.history, lookupHistory.index]);

  const goForward = useCallback(() => {
    const nextIndex = lookupHistory.index + 1;
    if (nextIndex >= lookupHistory.history.length) {
      return;
    }

    const nextAddress = lookupHistory.history[nextIndex];
    lastFetchedOwnerRef.current = null;
    setNameOrAddress(nextAddress);
    setInputValue(nextAddress);
    setLookupHistory((previous) => ({ ...previous, index: nextIndex }));
    void lookupFunc(nextAddress, { skipHistoryPush: true });
  }, [lookupFunc, lookupHistory.history, lookupHistory.index]);

  const handleSearchSubmit = useCallback(() => {
    if (!inputValue.trim()) {
      return;
    }

    setNameOrAddress(inputValue.trim());
    void lookupFunc(inputValue.trim());
  }, [inputValue, lookupFunc]);

  const handleCopyAddress = useCallback(() => {
    if (!addressInfo?.address) {
      return;
    }

    navigator.clipboard.writeText(addressInfo.address);
    pushSnack(
      'success',
      'Address copied to clipboard'
    );
  }, [addressInfo?.address, pushSnack, t]);

  const handleToggleBlock = useCallback(async () => {
    if (!addressInfo?.address || isCurrentUserProfile || isRunningPublicNode) {
      return;
    }

    setIsBlockActionPending(true);

    try {
      if (isBlocked) {
        await removeBlockFromList(addressInfo.address, targetUserName);
        pushSnack(
          'success',
          t('auth:action.unblock_name', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      } else {
        await addToBlockList(addressInfo.address, targetUserName);
        pushSnack(
          'success',
          t('auth:action.block_name', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      }
    } catch (error: any) {
      pushSnack(
        'error',
        error?.message ||
          t('auth:message.error.block_user', {
            postProcess: 'capitalizeFirstChar',
          })
      );
    } finally {
      setIsBlockActionPending(false);
    }
  }, [
    addToBlockList,
    addressInfo?.address,
    isBlocked,
    isCurrentUserProfile,
    isRunningPublicNode,
    pushSnack,
    removeBlockFromList,
    t,
    targetUserName,
  ]);

  const handleSendQort = useCallback(() => {
    if (!addressInfo?.address) {
      return;
    }

    executeEvent('openPaymentInternal', {
      address: addressInfo.address,
      name: addressInfo.name,
    });
    closeLookup();
  }, [addressInfo?.address, addressInfo?.name, closeLookup]);

  const currentBlocks =
    (addressInfo?.blocksMinted ?? 0) + (addressInfo?.blocksMintedAdjustment ?? 0);
  const targetBlocks =
    addressInfo?.level != null
      ? accountTargetBlocks(addressInfo.level)
      : undefined;
  const progress =
    targetBlocks != null && targetBlocks > 0
      ? Math.min(1, currentBlocks / targetBlocks)
      : 0;
  const remainingBlocks =
    addressInfo && nodeStatus
      ? levelUpBlocks(addressInfo, nodeStatus)
      : targetBlocks != null
        ? Math.max(0, targetBlocks - currentBlocks)
        : 0;
  const daysToLevel =
    addressInfo && nodeStatus && adminInfo && nodeHeightBlock
      ? levelUpDays(addressInfo, adminInfo, nodeHeightBlock, nodeStatus)
      : undefined;
  const nextLevelNumber =
    addressInfo?.level != null ? nextLevel(addressInfo.level) : undefined;

  const { totalReceived, totalSent } = useMemo(() => {
    const ownerAddress = addressInfo?.address;

    if (!ownerAddress || payments.length === 0) {
      return {
        totalReceived: undefined,
        totalSent: undefined,
      };
    }

    let received = 0;
    let sent = 0;

    for (const payment of payments) {
      const amount = parseFloat(payment?.amount ?? '0') || 0;
      if (payment?.recipient === ownerAddress) {
        received += amount;
      }
      if (payment?.creatorAddress === ownerAddress) {
        sent += amount;
      }
    }

    return {
      totalReceived: received,
      totalSent: sent,
    };
  }, [addressInfo?.address, payments]);

  const paginatedPayments = useMemo(() => {
    const startIndex = paymentsPage * paymentsRowsPerPage;
    return payments.slice(startIndex, startIndex + paymentsRowsPerPage);
  }, [payments, paymentsPage, paymentsRowsPerPage]);

  const canGoBack = lookupHistory.index > 0;
  const canGoForward =
    lookupHistory.index >= 0 && lookupHistory.index < lookupHistory.history.length - 1;
  const isEmptyLookupState = !errorMessage && !isLoadingUser && !addressInfo;

  const surfaceBorder = alpha(theme.palette.divider, 0.42);
  const dividerColor = alpha(
    theme.palette.common.white,
    theme.palette.mode === 'dark' ? 0.04 : 0.07
  );
  const summarySurface = theme.palette.mode === 'dark'
    ? 'linear-gradient(180deg, rgba(23,27,35,0.98) 0%, rgba(17,20,27,0.985) 100%)'
    : 'linear-gradient(180deg, rgba(248,250,253,0.985) 0%, rgba(241,245,250,0.99) 100%)';
  const sectionSurface = alpha(
    theme.palette.mode === 'dark'
      ? theme.palette.common.white
      : theme.palette.text.primary,
    theme.palette.mode === 'dark' ? 0.026 : 0.036
  );
  const softSectionSurface = alpha(
    theme.palette.mode === 'dark'
      ? theme.palette.common.white
      : theme.palette.text.primary,
    theme.palette.mode === 'dark' ? 0.018 : 0.028
  );
  const sectionLabelSx = {
    color: alpha(theme.palette.text.secondary, 0.64),
    display: 'block',
    fontSize: '0.68rem',
    fontWeight: 700,
    letterSpacing: '0.11em',
    lineHeight: 1.1,
    textTransform: 'uppercase',
  } as const;
  const helperNoteSx = {
    color: alpha(theme.palette.text.secondary, 0.8),
    fontSize: '0.84rem',
    lineHeight: 1.55,
  } as const;
  const silkyActionBackground =
    theme.palette.mode === 'dark'
      ? 'linear-gradient(180deg, rgba(144,184,244,0.985) 0%, rgba(118,160,227,0.985) 100%)'
      : 'linear-gradient(180deg, rgba(125,168,235,0.985) 0%, rgba(98,145,220,0.985) 100%)';
  const silkyDangerBackground =
    theme.palette.mode === 'dark'
      ? 'linear-gradient(180deg, rgba(244,143,143,0.985) 0%, rgba(221,92,92,0.985) 100%)'
      : 'linear-gradient(180deg, rgba(230,120,120,0.985) 0%, rgba(208,82,82,0.985) 100%)';
  const neutralActionBackground =
    theme.palette.mode === 'dark'
      ? 'linear-gradient(180deg, rgba(76,84,100,0.96) 0%, rgba(58,64,77,0.96) 100%)'
      : 'linear-gradient(180deg, rgba(197,204,216,0.98) 0%, rgba(176,184,198,0.98) 100%)';

  const createSilkyActionButtonSx = (
    background: string,
    textColor: string,
    shadow: string,
    disabledBackground = neutralActionBackground,
    disabledTextColor = alpha(
      theme.palette.mode === 'dark' ? '#E7ECF7' : '#243247',
      0.7
    )
  ) => ({
    background,
    border: `1px solid ${alpha(theme.palette.common.white, 0.18)}`,
    borderRadius: '10px',
    boxShadow: shadow,
    color: textColor,
    fontSize: '0.78rem',
    fontWeight: 700,
    gap: 0.7,
    justifyContent: 'center',
    letterSpacing: '0.01em',
    minHeight: 40,
    px: 1.35,
    textAlign: 'center',
    textTransform: 'none',
    whiteSpace: 'nowrap',
    '& .MuiButton-startIcon': {
      marginLeft: 0,
      marginRight: 0,
    },
    '& .MuiSvgIcon-root': {
      fontSize: '1rem',
    },
    '&.Mui-disabled': {
      background: disabledBackground,
      borderColor: alpha(theme.palette.common.white, 0.12),
      color: disabledTextColor,
      boxShadow:
        theme.palette.mode === 'dark'
          ? 'inset 0 1px 0 rgba(255,255,255,0.08), 0 6px 18px rgba(18,22,31,0.16)'
          : 'inset 0 1px 0 rgba(255,255,255,0.2), 0 6px 18px rgba(117,127,144,0.12)',
      opacity: 1,
    },
  });

  const sendActionButtonSx = createSilkyActionButtonSx(
    silkyActionBackground,
    theme.palette.mode === 'dark' ? '#0F1725' : '#F8FBFF',
    theme.palette.mode === 'dark'
      ? 'inset 0 1px 0 rgba(255,255,255,0.16), 0 10px 24px rgba(59,98,168,0.18)'
      : 'inset 0 1px 0 rgba(255,255,255,0.3), 0 10px 22px rgba(82,126,201,0.16)',
    neutralActionBackground
  );

  const blockActionButtonSx = createSilkyActionButtonSx(
    silkyDangerBackground,
    '#FFF6F6',
    theme.palette.mode === 'dark'
      ? 'inset 0 1px 0 rgba(255,255,255,0.14), 0 10px 24px rgba(135,40,40,0.22)'
      : 'inset 0 1px 0 rgba(255,255,255,0.28), 0 10px 22px rgba(170,56,56,0.18)',
    neutralActionBackground,
    alpha(theme.palette.mode === 'dark' ? '#D9DFEA' : '#314055', 0.78)
  );

  const statRows = [
    {
      label: t('core:balance', { postProcess: 'capitalizeFirstChar' }),
      value: `${formatBalance(addressInfo?.balance)} QORT`,
    },
    {
      label: t('core:total_received', { postProcess: 'capitalizeFirstChar' }),
      value:
        totalReceived != null ? `${formatBalance(totalReceived)} QORT` : '—',
    },
    {
      label: t('core:total_sent', { postProcess: 'capitalizeFirstChar' }),
      value: totalSent != null ? `${formatBalance(totalSent)} QORT` : '—',
    },
    {
      label: t('core:total_blocks_minted', {
        postProcess: 'capitalizeFirstChar',
      }),
      value: currentBlocks.toLocaleString(),
    },
  ];

  const displayStatRows = [
    {
      label: t('core:balance', { postProcess: 'capitalizeFirstChar' }),
      value: `${formatStatBalance(addressInfo?.balance)} QORT`,
    },
    {
      label: t('core:total_received', { postProcess: 'capitalizeFirstChar' }),
      value:
        totalReceived != null ? `${formatStatBalance(totalReceived)} QORT` : 'â€”',
    },
    {
      label: t('core:total_sent', { postProcess: 'capitalizeFirstChar' }),
      value: totalSent != null ? `${formatStatBalance(totalSent)} QORT` : 'â€”',
    },
    {
      label: t('core:total_blocks_minted', {
        postProcess: 'capitalizeFirstChar',
      }),
      value: currentBlocks.toLocaleString(),
    },
  ];

  const renderActionButton = (
    button: React.ReactNode,
    tooltip?: string,
    disabled?: boolean
  ) => {
    if (!tooltip) {
      return button;
    }

    return (
      <Tooltip title={tooltip}>
        <Box component="span" sx={{ width: '100%' }}>
          {button}
        </Box>
      </Tooltip>
    );
  };

  const profileActionButtons = (
    <>
      {renderActionButton(
        <Button
          fullWidth
          variant="contained"
          onClick={handleSendQort}
          disabled={isCurrentUserProfile}
          startIcon={<NorthEastRoundedIcon />}
          sx={sendActionButtonSx}
        >
          Send QORT
        </Button>,
        isCurrentUserProfile ? 'This is your own profile' : undefined
      )}

      {renderActionButton(
        <Button
          fullWidth
          variant="contained"
          onClick={handleToggleBlock}
          startIcon={
            isBlockActionPending ? (
              <CircularProgress color="inherit" size={16} />
            ) : (
              <PersonOffRoundedIcon />
            )
          }
          disabled={
            isCurrentUserProfile ||
            isRunningPublicNode ||
            isBlockActionPending ||
            !addressInfo?.address
          }
          sx={blockActionButtonSx}
        >
          {isBlocked ? 'Unblock' : 'Block'}
        </Button>,
        isRunningPublicNode
          ? 'Blocking users is unavailable while running on a public node.'
          : isCurrentUserProfile
            ? 'You cannot block yourself.'
            : undefined,
        isRunningPublicNode || isCurrentUserProfile
      )}
    </>
  );

  return (
    <Dialog
      open={isOpenDrawerLookup}
      onClose={closeLookup}
      fullWidth
      maxWidth={false}
      slotProps={{
        backdrop: {
          sx: {
            backdropFilter: 'blur(12px)',
            backgroundColor: alpha('#07090D', 0.72),
          },
        },
        paper: {
          sx: {
            background:
              theme.palette.mode === 'dark'
                ? 'linear-gradient(180deg, rgba(20,23,30,0.985) 0%, rgba(15,17,23,0.99) 100%)'
                : 'linear-gradient(180deg, rgba(251,253,255,0.985) 0%, rgba(244,247,251,0.99) 100%)',
            border: `1px solid ${surfaceBorder}`,
            borderRadius: '14px',
            boxShadow:
              theme.palette.mode === 'dark'
                ? '0 34px 120px rgba(0,0,0,0.46)'
                : '0 28px 88px rgba(18,28,45,0.16)',
            height: {
              xs: 'calc(100vh - 32px)',
              md: 'min(78vh, 860px)',
              lg: 'min(74vh, 820px)',
            },
            margin: { xs: 2, md: 3 },
            maxHeight: 'calc(100vh - 24px)',
            overflow: 'hidden',
            width: 'min(1140px, calc(100vw - 48px))',
          },
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          position: 'relative',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.42)}`,
            display: 'flex',
            gap: 1,
            justifyContent: 'space-between',
            px: { xs: 2, md: 2.75 },
            py: 1.1,
          }}
        >
          <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.5 }}>
            <IconButton
              onClick={goBack}
              disabled={!canGoBack}
              size="small"
              sx={{
                color: canGoBack
                  ? theme.palette.text.primary
                  : theme.palette.text.disabled,
              }}
            >
              <ArrowBackRoundedIcon fontSize="small" />
            </IconButton>
            <IconButton
              onClick={goForward}
              disabled={!canGoForward}
              size="small"
              sx={{
                color: canGoForward
                  ? theme.palette.text.primary
                  : theme.palette.text.disabled,
              }}
            >
              <ArrowForwardRoundedIcon fontSize="small" />
            </IconButton>
          </Box>

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: 1,
              justifyContent: 'center',
              minWidth: 0,
            }}
          >
            <SearchRoundedIcon
              sx={{
                color: alpha(theme.palette.primary.main, 0.9),
                fontSize: '1.05rem',
              }}
            />
            <Typography
              sx={{
                fontSize: '1rem',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
              }}
            >
              User search
            </Typography>
            </Box>

            <Box sx={{ alignItems: 'center', display: 'flex', gap: 0.5 }}>
              <IconButton
                onClick={closeLookup}
                size="small"
                sx={{
                  color: theme.palette.text.secondary,
              }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        <Box
          sx={{
            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.35)}`,
            px: { xs: 2, md: 2.75 },
            py: { xs: 1.05, md: 1.15 },
          }}
        >
          <Autocomplete
            freeSolo
            value={nameOrAddress}
            onChange={(_event, newValue) => {
              const nextValue = typeof newValue === 'string' ? newValue.trim() : '';
              if (!nextValue) {
                setNameOrAddress('');
                return;
              }

              setNameOrAddress(nextValue);
              setInputValue(nextValue);
              void lookupFunc(nextValue);
            }}
            inputValue={inputValue}
            onInputChange={(_event, newInputValue) => {
              setInputValue(newInputValue);
            }}
            loading={isLoading}
            noOptionsText={t('core:option_no', {
              postProcess: 'capitalizeFirstChar',
            })}
            options={lookupOptions}
            renderInput={(params) => (
              <TextField
                {...params}
                autoFocus
                id="user-lookup-address-name"
                placeholder={t('auth:message.generic.name_address', {
                  postProcess: 'capitalizeFirstChar',
                })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleSearchSubmit();
                  }
                }}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {isLoading ? (
                        <CircularProgress
                          color="inherit"
                          size={18}
                          sx={{ mr: 0.5 }}
                        />
                      ) : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: alpha(
                      theme.palette.mode === 'dark'
                        ? theme.palette.common.white
                        : theme.palette.text.primary,
                      theme.palette.mode === 'dark' ? 0.03 : 0.028
                    ),
                    borderRadius: '12px',
                    boxShadow: 'none',
                    height: 44,
                    pr: 0.75,
                    transition:
                      'background-color 180ms ease, border-color 180ms ease, box-shadow 200ms ease',
                    '& fieldset': {
                      borderColor: alpha(
                        theme.palette.common.white,
                        theme.palette.mode === 'dark' ? 0.14 : 0.18
                      ),
                      borderWidth: '0.75px',
                    },
                    '&:hover fieldset': {
                      borderColor: alpha(
                        theme.palette.common.white,
                        theme.palette.mode === 'dark' ? 0.18 : 0.22
                      ),
                    },
                    '&.Mui-focused': {
                      boxShadow: `inset 0 0 0 1px ${alpha(
                        theme.palette.primary.main,
                        theme.palette.mode === 'dark' ? 0.18 : 0.14
                      )}`,
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: alpha(
                        theme.palette.primary.main,
                        theme.palette.mode === 'dark' ? 0.2 : 0.16
                      ),
                      borderWidth: '0.75px',
                    },
                  },
                }}
              />
            )}
          />
        </Box>

        <Box
          sx={{
            display: 'flex',
            flex: '1 1 auto',
            minHeight: 0,
            overflowX: 'hidden',
            overflowY: { xs: 'auto', md: 'hidden' },
            px: { xs: 2, md: 2.75 },
            py: { xs: 1.6, md: 2.4 },
          }}
        >
          {errorMessage && !isLoadingUser ? (
            <Box
              sx={{
                alignItems: 'center',
                backgroundColor: alpha(theme.palette.error.main, 0.08),
                border: `1px solid ${alpha(theme.palette.error.main, 0.2)}`,
                borderRadius: '20px',
                display: 'flex',
                flex: 1,
                justifyContent: 'center',
                px: 3,
                py: 4,
                textAlign: 'center',
              }}
            >
              <Typography color="error">{errorMessage}</Typography>
            </Box>
          ) : null}

          {!errorMessage && isLoadingUser ? (
            <Box
              sx={{
                alignItems: 'center',
                color: theme.palette.text.secondary,
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                gap: 1.5,
                justifyContent: 'center',
              }}
            >
              <CircularProgress
                size={42}
                thickness={4}
                sx={{ color: theme.palette.primary.main }}
              />
              <Typography variant="body2">
                {t('core:loading.generic', {
                  postProcess: 'capitalizeFirstChar',
                })}
              </Typography>
            </Box>
          ) : null}

            {isEmptyLookupState ? (
                <Box
                  sx={{
                    alignItems: 'center',
                    backgroundColor: softSectionSurface,
                  border: `1px solid ${alpha(theme.palette.divider, 0.26)}`,
                  borderRadius: '12px',
                  display: 'flex',
                  flex: 1,
                  flexDirection: 'column',
                  gap: { xs: 1.85, md: 2.2 },
                  justifyContent: 'center',
                    overflow: 'hidden',
                    px: 3,
                    py: { xs: 5, md: 5.5 },
                    position: 'relative',
                    textAlign: 'center',
                  '&::before': {
                    background: `radial-gradient(circle at 50% 55%, ${alpha(
                      theme.palette.primary.main,
                      0.12
                    )} 0%, ${alpha(theme.palette.primary.main, 0.05)} 26%, transparent 74%)`,
                    content: '""',
                    inset: 0,
                    pointerEvents: 'none',
                    position: 'absolute',
                    zIndex: 0,
                  },
                  '& > *': {
                    position: 'relative',
                    zIndex: 1,
                  },
                }}
                >
                  <UserSearchIllustration
                    glowColor={alpha(theme.palette.primary.main, 0.92)}
                  logoSrc={qortalLogo512}
                  magnifierMarkup={magnifierSvg}
                />
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: { xs: 0.15, md: 0.25 },
                      mt: '-10px',
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: { xs: '1.28rem', md: '1.38rem' },
                        fontWeight: 800,
                        letterSpacing: '-0.014em',
                        lineHeight: 1.14,
                      }}
                    >
                      Search accounts
                    </Typography>
                    <Typography
                      sx={{
                        color: alpha(theme.palette.text.primary, 0.76),
                        fontSize: { xs: '0.96rem', md: '1rem' },
                        maxWidth: '34ch',
                        lineHeight: 1.55,
                      }}
                    >
                      Enter a name or address
                    </Typography>
                  </Box>
              </Box>
            ) : null}

          {!errorMessage && !isLoadingUser && addressInfo ? (
            <Box
              sx={{
                display: { xs: 'flex', md: 'grid' },
                flex: 1,
                flexDirection: { xs: 'column', md: 'row' },
                gap: { xs: 1.5, md: 0 },
                gridTemplateColumns: { md: '296px minmax(0, 1fr)' },
                minHeight: 0,
                overflowX: 'hidden',
                overflowY: { xs: 'visible', md: 'hidden' },
                width: '100%',
              }}
            >
              <Box
                sx={{
                  alignSelf: { xs: 'stretch', md: 'start' },
                  background: summarySurface,
                  border: `1px solid ${alpha(theme.palette.divider, 0.28)}`,
                  borderRadius: '12px',
                  display: 'flex',
                  flexShrink: 0,
                  flexDirection: 'column',
                  gap: 1.35,
                  justifySelf: { md: 'start' },
                  minWidth: 0,
                  overflow: 'hidden',
                  p: 1.7,
                  width: { xs: '100%', md: 'min(100%, 284px)' },
                }}
              >
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.15,
                    minWidth: 0,
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1.05,
                      justifyContent: 'center',
                      textAlign: 'center',
                    }}
                  >
                    {addressInfo.name ? (
                      <Avatar
                        alt={addressInfo.name}
                        src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${addressInfo.name}/qortal_avatar?async=true`}
                        sx={{
                          border: `3px solid ${alpha(
                            theme.palette.common.white,
                            theme.palette.mode === 'dark' ? 0.08 : 0.54
                          )}`,
                          boxShadow:
                            theme.palette.mode === 'dark'
                              ? '0 16px 40px rgba(0,0,0,0.24)'
                              : '0 16px 36px rgba(18,28,45,0.12)',
                          height: 108,
                          width: 108,
                        }}
                      >
                        <AccountCircleRoundedIcon sx={{ fontSize: 78 }} />
                      </Avatar>
                    ) : (
                      <Box
                        sx={{
                          alignItems: 'center',
                          backgroundColor: alpha(theme.palette.primary.main, 0.12),
                          borderRadius: '50%',
                          color: theme.palette.primary.main,
                          display: 'flex',
                          height: 108,
                          justifyContent: 'center',
                          width: 108,
                        }}
                      >
                        <AccountCircleRoundedIcon sx={{ fontSize: 78 }} />
                      </Box>
                    )}

                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        sx={{
                          fontSize: '1.02rem',
                          fontWeight: 700,
                          letterSpacing: '-0.025em',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {addressInfo.name ||
                          t('auth:message.error.name_not_registered', {
                            postProcess: 'capitalizeFirstChar',
                          })}
                      </Typography>
                    </Box>

                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 0.75,
                        justifyContent: 'center',
                      }}
                    >
                      <Chip
                        label={`Level ${addressInfo.level ?? 0}`}
                        size="small"
                        sx={{
                          backgroundColor: alpha(theme.palette.primary.main, 0.14),
                          color: theme.palette.primary.light,
                          fontWeight: 700,
                        }}
                      />
                      {isBlocked ? (
                        <Chip
                          icon={<ShieldRoundedIcon />}
                          label="Blocked"
                          size="small"
                          sx={{
                            backgroundColor: alpha(theme.palette.error.main, 0.12),
                            color: theme.palette.error.light,
                            fontWeight: 700,
                          }}
                        />
                      ) : null}
                      {!addressInfo.name ? (
                        <Chip
                          label="No registered name"
                          size="small"
                          sx={{
                            backgroundColor: alpha(
                              theme.palette.text.secondary,
                              0.12
                            ),
                            color: theme.palette.text.secondary,
                          }}
                        />
                      ) : null}
                    </Box>
                  </Box>

                  {targetBlocks != null ? (
                    <Box
                      sx={{
                        backgroundColor: softSectionSurface,
                        border: `1px solid ${alpha(theme.palette.divider, 0.22)}`,
                        borderRadius: '10px',
                        p: 1.25,
                      }}
                    >
                      <Typography sx={sectionLabelSx}>
                        Minting progress
                      </Typography>
                      <LinearProgress
                        value={progress * 100}
                        variant="determinate"
                        sx={{
                          backgroundColor: alpha(theme.palette.primary.main, 0.12),
                          borderRadius: '999px',
                          height: 10,
                          mt: 1,
                          '& .MuiLinearProgress-bar': {
                            borderRadius: '999px',
                          },
                        }}
                      />
                      <Typography
                        sx={{ fontSize: '0.84rem', fontWeight: 700, mt: 0.85 }}
                      >
                        {currentBlocks.toLocaleString()} /{' '}
                        {targetBlocks.toLocaleString()}
                      </Typography>
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: '0.8rem',
                          mt: 0.4,
                        }}
                      >
                        {nextLevelNumber != null
                          ? `${remainingBlocks.toLocaleString()} to level ${nextLevelNumber}`
                          : `${remainingBlocks.toLocaleString()} remaining`}
                      </Typography>
                      {daysToLevel != null && daysToLevel >= 0 ? (
                        <Typography
                          sx={{
                            color: theme.palette.text.secondary,
                            fontSize: '0.8rem',
                            mt: 0.25,
                          }}
                        >
                          Minting for: ~{Math.round(daysToLevel)} days
                        </Typography>
                      ) : null}
                    </Box>
                  ) : null}
                </Box>

                <Box
                  sx={{
                    display: 'grid',
                    gap: 0.8,
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    minWidth: 0,
                    position: 'relative',
                    pt: 0.35,
                    zIndex: 1,
                  }}
                >
                  {profileActionButtons}
                </Box>
              </Box>

              <Box
                sx={{
                  borderLeft: {
                    xs: 'none',
                    md: `1px solid ${dividerColor}`,
                  },
                  display: 'flex',
                  flexDirection: 'column',
                  flexShrink: 0,
                  gap: 1.55,
                  minHeight: 0,
                  overflow: { xs: 'visible', md: 'hidden' },
                  pl: { xs: 0, md: 2.3 },
                }}
              >
                <Box
                  sx={{
                    backgroundColor: softSectionSurface,
                    border: `1px solid ${alpha(theme.palette.divider, 0.22)}`,
                    borderRadius: '12px',
                    display: 'grid',
                    gap: 0,
                    gridTemplateColumns: {
                      xs: 'repeat(2, minmax(0, 1fr))',
                      md: 'repeat(4, minmax(0, 1fr))',
                    },
                    overflow: 'hidden',
                  }}
                >
                  {displayStatRows.map((row, index) => (
                    <Box
                      key={row.label}
                      sx={{
                        borderLeft: {
                          xs:
                            index % 2 === 1
                              ? `1px solid ${dividerColor}`
                              : 'none',
                          md: index > 0 ? `1px solid ${dividerColor}` : 'none',
                        },
                        borderTop: {
                          xs: index >= 2 ? `1px solid ${dividerColor}` : 'none',
                          md: 'none',
                        },
                        minWidth: 0,
                        p: 1.25,
                      }}
                    >
                      <Typography sx={sectionLabelSx}>
                        {row.label}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: '0.88rem',
                          fontWeight: 700,
                          letterSpacing: '-0.02em',
                          mt: 0.35,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {row.value}
                      </Typography>
                    </Box>
                  ))}
                </Box>

                <Box
                  sx={{
                    backgroundColor: softSectionSurface,
                    border: `1px solid ${alpha(theme.palette.divider, 0.22)}`,
                    borderRadius: '12px',
                    display: 'grid',
                    gap: 0,
                    gridTemplateColumns: { xs: '1fr', md: '1.35fr 0.9fr' },
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      minWidth: 0,
                      p: 1.35,
                    }}
                  >
                    <Typography sx={sectionLabelSx}>
                      Address
                    </Typography>
                    <ButtonBase
                      onClick={handleCopyAddress}
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        gap: 0.9,
                        justifyContent: 'flex-start',
                        mt: 0.45,
                        textAlign: 'left',
                      }}
                    >
                      <Typography
                        sx={{
                          fontFamily: 'monospace',
                          fontSize: '0.82rem',
                          lineHeight: 1.52,
                          wordBreak: 'break-all',
                        }}
                      >
                        {addressInfo.address}
                      </Typography>
                      <ContentCopyRoundedIcon sx={{ fontSize: '1rem' }} />
                    </ButtonBase>
                  </Box>

                  <Box
                    sx={{
                      borderLeft: {
                        xs: 'none',
                        md: `1px solid ${dividerColor}`,
                      },
                      borderTop: {
                        xs: `1px solid ${dividerColor}`,
                        md: 'none',
                      },
                      minWidth: 0,
                      p: 1.35,
                    }}
                  >
                    <Typography sx={sectionLabelSx}>
                      Public key
                    </Typography>
                    <Typography
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.74rem',
                        lineHeight: 1.45,
                        mt: 0.5,
                        opacity: 0.86,
                        wordBreak: 'break-all',
                      }}
                    >
                      {addressInfo.publicKey || '—'}
                    </Typography>
                  </Box>
                </Box>

                <Box
                  sx={{
                    backgroundColor: softSectionSurface,
                    border: `1px solid ${alpha(theme.palette.divider, 0.22)}`,
                    borderRadius: '12px',
                    display: 'flex',
                    flex: '1 1 auto',
                    flexDirection: 'column',
                    minHeight: { xs: 280, md: 0 },
                    overflow: 'hidden',
                    p: 1.15,
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      justifyContent: 'flex-start',
                      pb: 0.9,
                      px: 0.4,
                    }}
                  >
                    <Box>
                      <Typography
                        sx={{
                          fontSize: '0.92rem',
                          fontWeight: 800,
                          letterSpacing: '-0.03em',
                        }}
                      >
                        Recent payments
                      </Typography>
                      <Typography
                        sx={{
                          ...helperNoteSx,
                          mt: 0.2,
                        }}
                      >
                        {t('core:payments_count', {
                          count: totalPaymentsCount,
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </Typography>
                    </Box>
                  </Box>

                  <TableContainer
                    sx={{
                      border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
                      borderRadius: '10px',
                      flex: '1 1 auto',
                      minHeight: 0,
                    }}
                  >
                    <Table
                      size="small"
                      stickyHeader
                      sx={{
                        '& .MuiTableCell-root': {
                          borderColor: alpha(theme.palette.divider, 0.16),
                          py: 1.15,
                        },
                        '& .MuiTableHead-root .MuiTableCell-head': {
                          backgroundColor:
                            theme.palette.mode === 'dark'
                              ? alpha(theme.palette.common.white, 0.025)
                              : '#EEF2F7',
                          color: alpha(theme.palette.text.secondary, 0.72),
                          fontSize: '0.66rem',
                          fontWeight: 700,
                          letterSpacing: '0.09em',
                          textTransform: 'uppercase',
                        },
                        '& .MuiTableBody-root .MuiTableCell-root': {
                          fontSize: '0.78rem',
                        },
                        '& .MuiTableRow-hover:hover': {
                          backgroundColor: alpha(theme.palette.primary.main, 0.04),
                        },
                      }}
                    >
                      <TableHead>
                        <TableRow>
                          <TableCell>Sender</TableCell>
                          <TableCell>Receiver</TableCell>
                          <TableCell align="right">Amount</TableCell>
                          <TableCell align="right">Time</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {isLoadingPayments ? (
                          <TableRow>
                            <TableCell align="center" colSpan={4} sx={{ py: 4 }}>
                              <CircularProgress size={22} />
                            </TableCell>
                          </TableRow>
                        ) : null}

                        {!isLoadingPayments && paginatedPayments.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} sx={{ py: 3 }}>
                              {t('core:message.generic.no_payments', {
                                postProcess: 'capitalizeFirstChar',
                              })}
                            </TableCell>
                          </TableRow>
                        ) : null}

                        {!isLoadingPayments
                          ? paginatedPayments.map((payment) => {
                              const ownerAddress = addressInfo.address;
                              const senderAddress = payment?.creatorAddress || '';
                              const receiverAddress = payment?.recipient || '';
                              const senderEntry = addressNamesMap[senderAddress];
                              const receiverEntry = addressNamesMap[receiverAddress];
                              const senderLabel =
                                senderAddress === ownerAddress
                                  ? addressInfo.name?.trim() || formatAddress(senderAddress)
                                  : senderEntry?.name || formatAddress(senderAddress);
                              const receiverLabel =
                                receiverAddress === ownerAddress
                                  ? addressInfo.name?.trim() || formatAddress(receiverAddress)
                                  : receiverEntry?.name || formatAddress(receiverAddress);

                              const handleLookupAddress = (address: string) => {
                                if (!address || address === ownerAddress) {
                                  return;
                                }

                                setNameOrAddress(address);
                                setInputValue(address);
                                void lookupFunc(address);
                              };

                              return (
                                <TableRow
                                  hover
                                  key={payment?.signature ?? payment?.timestamp}
                                >
                                  <TableCell>
                                    {senderAddress === ownerAddress ? (
                                      <Typography
                                        sx={{ fontSize: '0.76rem', fontWeight: 500 }}
                                      >
                                        {senderLabel}
                                      </Typography>
                                    ) : (
                                      <ButtonBase
                                        onClick={() => handleLookupAddress(senderAddress)}
                                        sx={{ textAlign: 'left' }}
                                      >
                                        <Typography
                                          sx={{
                                            color: theme.palette.primary.main,
                                            fontSize: '0.76rem',
                                            fontWeight: 600,
                                          }}
                                        >
                                          {senderLabel}
                                        </Typography>
                                      </ButtonBase>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {receiverAddress === ownerAddress ? (
                                      <Typography
                                        sx={{ fontSize: '0.76rem', fontWeight: 500 }}
                                      >
                                        {receiverLabel}
                                      </Typography>
                                    ) : (
                                      <ButtonBase
                                        onClick={() =>
                                          handleLookupAddress(receiverAddress)
                                        }
                                        sx={{ textAlign: 'left' }}
                                      >
                                        <Typography
                                          sx={{
                                            color: theme.palette.primary.main,
                                            fontSize: '0.76rem',
                                            fontWeight: 600,
                                          }}
                                        >
                                          {receiverLabel}
                                        </Typography>
                                      </ButtonBase>
                                    )}
                                  </TableCell>
                                  <TableCell
                                    align="right"
                                    sx={{
                                      fontSize: '0.76rem',
                                      fontWeight: 700,
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {formatBalance(payment?.amount)} QORT
                                  </TableCell>
                                  <TableCell
                                    align="right"
                                    sx={{
                                      color: theme.palette.text.secondary,
                                      fontSize: '0.74rem',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {formatTimestamp(payment?.timestamp)}
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          : null}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  <TablePagination
                    component="div"
                    count={totalPaymentsCount}
                    onPageChange={(_event, page) => setPaymentsPage(page)}
                    onRowsPerPageChange={(event) => {
                      setPaymentsRowsPerPage(parseInt(event.target.value, 10));
                      setPaymentsPage(0);
                    }}
                    page={paymentsPage}
                    rowsPerPage={paymentsRowsPerPage}
                    rowsPerPageOptions={[5, 10, 20]}
                    sx={{
                      borderTop: `1px solid ${alpha(theme.palette.divider, 0.16)}`,
                      mt: 1,
                      '& .MuiTablePagination-toolbar': {
                        minHeight: 42,
                        px: 0.5,
                      },
                      '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
                        color: theme.palette.text.secondary,
                        fontSize: '0.74rem',
                        fontWeight: 500,
                        m: 0,
                      },
                      '& .MuiTablePagination-select': {
                        fontSize: '0.76rem',
                        fontWeight: 600,
                        py: 0.25,
                      },
                      '& .MuiTablePagination-actions .MuiIconButton-root': {
                        p: 0.5,
                      },
                    }}
                  />
                </Box>
              </Box>
            </Box>
          ) : null}
        </Box>
      </Box>
    </Dialog>
  );
};
