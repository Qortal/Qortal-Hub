import {
  type ChangeEvent,
  type MouseEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Avatar,
  Badge,
  Box,
  ButtonBase,
  Dialog,
  GlobalStyles,
  Menu,
  MenuItem,
  Portal,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { LoadingButton } from '@mui/lab';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import CloseIcon from '@mui/icons-material/Close';
import ErrorIcon from '@mui/icons-material/Error';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import PersonIcon from '@mui/icons-material/Person';
import QrCode2RoundedIcon from '@mui/icons-material/QrCode2Rounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  blockedAddressesAtom,
  blockedNamesAtom,
  enabledDevModeAtom,
  rawWalletAtom,
  userInfoAtom,
  openSnackGlobalAtom,
  infoSnackGlobalAtom,
} from '../../atoms/global';
import {
  isIdleAtom,
  type SelectableStatus,
} from '../../atoms/presence';
import { statusDotColor, useMyStatus } from '../../hooks/usePresence';
import { QORTAL_APP_CONTEXT } from '../../App';
import { getFee, walletVersion } from '../../background/background.ts';
import Base58 from '../../encryption/Base58';
import ImageUploader from '../../common/ImageUploader';
import { MAX_SIZE_AVATAR } from '../../constants/constants.ts';
import { decryptStoredWallet } from '../../utils/decryptWallet';
import { fileToBase64 } from '../../utils/fileReading';
import PhraseWallet from '../../utils/generateWallet/phrase-wallet';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import {
  getBaseApiReact,
  getBaseApiReactForAvatar,
} from '../../utils/globalApi';
import {
  dashboardPanelSx,
  handleDashboardPanelPointerLeave,
  handleDashboardPanelPointerMove,
  useDashboardPanelMouseLight,
} from './dashboardPanelEffects';
import { DecryptedText } from '../common/DecryptedText';
import { getBlueTier1ButtonSx } from '../../styles/blueMaterial';
import BorderGlow from '../common/BorderGlow';
import TiltedCard from '../common/TiltedCard';
import { GROUP_ACTIVITY_BLUE } from './groupActivityColorSystem';
import { Save } from '../Save/Save';
import { useBlockedAddresses } from '../../hooks/useBlockUsers';

type HomeProfileCardProps = {
  onOpenReceive?: (anchorEl: HTMLElement) => void;
};

type PresenceDisplayStatus = SelectableStatus | 'idle';
type NameAvailability = 'available' | 'loading' | 'not-available' | 'null';
type AccountSettingsTab =
  | 'blocked'
  | 'developer'
  | 'profile'
  | 'security'
  | 'system';

const ACCOUNT_SETTINGS_PRIVACY_STORAGE_KEY =
  'home_account_settings_privacy_mode';
const ACCOUNT_SETTINGS_UI_ANIMATIONS_STORAGE_KEY = 'hub_ui_animations_enabled';
const ACCOUNT_STATUS_DEFS: Array<{
  key: SelectableStatus;
}> = [
  {
    key: 'online',
  },
  {
    key: 'busy',
  },
  {
    key: 'offline',
  },
];

const readStoredBoolean = (key: string, fallback: boolean) => {
  if (typeof window === 'undefined') return fallback;

  try {
    const storedValue = window.localStorage.getItem(key);

    if (storedValue === null) return fallback;

    return JSON.parse(storedValue);
  } catch (error) {
    console.warn(`Unable to read stored boolean for ${key}.`, error);
    return fallback;
  }
};

export const HomeProfileCard = ({ onOpenReceive }: HomeProfileCardProps) => {
  const { t } = useTranslation(['tutorial', 'core', 'group']);
  const theme = useTheme();
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const userInfo = useAtomValue(userInfoAtom);
  const rawWallet = useAtomValue(rawWalletAtom);
  const blockedAddresses = useAtomValue(blockedAddressesAtom);
  const blockedNames = useAtomValue(blockedNamesAtom);
  const setUserInfo = useSetAtom(userInfoAtom);
  const setOpenSnack = useSetAtom(openSnackGlobalAtom);
  const setInfoSnack = useSetAtom(infoSnackGlobalAtom);
  const [isEnabledDevMode, setIsEnabledDevMode] = useAtom(enabledDevModeAtom);

  const avatarAnchorRef = useRef<HTMLButtonElement | null>(null);
  const avatarPanelRef = useRef<HTMLDivElement | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [tempAvatar, setTempAvatar] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [avatarAnchorEl, setAvatarAnchorEl] = useState<HTMLElement | null>(
    null
  );
  const [avatarPanelOriginRect, setAvatarPanelOriginRect] =
    useState<DOMRect | null>(null);
  const [avatarPanelHeight, setAvatarPanelHeight] = useState(430);
  const [isAvatarLoading, setIsAvatarLoading] = useState(false);
  const avatarPanelWasOpenRef = useRef(false);
  const [isAddressFieldHovered, setIsAddressFieldHovered] = useState(false);
  const [isAvatarGlowHovered, setIsAvatarGlowHovered] = useState(false);
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] =
    useState<AccountSettingsTab>('profile');
  const [changeNameValue, setChangeNameValue] = useState('');
  const [isChangeNameLoading, setIsChangeNameLoading] = useState(false);
  const [changeNameAvailability, setChangeNameAvailability] =
    useState<NameAvailability>('null');
  const [changeNameFee, setChangeNameFee] = useState<string | number | null>(
    null
  );
  const [currentNameDescription, setCurrentNameDescription] = useState('');
  const [isCurrentNameMetaLoading, setIsCurrentNameMetaLoading] =
    useState(false);
  const [currentNameMetaError, setCurrentNameMetaError] = useState<
    string | null
  >(null);
  const [changeNamePassword, setChangeNamePassword] = useState('');
  const [isChangeNamePasswordEditable, setIsChangeNamePasswordEditable] =
    useState(false);
  const [isPrivacyModeActive, setIsPrivacyModeActive] = useState(() =>
    readStoredBoolean(ACCOUNT_SETTINGS_PRIVACY_STORAGE_KEY, false)
  );
  const [areAppNotificationsEnabled, setAreAppNotificationsEnabled] =
    useState(true);
  const [areUiAnimationsEnabled, setAreUiAnimationsEnabled] = useState(() =>
    readStoredBoolean(ACCOUNT_SETTINGS_UI_ANIMATIONS_STORAGE_KEY, true)
  );
  const [securityPassword, setSecurityPassword] = useState('');
  const [isSecurityPasswordEditable, setIsSecurityPasswordEditable] =
    useState(false);
  const [revealedPrivateKey, setRevealedPrivateKey] = useState('');
  const [privateKeyError, setPrivateKeyError] = useState<string | null>(null);
  const [isRevealingPrivateKey, setIsRevealingPrivateKey] = useState(false);
  const [accountStatusAnchorEl, setAccountStatusAnchorEl] =
    useState<HTMLElement | null>(null);
  const [myStatus, setMyStatus] = useMyStatus();
  const isIdle = useAtomValue(isIdleAtom);
  const { refreshBlockedUsers, removeBlockFromList } =
    useBlockedAddresses(true);
  const panelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const prefersReducedMotion = useReducedMotion();
  const isDarkMode = theme.palette.mode === 'dark';
  const avatarModalSurface = isDarkMode
    ? 'linear-gradient(145deg, rgba(49,54,64,0.985) 0%, rgba(35,39,47,0.992) 48%, rgba(24,27,33,0.996) 100%)'
    : 'linear-gradient(180deg, rgba(251,253,255,0.985) 0%, rgba(244,247,251,0.99) 100%)';
  const avatarModalSurfaceSoft = isDarkMode
    ? 'linear-gradient(145deg, rgba(94,101,114,0.34) 0%, rgba(72,78,89,0.3) 100%)'
    : alpha(theme.palette.text.primary, 0.035);
  const avatarFieldSurface = isDarkMode
    ? 'linear-gradient(145deg, rgba(88,95,108,0.2) 0%, rgba(56,62,73,0.28) 44%, rgba(37,41,49,0.42) 100%)'
    : 'linear-gradient(180deg, rgba(17,23,34,0.042) 0%, rgba(17,23,34,0.024) 100%)';
  const avatarFieldSurfaceHover = isDarkMode
    ? 'linear-gradient(145deg, rgba(98,106,120,0.24) 0%, rgba(63,70,82,0.34) 46%, rgba(43,48,57,0.48) 100%)'
    : 'linear-gradient(180deg, rgba(17,23,34,0.06) 0%, rgba(17,23,34,0.034) 100%)';
  const avatarFieldBorder = isDarkMode
    ? 'rgba(255,255,255,0.085)'
    : 'rgba(24,29,36,0.12)';
  const avatarFieldHoverBorder = isDarkMode
    ? 'rgba(255,255,255,0.12)'
    : 'rgba(24,29,36,0.16)';
  const avatarSectionDivider = isDarkMode
    ? 'rgba(255,255,255,0.052)'
    : 'rgba(24,29,36,0.1)';
  const avatarFieldInsetShadow = isDarkMode
    ? '0 8px 20px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.035)'
    : '0 4px 10px rgba(24,32,44,0.06), inset 0 1px 0 rgba(255,255,255,0.5)';
  const avatarWarningTone = isDarkMode
    ? {
        background: 'rgba(189, 143, 73, 0.1)',
        border: 'rgba(189, 143, 73, 0.24)',
        icon: '#C7A56C',
      }
    : {
        background: 'rgba(191, 144, 73, 0.08)',
        border: 'rgba(191, 144, 73, 0.2)',
        icon: '#A97E3F',
      };
  const changeNameNoteTone = isDarkMode
    ? {
        background: 'rgba(132, 176, 240, 0.09)',
        border: 'rgba(132, 176, 240, 0.2)',
        icon: '#8EB8F5',
      }
    : {
        background: 'rgba(90, 126, 196, 0.08)',
        border: 'rgba(90, 126, 196, 0.18)',
        icon: '#5C7EC6',
      };
  const developerNoticeTone = isDarkMode
    ? {
        background: 'rgba(205, 156, 69, 0.1)',
        border: 'rgba(205, 156, 69, 0.2)',
        icon: '#D8AC61',
      }
    : {
        background: 'rgba(191, 132, 46, 0.08)',
        border: 'rgba(191, 132, 46, 0.18)',
        icon: '#A66D1F',
      };
  const settingsSidebarSurface = isDarkMode
    ? 'linear-gradient(180deg, rgba(31,35,43,0.92) 0%, rgba(24,27,33,0.88) 100%)'
    : 'linear-gradient(180deg, rgba(238,242,248,0.76) 0%, rgba(231,236,244,0.88) 100%)';
  const settingsSidebarActiveSurface = isDarkMode
    ? 'linear-gradient(145deg, rgba(73,79,91,0.54) 0%, rgba(50,55,65,0.46) 100%)'
    : 'linear-gradient(145deg, rgba(255,255,255,0.9) 0%, rgba(240,244,250,0.74) 100%)';
  const settingsSidebarAccent = isDarkMode
    ? alpha(theme.palette.primary.light, 0.88)
    : alpha(theme.palette.primary.main, 0.84);
  const privacyBlurClassName = isPrivacyModeActive ? 'privacy-blur' : undefined;
  const td = useCallback(
    (key: string, defaultValue: string, options = {}) =>
      t(`group:dashboard.${key}`, { defaultValue, ...options }),
    [t]
  );
  const accountStatusOptions = useMemo(
    () =>
      ACCOUNT_STATUS_DEFS.map((def) => ({
        ...def,
        color:
          def.key === 'offline'
            ? isDarkMode
              ? alpha(theme.palette.common.white, 0.36)
              : alpha(theme.palette.text.primary, 0.32)
            : statusDotColor(def.key),
        label:
          def.key === 'online'
            ? td('account_status_online', 'Online')
            : def.key === 'busy'
              ? td('account_status_busy', 'Busy')
              : td('account_status_offline', 'Offline'),
      })),
    [isDarkMode, td, theme.palette.common.white, theme.palette.text.primary]
  );
  const accountSettingsTabs = useMemo(
    () => [
      {
        description: td(
          'profile_settings_description',
          'Review your name and account identity.'
        ),
        icon: PersonIcon,
        key: 'profile' as const,
        label: td('profile', 'Profile'),
        title: td('profile_settings', 'Profile Settings'),
      },
      {
        description: td(
          'security_settings_description',
          'Reveal and copy your private key only when absolutely needed.'
        ),
        icon: LockOutlinedIcon,
        key: 'security' as const,
        label: td('security', 'Security'),
        title: td('security_settings', 'Security Settings'),
      },
      {
        description: td(
          'blocked_settings_description',
          'Manage blocked names and addresses for this wallet or across this device.'
        ),
        icon: BlockRoundedIcon,
        key: 'blocked' as const,
        label: td('blocked', 'Blocked'),
        title: td('blocked_settings', 'Blocked Accounts'),
      },
      {
        description: td(
          'developer_settings_description',
          'Enable developer tools and diagnostics for advanced testing.'
        ),
        icon: CodeRoundedIcon,
        key: 'developer' as const,
        label: td('developer', 'Developer'),
        title: td('developer_settings', 'Developer Settings'),
      },
      {
        description: td(
          'system_settings_description',
          'Control notifications, motion, and pinned Q-App backup preferences.'
        ),
        icon: TuneRoundedIcon,
        key: 'system' as const,
        label: td('system', 'System'),
        title: td('system_settings', 'System Settings'),
      },
    ],
    [td]
  );

  const openAvatarPanel = useCallback((target: HTMLElement | null) => {
    if (!target) return;
    setAvatarPanelOriginRect(target.getBoundingClientRect());
    setAvatarAnchorEl(target);
  }, []);

  const closeAvatarPanel = useCallback(() => {
    setAvatarAnchorEl(null);
    setAvatarFile(null);
  }, []);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  useEffect(() => {
    const openFromEvent = () => {
      if (avatarAnchorRef.current) {
        openAvatarPanel(avatarAnchorRef.current);
      }
    };
    subscribeToEvent('openAvatarUpload', openFromEvent);
    return () => unsubscribeFromEvent('openAvatarUpload', openFromEvent);
  }, [openAvatarPanel]);

  useEffect(() => {
    if (!avatarAnchorEl) return;

    const updatePanelMetrics = () => {
      setAvatarPanelOriginRect(avatarAnchorEl.getBoundingClientRect());
      if (avatarPanelRef.current) {
        setAvatarPanelHeight(
          avatarPanelRef.current.getBoundingClientRect().height
        );
      }
    };

    updatePanelMetrics();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && avatarPanelRef.current
        ? new ResizeObserver(() => updatePanelMetrics())
        : null;

    if (resizeObserver && avatarPanelRef.current) {
      resizeObserver.observe(avatarPanelRef.current);
    }

    window.addEventListener('resize', updatePanelMetrics);
    window.addEventListener('scroll', updatePanelMetrics, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updatePanelMetrics);
      window.removeEventListener('scroll', updatePanelMetrics, true);
    };
  }, [avatarAnchorEl]);

  const name = userInfo?.name;
  const address = userInfo?.address;
  const normalizedCurrentName = name?.trim().toLowerCase() ?? '';
  const hasRegisteredName = Boolean(name);
  const accountIdentityPrimaryText = hasRegisteredName
    ? (name ?? '—')
    : (address ?? '—');
  const accountIdentitySecondaryText = address ?? '—';
  const shouldRevealAddressOnHover = hasRegisteredName && Boolean(address);
  const showAnimatedAddress =
    shouldRevealAddressOnHover && isAddressFieldHovered;
  const blockedAddressEntries = useMemo(
    () => Object.keys(blockedAddresses || {}),
    [blockedAddresses]
  );
  const blockedNameEntries = useMemo(
    () => Object.keys(blockedNames || {}),
    [blockedNames]
  );
  const blockedCount = blockedAddressEntries.length + blockedNameEntries.length;
  const addressFieldActionButtonSizePx = 26;
  const addressFieldActionGapPx = 1;
  const addressFieldActionBaseColor = isDarkMode
    ? alpha(theme.palette.common.white, 0.34)
    : alpha(theme.palette.text.primary, 0.4);
  const addressFieldActionHoverColor = isDarkMode
    ? alpha(theme.palette.common.white, 0.68)
    : alpha(theme.palette.text.primary, 0.7);
  const addressFieldActionHoverBackground = isDarkMode
    ? alpha(theme.palette.common.white, 0.055)
    : alpha(theme.palette.text.primary, 0.06);
  const accountStatus: PresenceDisplayStatus =
    isIdle && myStatus !== 'offline' ? 'idle' : myStatus;
  const isAccountStatusMenuOpen = Boolean(accountStatusAnchorEl);
  const accountStatusMeta = useMemo(() => {
    if (accountStatus === 'busy') {
      return {
        color: statusDotColor('busy'),
        label: td('account_status_busy', 'Busy'),
      };
    }

    if (accountStatus === 'offline') {
      return {
        color: isDarkMode
          ? alpha(theme.palette.common.white, 0.36)
          : alpha(theme.palette.text.primary, 0.32),
        label: td('account_status_offline', 'Offline'),
      };
    }

    if (accountStatus === 'idle') {
      return {
        color: statusDotColor('idle'),
        label: td('account_status_idle', 'Idle'),
      };
    }

    return {
      color: statusDotColor('online'),
      label: td('account_status_online', 'Online'),
    };
  }, [
    accountStatus,
    isDarkMode,
    td,
    theme.palette.common.white,
    theme.palette.text.primary,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const storedDevMode = window.localStorage.getItem('isEnabledDevMode');

      if (storedDevMode !== null) {
        setIsEnabledDevMode(JSON.parse(storedDevMode));
      }
    } catch (error) {
      console.warn('Unable to read developer mode preference.', error);
    }
  }, [setIsEnabledDevMode]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.setItem(
        ACCOUNT_SETTINGS_PRIVACY_STORAGE_KEY,
        JSON.stringify(isPrivacyModeActive)
      );
    } catch (error) {
      console.warn('Unable to persist privacy mode preference.', error);
    }
  }, [isPrivacyModeActive]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      window.localStorage.setItem(
        ACCOUNT_SETTINGS_UI_ANIMATIONS_STORAGE_KEY,
        JSON.stringify(areUiAnimationsEnabled)
      );
    } catch (error) {
      console.warn('Unable to persist UI animations preference.', error);
    }
  }, [areUiAnimationsEnabled]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    document.documentElement.dataset.hubUiAnimations = areUiAnimationsEnabled
      ? 'on'
      : 'off';
  }, [areUiAnimationsEnabled]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const styleElementId = 'hub-ui-animations-style';
    let styleElement = document.getElementById(
      styleElementId
    ) as HTMLStyleElement | null;

    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = styleElementId;
      document.head.appendChild(styleElement);
    }

    styleElement.textContent = areUiAnimationsEnabled
      ? ''
      : `
        html[data-hub-ui-animations="off"] *,
        html[data-hub-ui-animations="off"] *::before,
        html[data-hub-ui-animations="off"] *::after {
          animation-duration: 0.01ms !important;
          animation-iteration-count: 1 !important;
          scroll-behavior: auto !important;
          transition-delay: 0ms !important;
          transition-duration: 0.01ms !important;
        }
      `;
  }, [areUiAnimationsEnabled]);

  const loadAppNotificationsPreference = useCallback(async () => {
    try {
      const response = await window.sendMessage('getUserSettings', {
        key: 'disable-push-notifications',
      });
      setAreAppNotificationsEnabled(!(response || false));
    } catch (error) {
      console.error('Unable to load app notification preference.', error);
    }
  }, []);

  const closeAccountSettingsModal = useCallback(() => {
    if (isChangeNameLoading) return;
    setIsAccountSettingsOpen(false);
    setChangeNameValue('');
    setChangeNameAvailability('null');
    setCurrentNameMetaError(null);
    setChangeNamePassword('');
    setIsChangeNamePasswordEditable(false);
    setSecurityPassword('');
    setIsSecurityPasswordEditable(false);
    setPrivateKeyError(null);
    setRevealedPrivateKey('');
  }, [isChangeNameLoading]);

  const openAccountSettingsModal = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      setIsAccountSettingsOpen(true);
      setActiveSettingsTab('profile');
      setChangeNameValue('');
      setChangeNameAvailability('null');
      setChangeNamePassword('');
      setIsChangeNamePasswordEditable(false);
      setSecurityPassword('');
      setIsSecurityPasswordEditable(false);
      setPrivateKeyError(null);
      setRevealedPrivateKey('');
      loadAppNotificationsPreference();
    },
    [loadAppNotificationsPreference]
  );

  useEffect(() => {
    if (!isAccountSettingsOpen || activeSettingsTab !== 'blocked') return;

    // Q-Apps such as Quitter can update Core block lists outside Hub's atoms.
    // Refresh on tab entry so the blocked section reflects the active wallet scope.
    refreshBlockedUsers().catch((error) => {
      console.error('Unable to refresh blocked users.', error);
    });
  }, [activeSettingsTab, isAccountSettingsOpen, refreshBlockedUsers]);

  const handleOpenAccountStatusMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      setAccountStatusAnchorEl(event.currentTarget);
    },
    []
  );

  const handleCloseAccountStatusMenu = useCallback(() => {
    setAccountStatusAnchorEl(null);
  }, []);

  const handleSelectAccountStatus = useCallback(
    (nextStatus: SelectableStatus) => {
      setMyStatus(nextStatus);
      setAccountStatusAnchorEl(null);
    },
    [setMyStatus]
  );

  const handleTogglePrivacyMode = useCallback(() => {
    setIsPrivacyModeActive((previousState) => !previousState);
  }, []);

  const handleToggleAppNotifications = useCallback(
    async (_event: ChangeEvent<HTMLInputElement>, checked: boolean) => {
      const shouldReduceNotifications = checked;
      setAreAppNotificationsEnabled(!shouldReduceNotifications);

      try {
        await window.sendMessage('addUserSettings', {
          keyValue: {
            key: 'disable-push-notifications',
            value: shouldReduceNotifications,
          },
        });
      } catch (error) {
        setAreAppNotificationsEnabled(shouldReduceNotifications);
        setInfoSnack({
          type: 'error',
          message: td(
            'notifications_update_error',
            'We could not update app notifications right now.'
          ),
        });
        setOpenSnack(true);
      }
    },
    [setInfoSnack, setOpenSnack, td]
  );

  const handleToggleDevMode = useCallback(
    (_event: ChangeEvent<HTMLInputElement>, checked: boolean) => {
      setIsEnabledDevMode(checked);

      if (typeof window === 'undefined') return;

      try {
        window.localStorage.setItem(
          'isEnabledDevMode',
          JSON.stringify(checked)
        );
      } catch (error) {
        console.warn('Unable to persist developer mode preference.', error);
      }
    },
    [setIsEnabledDevMode]
  );

  const handleToggleUiAnimations = useCallback(
    (_event: ChangeEvent<HTMLInputElement>, checked: boolean) => {
      setAreUiAnimationsEnabled(!checked);
    },
    []
  );

  const revealPrivateKey = useCallback(async () => {
    if (!rawWallet) {
      setPrivateKeyError(
        td('wallet_unavailable_error', 'Wallet data is unavailable right now.')
      );
      return;
    }

    if (!securityPassword.trim()) {
      setPrivateKeyError(
        td(
          'wallet_password_required',
          'Enter your wallet password to decrypt the private key.'
        )
      );
      return;
    }

    try {
      setIsRevealingPrivateKey(true);
      setPrivateKeyError(null);

      const walletCopy = structuredClone(rawWallet);
      const decryptedSeed = await decryptStoredWallet(
        securityPassword,
        walletCopy
      );
      const phraseWallet = new PhraseWallet(
        decryptedSeed,
        walletCopy?.version || walletVersion
      );
      const derivedPrivateKey = Base58.encode(
        phraseWallet._addresses[0].keyPair.privateKey
      );

      setRevealedPrivateKey(derivedPrivateKey);
    } catch (error) {
      setRevealedPrivateKey('');
      setPrivateKeyError(
        error instanceof Error && error.message
          ? td(
              'wallet_decrypt_error_with_message',
              'We could not decrypt your wallet: {{message}}',
              {
                message: error.message,
              }
            )
          : td(
              'wallet_decrypt_error',
              'We could not decrypt your wallet with that password.'
            )
      );
    } finally {
      setIsRevealingPrivateKey(false);
    }
  }, [rawWallet, securityPassword, td]);

  const copyPrivateKey = useCallback(() => {
    if (!revealedPrivateKey) return;

    navigator.clipboard.writeText(revealedPrivateKey);
    setInfoSnack({
      type: 'success',
      message: td('private_key_copied', 'Private key copied to clipboard.'),
    });
    setOpenSnack(true);
  }, [revealedPrivateKey, setInfoSnack, setOpenSnack, td]);

  const avatarUrl =
    tempAvatar ??
    (name && !avatarError
      ? `${getBaseApiReactForAvatar()}/arbitrary/THUMBNAIL/${name}/qortal_avatar?async=true`
      : null);

  const handleCopyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setInfoSnack({
      compact: true,
      duration: 3000,
      type: 'info',
      message: t('tutorial:home.address_copied', {
        postProcess: 'capitalizeFirstChar',
      }),
    });
    setOpenSnack(true);
  };

  const checkIfNameExists = useCallback(
    async (candidateName: string) => {
      const trimmedName = candidateName.trim();

      if (!trimmedName) {
        setChangeNameAvailability('null');
        return;
      }

      if (trimmedName.toLowerCase() === normalizedCurrentName) {
        setChangeNameAvailability('not-available');
        return;
      }

      setChangeNameAvailability('loading');

      try {
        const response = await fetch(
          `${getBaseApiReact()}/names/${trimmedName}`
        );
        const data = await response.json();

        if (data?.message === 'name unknown' || data?.error) {
          setChangeNameAvailability('available');
        } else {
          setChangeNameAvailability('not-available');
        }
      } catch (error) {
        setChangeNameAvailability('available');
      }
    },
    [normalizedCurrentName]
  );

  useEffect(() => {
    if (!isAccountSettingsOpen || activeSettingsTab !== 'profile') return;

    const handler = window.setTimeout(() => {
      checkIfNameExists(changeNameValue);
    }, 400);

    return () => window.clearTimeout(handler);
  }, [
    activeSettingsTab,
    changeNameValue,
    checkIfNameExists,
    isAccountSettingsOpen,
  ]);

  useEffect(() => {
    if (!isAccountSettingsOpen || activeSettingsTab !== 'profile' || !name)
      return;

    let cancelled = false;

    const loadChangeNameMeta = async () => {
      setIsCurrentNameMetaLoading(true);
      setCurrentNameMetaError(null);

      try {
        const [feeResponse, nameResponse] = await Promise.all([
          getFee('UPDATE_NAME'),
          fetch(`${getBaseApiReact()}/names/${name}`),
        ]);

        if (cancelled) return;

        setChangeNameFee(feeResponse?.fee ?? null);

        const data = await nameResponse.json();

        if (cancelled) return;

        if (
          !nameResponse.ok ||
          data?.error ||
          data?.message === 'name unknown'
        ) {
          throw new Error(
            td(
              'current_name_details_load_failed',
              'We could not load your current name details.'
            )
          );
        }

        const preservedDescription =
          typeof data?.description === 'string'
            ? data.description
            : typeof data?.data === 'string'
              ? data.data
              : '';

        setCurrentNameDescription(preservedDescription);
      } catch (error) {
        if (cancelled) return;

        setCurrentNameMetaError(
          error instanceof Error
            ? error.message
            : td(
                'current_name_details_load_failed',
                'We could not load your current name details.'
              )
        );
      } finally {
        if (!cancelled) {
          setIsCurrentNameMetaLoading(false);
        }
      }
    };

    loadChangeNameMeta();

    return () => {
      cancelled = true;
    };
  }, [activeSettingsTab, isAccountSettingsOpen, name, td]);

  const formattedChangeNameFee = useMemo(() => {
    const numericFee = Number(changeNameFee);

    if (!Number.isFinite(numericFee)) {
      return null;
    }

    return numericFee.toFixed(2);
  }, [changeNameFee]);

  const submitNameChange = useCallback(async () => {
    try {
      const oldName = name?.trim();
      const newName = changeNameValue.trim();

      if (!oldName) {
        throw new Error(
          td(
            'name_change_register_first',
            'Register a name first before changing it.'
          )
        );
      }

      if (!newName) {
        throw new Error(
          td(
            'name_change_enter_new_name',
            'Enter the new name you want to use.'
          )
        );
      }

      if (newName.toLowerCase() === oldName.toLowerCase()) {
        throw new Error(
          td(
            'name_change_different_from_current',
            'Choose a different name from your current one.'
          )
        );
      }

      if (isCurrentNameMetaLoading) {
        throw new Error(
          td(
            'name_change_details_still_loading',
            'Still loading your current name details. Try again in a moment.'
          )
        );
      }

      if (currentNameMetaError) {
        throw new Error(currentNameMetaError);
      }

      if (changeNameAvailability !== 'available') {
        throw new Error(
          td(
            'name_change_choose_available',
            'Choose an available name before continuing.'
          )
        );
      }

      if (!rawWallet) {
        throw new Error(
          td(
            'wallet_unavailable_error',
            'Wallet data is unavailable right now.'
          )
        );
      }

      if (!changeNamePassword.trim()) {
        throw new Error(
          td(
            'name_change_wallet_password_required',
            'Enter your wallet password before changing your name.'
          )
        );
      }

      try {
        const walletCopy = structuredClone(rawWallet);
        await decryptStoredWallet(changeNamePassword, walletCopy);
      } catch {
        throw new Error(
          td(
            'name_change_wallet_password_failed',
            'We could not verify your wallet password.'
          )
        );
      }

      const fee = await getFee('UPDATE_NAME');

      await show({
        message: td(
          'name_change_confirm',
          'Change your registered name from {{oldName}} to {{newName}}?',
          { oldName, newName }
        ),
        publishFee: `${fee.fee} QORT`,
      });

      setIsChangeNameLoading(true);

      const response = await new Promise<any>((resolve, reject) => {
        window
          .sendMessage('updateName', {
            oldName,
            newName,
            description: currentNameDescription,
          })
          .then((messageResponse) => {
            if (!messageResponse?.error) {
              resolve(messageResponse);
              return;
            }

            reject(new Error(messageResponse.error));
          })
          .catch((error) => {
            reject(
              error instanceof Error
                ? error
                : new Error(
                    td(
                      'name_change_unknown_error',
                      'Something went wrong while changing your name.'
                    )
                  )
            );
          });
      });

      setUserInfo(
        userInfo
          ? {
              ...userInfo,
              name: newName,
            }
          : userInfo
      );
      setInfoSnack({
        type: 'success',
        message: td(
          'name_change_success',
          'Name change submitted successfully.'
        ),
      });
      setOpenSnack(true);
      closeAccountSettingsModal();
      executeEvent('nameUpdated', {
        currentName: newName,
        previousName: oldName,
        signature: response?.signature,
      });
    } catch (error) {
      if (error instanceof Error && error.message) {
        setInfoSnack({
          type: 'error',
          message: error.message,
        });
        setOpenSnack(true);
      }
    } finally {
      setIsChangeNameLoading(false);
    }
  }, [
    changeNameAvailability,
    changeNamePassword,
    changeNameValue,
    closeAccountSettingsModal,
    currentNameDescription,
    currentNameMetaError,
    isCurrentNameMetaLoading,
    name,
    rawWallet,
    setInfoSnack,
    setOpenSnack,
    setUserInfo,
    show,
    td,
    userInfo,
  ]);

  const publishAvatar = async () => {
    try {
      const fee = await getFee('ARBITRARY');

      await show({
        message: t('core:message.question.publish_avatar', {
          postProcess: 'capitalizeFirstChar',
        }),
        publishFee: fee.fee + ' QORT',
      });

      setIsAvatarLoading(true);
      const avatarBase64 = await fileToBase64(avatarFile);

      const publishResponse = await window.sendMessage('publishOnQDN', {
        data: avatarBase64,
        identifier: 'qortal_avatar',
        service: 'THUMBNAIL',
        uploadType: 'base64',
      });
      if (publishResponse?.error) {
        throw new Error(
          typeof publishResponse.error === 'string'
            ? publishResponse.error
            : publishResponse.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
        );
      }

      setAvatarFile(null);
      setTempAvatar(`data:image/webp;base64,${avatarBase64}`);
      setAvatarAnchorEl(null);
      executeEvent('avatarUploaded', {});
    } catch (error) {
      setInfoSnack({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                }),
      });
      setOpenSnack(true);
    } finally {
      setIsAvatarLoading(false);
    }
  };

  const isAvatarPanelOpen = Boolean(avatarAnchorEl);
  useEffect(() => {
    if (isAvatarPanelOpen) {
      avatarPanelWasOpenRef.current = true;
      return;
    }

    if (!avatarPanelWasOpenRef.current) {
      return;
    }

    avatarPanelWasOpenRef.current = false;
    executeEvent('avatarUploadClosed', {});
  }, [isAvatarPanelOpen]);

  const avatarPanelOriginRadius = 22;
  const avatarPanelTargetRadius = 20;
  const avatarPanelWidth =
    typeof window === 'undefined'
      ? 332
      : Math.min(352, Math.max(304, window.innerWidth - 32));

  const avatarPanelLayout = useMemo(() => {
    const viewportWidth =
      typeof window !== 'undefined' ? window.innerWidth : avatarPanelWidth + 32;
    const viewportHeight =
      typeof window !== 'undefined' ? window.innerHeight : 800;
    const fallbackLeft = Math.max(16, (viewportWidth - avatarPanelWidth) / 2);
    const fallbackTop = 140;

    if (!avatarPanelOriginRect) {
      return {
        left: fallbackLeft,
        top: fallbackTop,
        width: avatarPanelWidth,
        height: avatarPanelHeight,
      };
    }

    const preferredLeft = avatarPanelOriginRect.left;
    const left = Math.min(
      Math.max(16, preferredLeft),
      Math.max(16, viewportWidth - avatarPanelWidth - 16)
    );

    const preferredTop = avatarPanelOriginRect.top;
    const top = Math.min(
      Math.max(16, preferredTop),
      Math.max(16, viewportHeight - avatarPanelHeight - 16)
    );

    return {
      left,
      top,
      width: avatarPanelWidth,
      height: avatarPanelHeight,
    };
  }, [avatarPanelHeight, avatarPanelOriginRect, avatarPanelWidth]);

  const avatarPanelAnimation = useMemo(() => {
    if (!avatarPanelOriginRect) {
      return {
        initial: { opacity: 0, scale: 0.96 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.96 },
      };
    }

    if (prefersReducedMotion) {
      return {
        initial: { opacity: 0, scale: 0.98 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.98 },
      };
    }

    return {
      initial: {
        opacity: 0.9,
        scaleX: Math.max(
          0.18,
          avatarPanelOriginRect.width / avatarPanelLayout.width
        ),
        scaleY: Math.max(
          0.1,
          avatarPanelOriginRect.height / avatarPanelLayout.height
        ),
        borderRadius: avatarPanelOriginRadius,
      },
      animate: {
        opacity: 1,
        scaleX: 1,
        scaleY: 1,
        borderRadius: avatarPanelTargetRadius,
      },
      exit: {
        opacity: 0.9,
        scaleX: Math.max(
          0.18,
          avatarPanelOriginRect.width / avatarPanelLayout.width
        ),
        scaleY: Math.max(
          0.1,
          avatarPanelOriginRect.height / avatarPanelLayout.height
        ),
        borderRadius: avatarPanelOriginRadius,
      },
    };
  }, [
    avatarPanelLayout.height,
    avatarPanelLayout.left,
    avatarPanelLayout.top,
    avatarPanelLayout.width,
    avatarPanelOriginRadius,
    avatarPanelOriginRect,
    avatarPanelTargetRadius,
    prefersReducedMotion,
  ]);

  const changeNameStatusTone = useMemo(() => {
    if (changeNameAvailability === 'available') {
      return {
        color: isDarkMode ? '#78D29A' : '#2E8B57',
        label: td('name_availability_available', 'Name is available.'),
      };
    }

    if (changeNameAvailability === 'loading') {
      return {
        color: theme.palette.text.secondary,
        label: td(
          'name_availability_checking',
          'Checking name availability...'
        ),
      };
    }

    if (changeNameAvailability === 'not-available') {
      return {
        color: avatarWarningTone.icon,
        label:
          changeNameValue.trim().toLowerCase() === normalizedCurrentName
            ? td(
                'name_availability_same_as_current',
                'Choose a different name from the one you already use.'
              )
            : td('name_availability_taken', 'That name is already taken.'),
      };
    }

    return null;
  }, [
    avatarWarningTone.icon,
    changeNameAvailability,
    changeNameValue,
    isDarkMode,
    normalizedCurrentName,
    td,
    theme.palette.text.secondary,
  ]);

  const isChangeNameSubmitDisabled =
    !changeNameValue.trim() ||
    !changeNamePassword.trim() ||
    isChangeNameLoading ||
    isCurrentNameMetaLoading ||
    Boolean(currentNameMetaError) ||
    changeNameAvailability !== 'available';
  const activeSettingsMeta =
    accountSettingsTabs.find((tab) => tab.key === activeSettingsTab) ??
    accountSettingsTabs[0];
  const ActiveSettingsIcon = activeSettingsMeta.icon;
  const settingsSwitchSx = {
    '& .MuiSwitch-switchBase': {
      '&.Mui-checked': {
        color: theme.palette.common.white,
        '& + .MuiSwitch-track': {
          backgroundColor: alpha(
            theme.palette.primary.main,
            isDarkMode ? 0.72 : 0.82
          ),
          opacity: 1,
        },
      },
    },
    '& .MuiSwitch-thumb': {
      boxShadow: 'none',
      height: 16,
      width: 16,
    },
    '& .MuiSwitch-track': {
      backgroundColor: isDarkMode
        ? 'rgba(255,255,255,0.16)'
        : 'rgba(24,29,36,0.18)',
      borderRadius: 999,
      opacity: 1,
    },
  } as const;
  const compactProfileFieldSx = {
    '& .MuiOutlinedInput-root': {
      background: avatarFieldSurface,
      borderRadius: '10px',
      boxShadow: avatarFieldInsetShadow,
      color: theme.palette.text.primary,
      minHeight: 40,
      '& fieldset': {
        borderColor: avatarFieldBorder,
      },
      '&:hover fieldset': {
        borderColor: avatarFieldHoverBorder,
      },
      '&.Mui-focused fieldset': {
        borderColor: alpha(theme.palette.primary.main, 0.9),
        borderWidth: 1.25,
      },
      '&:hover': {
        background: avatarFieldSurfaceHover,
      },
    },
    '& .MuiOutlinedInput-input': {
      fontSize: '0.88rem',
      lineHeight: 1.25,
      padding: '10px 12px',
    },
    '& input:-webkit-autofill, & input:-webkit-autofill:hover, & input:-webkit-autofill:focus':
      {
        WebkitBoxShadow: isDarkMode
          ? '0 0 0 100px rgb(47, 52, 62) inset'
          : '0 0 0 100px rgb(248, 250, 253) inset',
        WebkitTextFillColor: theme.palette.text.primary,
        caretColor: theme.palette.text.primary,
        transition: 'background-color 9999s ease-out 0s',
      },
  } as const;
  const compactNeutralFieldSx = {
    '& .MuiOutlinedInput-root': {
      background: avatarFieldSurface,
      borderRadius: '10px',
      boxShadow: avatarFieldInsetShadow,
      color: theme.palette.text.primary,
      minHeight: 40,
      '& fieldset': {
        borderColor: avatarFieldBorder,
      },
      '&:hover fieldset': {
        borderColor: avatarFieldHoverBorder,
      },
      '&.Mui-focused fieldset': {
        borderColor: avatarFieldHoverBorder,
        borderWidth: 1,
      },
      '&:hover': {
        background: avatarFieldSurfaceHover,
      },
    },
    '& .MuiOutlinedInput-input': {
      fontSize: '0.88rem',
      lineHeight: 1.25,
      padding: '10px 12px',
    },
    '& input:-webkit-autofill, & input:-webkit-autofill:hover, & input:-webkit-autofill:focus':
      {
        WebkitBoxShadow: isDarkMode
          ? '0 0 0 100px rgb(47, 52, 62) inset'
          : '0 0 0 100px rgb(248, 250, 253) inset',
        WebkitTextFillColor: theme.palette.text.primary,
        caretColor: theme.palette.text.primary,
        transition: 'background-color 9999s ease-out 0s',
      },
  } as const;

  return (
    <Box
      ref={panelRef}
      sx={{
        ...dashboardPanelSx(theme, 'accent'),
        alignItems: 'center',
        borderRadius: '14px',
        display: 'grid',
        gap: {
          xs: '18px',
          lg: '16px',
        },
        gridTemplateColumns: {
          xs: '1fr',
          lg: '104px minmax(0, 1fr)',
        },
        minHeight: '164px',
        padding: '22px 24px',
        width: '100%',
      }}
      onMouseMove={handleDashboardPanelPointerMove}
      onMouseLeave={handleDashboardPanelPointerLeave}
    >
      <GlobalStyles
        styles={{
          '.privacy-blur': {
            filter: 'blur(8px)',
            pointerEvents: 'none',
            transition: 'filter 0.3s ease',
            userSelect: 'none',
          },
        }}
      />
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          justifyContent: 'center',
          justifySelf: {
            xs: 'center',
            lg: 'stretch',
          },
          width: '104px',
        }}
      >
        <TiltedCard scaleOnHover={1.1} rotateAmplitude={18}>
          <BorderGlow
            animated={isAvatarGlowHovered}
            loopAnimated={true}
            interactive={false}
            edgeSensitivity={20}
            glowColor={isDarkMode ? '218 79 73' : '218 72 70'}
            backgroundColor="transparent"
            borderRadius={26}
            glowRadius={50}
            glowIntensity={isDarkMode ? 0.3 : 0.42}
            coneSpread={25}
            colors={[
              GROUP_ACTIVITY_BLUE.gradientTop,
              GROUP_ACTIVITY_BLUE.primary,
              GROUP_ACTIVITY_BLUE.hover,
            ]}
            fillOpacity={0.32}
            style={{
              '--card-border': 'transparent',
              '--card-shadow': 'none',
              width: 'fit-content',
            }}
          >
            <ButtonBase
              ref={avatarAnchorRef}
              onClick={(e) => openAvatarPanel(e.currentTarget)}
              onMouseEnter={() => setIsAvatarGlowHovered(true)}
              onMouseLeave={() => setIsAvatarGlowHovered(false)}
              sx={{
                background: isDarkMode
                  ? 'linear-gradient(180deg, rgba(255,255,255,0.062) 0%, rgba(255,255,255,0.02) 100%)'
                  : 'linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.36) 100%)',
                border: `1px solid ${
                  isDarkMode
                    ? 'rgba(255,255,255,0.08)'
                    : alpha(theme.palette.common.white, 0.54)
                }`,
                borderRadius: '22px',
                boxShadow: isDarkMode
                  ? '0 1px 4px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(0,0,0,0.18)'
                  : '0 1px 3px rgba(28,36,52,0.08), inset 0 1px 0 rgba(255,255,255,0.42)',
                display: 'inline-flex',
                overflow: 'hidden',
                padding: '3px',
                transition:
                  'border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease',
                '&:hover': {
                  borderColor: isDarkMode
                    ? 'rgba(255,255,255,0.12)'
                    : alpha(theme.palette.common.white, 0.74),
                  boxShadow: isDarkMode
                    ? '0 0 0 3px rgba(132,175,240,0.08), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.18)'
                    : '0 0 0 3px rgba(132,175,240,0.08), inset 0 1px 0 rgba(255,255,255,0.5)',
                },
              }}
            >
              <Avatar
                src={avatarUrl ?? undefined}
                onError={() => setAvatarError(true)}
                sx={{
                  bgcolor: isDarkMode ? '#636772' : '#E7DED0',
                  borderRadius: '22px',
                  height: 88,
                  width: 88,
                }}
              >
                <PersonIcon
                  sx={{
                    color: isDarkMode
                      ? '#1D2126'
                      : theme.palette.text.secondary,
                    fontSize: 44,
                  }}
                />
              </Avatar>
            </ButtonBase>
          </BorderGlow>
        </TiltedCard>

        <ButtonBase
          onClick={handleOpenAccountStatusMenu}
          aria-haspopup="menu"
          aria-expanded={isAccountStatusMenuOpen ? 'true' : undefined}
          aria-controls={isAccountStatusMenuOpen ? 'account-status-menu' : undefined}
          sx={{
            alignItems: 'center',
            backgroundColor: alpha(
              isDarkMode ? theme.palette.common.white : theme.palette.text.primary,
              isDarkMode ? 0.06 : 0.05
            ),
            borderRadius: '999px',
            display: 'inline-flex',
            gap: '6px',
            justifyContent: 'center',
            maxWidth: '100%',
            minHeight: '22px',
            mt: '2px',
            px: '8px',
            py: '3px',
            transition:
              'background-color 160ms ease, color 160ms ease, transform 120ms ease',
            '&:hover': {
              backgroundColor: alpha(
                isDarkMode ? theme.palette.common.white : theme.palette.text.primary,
                isDarkMode ? 0.1 : 0.08
              ),
            },
            '&:focus-visible': {
              backgroundColor: alpha(theme.palette.primary.main, isDarkMode ? 0.16 : 0.1),
            },
          }}
        >
          <Box
            aria-hidden="true"
            sx={{
              animation:
                accountStatus === 'online'
                  ? 'homeProfileStatusPulse 3.4s ease-in-out infinite'
                  : undefined,
              bgcolor: accountStatusMeta.color,
              borderRadius: '50%',
              flexShrink: 0,
              height: 7,
              width: 7,
              '@keyframes homeProfileStatusPulse': {
                '0%, 100%': {
                  opacity: 0.9,
                  transform: 'scale(0.92)',
                },
                '50%': {
                  opacity: 1,
                  transform: 'scale(1.08)',
                },
              },
            }}
          />
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.88),
              fontSize: '0.72rem',
              fontWeight: 600,
              letterSpacing: '0.01em',
              lineHeight: 1.1,
              textAlign: 'center',
            }}
          >
            {accountStatusMeta.label}
          </Typography>
          <KeyboardArrowDownRoundedIcon
            sx={{
              color: alpha(theme.palette.text.secondary, 0.66),
              fontSize: '0.9rem',
            }}
          />
        </ButtonBase>
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '8px',
          minWidth: 0,
          pl: {
            xs: 0,
            lg: '12px',
          },
          width: '100%',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            maxWidth: '478px',
            minWidth: 0,
            width: '100%',
          }}
        >
          <Typography
            sx={{
              color: isDarkMode
                ? alpha(theme.palette.common.white, 0.9)
                : alpha(theme.palette.text.primary, 0.9),
              fontSize: '0.95rem',
              fontWeight: 560,
              letterSpacing: '-0.01em',
              textAlign: 'center',
              width: '100%',
            }}
          >
            {td('account_overview', 'Account Overview')}
          </Typography>

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: '8px',
              width: '100%',
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                bgcolor: isDarkMode ? '#1A1D24' : '#E7DDD0',
                border: `1px solid ${
                  isDarkMode
                    ? 'rgba(255,255,255,0.045)'
                    : alpha(theme.palette.text.primary, 0.065)
                }`,
                borderRadius: '11px',
                boxShadow: isDarkMode
                  ? 'inset 0 1px 0 rgba(255,255,255,0.018)'
                  : 'inset 0 1px 0 rgba(255,255,255,0.12)',
                cursor: address ? 'pointer' : 'default',
                display: 'flex',
                flex: '1 1 auto',
                gap: '8px',
                minHeight: '38px',
                minWidth: 0,
                px: '11px',
                py: '5px',
                transition:
                  'background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
                '&:hover': address
                  ? {
                      backgroundColor: isDarkMode ? '#171A20' : '#E2D7C9',
                      borderColor: isDarkMode
                        ? 'rgba(255,255,255,0.06)'
                        : alpha(theme.palette.text.primary, 0.095),
                      '& .wallet-address-overlay': {
                        color: theme.palette.text.primary,
                      },
                    }
                  : undefined,
              }}
              onClick={address ? handleCopyAddress : undefined}
              onMouseEnter={
                shouldRevealAddressOnHover
                  ? () => setIsAddressFieldHovered(true)
                  : undefined
              }
              onMouseLeave={
                shouldRevealAddressOnHover
                  ? () => setIsAddressFieldHovered(false)
                  : undefined
              }
              onKeyDown={
                address
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleCopyAddress();
                      }
                    }
                  : undefined
              }
              role={address ? 'button' : undefined}
              tabIndex={address ? 0 : undefined}
            >
              <Box
                className="wallet-address-overlay"
                sx={{
                  alignItems: 'center',
                  color:
                    theme.palette.mode === 'dark'
                      ? 'rgba(236, 241, 248, 0.86)'
                      : alpha(theme.palette.text.primary, 0.72),
                  display: 'flex',
                  flex: '1 1 auto',
                  fontSize: '0.84rem',
                  fontWeight: 560,
                  justifyContent: 'flex-start',
                  minWidth: 0,
                  pr: '4px',
                  textAlign: 'left',
                  transition: 'color 160ms ease',
                }}
              >
                {shouldRevealAddressOnHover ? (
                  showAnimatedAddress ? (
                    <Box
                      sx={{
                        maxWidth: '100%',
                        overflow: 'hidden',
                        pointerEvents: 'auto',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <DecryptedText
                        text={accountIdentitySecondaryText}
                        animateOn="hover"
                        active={showAnimatedAddress}
                        speed={35}
                        maxIterations={12}
                        sequential={true}
                        revealDirection="start"
                        useOriginalCharsOnly={true}
                      />
                    </Box>
                  ) : (
                    <Box
                      sx={{
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {accountIdentityPrimaryText}
                    </Box>
                  )
                ) : (
                  <Box
                    sx={{
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {accountIdentityPrimaryText}
                  </Box>
                )}
              </Box>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexShrink: 0,
                  justifyContent: 'flex-end',
                  ml: 'auto',
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'flex',
                    gap: `${addressFieldActionGapPx}px`,
                    justifyContent: 'flex-end',
                  }}
                >
                  {onOpenReceive ? (
                    <Tooltip
                      enterDelay={450}
                      title={td('show_receive_qr', 'Show receive QR')}
                    >
                      <Box component="span">
                        <ButtonBase
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenReceive(event.currentTarget);
                          }}
                          disabled={!address}
                          aria-label={td('show_receive_qr', 'Show receive QR')}
                          sx={{
                            alignItems: 'center',
                            borderRadius: '8px',
                            color: addressFieldActionBaseColor,
                            display: 'inline-flex',
                            flexShrink: 0,
                            height: `${addressFieldActionButtonSizePx}px`,
                            justifyContent: 'center',
                            transition:
                              'background-color 160ms ease, color 160ms ease, opacity 160ms ease',
                            width: `${addressFieldActionButtonSizePx}px`,
                            '&:hover': {
                              backgroundColor:
                                addressFieldActionHoverBackground,
                              color: addressFieldActionHoverColor,
                            },
                          }}
                        >
                          <QrCode2RoundedIcon sx={{ fontSize: '0.95rem' }} />
                        </ButtonBase>
                      </Box>
                    </Tooltip>
                  ) : null}
                  <ButtonBase
                    onClick={(event) => {
                      event.stopPropagation();
                      handleCopyAddress();
                    }}
                    disabled={!address}
                    aria-label={td('copy_address', 'Copy address')}
                    sx={{
                      alignItems: 'center',
                      borderRadius: '8px',
                      color: addressFieldActionBaseColor,
                      display: 'inline-flex',
                      flexShrink: 0,
                      height: `${addressFieldActionButtonSizePx}px`,
                      justifyContent: 'center',
                      width: `${addressFieldActionButtonSizePx}px`,
                      '&:hover': {
                        backgroundColor: addressFieldActionHoverBackground,
                        color: addressFieldActionHoverColor,
                      },
                    }}
                  >
                    <ContentCopyIcon sx={{ fontSize: '0.92rem' }} />
                  </ButtonBase>
                </Box>
              </Box>
            </Box>

            <Tooltip
              enterDelay={320}
              title={td('account_settings_tooltip', 'Account settings')}
            >
              <ButtonBase
                onClick={openAccountSettingsModal}
                aria-label={td(
                  'open_account_settings_aria',
                  'Open account settings'
                )}
                sx={{
                  alignItems: 'center',
                  background: isDarkMode
                    ? 'rgba(44,49,58,0.98)'
                    : 'rgba(232,237,245,0.99)',
                  border: `1px solid ${
                    isDarkMode
                      ? alpha('#8FD8FF', 0.06)
                      : alpha(theme.palette.text.primary, 0.072)
                  }`,
                  borderRadius: '12px',
                  boxShadow: isDarkMode
                    ? `inset 0 1px 0 rgba(255,255,255,0.075), inset 0 0 0 1px rgba(255,255,255,0.012), inset 0 -1px 0 rgba(0,0,0,0.44), inset -1px -1px 0 rgba(0,0,0,0.18), 0 4px 8px rgba(0,0,0,0.17), 0 0 0 1px ${alpha('#8FD8FF', 0.012)}`
                    : 'inset 0 1px 0 rgba(255,255,255,0.86), inset 0 0 0 1px rgba(255,255,255,0.24), inset 0 -1px 0 rgba(104,116,140,0.22), inset -1px -1px 0 rgba(146,158,182,0.14), 0 4px 8px rgba(94,108,132,0.11)',
                  color: isDarkMode
                    ? alpha('#F6F8FB', 0.88)
                    : alpha(theme.palette.text.primary, 0.84),
                  display: 'inline-flex',
                  flexShrink: 0,
                  height: 38,
                  justifyContent: 'center',
                  minWidth: 38,
                  p: 0,
                  position: 'relative',
                  transition:
                    'transform 90ms ease, filter 120ms ease, border-color 140ms ease, box-shadow 140ms ease, color 140ms ease',
                  width: 38,
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    inset: '1px',
                    borderRadius: 'inherit',
                    pointerEvents: 'none',
                    background: isDarkMode
                      ? 'linear-gradient(145deg, rgba(255,255,255,0.052) 0%, rgba(255,255,255,0.02) 24%, rgba(255,255,255,0) 58%)'
                      : 'linear-gradient(145deg, rgba(255,255,255,0.58) 0%, rgba(255,255,255,0.22) 28%, rgba(255,255,255,0) 58%)',
                    opacity: 0.92,
                  },
                  '&:hover': {
                    filter: 'brightness(1.05)',
                  },
                  '&:active': {
                    boxShadow:
                      'inset 2px 2px 6px rgba(0, 0, 0, 0.7), inset -1px -1px 3px rgba(255, 255, 255, 0.04)',
                    transform: 'scale(0.97)',
                  },
                }}
              >
                <SettingsRoundedIcon sx={{ fontSize: '1rem' }} />
              </ButtonBase>
            </Tooltip>
          </Box>

          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '0.64rem',
              letterSpacing: '0.05em',
              opacity: 0.88,
              textAlign: 'center',
              textTransform: 'uppercase',
              width: '100%',
            }}
          >
            {td('qortal_name_address', 'QORTAL NAME & ADDRESS')}
          </Typography>
        </Box>
      </Box>

      <Menu
        id="account-status-menu"
        anchorEl={accountStatusAnchorEl}
        open={isAccountStatusMenuOpen}
        onClose={handleCloseAccountStatusMenu}
        anchorOrigin={{
          horizontal: 'center',
          vertical: 'bottom',
        }}
        transformOrigin={{
          horizontal: 'center',
          vertical: 'top',
        }}
        slotProps={{
          list: {
            sx: {
              p: '6px',
            },
          },
          paper: {
            sx: {
              backdropFilter: 'blur(14px)',
              bgcolor: isDarkMode ? 'rgba(34, 37, 46, 0.94)' : 'rgba(251, 247, 240, 0.94)',
              border: `1px solid ${alpha(
                isDarkMode ? theme.palette.common.white : theme.palette.text.primary,
                0.07
              )}`,
              borderRadius: '16px',
              boxShadow: isDarkMode
                ? '0 18px 36px rgba(0, 0, 0, 0.32)'
                : '0 16px 28px rgba(24, 32, 44, 0.12)',
              minWidth: 168,
              mt: 0.5,
              overflow: 'hidden',
            },
          },
        }}
      >
        {accountStatusOptions.map((option) => {
          const isSelected = option.key === myStatus;

          return (
            <MenuItem
              key={option.key}
              selected={isSelected}
              onClick={() => handleSelectAccountStatus(option.key)}
              sx={{
                alignItems: 'center',
                columnGap: '10px',
                borderRadius: '12px',
                minHeight: '38px',
                px: '12px',
                py: '7px',
              }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  bgcolor: option.color,
                  borderRadius: '50%',
                  flexShrink: 0,
                  height: 8,
                  width: 8,
                }}
              />
              <Typography
                sx={{
                  color: isSelected
                    ? theme.palette.text.primary
                    : alpha(theme.palette.text.secondary, 0.96),
                  fontSize: '0.82rem',
                  fontWeight: isSelected ? 700 : 600,
                  letterSpacing: '0.01em',
                }}
              >
                {option.label}
              </Typography>
            </MenuItem>
          );
        })}
      </Menu>

      <Dialog
        open={isAccountSettingsOpen}
        onClose={closeAccountSettingsModal}
        aria-labelledby="account-settings-dialog-title"
        aria-describedby="account-settings-dialog-description"
        maxWidth={false}
        fullWidth
        slotProps={{
          backdrop: {
            sx: {
              backdropFilter: isDarkMode
                ? 'blur(12px) brightness(0.76) saturate(0.88)'
                : 'blur(12px) brightness(0.9) saturate(0.94)',
              WebkitBackdropFilter: isDarkMode
                ? 'blur(12px) brightness(0.76) saturate(0.88)'
                : 'blur(12px) brightness(0.9) saturate(0.94)',
              backgroundColor: isDarkMode
                ? 'rgba(6, 8, 12, 0.4)'
                : 'rgba(22, 26, 34, 0.14)',
            },
          },
          paper: {
            sx: {
              background: avatarModalSurface,
              border: isDarkMode
                ? '1px solid rgba(255,255,255,0.08)'
                : '1px solid rgba(24,29,36,0.09)',
              borderRadius: '16px',
              boxShadow: isDarkMode
                ? '0 34px 120px rgba(0,0,0,0.46)'
                : '0 28px 88px rgba(18,28,45,0.16)',
              clipPath: 'inset(0 round 16px)',
              isolation: 'isolate',
              overflow: 'hidden',
              width: 'min(840px, calc(100vw - 32px))',
            },
          },
        }}
      >
        <Box
          sx={{
            background: avatarModalSurface,
            display: 'flex',
            minHeight: 530,
            width: '100%',
          }}
        >
          <Box
            sx={{
              background: settingsSidebarSurface,
              borderRight: `1px solid ${avatarSectionDivider}`,
              display: 'flex',
              flexDirection: 'column',
              flexShrink: 0,
              gap: 1,
              minWidth: 200,
              px: 1.1,
              py: 1.15,
              width: 200,
            }}
          >
            {accountSettingsTabs.map((tab) => {
              const TabIcon = tab.icon;
              const isActive = activeSettingsTab === tab.key;

              return (
                <ButtonBase
                  key={tab.key}
                  onClick={() => setActiveSettingsTab(tab.key)}
                  sx={{
                    alignItems: 'center',
                    background: isActive
                      ? settingsSidebarActiveSurface
                      : 'transparent',
                    border: `1px solid ${
                      isActive
                        ? alpha(
                            theme.palette.common.white,
                            isDarkMode ? 0.075 : 0.18
                          )
                        : 'transparent'
                    }`,
                    borderLeft: `2px solid ${
                      isActive ? settingsSidebarAccent : 'transparent'
                    }`,
                    borderRadius: '12px',
                    color: isActive
                      ? theme.palette.text.primary
                      : alpha(theme.palette.text.secondary, 0.9),
                    justifyContent: 'flex-start',
                    minHeight: 52,
                    px: 1.35,
                    py: 1.15,
                    transition:
                      'background-color 160ms ease, border-color 160ms ease, color 160ms ease',
                    width: '100%',
                    '&:hover': {
                      background: isActive
                        ? settingsSidebarActiveSurface
                        : alpha(
                            theme.palette.common.white,
                            isDarkMode ? 0.032 : 0.48
                          ),
                    },
                  }}
                >
                  <TabIcon sx={{ fontSize: 20, mr: 1.1 }} />
                  <Typography
                    sx={{
                      fontSize: '0.86rem',
                      fontWeight: isActive ? 700 : 600,
                      letterSpacing: '0.01em',
                    }}
                  >
                    {tab.label.toUpperCase()}
                  </Typography>
                </ButtonBase>
              );
            })}

            <Box
              sx={{
                mt: 'auto',
                pt: 1.6,
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              <Tooltip
                title={td(
                  'privacy_mode_tooltip',
                  'Privacy Mode: Blurs sensitive info for screen sharing'
                )}
              >
                <ButtonBase
                  onClick={handleTogglePrivacyMode}
                  aria-label={td('toggle_privacy_mode', 'Toggle privacy mode')}
                  sx={{
                    borderRadius: '999px',
                    color: isPrivacyModeActive
                      ? theme.palette.text.primary
                      : alpha(theme.palette.text.secondary, 0.78),
                    height: 32,
                    width: 32,
                    '&:hover': {
                      backgroundColor: alpha(
                        theme.palette.common.white,
                        isDarkMode ? 0.05 : 0.6
                      ),
                      color: theme.palette.text.primary,
                    },
                  }}
                >
                  {isPrivacyModeActive ? (
                    <VisibilityOffOutlinedIcon sx={{ fontSize: 19 }} />
                  ) : (
                    <VisibilityOutlinedIcon sx={{ fontSize: 19 }} />
                  )}
                </ButtonBase>
              </Tooltip>
            </Box>
          </Box>

          <Box
            sx={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              minWidth: 0,
            }}
          >
            <Box
              sx={{
                alignItems: 'flex-start',
                display: 'flex',
                justifyContent: 'space-between',
                px: 2.3,
                py: 1.8,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.1 }}>
                <ActiveSettingsIcon
                  sx={{
                    color: alpha(theme.palette.text.primary, 0.9),
                    fontSize: 22,
                    mt: '2px',
                  }}
                />
                <Box
                  sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}
                >
                  <Typography
                    id="account-settings-dialog-title"
                    sx={{
                      color: theme.palette.text.primary,
                      fontSize: '0.98rem',
                      fontWeight: 700,
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {activeSettingsMeta.title}
                  </Typography>
                  <Typography
                    id="account-settings-dialog-description"
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: '0.76rem',
                      lineHeight: 1.45,
                    }}
                  >
                    {activeSettingsMeta.description}
                  </Typography>
                </Box>
              </Box>
              <ButtonBase
                onClick={closeAccountSettingsModal}
                disabled={isChangeNameLoading}
                sx={{
                  borderRadius: '8px',
                  color: theme.palette.text.secondary,
                  height: 30,
                  width: 30,
                  '&:hover': {
                    backgroundColor: alpha(
                      theme.palette.common.white,
                      isDarkMode ? 0.05 : 0.55
                    ),
                    color: theme.palette.text.primary,
                  },
                }}
              >
                <CloseIcon sx={{ fontSize: 17 }} />
              </ButtonBase>
            </Box>

            <Box
              sx={{
                borderTop: `1px solid ${avatarSectionDivider}`,
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                gap: 1.25,
                overflowY: 'auto',
                px: 2.3,
                pb: 2.2,
                pt: 1.9,
              }}
            >
              {activeSettingsTab === 'profile' ? (
                <>
                  <Box sx={{ display: 'grid', gap: 1.35 }}>
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                        py: 0.45,
                      }}
                    >
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          letterSpacing: '0.03em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {td('current_name', 'Current name')}
                      </Typography>
                      <Typography
                        className={privacyBlurClassName}
                        sx={{
                          color: theme.palette.text.primary,
                          fontSize: '0.9rem',
                          fontWeight: 700,
                          letterSpacing: '-0.01em',
                        }}
                      >
                        {name ?? td('no_name_registered', 'No name registered')}
                      </Typography>
                      {!hasRegisteredName ? (
                        <ButtonBase
                          aria-label={td('register_name', 'Register name')}
                          onClick={() => {
                            closeAccountSettingsModal();
                            window.setTimeout(() => {
                              executeEvent('openRegisterName', {});
                            }, 80);
                          }}
                          sx={{
                            alignItems: 'center',
                            alignSelf: 'flex-start',
                            borderRadius: '8px',
                            color: theme.palette.primary.light,
                            display: 'inline-flex',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            gap: 0.45,
                            mt: 0.55,
                            px: 0.15,
                            py: 0.35,
                            transition: 'color 140ms ease, opacity 140ms ease',
                            '&:hover': {
                              color: theme.palette.primary.main,
                            },
                          }}
                        >
                          <Typography
                            component="span"
                            sx={{
                              fontSize: 'inherit',
                              fontWeight: 'inherit',
                              lineHeight: 1.25,
                            }}
                          >
                            {td('register_name', 'Register name')}
                          </Typography>
                          <ArrowForwardRoundedIcon sx={{ fontSize: 15 }} />
                        </ButtonBase>
                      ) : null}
                    </Box>

                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                        py: 0.45,
                      }}
                    >
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          letterSpacing: '0.03em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {td('wallet_address', 'Wallet address')}
                      </Typography>
                      <Typography
                        className={privacyBlurClassName}
                        sx={{
                          color: theme.palette.text.primary,
                          fontSize: '0.9rem',
                          fontWeight: 700,
                          letterSpacing: '-0.01em',
                          wordBreak: 'break-all',
                        }}
                      >
                        {address ?? td('unavailable', 'Unavailable')}
                      </Typography>
                    </Box>
                  </Box>

                  <Box
                    sx={{
                      alignItems: 'flex-start',
                      backgroundColor: changeNameNoteTone.background,
                      border: `1px solid ${changeNameNoteTone.border}`,
                      borderRadius: '12px',
                      display: 'flex',
                      gap: 1,
                      px: 1.25,
                      py: 1.05,
                    }}
                  >
                    <InfoOutlinedIcon
                      sx={{
                        color: changeNameNoteTone.icon,
                        flexShrink: 0,
                        fontSize: 18,
                        mt: '1px',
                      }}
                    />
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '0.76rem',
                        lineHeight: 1.48,
                      }}
                    >
                      {td(
                        'names_qapp_actions_hint',
                        'Buy, sell, and name-change actions should be handled in the Names Q-App.'
                      )}
                    </Typography>
                  </Box>

                  <Box
                    sx={{
                      borderTop: `1px solid ${avatarSectionDivider}`,
                      mt: 0.35,
                      pt: 1.15,
                    }}
                  >
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '0.73rem',
                        lineHeight: 1.5,
                      }}
                    >
                      {td('open_the', 'Open the')}{' '}
                      <Box
                        component="span"
                        sx={{
                          color: theme.palette.text.primary,
                          fontWeight: 700,
                        }}
                      >
                        {td('names', 'Names')}
                      </Box>{' '}
                      {td(
                        'names_qapp_hint_suffix',
                        'Q-App for buying names, selling names, or changing your registered name.'
                      )}
                    </Typography>
                  </Box>
                </>
              ) : null}

              {activeSettingsTab === 'security' ? (
                <>
                  <Box
                    sx={{
                      alignItems: 'flex-start',
                      backgroundColor: avatarWarningTone.background,
                      border: `1px solid ${avatarWarningTone.border}`,
                      borderRadius: '12px',
                      display: 'flex',
                      gap: 1,
                      px: 1.25,
                      py: 1.1,
                    }}
                  >
                    <ErrorIcon
                      sx={{
                        color: avatarWarningTone.icon,
                        flexShrink: 0,
                        fontSize: 18,
                        mt: '1px',
                      }}
                    />
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '0.76rem',
                        lineHeight: 1.45,
                      }}
                    >
                      {td(
                        'private_key_warning',
                        'Never share your private key. Anyone who has it could potentially control this wallet and its funds.'
                      )}
                    </Typography>
                  </Box>

                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '3px',
                      py: 0.45,
                    }}
                  >
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        letterSpacing: '0.03em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {td('wallet_address', 'Wallet address')}
                    </Typography>
                    <Typography
                      className={privacyBlurClassName}
                      sx={{
                        color: theme.palette.text.primary,
                        fontSize: '0.9rem',
                        fontWeight: 700,
                        letterSpacing: '-0.01em',
                        wordBreak: 'break-all',
                      }}
                    >
                      {address ?? td('unavailable', 'Unavailable')}
                    </Typography>
                  </Box>

                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0.72,
                      pt: 0.45,
                    }}
                  >
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        display: 'block',
                        fontSize: '0.74rem',
                        fontWeight: 600,
                        letterSpacing: '0.01em',
                      }}
                    >
                      {td('wallet_password', 'Wallet password')}
                    </Typography>
                    <TextField
                      autoComplete="off"
                      fullWidth
                      type="password"
                      variant="outlined"
                      size="small"
                      name="hub-private-key-decrypt"
                      onFocus={() => setIsSecurityPasswordEditable(true)}
                      onMouseDown={() => setIsSecurityPasswordEditable(true)}
                      onBlur={() => {
                        if (!securityPassword) {
                          setIsSecurityPasswordEditable(false);
                        }
                      }}
                      onChange={(event) =>
                        setSecurityPassword(event.target.value)
                      }
                      value={securityPassword}
                      placeholder={td(
                        'wallet_password_placeholder',
                        'Enter your wallet password'
                      )}
                      sx={compactNeutralFieldSx}
                      InputProps={{
                        readOnly: !isSecurityPasswordEditable,
                      }}
                      inputProps={{
                        autoComplete: 'new-password',
                        'data-1p-ignore': 'true',
                        'data-lpignore': 'true',
                        spellCheck: 'false',
                      }}
                    />
                  </Box>

                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <LoadingButton
                      loading={isRevealingPrivateKey}
                      disabled={!securityPassword.trim() || !rawWallet}
                      onClick={revealPrivateKey}
                      variant="contained"
                      sx={{
                        borderRadius: '10px',
                        ...getBlueTier1ButtonSx(),
                        minHeight: 40,
                        px: 2,
                        textTransform: 'none',
                        '&.Mui-disabled': {
                          background: isDarkMode
                            ? 'rgba(255,255,255,0.035)'
                            : 'rgba(24,29,36,0.04)',
                          border: isDarkMode
                            ? '1px solid rgba(255,255,255,0.055)'
                            : '1px solid rgba(24,29,36,0.06)',
                          boxShadow: 'none',
                          color: isDarkMode
                            ? 'rgba(255,255,255,0.34)'
                            : 'rgba(24,29,36,0.34)',
                        },
                      }}
                    >
                      {td('decrypt', 'Decrypt')}
                    </LoadingButton>
                    <LoadingButton
                      disabled={!revealedPrivateKey}
                      onClick={copyPrivateKey}
                      variant="outlined"
                      sx={{
                        borderColor: avatarFieldBorder,
                        borderRadius: '10px',
                        color: theme.palette.text.primary,
                        minHeight: 40,
                        px: 2,
                        textTransform: 'none',
                      }}
                    >
                      {td('copy_key', 'Copy key')}
                    </LoadingButton>
                  </Box>

                  {privateKeyError ? (
                    <Typography
                      sx={{
                        color: avatarWarningTone.icon,
                        fontSize: '0.74rem',
                        fontWeight: 600,
                        lineHeight: 1.4,
                      }}
                    >
                      {privateKeyError}
                    </Typography>
                  ) : null}

                  <Box
                    sx={{
                      alignItems: 'flex-start',
                      background: avatarModalSurfaceSoft,
                      border: `1px solid ${avatarFieldBorder}`,
                      borderRadius: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      minHeight: 98,
                      px: 1.35,
                      py: 1.15,
                    }}
                  >
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        letterSpacing: '0.03em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {td('private_key', 'Private key')}
                    </Typography>
                    <Typography
                      className={
                        revealedPrivateKey ? privacyBlurClassName : undefined
                      }
                      sx={{
                        color: revealedPrivateKey
                          ? theme.palette.text.primary
                          : theme.palette.text.secondary,
                        fontFamily: 'monospace',
                        fontSize: revealedPrivateKey ? '0.78rem' : '0.76rem',
                        fontWeight: revealedPrivateKey ? 600 : 500,
                        lineHeight: 1.45,
                        userSelect: revealedPrivateKey ? 'text' : 'none',
                        wordBreak: 'break-all',
                      }}
                    >
                      {revealedPrivateKey ||
                        td(
                          'private_key_hint',
                          'Decrypt your private key only when you need to recover or migrate this wallet.'
                        )}
                    </Typography>
                  </Box>
                </>
              ) : null}

              {activeSettingsTab === 'developer' ? (
                <Box
                  sx={{
                    background: avatarModalSurfaceSoft,
                    border: `1px solid ${avatarFieldBorder}`,
                    borderRadius: '12px',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: 1.2,
                      justifyContent: 'space-between',
                      px: 1.35,
                      py: 1.2,
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        sx={{
                          color: theme.palette.text.primary,
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          letterSpacing: '0.01em',
                        }}
                      >
                        {td('enable_dev_mode', 'Enable Dev Mode')}
                      </Typography>
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: '0.75rem',
                          lineHeight: 1.45,
                          mt: 0.4,
                        }}
                      >
                        {td(
                          'enable_dev_mode_desc',
                          'Unlock local developer surfaces, diagnostics, and testing tools across the Hub.'
                        )}
                      </Typography>
                    </Box>
                    <Switch
                      checked={isEnabledDevMode}
                      onChange={handleToggleDevMode}
                      sx={settingsSwitchSx}
                    />
                  </Box>

                  <Box
                    sx={{
                      alignItems: 'flex-start',
                      backgroundColor: developerNoticeTone.background,
                      borderTop: `1px solid ${avatarSectionDivider}`,
                      display: 'flex',
                      gap: 1,
                      px: 1.35,
                      py: 1.1,
                    }}
                  >
                    <InfoOutlinedIcon
                      sx={{
                        color: developerNoticeTone.icon,
                        flexShrink: 0,
                        fontSize: 18,
                        mt: '1px',
                      }}
                    />
                    <Typography
                      sx={{
                        color: theme.palette.text.secondary,
                        fontSize: '0.74rem',
                        lineHeight: 1.45,
                      }}
                    >
                      {td(
                        'dev_mode_tip',
                        'Tip: Once enabled, a new Developer Tools icon will appear in your sidebar. You might need to hover over the left edge to reveal it.'
                      )}
                    </Typography>
                  </Box>
                </Box>
              ) : null}

              {activeSettingsTab === 'blocked' ? (
                <Box
                  sx={{
                    background: avatarModalSurfaceSoft,
                    border: `1px solid ${avatarFieldBorder}`,
                    borderRadius: '12px',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                      px: 1.35,
                      py: 1.2,
                    }}
                  >
                    <Box
                      sx={{
                        alignItems: 'flex-start',
                        display: 'flex',
                        gap: 1.2,
                        justifyContent: 'space-between',
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          sx={{
                            color: theme.palette.text.primary,
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            letterSpacing: '0.01em',
                          }}
                        >
                          {td('block_list', 'Block list')}
                        </Typography>
                        <Typography
                          sx={{
                            color: theme.palette.text.secondary,
                            fontSize: '0.75rem',
                            lineHeight: 1.45,
                            mt: 0.4,
                          }}
                        >
                          {td(
                            'block_list_desc',
                            'Review blocked names and addresses, then unblock accounts whenever you are ready.'
                          )}
                        </Typography>
                      </Box>
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          flexShrink: 0,
                          fontSize: '0.73rem',
                          fontWeight: 700,
                          lineHeight: 1.4,
                        }}
                      >
                        {td('blocked_count', '{{count}} blocked', {
                          count: blockedCount,
                        })}
                      </Typography>
                    </Box>

                    {blockedCount > 0 ? (
                      <Box sx={{ display: 'grid', gap: 1 }}>
                        {blockedNameEntries.length > 0 ? (
                          <Box sx={{ display: 'grid', gap: 0.7 }}>
                            <Typography
                              sx={{
                                color: theme.palette.text.secondary,
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                letterSpacing: '0.04em',
                                textTransform: 'uppercase',
                              }}
                            >
                              {td('names', 'Names')}
                            </Typography>
                            {blockedNameEntries.map((blockedName) => (
                              <Box
                                key={blockedName}
                                sx={{
                                  alignItems: 'center',
                                  borderRadius: '10px',
                                  display: 'flex',
                                  gap: 1,
                                  justifyContent: 'space-between',
                                  px: 0.85,
                                  py: 0.55,
                                  transition: 'background-color 0.14s ease',
                                  '&:hover': {
                                    backgroundColor: alpha(
                                      theme.palette.primary.main,
                                      0.08
                                    ),
                                  },
                                }}
                              >
                                <Typography
                                  sx={{
                                    color: theme.palette.text.primary,
                                    fontSize: '0.8rem',
                                    fontWeight: 600,
                                    minWidth: 0,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {blockedName}
                                </Typography>
                                <ButtonBase
                                  onClick={() =>
                                    removeBlockFromList(undefined, blockedName)
                                  }
                                  sx={{
                                    borderRadius: '8px',
                                    color: theme.palette.primary.light,
                                    flexShrink: 0,
                                    fontSize: '0.74rem',
                                    fontWeight: 700,
                                    px: 0.9,
                                    py: 0.55,
                                    '&:hover': {
                                      backgroundColor: alpha(
                                        theme.palette.primary.main,
                                        0.1
                                      ),
                                    },
                                  }}
                                >
                                  {td('unblock', 'Unblock')}
                                </ButtonBase>
                              </Box>
                            ))}
                          </Box>
                        ) : null}

                        {blockedAddressEntries.length > 0 ? (
                          <Box sx={{ display: 'grid', gap: 0.7 }}>
                            <Typography
                              sx={{
                                color: theme.palette.text.secondary,
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                letterSpacing: '0.04em',
                                textTransform: 'uppercase',
                              }}
                            >
                              {td('addresses', 'Addresses')}
                            </Typography>
                            {blockedAddressEntries.map((blockedAddress) => (
                              <Box
                                key={blockedAddress}
                                sx={{
                                  alignItems: 'center',
                                  borderRadius: '10px',
                                  display: 'flex',
                                  gap: 1,
                                  justifyContent: 'space-between',
                                  px: 0.85,
                                  py: 0.55,
                                  transition: 'background-color 0.14s ease',
                                  '&:hover': {
                                    backgroundColor: alpha(
                                      theme.palette.primary.main,
                                      0.08
                                    ),
                                  },
                                }}
                              >
                                <Typography
                                  sx={{
                                    color: theme.palette.text.primary,
                                    fontSize: '0.8rem',
                                    fontWeight: 600,
                                    minWidth: 0,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {blockedAddress}
                                </Typography>
                                <ButtonBase
                                  onClick={() =>
                                    removeBlockFromList(
                                      blockedAddress,
                                      undefined
                                    )
                                  }
                                  sx={{
                                    borderRadius: '8px',
                                    color: theme.palette.primary.light,
                                    flexShrink: 0,
                                    fontSize: '0.74rem',
                                    fontWeight: 700,
                                    px: 0.9,
                                    py: 0.55,
                                    '&:hover': {
                                      backgroundColor: alpha(
                                        theme.palette.primary.main,
                                        0.1
                                      ),
                                    },
                                  }}
                                >
                                  {td('unblock', 'Unblock')}
                                </ButtonBase>
                              </Box>
                            ))}
                          </Box>
                        ) : null}
                      </Box>
                    ) : (
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: '0.75rem',
                          lineHeight: 1.45,
                        }}
                      >
                        {td('no_blocked_accounts', 'No blocked accounts yet.')}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ) : null}

              {activeSettingsTab === 'system' ? (
                <Box
                  sx={{
                    background: avatarModalSurfaceSoft,
                    border: `1px solid ${avatarFieldBorder}`,
                    borderRadius: '12px',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: 1.2,
                      justifyContent: 'space-between',
                      px: 1.35,
                      py: 1.2,
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        sx={{
                          color: theme.palette.text.primary,
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          letterSpacing: '0.01em',
                        }}
                      >
                        {td(
                          'reduce_app_notifications',
                          'Reduce App Notifications'
                        )}
                      </Typography>
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: '0.75rem',
                          lineHeight: 1.45,
                          mt: 0.4,
                        }}
                      >
                        {td(
                          'reduce_app_notifications_desc',
                          'Turn on to mute desktop push notifications. Leave off for normal Hub alerts.'
                        )}
                      </Typography>
                    </Box>
                    <Switch
                      checked={!areAppNotificationsEnabled}
                      onChange={handleToggleAppNotifications}
                      sx={settingsSwitchSx}
                    />
                  </Box>

                  <Box
                    sx={{
                      borderTop: `1px solid ${avatarSectionDivider}`,
                      mx: 1.35,
                    }}
                  />

                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: 1.2,
                      justifyContent: 'space-between',
                      px: 1.35,
                      py: 1.2,
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        sx={{
                          color: theme.palette.text.primary,
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          letterSpacing: '0.01em',
                        }}
                      >
                        {td('reduce_ui_animations', 'Reduce UI Animations')}
                      </Typography>
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: '0.75rem',
                          lineHeight: 1.45,
                          mt: 0.4,
                        }}
                      >
                        {td(
                          'reduce_ui_animations_desc',
                          'Turn on to minimize motion throughout the Hub. Leave off for the normal animated interface.'
                        )}
                      </Typography>
                    </Box>
                    <Switch
                      checked={!areUiAnimationsEnabled}
                      onChange={handleToggleUiAnimations}
                      sx={settingsSwitchSx}
                    />
                  </Box>

                  <Box
                    sx={{
                      borderTop: `1px solid ${avatarSectionDivider}`,
                      mx: 1.35,
                    }}
                  />

                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: 1.2,
                      justifyContent: 'space-between',
                      px: 1.35,
                      py: 1.2,
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        sx={{
                          color: theme.palette.text.primary,
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          letterSpacing: '0.01em',
                        }}
                      >
                        {td('pinned_qapp_backup', 'Pinned Q-App backup')}
                      </Typography>
                      <Typography
                        sx={{
                          color: theme.palette.text.secondary,
                          fontSize: '0.75rem',
                          lineHeight: 1.45,
                          mt: 0.4,
                        }}
                      >
                        {td(
                          'pinned_qapp_backup_desc',
                          'Save your pinned Q-Apps to encrypted QDN settings so the same layout can follow you across devices.'
                        )}
                      </Typography>
                    </Box>
                    <Tooltip title={td('manage_backup', 'Manage backup')}>
                      <Box component="span" sx={{ flexShrink: 0 }}>
                        <Save
                          isDesktop
                          disableWidth={false}
                          myName={userInfo?.name}
                          toolbarModule
                          buttonSx={{
                            alignItems: 'center',
                            backgroundColor: avatarModalSurfaceSoft,
                            border: `1px solid ${avatarFieldBorder}`,
                            borderRadius: '10px',
                            display: 'inline-flex',
                            height: 38,
                            justifyContent: 'center',
                            width: 42,
                            '&:hover': {
                              backgroundColor: alpha(
                                theme.palette.primary.main,
                                isDarkMode ? 0.12 : 0.08
                              ),
                              borderColor: alpha(
                                theme.palette.primary.main,
                                0.32
                              ),
                            },
                          }}
                        />
                      </Box>
                    </Tooltip>
                  </Box>
                </Box>
              ) : null}
            </Box>
          </Box>
        </Box>
      </Dialog>

      <Portal>
        <AnimatePresence>
          {isAvatarPanelOpen && (
            <>
              <Box
                component={motion.button}
                type="button"
                aria-label="Close avatar panel"
                initial={{
                  opacity: 0,
                  backdropFilter: 'blur(0px) brightness(1) saturate(1)',
                  WebkitBackdropFilter: 'blur(0px) brightness(1) saturate(1)',
                  backgroundColor: isDarkMode
                    ? 'rgba(6, 8, 12, 0)'
                    : 'rgba(22, 26, 34, 0)',
                }}
                animate={{
                  opacity: 1,
                  backdropFilter: isDarkMode
                    ? 'blur(12px) brightness(0.76) saturate(0.88)'
                    : 'blur(12px) brightness(0.9) saturate(0.94)',
                  WebkitBackdropFilter: isDarkMode
                    ? 'blur(12px) brightness(0.76) saturate(0.88)'
                    : 'blur(12px) brightness(0.9) saturate(0.94)',
                  backgroundColor: isDarkMode
                    ? 'rgba(6, 8, 12, 0.4)'
                    : 'rgba(22, 26, 34, 0.14)',
                }}
                exit={{
                  opacity: 0,
                  backdropFilter: 'blur(0px) brightness(1) saturate(1)',
                  WebkitBackdropFilter: 'blur(0px) brightness(1) saturate(1)',
                  backgroundColor: isDarkMode
                    ? 'rgba(6, 8, 12, 0)'
                    : 'rgba(22, 26, 34, 0)',
                }}
                transition={{
                  duration: prefersReducedMotion ? 0.08 : 0.14,
                  ease: [0.2, 0, 0, 1],
                  delay: prefersReducedMotion ? 0 : 0.08,
                }}
                onClick={closeAvatarPanel}
                sx={{
                  appearance: 'none',
                  border: 0,
                  inset: 0,
                  padding: 0,
                  position: 'fixed',
                  zIndex: 1298,
                }}
              />

              <Box
                component={motion.div}
                initial={avatarPanelAnimation.initial}
                animate={avatarPanelAnimation.animate}
                exit={avatarPanelAnimation.exit}
                transition={{
                  duration: prefersReducedMotion ? 0.14 : 0.28,
                  ease: [0.16, 0.9, 0.2, 1],
                }}
                onClick={(event) => event.stopPropagation()}
                sx={{
                  left: `${avatarPanelLayout.left}px`,
                  overflow: 'visible',
                  position: 'fixed',
                  top: `${avatarPanelLayout.top}px`,
                  transformOrigin: 'top left',
                  width: `${avatarPanelLayout.width}px`,
                  zIndex: 1299,
                }}
              >
                <Box
                  ref={avatarPanelRef}
                  sx={{
                    background: avatarModalSurface,
                    border: isDarkMode
                      ? '1px solid rgba(255,255,255,0.08)'
                      : '1px solid rgba(24,29,36,0.09)',
                    borderRadius: '14px',
                    boxShadow: isDarkMode
                      ? '0 34px 120px rgba(0,0,0,0.46)'
                      : '0 28px 88px rgba(18,28,45,0.16)',
                    clipPath: 'inset(0 round 14px)',
                    isolation: 'isolate',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    component={motion.div}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{
                      duration: prefersReducedMotion ? 0.08 : 0.14,
                      delay: prefersReducedMotion ? 0 : 0.1,
                    }}
                    sx={{
                      background: avatarModalSurface,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0,
                    }}
                  >
                    <Box
                      sx={{
                        alignItems: 'center',
                        display: 'flex',
                        justifyContent: 'space-between',
                        px: 2.25,
                        py: 1.7,
                      }}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        }}
                      >
                        <Typography
                          sx={{
                            color: theme.palette.text.primary,
                            fontSize: '0.98rem',
                            fontWeight: 700,
                            letterSpacing: '-0.02em',
                          }}
                        >
                          Update avatar
                        </Typography>
                        <Typography
                          sx={{
                            color: theme.palette.text.secondary,
                            fontSize: '0.76rem',
                            lineHeight: 1.45,
                          }}
                        >
                          {t('core:message.generic.avatar_size', {
                            size: MAX_SIZE_AVATAR,
                            postProcess: 'capitalizeFirstChar',
                          })}
                        </Typography>
                      </Box>
                      <ButtonBase
                        onClick={closeAvatarPanel}
                        sx={{
                          borderRadius: '8px',
                          color: theme.palette.text.secondary,
                          height: 30,
                          width: 30,
                          '&:hover': {
                            backgroundColor: alpha(
                              theme.palette.common.white,
                              isDarkMode ? 0.05 : 0.55
                            ),
                            color: theme.palette.text.primary,
                          },
                        }}
                      >
                        <CloseIcon sx={{ fontSize: 17 }} />
                      </ButtonBase>
                    </Box>

                    <Box
                      sx={{
                        borderTop: `1px solid ${avatarSectionDivider}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1.15,
                        px: 2.25,
                        pb: 2.25,
                        pt: 2,
                      }}
                    >
                      <Box
                        sx={{
                          alignItems: 'center',
                          display: 'flex',
                          borderBottom: `1px solid ${avatarSectionDivider}`,
                          justifyContent: 'center',
                          minHeight: 146,
                          pb: 1.35,
                        }}
                      >
                        <Box
                          sx={{
                            alignItems: 'center',
                            background: avatarFieldSurface,
                            border: `1px solid ${avatarFieldBorder}`,
                            borderRadius: '50%',
                            boxShadow: avatarFieldInsetShadow,
                            display: 'flex',
                            height: 112,
                            justifyContent: 'center',
                            overflow: 'hidden',
                            width: 112,
                          }}
                        >
                          {avatarPreviewUrl ? (
                            <Box
                              component="img"
                              src={avatarPreviewUrl}
                              alt=""
                              sx={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                              }}
                            />
                          ) : (
                            <PersonIcon
                              sx={{
                                fontSize: 52,
                                color: theme.palette.text.disabled,
                              }}
                            />
                          )}
                        </Box>
                      </Box>

                      <ImageUploader onPick={(file) => setAvatarFile(file)}>
                        <ButtonBase
                          sx={{
                            alignItems: 'center',
                            background: avatarFieldSurface,
                            border: `1px solid ${avatarFieldBorder}`,
                            borderRadius: '10px',
                            boxShadow: avatarFieldInsetShadow,
                            color: theme.palette.text.primary,
                            display: 'flex',
                            justifyContent: 'space-between',
                            px: 1.35,
                            py: 1.1,
                            textAlign: 'left',
                            transition:
                              'background 160ms ease, border-color 160ms ease, transform 120ms ease, box-shadow 160ms ease',
                            width: '100%',
                            '&:hover': {
                              background: avatarFieldSurfaceHover,
                              borderColor: avatarFieldHoverBorder,
                              boxShadow: isDarkMode
                                ? '0 10px 24px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.042)'
                                : '0 6px 14px rgba(24,32,44,0.08), inset 0 1px 0 rgba(255,255,255,0.54)',
                              transform: 'translateY(-1px)',
                            },
                          }}
                        >
                          <Box
                            sx={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '3px',
                            }}
                          >
                            <Typography
                              sx={{
                                color: theme.palette.text.primary,
                                fontSize: '0.84rem',
                                fontWeight: 700,
                              }}
                            >
                              {avatarFile
                                ? 'Replace image'
                                : t('core:action.choose_image', {
                                    postProcess: 'capitalizeFirstChar',
                                  })}
                            </Typography>
                            <Typography
                              sx={{
                                color: theme.palette.text.secondary,
                                fontSize: '0.7rem',
                                lineHeight: 1.35,
                              }}
                            >
                              PNG, JPG, WEBP or GIF
                            </Typography>
                          </Box>
                          <Box
                            sx={{
                              alignItems: 'center',
                              background: avatarModalSurfaceSoft,
                              border: `1px solid ${avatarFieldBorder}`,
                              borderRadius: '999px',
                              color: theme.palette.text.primary,
                              display: 'inline-flex',
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              letterSpacing: '0.01em',
                              minHeight: 30,
                              px: 1.2,
                            }}
                          >
                            Browse
                          </Box>
                        </ButtonBase>
                      </ImageUploader>

                      {avatarFile?.name && (
                        <Typography
                          noWrap
                          sx={{
                            color: theme.palette.text.secondary,
                            fontSize: '0.72rem',
                            lineHeight: 1.35,
                            px: 0.15,
                          }}
                        >
                          {avatarFile.name}
                        </Typography>
                      )}

                      {!name && (
                        <Box
                          sx={{
                            alignItems: 'flex-start',
                            backgroundColor: avatarWarningTone.background,
                            border: `1px solid ${avatarWarningTone.border}`,
                            borderRadius: '12px',
                            display: 'flex',
                            gap: 1,
                            px: 1.25,
                            py: 1.15,
                          }}
                        >
                          <ErrorIcon
                            sx={{
                              color: avatarWarningTone.icon,
                              fontSize: 18,
                              flexShrink: 0,
                              mt: '1px',
                            }}
                          />
                          <Typography
                            sx={{
                              color: theme.palette.text.secondary,
                              fontSize: '0.78rem',
                              lineHeight: 1.45,
                            }}
                          >
                            {t('group:message.generic.avatar_registered_name', {
                              postProcess: 'capitalizeFirstChar',
                            })}
                          </Typography>
                        </Box>
                      )}

                      <LoadingButton
                        loading={isAvatarLoading}
                        disabled={!avatarFile || !name}
                        onClick={publishAvatar}
                        variant="contained"
                        fullWidth
                        sx={{
                          borderRadius: '10px',
                          ...getBlueTier1ButtonSx(),
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          minHeight: 42,
                          textTransform: 'none',
                          '&.Mui-disabled': {
                            background: isDarkMode
                              ? 'rgba(255,255,255,0.035)'
                              : 'rgba(24,29,36,0.04)',
                            border: isDarkMode
                              ? '1px solid rgba(255,255,255,0.055)'
                              : '1px solid rgba(24,29,36,0.06)',
                            boxShadow: 'none',
                            color: isDarkMode
                              ? 'rgba(255,255,255,0.34)'
                              : 'rgba(24,29,36,0.34)',
                          },
                        }}
                      >
                        {t('group:action.publish_avatar', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                      </LoadingButton>
                    </Box>
                  </Box>
                </Box>
              </Box>
            </>
          )}
        </AnimatePresence>
      </Portal>
    </Box>
  );
};
