import {
  Avatar,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Portal,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { AnimatePresence, motion } from 'framer-motion';
import { useAtomValue } from 'jotai';
import {
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DriveFileRenameOutlineRoundedIcon from '@mui/icons-material/DriveFileRenameOutlineRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded';
import PauseRoundedIcon from '@mui/icons-material/PauseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RepeatOneRoundedIcon from '@mui/icons-material/RepeatOneRounded';
import RepeatRoundedIcon from '@mui/icons-material/RepeatRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import SkipPreviousRoundedIcon from '@mui/icons-material/SkipPreviousRounded';
import SpaRoundedIcon from '@mui/icons-material/SpaRounded';
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded';
import UploadRoundedIcon from '@mui/icons-material/UploadRounded';
import VideoLibraryRoundedIcon from '@mui/icons-material/VideoLibraryRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import LibraryMusicRoundedIcon from '@mui/icons-material/LibraryMusicRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import {
  balanceAtom,
  blockedAddressesAtom,
  blockedNamesAtom,
  resourceKeySelector,
  txListAtom,
  userInfoAtom,
} from '../../atoms/global';
import { getArbitraryEndpointReact, getBaseApiReact } from '../../App';
import LogoSelected from '../../assets/svgs/LogoSelected.svg';
import ErrorBoundary from '../../common/ErrorBoundary';
import { useBlockedAddresses } from '../../hooks/useBlockUsers';
import { useFetchResources } from '../../hooks/useFetchResources';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import {
  dashboardPanelSx,
  handleDashboardPanelPointerLeave,
  handleDashboardPanelPointerMove,
  useDashboardPanelMouseLight,
} from './dashboardPanelEffects';
import { QortalRequestBubbleIcon } from './GroupActivityEmptyStateGraphic';
import {
  GROUP_ACTIVITY_BLUE,
  APP_BLUE_SURFACE_TEXT,
  getBlueAmbientLineBackground,
  getBlueTier1ButtonSx,
  getBlueTier2BadgeSx,
  getBlueTier3ProgressBackground,
} from './groupActivityColorSystem';
import type { GettingStartedDebugOverrides } from './homeGettingStartedDebug';
import { GETTING_STARTED_LS_KEY } from './HomeGettingStarted';
import {
  DEFAULT_QORTINO_COMPANION_DEBUG_SETTINGS,
  parseQortinoCompanionDebugSettings,
  QORTINO_COMPANION_DEBUG_EVENT,
  QORTINO_COMPANION_DEBUG_STORAGE_KEY,
  sanitizeQortinoCompanionDebugSettings,
  type QortinoCompanionDebugSettings,
} from './qortinoCompanionDebug';
import {
  DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS,
  parseQortinoLookDebugSettings,
  QORTINO_LOOK_DEBUG_EVENT,
  QORTINO_LOOK_DEBUG_STORAGE_KEY,
  sanitizeQortinoLookDebugSettings,
  type QortinoLookDebugSettings,
} from './qortinoLookDebug';
import {
  DEFAULT_QORTINO_LAYOUT_DEBUG_SETTINGS,
  parseQortinoLayoutDebugSettings,
  QORTINO_LAYOUT_DEBUG_EVENT,
  QORTINO_LAYOUT_DEBUG_STORAGE_KEY,
  sanitizeQortinoLayoutDebugSettings,
  type QortinoLayoutDebugSettings,
} from './qortinoLayoutDebug';
import {
  fetchEarbumpRecentTracks,
  fetchEarbumpTrackById,
  searchEarbumpTracks,
  type EarbumpTrack,
} from './earbumpLibraryApi';
import { Confetti } from '../ui/confetti';
import { DotPattern } from '../ui/dot-pattern';
import {
  QORTINO_DONATION_BUBBLE_MESSAGE,
  QORTINO_DONATION_COMPLETED_EVENT,
  QORTINO_DONATION_DRAG_TYPE,
  QORTINO_DONATION_GRATEFUL_DURATION_MS,
  QORTINO_DONATION_OVERLAY_DURATION_MS,
  QORTINO_DONATION_PREFILL_NAME,
  QORTINO_DONATION_THANK_YOU_MESSAGE,
} from './qortinoDonationEasterEgg';

const LS_KEY = GETTING_STARTED_LS_KEY;
const AVATAR_SERVICE = 'THUMBNAIL';
const AVATAR_IDENTIFIER = 'qortal_avatar';
const MIN_BALANCE_FOR_QORTS = 6;
export const QORTINO_WORKSPACE_SETTINGS_KEY = 'home-qortino-workspace-v1';
const ONBOARDING_URL = 'https://qortal.dev/onboarding';
const SUPPORT_CHAT_URL = 'https://link.qortal.dev/support';
const ONBOARDING_RECOGNITION_DURATION_MS = 2600;
const QORTINO_MASCOT_BASE_SIZE = 168;
const QORTINO_MASCOT_SCALE = 0.68;
const QORTINO_MASCOT_SIZE = Math.round(
  QORTINO_MASCOT_BASE_SIZE * QORTINO_MASCOT_SCALE
);
const QORTINO_MASCOT_STAGE_PADDING_X = 26;
const QORTINO_MASCOT_STAGE_PADDING_Y = 28;
const QORTINO_MASCOT_VERTICAL_LIFT_PX = 12;
const QORTINO_WORKSPACE_BAY_HEIGHT_PX = 251;
const HOTKEY_SLOT_COUNT = 6;
const CURATED_HOTKEY_APP_NAMES = [
  'Q-Tube',
  'Quitter',
  'Q-Mail',
  'Q-Blog',
  'Q-Trade',
  'Ear-Bump',
] as const;
type QortinoSandboxPresetKey =
  | 'guide'
  | 'unlocked'
  | 'listening'
  | 'routing'
  | 'standby';
type QortinoSandboxSnapshot = {
  bubbleMessage: string;
  presetKey: QortinoSandboxPresetKey;
  statusLabel: string;
};
type QortinoDonationOverlayState = {
  message: string;
  nonce: number;
};
type QortinoGratefulState = {
  message: string;
  nonce: number;
};
const QORTINO_SANDBOX_PRESETS: readonly {
  bubbleMessage: string;
  description: string;
  key: QortinoSandboxPresetKey;
  mood: 'celebrate' | 'empty' | 'guide' | 'hotkeys' | 'music';
  statusLabel: string;
}[] = [
  {
    bubbleMessage: 'Let’s start with 6 QORT. Pick any option above.',
    description: 'Onboarding guide state.',
    key: 'guide',
    mood: 'guide',
    statusLabel: 'helpful',
  },
  {
    bubbleMessage: 'All set. You can start building your workspace above.',
    description: 'Freshly unlocked workspace state.',
    key: 'unlocked',
    mood: 'celebrate',
    statusLabel: 'happy',
  },
  {
    bubbleMessage: 'Locked on Midnight Relay.',
    description: 'Music playback companion state.',
    key: 'listening',
    mood: 'music',
    statusLabel: 'listening',
  },
  {
    bubbleMessage: 'Hotkeys panel ready.',
    description: 'Hotkey routing state.',
    key: 'routing',
    mood: 'hotkeys',
    statusLabel: 'idle',
  },
  {
    bubbleMessage: 'Choose what lives above me.',
    description: 'Neutral standby state.',
    key: 'standby',
    mood: 'empty',
    statusLabel: 'idle',
  },
] as const;
const QORTINO_SANDBOX_PRESET_BY_KEY = Object.fromEntries(
  QORTINO_SANDBOX_PRESETS.map((preset) => [preset.key, preset])
) as Record<QortinoSandboxPresetKey, (typeof QORTINO_SANDBOX_PRESETS)[number]>;
const QORTINO_STATUS_REFERENCE_LABEL = 'standby';
const HOTKEY_SLOT_VALUE_SEPARATOR = '::';
const EARBUMP_AUDIO_SERVICE = 'AUDIO';
const MUSIC_STATUS_SLOT_HEIGHT_PX = 20;
type WorkspaceMode = 'empty' | 'hotkeys' | 'music';
type StepKey = 'get_six_qorts' | 'register_name' | 'load_avatar';
type HotkeyActionId = string;
type HotkeySlotValue = string | null;
type HotkeyAppService = 'APP' | 'WEBSITE';

type MusicTrack = EarbumpTrack;

type RepeatMode = 'all' | 'one';

type WorkspaceState = {
  hotkeys: HotkeySlotValue[];
  mode: WorkspaceMode;
  musicPlaying: boolean;
  musicQuery: string;
  onboardingCelebrationSeen: boolean;
  repeatMode: RepeatMode;
  selectedTrackId: string;
  version: 1;
};

type HomeQortinoWorkspaceCardProps = {
  debugCompletionOverrides?: Partial<GettingStartedDebugOverrides>;
  debugReplayToken?: number;
  debugUseOverridesOnly?: boolean;
  onGettingStartedComplete?: () => void;
  onOpenAppsPanel?: () => void;
};

type QortinoSectionRuntimeFallbackProps = {
  body: string;
  theme: ReturnType<typeof useTheme>;
  title: string;
  variant: 'qortino' | 'workspace';
};

type WorkspaceModuleDefinition = {
  appName?: string;
  appPath?: string;
  description: string;
  icon: typeof AppsRoundedIcon;
  key: string;
  label: string;
  mode?: Exclude<WorkspaceMode, 'empty'>;
};

type HotkeyActionDefinition = {
  description: string;
  icon: typeof VideoLibraryRoundedIcon;
  id: HotkeyActionId;
  label: string;
  reaction?: string;
  run: () => void;
};

type HotkeyAppDefinition = {
  appName: string;
  description: string;
  label: string;
  service: HotkeyAppService;
};

type QAppResourceRecord = {
  metadata?: {
    description?: string;
    title?: string;
  };
  name?: string;
  service?: string;
};

type TrackReadyState = 'downloading' | 'error' | 'idle' | 'ready';

let sharedEarbumpAudioInstance: HTMLAudioElement | null = null;
let sharedEarbumpTrackSnapshot: MusicTrack | null = null;

const DEFAULT_HOTKEYS: HotkeySlotValue[] = Array.from(
  { length: HOTKEY_SLOT_COUNT },
  () => null
);

const DEFAULT_WORKSPACE_STATE: WorkspaceState = {
  hotkeys: DEFAULT_HOTKEYS,
  mode: 'empty',
  musicPlaying: false,
  musicQuery: '',
  onboardingCelebrationSeen: false,
  repeatMode: 'all',
  selectedTrackId: '',
  version: 1,
};

const WORKSPACE_MODULES: WorkspaceModuleDefinition[] = [
  {
    description: 'Curated shortcuts for your most-used routes.',
    icon: AppsRoundedIcon,
    key: 'hotkeys',
    label: 'Hotkeys',
    mode: 'hotkeys',
  },
  {
    description: 'A compact Earbump player with search and quick playback.',
    icon: LibraryMusicRoundedIcon,
    key: 'music',
    label: 'Music player',
    mode: 'music',
  },
  {
    appName: 'q-mail',
    appPath: 'to/Qortino',
    description: 'Compose > Add Subject + Message & Send it our way!',
    icon: MailOutlineRoundedIcon,
    key: 'suggest-module',
    label: 'Suggest a module',
  },
];

const LEGACY_HOTKEY_APP_NAME_MAP: Record<string, string> = {
  earbump: 'Ear-Bump',
  earbumpupdated: 'Ear-Bump',
  'ear-bump updated': 'Ear-Bump',
  'earbump updated': 'Ear-Bump',
  Earbump: 'Ear-Bump',
  'Ear-Bump Updated': 'Ear-Bump',
  'q-blog': 'Q-Blog',
  'q-mail': 'Q-Mail',
  'q-mintership': 'q-mintership',
  'q-trade': 'Q-Trade',
  'q-tube': 'Q-Tube',
  quitter: 'Quitter',
};

const normalizeHotkeyAppName = (value: string) =>
  LEGACY_HOTKEY_APP_NAME_MAP[value] ?? value;

const encodeHotkeySlotValue = (service: HotkeyAppService, appName: string) =>
  `${service}${HOTKEY_SLOT_VALUE_SEPARATOR}${appName}`;

const parseHotkeySlotValue = (
  value: string
): { appName: string; service: HotkeyAppService } => {
  const [serviceCandidate, ...rest] = value.split(HOTKEY_SLOT_VALUE_SEPARATOR);

  if (
    (serviceCandidate === 'APP' || serviceCandidate === 'WEBSITE') &&
    rest.length > 0
  ) {
    return {
      appName: rest.join(HOTKEY_SLOT_VALUE_SEPARATOR),
      service: serviceCandidate,
    };
  }

  return {
    appName: normalizeHotkeyAppName(value),
    service: 'APP',
  };
};

const formatHotkeyAppLabel = (appName: string) =>
  appName
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

const getHotkeyAppThumbnailUrl = (appName: string) =>
  `${getBaseApiReact()}/arbitrary/THUMBNAIL/${appName}/qortal_avatar?async=true`;

const HotkeyAppAvatar = ({
  appName,
  radius = 12,
  size = 36,
}: {
  appName: string;
  radius?: number;
  size?: number;
}) => (
  <Avatar
    alt={appName}
    imgProps={{ loading: 'lazy' }}
    src={getHotkeyAppThumbnailUrl(appName)}
    sx={{
      background: alpha('#A9C9FF', 0.06),
      borderRadius: `${radius}px`,
      boxShadow: `inset 0 0 0 1px ${alpha('#A9C9FF', 0.08)}`,
      height: `${size}px`,
      width: `${size}px`,
      '& img': {
        objectFit: 'fill',
      },
    }}
  >
    <Box
      alt=""
      component="img"
      src={LogoSelected}
      sx={{
        height: 'auto',
        width: `${Math.round(size * 0.68)}px`,
      }}
    />
  </Avatar>
);

const getPersistentOnboardingMessage = (stepKey: StepKey) => {
  if (stepKey === 'get_six_qorts') {
    return 'Let’s start with 6 QORT. Pick any option above.';
  }

  if (stepKey === 'register_name') {
    return 'Next, register your name.';
  }

  return 'Finally, add your avatar.';
};

const getOnboardingRecognitionMessage = (
  previousStepKey: StepKey,
  nextStepKey: StepKey
) => {
  if (
    previousStepKey === 'get_six_qorts' &&
    nextStepKey === 'register_name'
  ) {
    return 'Nice work. The hardest part is done.';
  }

  if (
    previousStepKey === 'register_name' &&
    nextStepKey === 'load_avatar'
  ) {
    return 'Great. One more to go.';
  }

  return null;
};

const resolveQortinoSandboxPresetKey = (
  statusLabel: string
): QortinoSandboxPresetKey => {
  if (statusLabel === 'helpful') return 'guide';
  if (statusLabel === 'happy') return 'unlocked';
  if (statusLabel === 'listening') return 'listening';
  if (statusLabel === 'idle') return 'standby';
  return 'standby';
};

const truncateQortinoBubbleMessage = (
  message: string | null,
  maxChars = 96
) => {
  const trimmed = message?.trim() ?? '';
  if (!trimmed) return null;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 5)).trimEnd()}(...)`;
};

const QortinoSectionRuntimeFallback = ({
  body,
  theme,
  title,
  variant,
}: QortinoSectionRuntimeFallbackProps) => {
  const isDarkMode = theme.palette.mode === 'dark';

  return (
    <Box
      sx={{
        alignItems: 'flex-start',
        background:
          variant === 'workspace'
            ? theme.palette.mode === 'dark'
              ? `linear-gradient(180deg, ${alpha('#20242D', 0.9)} 0%, ${alpha(
                  '#171B23',
                  0.96
                )} 100%)`
              : `linear-gradient(180deg, ${alpha('#FFFFFF', 0.72)} 0%, ${alpha(
                  '#F3F6FB',
                  0.9
                )} 100%)`
            : theme.palette.mode === 'dark'
              ? `radial-gradient(90% 90% at 50% 14%, ${alpha('#23324A', 0.44)} 0%, ${alpha(
                  '#18202C',
                  0.18
                )} 28%, ${alpha('#11161E', 0)} 72%), linear-gradient(180deg, ${alpha(
                  '#13171D',
                  0.98
                )} 0%, ${alpha('#0E1319', 1)} 100%)`
              : `radial-gradient(90% 90% at 50% 14%, ${alpha('#D8E8FF', 0.52)} 0%, ${alpha(
                  '#E6EEF8',
                  0.22
                )} 28%, ${alpha('#FFFFFF', 0)} 72%), linear-gradient(180deg, ${alpha(
                  '#F4F7FB',
                  0.98
                )} 0%, ${alpha('#EEF3F8', 1)} 100%)`,
        borderBottom:
          variant === 'workspace'
            ? `1px solid ${alpha(theme.palette.common.white, 0.05)}`
            : undefined,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        height: '100%',
        justifyContent: 'center',
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
        px: 2,
        py: variant === 'workspace' ? 1.55 : 1.5,
      }}
    >
      {variant === 'qortino' ? (
        <Box
          sx={{
            inset: 0,
            pointerEvents: 'none',
            position: 'absolute',
            '&::before': {
              background: getBlueAmbientLineBackground(theme, 'soft'),
              content: '""',
              height: '1px',
              left: '18px',
              position: 'absolute',
              right: '18px',
              top: 0,
            },
          }}
        />
      ) : null}
      <Typography
        sx={{
          color: theme.palette.text.primary,
          fontSize: '1rem',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {title}
      </Typography>
      <Typography
        sx={{
          color: alpha(theme.palette.text.secondary, isDarkMode ? 0.82 : 0.86),
          fontSize: '0.8rem',
          lineHeight: 1.5,
          maxWidth: '34ch',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {body}
      </Typography>
    </Box>
  );
};

const sanitizeWorkspaceState = (value: unknown): WorkspaceState => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_WORKSPACE_STATE };
  }

  const parsed = value as Partial<WorkspaceState>;
  const nextMode: WorkspaceMode =
    parsed.mode === 'hotkeys' ||
    parsed.mode === 'music'
      ? parsed.mode
      : 'empty';

  const sanitizedHotkeys = Array.isArray(parsed.hotkeys)
    ? parsed.hotkeys
        .slice(0, HOTKEY_SLOT_COUNT)
        .map((item): HotkeySlotValue =>
          typeof item === 'string' && item.trim().length > 0
            ? normalizeHotkeyAppName(item.trim())
            : null
        )
    : [];
  const paddedHotkeys = Array.from({ length: HOTKEY_SLOT_COUNT }, (_, index) =>
    sanitizedHotkeys[index] ?? null
  );

  return {
    hotkeys: paddedHotkeys,
    mode: nextMode,
    musicPlaying: parsed.musicPlaying === true,
    musicQuery:
      typeof parsed.musicQuery === 'string' ? parsed.musicQuery : '',
    onboardingCelebrationSeen: parsed.onboardingCelebrationSeen === true,
    repeatMode: parsed.repeatMode === 'one' ? 'one' : 'all',
    selectedTrackId:
      typeof parsed.selectedTrackId === 'string'
        ? parsed.selectedTrackId.trim()
        : DEFAULT_WORKSPACE_STATE.selectedTrackId,
    version: 1,
  };
};

const openExternalUrl = (url: string) => {
  if (window?.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url);
    return;
  }

  window.open(url, '_blank');
};

const dispatchAppTab = (name: string, path = '') => {
  executeEvent('addTab', { data: { service: 'APP', name, path } });
};

const getFallbackStorageKey = (userAddress: string | undefined) =>
  userAddress
    ? `${QORTINO_WORKSPACE_SETTINGS_KEY}_${userAddress}`
    : QORTINO_WORKSPACE_SETTINGS_KEY;

const loadWorkspaceStateFromFallbackStorage = (
  userAddress: string | undefined
): WorkspaceState => {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_WORKSPACE_STATE };
  }

  const fallbackKey = getFallbackStorageKey(userAddress);

  try {
    const storedValue = localStorage.getItem(fallbackKey);
    return sanitizeWorkspaceState(
      storedValue ? JSON.parse(storedValue) : null
    );
  } catch {
    return { ...DEFAULT_WORKSPACE_STATE };
  }
};

const persistWorkspaceState = async (
  nextState: WorkspaceState,
  userAddress: string | undefined
) => {
  const fallbackKey = getFallbackStorageKey(userAddress);

  try {
    localStorage.setItem(fallbackKey, JSON.stringify(nextState));
  } catch {
    // Fallback-only persistence best effort.
  }

  try {
    if (typeof window.sendMessage !== 'function') return;
    await window.sendMessage('addUserSettings', {
      keyValue: {
        key: QORTINO_WORKSPACE_SETTINGS_KEY,
        value: nextState,
      },
    });
  } catch {
    // Account-scoped save best effort; local fallback already written.
  }
};

const loadWorkspaceState = async (
  userAddress: string | undefined
): Promise<WorkspaceState> => {
  try {
    if (typeof window.sendMessage === 'function') {
      const stored = await window.sendMessage('getUserSettings', {
        key: QORTINO_WORKSPACE_SETTINGS_KEY,
      });

      if (stored && !stored.error) {
        return sanitizeWorkspaceState(stored);
      }
    }
  } catch {
    // Fallback local storage below.
  }

  return loadWorkspaceStateFromFallbackStorage(userAddress);
};

export const resetQortinoWorkspaceOnboardingCelebration = async (
  userAddress: string | undefined
) => {
  const currentState = await loadWorkspaceState(userAddress);
  await persistWorkspaceState(
    {
      ...currentState,
      onboardingCelebrationSeen: false,
    },
    userAddress
  );
};

const formatPlaybackTime = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const truncateTrackLabel = (value: string, maxLength = 30) => {
  const trimmedValue = value.trim();
  if (!trimmedValue) return value;
  if (trimmedValue.length <= maxLength) return trimmedValue;
  return `${trimmedValue.slice(0, maxLength).trimEnd()} (...)`;
};

const getSharedEarbumpAudio = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  if (sharedEarbumpAudioInstance == null) {
    sharedEarbumpAudioInstance = new Audio();
    sharedEarbumpAudioInstance.preload = 'metadata';
  }

  return sharedEarbumpAudioInstance;
};

const getSharedEarbumpTrackSnapshot = () => sharedEarbumpTrackSnapshot;

const setSharedEarbumpTrackSnapshot = (track: MusicTrack | null) => {
  sharedEarbumpTrackSnapshot = track ? { ...track } : null;
};

const stopSharedEarbumpAudio = (audio: HTMLAudioElement | null) => {
  if (!audio) {
    return;
  }

  audio.pause();
  audio.removeAttribute('src');
  audio.load();
};

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError';

const buildTrackResourceKey = (track: Pick<MusicTrack, 'id' | 'name'>) =>
  track.id && track.name ? `${EARBUMP_AUDIO_SERVICE}-${track.name}-${track.id}` : '';

const buildTrackPlaybackUrl = (track: Pick<MusicTrack, 'id' | 'name'>) =>
  track.id && track.name
    ? `${getBaseApiReact()}/arbitrary/${EARBUMP_AUDIO_SERVICE}/${encodeURIComponent(
        track.name
      )}/${encodeURIComponent(track.id)}`
    : '';

const normalizeBlockedPublisherName = (value: string) =>
  value.trim().toLowerCase();

const fetchNamesForBlockedAddress = async (
  address: string,
  signal?: AbortSignal
) => {
  const normalizedAddress = address.trim();
  if (!normalizedAddress) return [];

  const response = await fetch(
    `${getBaseApiReact()}/names/address/${encodeURIComponent(normalizedAddress)}?limit=0`,
    { signal }
  );

  if (!response.ok) return [];

  const data = await response.json();
  return Array.isArray(data)
    ? data
        .map((item) => (typeof item?.name === 'string' ? item.name.trim() : ''))
        .filter(Boolean)
    : [];
};

const getTrackReadyState = (
  rawStatus: string | null | undefined,
  hasTrack: boolean
): TrackReadyState => {
  if (!hasTrack) return 'idle';
  if (rawStatus === 'READY') return 'ready';
  if (
    rawStatus === 'FAILED_TO_DOWNLOAD' ||
    rawStatus === 'BUILD_FAILED' ||
    rawStatus === 'NOT_PUBLISHED' ||
    rawStatus === 'BLOCKED' ||
    rawStatus === 'UNSUPPORTED'
  ) {
    return 'error';
  }

  return 'downloading';
};

const getTrackReadyPercent = (rawStatus: string | null | undefined, percent: number) => {
  if (rawStatus === 'READY') return 100;
  if (Number.isFinite(percent) && percent > 0) {
    return Math.min(Math.max(percent, 0), 100);
  }

  if (rawStatus === 'DOWNLOADED') return 94;
  if (rawStatus === 'BUILDING') return 97;
  if (rawStatus === 'REFETCHING') return 42;
  if (rawStatus === 'MISSING_DATA') return 34;
  if (rawStatus === 'DOWNLOADING') return 18;
  if (rawStatus === 'SEARCHING') return 10;
  if (rawStatus === 'PUBLISHED' || rawStatus === 'INITIAL') return 6;
  return 0;
};

const EMPTY_MUSIC_TRACK: MusicTrack = {
  artist: 'EarBump',
  coverColors: ['#6EA7FF', '#243B72', '#9CCBFF'],
  created: 0,
  id: '',
  length: '--:--',
  name: 'earbump',
  status: null,
  streamUrl: '',
  title: 'EarBump library',
  updated: null,
  uploaded: 'Waiting for library',
};

const MusicCoverArt = ({
  isSpinning = false,
  size,
  track,
}: {
  isSpinning?: boolean;
  size: number;
  track: MusicTrack;
}) => (
  <Box
    sx={{
      animation: 'earbumpDiscSpin 6.4s linear infinite',
      animationPlayState: isSpinning ? 'running' : 'paused',
      alignItems: 'center',
      background: `radial-gradient(circle at 30% 28%, ${alpha(
        track.coverColors[2],
        0.94
      )} 0%, ${alpha(track.coverColors[0], 0.88)} 34%, ${alpha(
        track.coverColors[1],
        0.94
      )} 100%)`,
      border: `1px solid ${alpha('#D7E7FF', 0.14)}`,
      borderRadius: '50%',
      boxShadow: `0 14px 26px ${alpha(track.coverColors[1], 0.28)}, inset 0 1px 0 ${alpha(
        '#fff',
        0.22
      )}`,
      display: 'flex',
      height: `${size}px`,
      justifyContent: 'center',
      overflow: 'hidden',
      position: 'relative',
      transformOrigin: '50% 50%',
      transition: 'filter 180ms ease',
      willChange: 'transform',
      width: `${size}px`,
      '@keyframes earbumpDiscSpin': {
        from: {
          transform: 'rotate(0deg)',
        },
        to: {
          transform: 'rotate(360deg)',
        },
      },
      '&::before': {
        background: `linear-gradient(135deg, ${alpha('#ffffff', 0.32)} 0%, ${alpha(
          '#ffffff',
          0
        )} 48%)`,
        content: '""',
        inset: '10%',
        position: 'absolute',
        transform: 'rotate(-18deg)',
      },
      '&::after': {
        background: alpha('#05070B', 0.22),
        borderRadius: '50%',
        content: '""',
        height: `${Math.round(size * 0.46)}px`,
        left: '50%',
        position: 'absolute',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: `${Math.round(size * 0.46)}px`,
      },
    }}
  >
    <Box
      sx={{
        background: alpha('#EAF2FF', 0.9),
        borderRadius: '50%',
        boxShadow: `0 0 0 2px ${alpha('#0B1119', 0.32)}`,
        height: `${Math.max(8, Math.round(size * 0.08))}px`,
        position: 'relative',
        width: `${Math.max(8, Math.round(size * 0.08))}px`,
        zIndex: 1,
      }}
    />
  </Box>
);

const QortinoMascot = ({
  isDarkMode,
  isTickled,
  isListening,
  isTalking,
  lookDebug,
  mood,
  showAntenna = true,
}: {
  isDarkMode: boolean;
  isTickled: boolean;
  isListening: boolean;
  isTalking: boolean;
  lookDebug: QortinoLookDebugSettings;
  mood:
    | 'celebrate'
    | 'empty'
    | 'grateful'
    | 'guide'
    | 'hotkeys'
    | 'music'
    | 'notes';
  showAntenna?: boolean;
}) => {
  const expression = isTickled
    ? 'ticklish'
    : mood === 'music'
      ? 'music'
      : mood === 'guide'
        ? 'guide'
        : mood === 'hotkeys'
          ? 'focused'
          : mood === 'notes'
            ? 'attentive'
            : mood === 'celebrate'
              ? 'delighted'
              : mood === 'grateful'
                ? 'delighted'
              : 'calm';
  const eyeStyle = {
    attentive: { height: 8, top: 79, width: 9 },
    calm: { height: 9, top: 80, width: 9 },
    delighted: { height: 8, top: 79, width: 10 },
    focused: { height: 7, top: 81, width: 10 },
    guide: { height: 10, top: 78, width: 9 },
    music: { height: 10, top: 79, width: 10 },
    ticklish: { height: 2, top: 82, width: 14 },
  }[expression];
  const mouthStyle = {
    attentive: { left: 69, top: 98, width: 28 },
    calm: { left: 70, top: 97, width: 26 },
    delighted: { left: 66, top: 94, width: 34 },
    focused: { left: 71, top: 98, width: 24 },
    guide: { left: 68, top: 96, width: 30 },
    music: { left: 67, top: 94, width: 32 },
    ticklish: { left: 66, top: 93, width: 34 },
  }[expression];
  const mascotAnimation = isTickled
    ? 'qortinoTicklishBounce 0.58s ease-in-out infinite'
    : isListening
      ? 'qortinoMusicBounce 3s ease-in-out infinite'
      : 'qortinoBob 5.8s ease-in-out infinite';
  const tickleRotateDeg = isTickled ? 1.35 : 0;
  const tickleTransform = isTickled
    ? 'translateY(-4px) scale(1.055)'
    : 'translateY(0px) scale(1)';
  const leftEyeTransform = isTickled
    ? `rotate(${(-tickleRotateDeg * 0.85).toFixed(2)}deg) scaleX(1.06)`
    : 'rotate(0deg) scaleX(1)';
  const rightEyeTransform = isTickled
    ? `rotate(${(tickleRotateDeg * 0.85).toFixed(2)}deg) scaleX(1.06)`
    : 'rotate(0deg) scaleX(1)';
  const faceRootLeft = 44;
  const faceRootTop = 58;
  const faceRootWidth = 80;
  const faceRootHeight = 58;
  const faceLeftEyeLeft = 20;
  const faceRightEyeLeft = 50;
  const faceEyeTop = eyeStyle.top - faceRootTop;
  const faceMouthLeft = mouthStyle.left - faceRootLeft;
  const faceMouthTop = mouthStyle.top - faceRootTop;
  const antennaBubbleSize = 20;
  const antennaBubbleOverlap = 9;
  const antennaStemHeight = Math.max(
    11,
    Math.round(20 * lookDebug.antennaLength)
  );
  const antennaContainerHeight =
    antennaBubbleSize - antennaBubbleOverlap + antennaStemHeight;

  return (
      <Box
        sx={{
          '@keyframes qortinoBob': {
            '0%, 100%': { transform: 'translateY(4px)' },
            '50%': { transform: 'translateY(0px)' },
          },
          '@keyframes qortinoMusicBounce': {
            '0%, 100%': { transform: 'translateY(4px)' },
            '25%': { transform: 'translateY(2px)' },
            '50%': { transform: 'translateY(-1px)' },
            '75%': { transform: 'translateY(3px)' },
          },
          '@keyframes qortinoTicklishBounce': {
            '0%, 100%': { transform: 'translateY(2px) rotate(0deg)' },
            '18%': { transform: 'translateY(-7px) rotate(-0.85deg)' },
            '38%': { transform: 'translateY(-2px) rotate(0.55deg)' },
            '60%': { transform: 'translateY(-10px) rotate(0.95deg)' },
            '82%': { transform: 'translateY(-3px) rotate(-0.45deg)' },
          },
          '@keyframes qortinoBlink': {
            '0%, 45%, 100%': { transform: 'scaleY(1)' },
            '48%, 52%': { transform: 'scaleY(0.16)' },
          },
          '@keyframes qortinoTalk': {
            '0%, 100%': { transform: 'scaleY(1) scaleX(1)' },
            '25%': { transform: 'scaleY(0.72) scaleX(1.06)' },
            '50%': { transform: 'scaleY(1.18) scaleX(0.96)' },
            '75%': { transform: 'scaleY(0.82) scaleX(1.04)' },
          },
          height: `${QORTINO_MASCOT_SIZE}px`,
          overflow: 'visible',
          position: 'relative',
          width: `${QORTINO_MASCOT_SIZE}px`,
        }}
      >
      <Box
        sx={{
          bottom: 0,
          height: `${QORTINO_MASCOT_BASE_SIZE}px`,
          left: 0,
          position: 'absolute',
          transform: `scale(${QORTINO_MASCOT_SCALE})`,
          transformOrigin: 'bottom left',
          width: `${QORTINO_MASCOT_BASE_SIZE}px`,
        }}
      >
        <Box
          sx={{
            height: `${QORTINO_MASCOT_BASE_SIZE}px`,
            position: 'relative',
            transform: tickleTransform,
            transformOrigin: 'center bottom',
            transition:
              'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
            width: `${QORTINO_MASCOT_BASE_SIZE}px`,
          }}
        >
          <Box
            sx={{
              animation: mascotAnimation,
              height: `${QORTINO_MASCOT_BASE_SIZE}px`,
              position: 'relative',
              transformOrigin: 'center bottom',
              width: `${QORTINO_MASCOT_BASE_SIZE}px`,
            }}
          >
            <Box
              sx={{
                height: '152px',
                left: '8px',
                position: 'absolute',
                top: '6px',
                transform: `scale(${lookDebug.bodyScale}) scaleX(${lookDebug.bodyWidthScale})`,
                transformOrigin: 'center',
                width: '152px',
              }}
            >
              <Box
                sx={{
                  background: `radial-gradient(ellipse at center, ${alpha(
                    '#02050B',
                    isDarkMode ? 0.56 : 0.3
                  )} 0%, ${alpha('#02050B', isDarkMode ? 0.3 : 0.16)} 48%, ${alpha(
                    '#02050B',
                    0
                  )} 78%)`,
                  bottom: '4px',
                  filter: 'blur(9px)',
                  height: '20px',
                  left: '16px',
                  opacity: isListening ? 0.98 : 0.9,
                  position: 'absolute',
                  width: '120px',
                }}
              />
              <Box
                sx={{
                  background: `radial-gradient(ellipse at center, ${alpha(
                    '#010307',
                    isDarkMode ? 0.5 : 0.28
                  )} 0%, ${alpha('#010307', 0)} 72%)`,
                  bottom: '7px',
                  filter: 'blur(4px)',
                  height: '10px',
                  left: '27px',
                  opacity: isListening ? 0.86 : 0.78,
                  position: 'absolute',
                  width: '88px',
                }}
              />
              <Box
                sx={{
                  background: `radial-gradient(circle, ${alpha(
                    '#0A1220',
                    0.22
                  )} 0%, ${alpha('#0A1220', 0)} 72%)`,
                  filter: 'blur(10px)',
                  inset: 0,
                  opacity: 0.44,
                  position: 'absolute',
                }}
              />
              <Box
                sx={{
                  background: `radial-gradient(circle at 34% 22%, ${alpha(
                    '#A0B8DD',
                    isDarkMode ? 0.14 : 0.1
                  )} 0%, ${alpha('#6B88B5', isDarkMode ? 0.08 : 0.05)} 18%, ${alpha(
                    '#0D1524',
                    0
                  )} 42%), linear-gradient(180deg, ${alpha('#232C3A', 0.98)} 0%, ${alpha(
                    '#161B24',
                    0.98
                  )} 58%, ${alpha('#10141C', 1)} 100%)`,
                  border: `1px solid ${alpha('#B3D0FF', isDarkMode ? 0.16 : 0.12)}`,
                  borderRadius: '46% 46% 42% 42%',
                  boxShadow: `0 18px 32px ${alpha('#000', 0.3)}, inset 0 1px 0 ${alpha(
                    '#fff',
                    0.03
                  )}, inset 0 -1px 0 ${alpha('#000', 0.22)}`,
                  inset: 0,
                  position: 'absolute',
                }}
              />
            </Box>
            <Box
              sx={{
                height: `${faceRootHeight}px`,
                left: `${faceRootLeft}px`,
                position: 'absolute',
                top: `${faceRootTop}px`,
                transform: `scale(${lookDebug.faceScale})`,
                transformOrigin: 'center',
                width: `${faceRootWidth}px`,
              }}
            >
              <Box
                sx={{
                  backdropFilter: 'blur(10px)',
                  background: `linear-gradient(180deg, ${alpha('#121A26', 0.7)} 0%, ${alpha(
                    '#0B1119',
                    0.84
                  )} 100%)`,
                  border: `1px solid ${alpha('#B3D0FF', 0.12)}`,
                  borderRadius: '28px',
                  boxShadow: `inset 0 1px 0 ${alpha('#fff', 0.06)}`,
                  inset: 0,
                  position: 'absolute',
                }}
              />
              <Box
                sx={{
                  animation: isTickled
                    ? 'none'
                    : 'qortinoBlink 6.2s ease-in-out infinite',
                  bgcolor: '#DDEBFF',
                  borderRadius: '999px',
                  boxShadow: `0 0 12px ${alpha('#7FB5FF', 0.2)}`,
                  height: eyeStyle.height,
                  left: faceLeftEyeLeft,
                  position: 'absolute',
                  top: faceEyeTop,
                  transform: leftEyeTransform,
                  transformOrigin: 'center',
                  transition:
                    'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
                  width: eyeStyle.width,
                }}
              />
              <Box
                sx={{
                  animation: isTickled
                    ? 'none'
                    : 'qortinoBlink 6.2s ease-in-out infinite 120ms',
                  bgcolor: '#DDEBFF',
                  borderRadius: '999px',
                  boxShadow: `0 0 12px ${alpha('#7FB5FF', 0.2)}`,
                  height: eyeStyle.height,
                  left: faceRightEyeLeft,
                  position: 'absolute',
                  top: faceEyeTop,
                  transform: rightEyeTransform,
                  transformOrigin: 'center',
                  transition:
                    'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
                  width: eyeStyle.width,
                }}
              />
              <Box
                sx={{
                  borderBottom: `2px solid ${alpha('#DDEBFF', 0.78)}`,
                  borderRadius: '0 0 999px 999px',
                  height: '8px',
                  left: faceMouthLeft,
                  position: 'absolute',
                  top: faceMouthTop,
                  transformOrigin: 'center',
                  width: mouthStyle.width,
                  ...(isTalking || isListening
                    ? {
                        animation: 'qortinoTalk 1.25s ease-in-out infinite',
                      }
                    : null),
                }}
              />
            </Box>
            {showAntenna ? (
              <Box
                sx={{
                  bottom: '130px',
                  height: `${antennaContainerHeight}px`,
                  left: '72px',
                  position: 'absolute',
                  transform: `scale(${lookDebug.antennaScale})`,
                  transformOrigin: 'bottom center',
                  width: '24px',
                }}
              >
                <Box
                  sx={{
                    background: `linear-gradient(180deg, ${alpha('#D2E3FF', 0.38)} 0%, ${alpha(
                      '#D2E3FF',
                      0
                    )} 100%)`,
                    borderRadius: '999px',
                    height: `${antennaStemHeight}px`,
                    left: '8px',
                    position: 'absolute',
                    top: `${antennaBubbleSize - antennaBubbleOverlap}px`,
                    width: '8px',
                  }}
                />
                <QortalRequestBubbleIcon
                  size={antennaBubbleSize}
                  logoScale={lookDebug.logoScale}
                  sx={{
                    left: '2px',
                    position: 'absolute',
                    top: 0,
                  }}
                />
              </Box>
            ) : null}
            {mood === 'guide' && <GuideBeacon isDarkMode={isDarkMode} />}
            {mood === 'hotkeys' && (
              <>
                <RouteDecoration
                  delay={0}
                  isDarkMode={isDarkMode}
                  left="18px"
                  top="38px"
                />
                <RouteDecoration
                  delay={0.25}
                  isDarkMode={isDarkMode}
                  left="132px"
                  top="114px"
                />
              </>
            )}
            {mood === 'notes' && (
              <>
                <NoteCardDecoration
                  delay={0}
                  isDarkMode={isDarkMode}
                  left="18px"
                  top="42px"
                />
                <NoteCardDecoration
                  delay={0.2}
                  isDarkMode={isDarkMode}
                  left="132px"
                  top="112px"
                />
              </>
            )}
            {isListening && (
              <>
                <MusicNoteDecoration delay={0} isDarkMode={isDarkMode} left="76px" top="8px" />
                <MusicNoteDecoration
                  delay={0.18}
                  isDarkMode={isDarkMode}
                  left="90px"
                  top="0px"
                  size={18}
                />
                <MusicNoteDecoration
                  delay={0.36}
                  isDarkMode={isDarkMode}
                  left="104px"
                  top="10px"
                  size={14}
                />
              </>
            )}
            {mood === 'celebrate' && (
              <>
                <SparkDecoration left="26px" top="18px" />
                <SparkDecoration left="136px" top="26px" />
                <SparkDecoration left="134px" top="126px" />
              </>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

const MusicNoteDecoration = ({
  delay,
  isDarkMode,
  left,
  size = 16,
  top,
}: {
  delay: number;
  isDarkMode: boolean;
  left: string;
  size?: number;
  top: string;
}) => (
  <Box
    sx={{
      '@keyframes qortinoNoteFloat': {
        '0%, 100%': { opacity: 0.18, transform: 'translateY(0px) scale(0.94)' },
        '50%': { opacity: 0.82, transform: 'translateY(-12px) scale(1.02)' },
      },
      animation: `qortinoNoteFloat 3.4s ease-in-out ${delay}s infinite`,
      color: alpha('#95BEFF', isDarkMode ? 0.92 : 0.76),
      left,
      position: 'absolute',
      top,
    }}
  >
    <GraphicEqRoundedIcon sx={{ fontSize: `${size}px` }} />
  </Box>
);

const GuideBeacon = ({ isDarkMode }: { isDarkMode: boolean }) => (
  <Box
    sx={{
      '@keyframes qortinoGuidePulse': {
        '0%, 100%': { opacity: 0.1, transform: 'scale(0.88)' },
        '50%': { opacity: 0.44, transform: 'scale(1.06)' },
      },
      border: `1px solid ${alpha('#97C0FF', isDarkMode ? 0.32 : 0.24)}`,
      borderRadius: '999px',
      boxShadow: `0 0 16px ${alpha('#8DB8FF', isDarkMode ? 0.16 : 0.1)}`,
      height: '28px',
      left: '70px',
      pointerEvents: 'none',
      position: 'absolute',
      top: '2px',
      width: '28px',
      animation: 'qortinoGuidePulse 2.8s ease-in-out infinite',
    }}
  />
);

const RouteDecoration = ({
  delay,
  isDarkMode,
  left,
  top,
}: {
  delay: number;
  isDarkMode: boolean;
  left: string;
  top: string;
}) => (
  <Box
    sx={{
      '@keyframes qortinoRouteFlow': {
        '0%, 100%': { opacity: 0.18, transform: 'translateX(0px)' },
        '50%': { opacity: 0.74, transform: 'translateX(4px)' },
      },
      alignItems: 'center',
      animation: `qortinoRouteFlow 2.9s ease-in-out ${delay}s infinite`,
      color: alpha('#98C0FF', isDarkMode ? 0.9 : 0.72),
      display: 'inline-flex',
      gap: '2px',
      left,
      pointerEvents: 'none',
      position: 'absolute',
      top,
    }}
  >
    <ChevronRightRoundedIcon sx={{ fontSize: '12px' }} />
    <ChevronRightRoundedIcon sx={{ fontSize: '10px', opacity: 0.7 }} />
  </Box>
);

const NoteCardDecoration = ({
  delay,
  isDarkMode,
  left,
  top,
}: {
  delay: number;
  isDarkMode: boolean;
  left: string;
  top: string;
}) => (
  <Box
    sx={{
      '@keyframes qortinoNoteCardFloat': {
        '0%, 100%': { opacity: 0.18, transform: 'translateY(0px)' },
        '50%': { opacity: 0.68, transform: 'translateY(-3px)' },
      },
      animation: `qortinoNoteCardFloat 3.1s ease-in-out ${delay}s infinite`,
      background: `linear-gradient(180deg, ${alpha('#202A3B', isDarkMode ? 0.72 : 0.28)} 0%, ${alpha(
        '#131A25',
        isDarkMode ? 0.82 : 0.18
      )} 100%)`,
      border: `1px solid ${alpha('#9CC3FF', isDarkMode ? 0.18 : 0.12)}`,
      borderRadius: '8px',
      boxShadow: `0 6px 14px ${alpha('#000', isDarkMode ? 0.16 : 0.08)}`,
      height: '20px',
      left,
      pointerEvents: 'none',
      position: 'absolute',
      top,
      width: '16px',
      '&::before': {
        background: alpha('#9CC3FF', isDarkMode ? 0.46 : 0.24),
        borderRadius: '2px',
        content: '""',
        height: '2px',
        left: '4px',
        position: 'absolute',
        top: '6px',
        width: '8px',
      },
      '&::after': {
        background: alpha('#9CC3FF', isDarkMode ? 0.32 : 0.18),
        borderRadius: '2px',
        content: '""',
        height: '2px',
        left: '4px',
        position: 'absolute',
        top: '10px',
        width: '6px',
      },
    }}
  />
);

const SparkDecoration = ({ left, top }: { left: string; top: string }) => (
  <Box
    sx={{
      '@keyframes qortinoSparkPulse': {
        '0%, 100%': { opacity: 0.18, transform: 'scale(0.9)' },
        '50%': { opacity: 0.76, transform: 'scale(1)' },
      },
      animation: 'qortinoSparkPulse 2.4s ease-in-out infinite',
      color: alpha('#A7CAFF', 0.9),
      left,
      position: 'absolute',
      top,
    }}
  >
    <AutoAwesomeRoundedIcon sx={{ fontSize: '14px' }} />
  </Box>
);

export const HomeQortinoWorkspaceCard = ({
  debugCompletionOverrides,
  debugReplayToken = 0,
  debugUseOverridesOnly = false,
  onGettingStartedComplete,
  onOpenAppsPanel,
}: HomeQortinoWorkspaceCardProps) => {
  const { t } = useTranslation(['tutorial']);
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const panelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const blockedAddresses = useAtomValue(blockedAddressesAtom);
  const blockedNames = useAtomValue(blockedNamesAtom);
  const txList = useAtomValue(txListAtom);
  const { refreshBlockedUsers } = useBlockedAddresses(true);
  const userAddress = userInfo?.address;
  const name = userInfo?.name;
  const openApp = useCallback(
    (appName: string, path = '') => {
      if (onOpenAppsPanel) {
        onOpenAppsPanel();
      } else {
        executeEvent('newTabWindow', {});
        executeEvent('open-apps-mode', {});
      }

      window.setTimeout(() => {
        dispatchAppTab(appName, path);
      }, 90);
    },
    [onOpenAppsPanel]
  );

  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [paymentsFallbackTotal, setPaymentsFallbackTotal] = useState<number | null>(null);
  const [hasAvatar, setHasAvatar] = useState(false);
  const [avatarStepCompleted, setAvatarStepCompleted] = useState(false);
  const [checkingAvatar, setCheckingAvatar] = useState(false);
  const [qortsAcquiredAcknowledged, setQortsAcquiredAcknowledged] = useState(false);
  const [showRegisterNameDelayHint, setShowRegisterNameDelayHint] = useState(false);
  const [openQortsDialog, setOpenQortsDialog] = useState(false);
  const [openMusicSearchDialog, setOpenMusicSearchDialog] = useState(false);
  const [openModulePickerDialog, setOpenModulePickerDialog] = useState(false);
  const [openHotkeyPickerDialog, setOpenHotkeyPickerDialog] = useState(false);
  const [availableHotkeyApps, setAvailableHotkeyApps] = useState<
    HotkeyAppDefinition[]
  >([]);
  const [hotkeyAppsError, setHotkeyAppsError] = useState<string | null>(null);
  const [isHotkeyAppsLoading, setIsHotkeyAppsLoading] = useState(false);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(() =>
    loadWorkspaceStateFromFallbackStorage(userAddress)
  );
  const [qortinoLookDebug, setQortinoLookDebug] =
    useState<QortinoLookDebugSettings>(() =>
      typeof window === 'undefined'
        ? { ...DEFAULT_QORTINO_LOOK_DEBUG_SETTINGS }
        : parseQortinoLookDebugSettings(
            localStorage.getItem(QORTINO_LOOK_DEBUG_STORAGE_KEY)
          )
    );
  const [qortinoLayoutDebug, setQortinoLayoutDebug] =
    useState<QortinoLayoutDebugSettings>(() =>
      typeof window === 'undefined'
        ? { ...DEFAULT_QORTINO_LAYOUT_DEBUG_SETTINGS }
        : parseQortinoLayoutDebugSettings(
            localStorage.getItem(QORTINO_LAYOUT_DEBUG_STORAGE_KEY)
          )
    );
  const [qortinoCompanionDebug, setQortinoCompanionDebug] =
    useState<QortinoCompanionDebugSettings>(() =>
      typeof window === 'undefined'
        ? { ...DEFAULT_QORTINO_COMPANION_DEBUG_SETTINGS }
        : parseQortinoCompanionDebugSettings(
            localStorage.getItem(QORTINO_COMPANION_DEBUG_STORAGE_KEY)
          )
    );
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [selectedHotkeySlot, setSelectedHotkeySlot] = useState(0);
  const [hotkeySearchQuery, setHotkeySearchQuery] = useState('');
  const [earbumpDiscoveryTracks, setEarbumpDiscoveryTracks] = useState<
    MusicTrack[]
  >([]);
  const [earbumpSearchTracks, setEarbumpSearchTracks] = useState<MusicTrack[]>(
    []
  );
  const [selectedTrackSnapshot, setSelectedTrackSnapshot] =
    useState<MusicTrack | null>(() => getSharedEarbumpTrackSnapshot());
  const [musicProgress, setMusicProgress] = useState(0);
  const [musicPlaybackTime, setMusicPlaybackTime] = useState(0);
  const [musicTrackDurations, setMusicTrackDurations] = useState<
    Record<string, number>
  >({});
  const [isEarbumpDiscoveryLoading, setIsEarbumpDiscoveryLoading] =
    useState(false);
  const [isEarbumpSearchLoading, setIsEarbumpSearchLoading] = useState(false);
  const [earbumpDiscoveryError, setEarbumpDiscoveryError] = useState<
    string | null
  >(null);
  const [earbumpSearchError, setEarbumpSearchError] = useState<string | null>(
    null
  );
  const [musicStreamError, setMusicStreamError] = useState<string | null>(null);
  const [blockedNamesResolvedFromAddresses, setBlockedNamesResolvedFromAddresses] =
    useState<string[]>([]);
  const [ephemeralReaction, setEphemeralReaction] = useState<string | null>(null);
  const [onboardingTransitionMessage, setOnboardingTransitionMessage] =
    useState<string | null>(null);
  const [postOnboardingMessage, setPostOnboardingMessage] = useState<
    string | null
  >(null);
  const [showOnboardingCompletionConfetti, setShowOnboardingCompletionConfetti] =
    useState(false);
  const [openQortinoSandboxDialog, setOpenQortinoSandboxDialog] =
    useState(false);
  const [qortinoSandboxPresetKey, setQortinoSandboxPresetKey] =
    useState<QortinoSandboxPresetKey>('standby');
  const [qortinoSandboxStatusLabel, setQortinoSandboxStatusLabel] =
    useState(QORTINO_SANDBOX_PRESET_BY_KEY.standby.statusLabel);
  const [qortinoSandboxBubbleMessage, setQortinoSandboxBubbleMessage] =
    useState(QORTINO_SANDBOX_PRESET_BY_KEY.standby.bubbleMessage);
  const [qortinoSandboxPreviewNonce, setQortinoSandboxPreviewNonce] =
    useState(0);
  const [isQortinoTickled, setIsQortinoTickled] = useState(false);
  const [isQortinoSandboxTickled, setIsQortinoSandboxTickled] = useState(false);
  const [qortinoGratefulState, setQortinoGratefulState] =
    useState<QortinoGratefulState | null>(null);
  const [qortinoDonationOverlayState, setQortinoDonationOverlayState] =
    useState<QortinoDonationOverlayState | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(getSharedEarbumpAudio());
  const discoveryRequestRef = useRef<AbortController | null>(null);
  const searchRequestRef = useRef<AbortController | null>(null);
  const qortinoGratefulTimeoutRef = useRef<number | null>(null);
  const qortinoDonationOverlayTimeoutRef = useRef<number | null>(null);
  const selectedTrackRequestRef = useRef<AbortController | null>(null);
  const reactionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onboardingMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const onboardingConfettiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const lastReactionRef = useRef<string | null>(null);
  const lastReactionAtRef = useRef(0);
  const onboardingBubbleLockRef = useRef(false);
  const onboardingBubbleHoldRef = useRef(false);
  const previousOnboardingStepRef = useRef<StepKey | null>(null);
  const onboardingJustCompletedRef = useRef(false);
  const wasOnboardingVisibleRef = useRef(false);
  const avatarCompletionAfterPanelCloseRef = useRef(false);
  const musicProgressBarRef = useRef<HTMLDivElement | null>(null);
  const qortinoSandboxBaseSnapshotRef = useRef<QortinoSandboxSnapshot>({
    bubbleMessage: QORTINO_SANDBOX_PRESET_BY_KEY.standby.bubbleMessage,
    presetKey: 'standby',
    statusLabel: QORTINO_SANDBOX_PRESET_BY_KEY.standby.statusLabel,
  });
  const downloadResource = useFetchResources();
  const blockedAddressList = useMemo(
    () => Object.keys(blockedAddresses || {}).filter(Boolean),
    [blockedAddresses]
  );
  const blockedPublisherNames = useMemo(
    () =>
      [
        ...Object.keys(blockedNames || {}),
        ...blockedNamesResolvedFromAddresses,
      ]
        .map(normalizeBlockedPublisherName)
        .filter(Boolean),
    [blockedNames, blockedNamesResolvedFromAddresses]
  );
  const blockedPublisherNameSet = useMemo(
    () => new Set(blockedPublisherNames),
    [blockedPublisherNames]
  );
  const isBlockedPublisherName = useCallback(
    (publisherName: string) =>
      blockedPublisherNameSet.has(normalizeBlockedPublisherName(publisherName)),
    [blockedPublisherNameSet]
  );
  const filterBlockedMusicTracks = useCallback(
    (tracks: MusicTrack[]) =>
      blockedPublisherNameSet.size === 0
        ? tracks
        : tracks.filter((track) => !isBlockedPublisherName(track.name)),
    [blockedPublisherNameSet.size, isBlockedPublisherName]
  );

  const pushReaction = useCallback(
    (
      nextMessage: string,
      options?: { allowDuringOnboarding?: boolean }
    ) => {
      const trimmedMessage = nextMessage.trim();
      if (!trimmedMessage) return;

      if (
        (onboardingBubbleLockRef.current || onboardingBubbleHoldRef.current) &&
        options?.allowDuringOnboarding !== true
      ) {
        return;
      }

      const isAllowedRuntimeReaction =
        trimmedMessage ===
          'This only mutes desktop alerts. In-Hub notifications still continue.' ||
        trimmedMessage === 'Only available for minters. Apply at Q-Mintership.' ||
        /^This panel unlocks once you.+ minter\. Swing by Q-Mintership to get started!$/.test(
          trimmedMessage
        ) ||
        trimmedMessage === 'Hotkeys panel ready.' ||
        trimmedMessage === 'Music panel ready.' ||
        trimmedMessage === 'Music player ready.' ||
        trimmedMessage === 'Panel cleared.' ||
        /^Locked on .+\.$/.test(trimmedMessage) ||
        /^.+ is in rotation\.$/.test(trimmedMessage);

      if (
        onboardingBubbleLockRef.current !== true &&
        options?.allowDuringOnboarding !== true &&
        !isAllowedRuntimeReaction
      ) {
        return;
      }

      const now = Date.now();
      if (
        lastReactionRef.current === trimmedMessage &&
        now - lastReactionAtRef.current < 1400
      ) {
        return;
      }

      lastReactionRef.current = trimmedMessage;
      lastReactionAtRef.current = now;

      if (reactionTimeoutRef.current) {
        window.clearTimeout(reactionTimeoutRef.current);
      }
      setEphemeralReaction(trimmedMessage);
      reactionTimeoutRef.current = window.setTimeout(() => {
        setEphemeralReaction(null);
      }, 6800);
    },
    []
  );

  useEffect(() => {
    audioRef.current = getSharedEarbumpAudio();

    return () => {
      if (reactionTimeoutRef.current) {
        window.clearTimeout(reactionTimeoutRef.current);
      }

      if (onboardingMessageTimeoutRef.current) {
        window.clearTimeout(onboardingMessageTimeoutRef.current);
      }

      if (onboardingConfettiTimeoutRef.current) {
        window.clearTimeout(onboardingConfettiTimeoutRef.current);
      }

      if (qortinoGratefulTimeoutRef.current) {
        window.clearTimeout(qortinoGratefulTimeoutRef.current);
      }

      discoveryRequestRef.current?.abort();
      searchRequestRef.current?.abort();
      selectedTrackRequestRef.current?.abort();
    };
  }, []);

  const applyWorkspaceState = useCallback(
    (updater: (current: WorkspaceState) => WorkspaceState) => {
      setWorkspaceState((current) => sanitizeWorkspaceState(updater(current)));
    },
    []
  );

  useEffect(() => {
    const handleLogout = () => {
      stopSharedEarbumpAudio(audioRef.current);
      setSharedEarbumpTrackSnapshot(null);
      setMusicPlaybackTime(0);
      setMusicProgress(0);
      setMusicStreamError(null);
      applyWorkspaceState((current) =>
        current.musicPlaying
          ? {
              ...current,
              musicPlaying: false,
            }
          : current
      );
    };

    subscribeToEvent('logout-event', handleLogout);

    return () => {
      unsubscribeFromEvent('logout-event', handleLogout);
    };
  }, [applyWorkspaceState]);

  useEffect(() => {
    if (userAddress != null) {
      return;
    }

    stopSharedEarbumpAudio(audioRef.current);
    setIsQortinoTickled(false);
    setIsQortinoSandboxTickled(false);
    setQortinoGratefulState(null);
    setSharedEarbumpTrackSnapshot(null);
    setMusicPlaybackTime(0);
    setMusicProgress(0);
    setMusicStreamError(null);
    setSelectedTrackSnapshot(null);
  }, [userAddress, debugReplayToken]);

  const handleQortinoPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setIsQortinoTickled(true);
    },
    []
  );

  const handleQortinoPointerRelease = useCallback(() => {
    setIsQortinoTickled(false);
  }, []);

  const showQortinoDonationOverlay = useCallback(
    ({
      durationMs,
      message,
      mood,
      statusLabel,
    }: {
      durationMs: number;
      message: string;
    }) => {
    if (qortinoDonationOverlayTimeoutRef.current != null) {
      window.clearTimeout(qortinoDonationOverlayTimeoutRef.current);
    }
    setQortinoDonationOverlayState({
      message,
      nonce: Date.now(),
    });
    qortinoDonationOverlayTimeoutRef.current = window.setTimeout(() => {
      setQortinoDonationOverlayState(null);
      qortinoDonationOverlayTimeoutRef.current = null;
    }, durationMs);
  },
    []
  );

  const handleQortinoDonationDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes(QORTINO_DONATION_DRAG_TYPE)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    },
    []
  );

  const handleQortinoDonationDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes(QORTINO_DONATION_DRAG_TYPE)) {
        return;
      }
      event.preventDefault();
      executeEvent('openPaymentInternal', {
        name: QORTINO_DONATION_PREFILL_NAME,
      });
      showQortinoDonationOverlay({
        durationMs: QORTINO_DONATION_OVERLAY_DURATION_MS,
        message: QORTINO_DONATION_BUBBLE_MESSAGE,
      });
    },
    [showQortinoDonationOverlay]
  );

  const handleQortinoSandboxPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setIsQortinoSandboxTickled(true);
    },
    []
  );

  const handleQortinoSandboxPointerRelease = useCallback(() => {
    setIsQortinoSandboxTickled(false);
  }, []);

  useEffect(
    () => () => {
      if (qortinoGratefulTimeoutRef.current != null) {
        window.clearTimeout(qortinoGratefulTimeoutRef.current);
      }
      if (qortinoDonationOverlayTimeoutRef.current != null) {
        window.clearTimeout(qortinoDonationOverlayTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const handleQortinoDonationCompleted = (event: Event) => {
      const recipient =
        (
          event as CustomEvent<{
            recipient?: string;
          }>
        )?.detail?.recipient ?? '';

      if (
        recipient.trim().toLowerCase() !==
        QORTINO_DONATION_PREFILL_NAME.toLowerCase()
      ) {
        return;
      }

      if (qortinoGratefulTimeoutRef.current != null) {
        window.clearTimeout(qortinoGratefulTimeoutRef.current);
      }

      setQortinoGratefulState({
        message: QORTINO_DONATION_THANK_YOU_MESSAGE,
        nonce: Date.now(),
      });

      qortinoGratefulTimeoutRef.current = window.setTimeout(() => {
        setQortinoGratefulState(null);
        qortinoGratefulTimeoutRef.current = null;
      }, QORTINO_DONATION_GRATEFUL_DURATION_MS);
    };

    subscribeToEvent(
      QORTINO_DONATION_COMPLETED_EVENT,
      handleQortinoDonationCompleted
    );

    return () => {
      unsubscribeFromEvent(
        QORTINO_DONATION_COMPLETED_EVENT,
        handleQortinoDonationCompleted
      );
    };
  }, []);

  useEffect(() => {
    if (userAddress == null) {
      setDismissed(null);
      setAvatarStepCompleted(false);
      setQortsAcquiredAcknowledged(false);
      setShowRegisterNameDelayHint(false);
      setShowOnboardingCompletionConfetti(false);
      setBlockedNamesResolvedFromAddresses([]);
      avatarCompletionAfterPanelCloseRef.current = false;
      return;
    }

    setDismissed(
      localStorage.getItem(`${LS_KEY}_${userAddress}`) === 'completed'
    );
    setAvatarStepCompleted(false);
    setQortsAcquiredAcknowledged(false);
    setShowRegisterNameDelayHint(false);
    setShowOnboardingCompletionConfetti(false);
    setBlockedNamesResolvedFromAddresses([]);
    avatarCompletionAfterPanelCloseRef.current = false;
  }, [userAddress, debugReplayToken]);

  useEffect(() => {
    refreshBlockedUsers().catch((error) => {
      console.error('Failed to refresh QORTINO Space block list.', error);
    });
  }, [refreshBlockedUsers, userAddress]);

  useEffect(() => {
    if (blockedAddressList.length === 0) {
      setBlockedNamesResolvedFromAddresses([]);
      return undefined;
    }

    const controller = new AbortController();

    void Promise.all(
      blockedAddressList.map((address) =>
        fetchNamesForBlockedAddress(address, controller.signal).catch((error) => {
          if (!controller.signal.aborted) {
            console.error('Failed to resolve blocked publisher names.', error);
          }
          return [];
        })
      )
    ).then((resolvedNames) => {
      if (controller.signal.aborted) return;
      setBlockedNamesResolvedFromAddresses([...new Set(resolvedNames.flat())]);
    });

    return () => {
      controller.abort();
    };
  }, [blockedAddressList]);

  useEffect(() => {
    let active = true;
    setWorkspaceState(loadWorkspaceStateFromFallbackStorage(userAddress));
    setWorkspaceHydrated(false);

    void loadWorkspaceState(userAddress).then((nextState) => {
      if (!active) return;
      setWorkspaceState(nextState);
      setWorkspaceHydrated(true);
    });

    return () => {
      active = false;
    };
  }, [userAddress, debugReplayToken]);

  useEffect(() => {
    const handleSetQortinoLookDebug = (
      e: CustomEvent<{
        data?: { settings?: QortinoLookDebugSettings };
        settings?: QortinoLookDebugSettings;
      }>
    ) => {
      setQortinoLookDebug(
        sanitizeQortinoLookDebugSettings(e.detail?.settings ?? e.detail?.data?.settings)
      );
    };

    subscribeToEvent(QORTINO_LOOK_DEBUG_EVENT, handleSetQortinoLookDebug);

    return () => {
      unsubscribeFromEvent(QORTINO_LOOK_DEBUG_EVENT, handleSetQortinoLookDebug);
    };
  }, []);

  useEffect(() => {
    const handleSetQortinoLayoutDebug = (
      e: CustomEvent<{
        data?: { settings?: QortinoLayoutDebugSettings };
        settings?: QortinoLayoutDebugSettings;
      }>
    ) => {
      setQortinoLayoutDebug(
        sanitizeQortinoLayoutDebugSettings(
          e.detail?.settings ?? e.detail?.data?.settings
        )
      );
    };

    subscribeToEvent(QORTINO_LAYOUT_DEBUG_EVENT, handleSetQortinoLayoutDebug);

    return () => {
      unsubscribeFromEvent(
        QORTINO_LAYOUT_DEBUG_EVENT,
        handleSetQortinoLayoutDebug
      );
    };
  }, []);

  useEffect(() => {
    const handleSetQortinoCompanionDebug = (
      e: CustomEvent<{
        data?: { settings?: QortinoCompanionDebugSettings };
        settings?: QortinoCompanionDebugSettings;
      }>
    ) => {
      setQortinoCompanionDebug(
        sanitizeQortinoCompanionDebugSettings(
          e.detail?.settings ?? e.detail?.data?.settings
        )
      );
    };

    subscribeToEvent(
      QORTINO_COMPANION_DEBUG_EVENT,
      handleSetQortinoCompanionDebug
    );

    return () => {
      unsubscribeFromEvent(
        QORTINO_COMPANION_DEBUG_EVENT,
        handleSetQortinoCompanionDebug
      );
    };
  }, []);

  useEffect(() => {
    if (!workspaceHydrated) return;
    void persistWorkspaceState(workspaceState, userAddress);
  }, [userAddress, workspaceHydrated, workspaceState]);

  useEffect(() => {
    if (!selectedTrackSnapshot?.id) {
      return;
    }

    setSharedEarbumpTrackSnapshot(selectedTrackSnapshot);
  }, [selectedTrackSnapshot]);

  const checkAvatar = useCallback(async () => {
    if (!name) return;

    try {
      setCheckingAvatar(true);
      const url = `${getBaseApiReact()}${getArbitraryEndpointReact()}?mode=ALL&service=${AVATAR_SERVICE}&identifier=${AVATAR_IDENTIFIER}&limit=1&name=${name}&includemetadata=false&prefix=true`;
      const response = await fetch(url);
      const data = await response.json();
      setHasAvatar(Array.isArray(data) && data.length > 0);
    } catch {
      setHasAvatar(false);
    } finally {
      setCheckingAvatar(false);
    }
  }, [name]);

  useEffect(() => {
    void checkAvatar();
  }, [checkAvatar]);

  useEffect(() => {
    if (dismissed !== false || !userAddress) return;

    const balanceNum = balance != null ? Number(balance) : null;
    if (balanceNum != null && balanceNum >= MIN_BALANCE_FOR_QORTS) return;

    const url = `${getBaseApiReact()}/transactions/payments/between?recipientAddress=${encodeURIComponent(userAddress)}&confirmationStatus=CONFIRMED&limit=20`;
    let cancelled = false;

    fetch(url)
      .then((res) => res.json())
      .then((data: Array<{ amount?: string }>) => {
        if (cancelled || !Array.isArray(data)) return;
        const total = data.reduce(
          (sum, tx) => sum + (parseFloat(tx?.amount ?? '0') || 0),
          0
        );
        setPaymentsFallbackTotal(total);
      })
      .catch(() => {
        if (!cancelled) setPaymentsFallbackTotal(0);
      });

    return () => {
      cancelled = true;
    };
  }, [balance, dismissed, userAddress]);

  const realHasQorts =
    (balance != null && Number(balance) >= MIN_BALANCE_FOR_QORTS) ||
    (paymentsFallbackTotal != null &&
      paymentsFallbackTotal >= MIN_BALANCE_FOR_QORTS);
  const realHasName = Boolean(name);
  const hasQortsDebugOverride =
    debugCompletionOverrides?.get_six_qorts === true;
  const hasNameDebugOverride =
    debugCompletionOverrides?.register_name === true;
  const hasAvatarDebugOverride =
    debugCompletionOverrides?.load_avatar === true;
  const hasQorts = debugUseOverridesOnly
    ? hasQortsDebugOverride
    : hasQortsDebugOverride || realHasQorts;
  const hasName = debugUseOverridesOnly
    ? hasNameDebugOverride
    : hasNameDebugOverride || realHasName;
  const hasPendingRegisterName =
    (txList?.some((tx) => tx?.type === 'register-name' && !tx?.done) ?? false) &&
    !realHasName;
  const resolvedHasAvatar = debugUseOverridesOnly
    ? hasAvatarDebugOverride
    : hasAvatarDebugOverride || hasAvatar || avatarStepCompleted;
  const hasCompletionChecksPending = debugUseOverridesOnly ? false : checkingAvatar;

  useEffect(() => {
    if (
      !hasCompletionChecksPending &&
      hasQorts &&
      hasName &&
      resolvedHasAvatar &&
      dismissed === false &&
      userAddress
    ) {
      localStorage.setItem(`${LS_KEY}_${userAddress}`, 'completed');
      onboardingJustCompletedRef.current = true;
      setDismissed(true);
      applyWorkspaceState((current) => ({
        ...current,
        onboardingCelebrationSeen: true,
      }));
      onGettingStartedComplete?.();
    }
  }, [
    applyWorkspaceState,
    dismissed,
    hasCompletionChecksPending,
    hasName,
    hasQorts,
    onGettingStartedComplete,
    pushReaction,
    resolvedHasAvatar,
    userAddress,
  ]);

  const isWorkspaceFreshlyUnlocked =
    showOnboardingCompletionConfetti && Boolean(postOnboardingMessage);

  const hotkeyActions = useMemo<Record<HotkeyActionId, HotkeyActionDefinition>>(
    () => ({
      earbump: {
        description: 'Launch Ear-Bump',
        icon: LibraryMusicRoundedIcon,
        id: 'earbump',
        label: 'Ear-Bump',
        run: () => openApp('Ear-Bump'),
      },
      'q-blog': {
        description: 'Launch Q-Blog',
        icon: EditRoundedIcon,
        id: 'q-blog',
        label: 'Q-Blog',
        run: () => openApp('Q-Blog'),
      },
      'q-mail': {
        description: 'Launch Q-Mail',
        icon: MailOutlineRoundedIcon,
        id: 'q-mail',
        label: 'Q-Mail',
        run: () => openApp('q-mail'),
      },
      'q-trade': {
        description: 'Launch Q-Trade',
        icon: ShoppingBagRoundedIcon,
        id: 'q-trade',
        label: 'Q-Trade',
        reaction: 'Q-Trade is up. Letâ€™s make the next move.',
        run: () => openApp('Q-Trade'),
      },
      'q-mintership': {
        description: 'Launch Q-Mintership',
        icon: SpaRoundedIcon,
        id: 'q-mintership',
        label: 'Q-Mintership',
        run: () => openApp('q-mintership'),
      },
      'q-tube': {
        description: 'Launch Q-Tube',
        icon: VideoLibraryRoundedIcon,
        id: 'q-tube',
        label: 'Q-Tube',
        run: () => openApp('Q-Tube'),
      },
      quitter: {
        description: 'Launch Quitter',
        icon: ForumRoundedIcon,
        id: 'quitter',
        label: 'Quitter',
        run: () => openApp('Quitter'),
      },
    }),
    []
  );

  const filteredAvailableHotkeyApps = useMemo(
    () =>
      availableHotkeyApps.filter(
        (app) => !isBlockedPublisherName(app.appName)
      ),
    [availableHotkeyApps, isBlockedPublisherName]
  );

  const hotkeyCatalog = useMemo(
    () =>
      availableHotkeyApps.length > 0
        ? filteredAvailableHotkeyApps
        : (Object.keys(hotkeyActions) as HotkeyActionId[]).map((id) => ({
            appName: hotkeyActions[id].label,
            description: hotkeyActions[id].description,
            label: hotkeyActions[id].label,
            service: 'APP' as const,
          })),
    [availableHotkeyApps.length, filteredAvailableHotkeyApps, hotkeyActions]
  );

  const loadHotkeyApps = useCallback(async () => {
    if (isHotkeyAppsLoading) {
      return;
    }

    setIsHotkeyAppsLoading(true);
    setHotkeyAppsError(null);

    try {
      const urls = [
        `${getBaseApiReact()}/arbitrary/resources/search?service=APP&mode=ALL&limit=0&includestatus=true&includemetadata=true&excludeblocked=true`,
        `${getBaseApiReact()}/arbitrary/resources/search?service=WEBSITE&mode=ALL&limit=0&includestatus=true&includemetadata=true&excludeblocked=true`,
      ];
      const responses = await Promise.all(
        urls.map((url) =>
          fetch(url, {
            headers: {
              'Content-Type': 'application/json',
            },
            method: 'GET',
          })
        )
      );

      if (responses.some((response) => !response.ok)) {
        throw new Error('Unable to load Q-Apps.');
      }

      const responseData = (
        await Promise.all(responses.map((response) => response.json()))
      ).flat() as QAppResourceRecord[];
      const nextCatalog = Array.from(
        new Map(
          (Array.isArray(responseData) ? responseData : [])
            .map((resource) => {
              const appName =
                typeof resource?.name === 'string' ? resource.name.trim() : '';
              const service =
                resource?.service === 'WEBSITE' ? 'WEBSITE' : 'APP';
              if (!appName || isBlockedPublisherName(appName)) {
                return null;
              }

              const label =
                typeof resource.metadata?.title === 'string' &&
                resource.metadata.title.trim().length > 0
                  ? resource.metadata.title.trim()
                  : appName;
              const description =
                typeof resource.metadata?.description === 'string'
                  ? resource.metadata.description.trim()
                  : '';

              return [
                `${service.toLowerCase()}::${appName.toLowerCase()}`,
                {
                  appName,
                  description,
                  label,
                  service,
                } satisfies HotkeyAppDefinition,
              ] as const;
            })
            .filter(
              (
                item
              ): item is readonly [string, HotkeyAppDefinition] => item != null
            )
        ).values()
      ).sort((left, right) =>
        left.label.localeCompare(right.label, undefined, {
          sensitivity: 'base',
        })
      );

      setAvailableHotkeyApps(nextCatalog);
    } catch (error) {
      console.error(error);
      setHotkeyAppsError('Unable to load Q-Apps right now.');
    } finally {
      setIsHotkeyAppsLoading(false);
    }
  }, [isBlockedPublisherName, isHotkeyAppsLoading]);

  useEffect(() => {
    if (
      workspaceState.mode !== 'hotkeys' &&
      !openHotkeyPickerDialog &&
      availableHotkeyApps.length > 0
    ) {
      return;
    }

    if (
      (workspaceState.mode === 'hotkeys' || openHotkeyPickerDialog) &&
      availableHotkeyApps.length === 0 &&
      !isHotkeyAppsLoading
    ) {
      void loadHotkeyApps();
    }
  }, [
    availableHotkeyApps.length,
    isHotkeyAppsLoading,
    loadHotkeyApps,
    openHotkeyPickerDialog,
    workspaceState.mode,
  ]);

  const hotkeyAppsByName = useMemo(() => {
    const nextMap = new Map<string, HotkeyAppDefinition>();
    availableHotkeyApps.forEach((app) => {
      nextMap.set(
        `${app.service.toLowerCase()}${HOTKEY_SLOT_VALUE_SEPARATOR}${app.appName.toLowerCase()}`,
        app
      );
      if (!nextMap.has(app.appName.toLowerCase())) {
        nextMap.set(app.appName.toLowerCase(), app);
      }
    });
    return nextMap;
  }, [availableHotkeyApps]);

  const resolveHotkeyApp = useCallback(
    (slotValue: string): HotkeyAppDefinition => {
      const parsedSlot = parseHotkeySlotValue(slotValue);
      const knownApp =
        hotkeyAppsByName.get(
          `${parsedSlot.service.toLowerCase()}${HOTKEY_SLOT_VALUE_SEPARATOR}${parsedSlot.appName.toLowerCase()}`
        ) ?? hotkeyAppsByName.get(parsedSlot.appName.toLowerCase());

      if (knownApp) {
        return knownApp;
      }

      return {
        appName: parsedSlot.appName,
        description: 'Launch Q-App',
        label: formatHotkeyAppLabel(parsedSlot.appName),
        service: parsedSlot.service,
      };
    },
    [hotkeyAppsByName]
  );

  const steps = useMemo(
    () => [
      {
        accent: '#92B8FF',
        actionLabel: t('tutorial:home.get_six_qorts_way3_action', 'Open Q-Trade'),
        ctaLabel: t('tutorial:home.get_six_qorts', 'Get 6 QORT'),
        done: hasQorts,
        helper: t(
          'tutorial:home.get_qorts_workspace_hint',
          'Unlock your first 6 QORT to activate the rest of the setup.'
        ),
        icon: ShoppingBagRoundedIcon,
        key: 'get_six_qorts' as const,
        label: t('tutorial:home.get_six_qorts', 'Get 6 QORT'),
        onAction: () => setOpenQortsDialog(true),
      },
      {
        accent: '#8DBEFF',
        actionLabel: t('tutorial:home.open', 'Open'),
        ctaLabel: t('tutorial:home.register_name', 'Register your name'),
        done: hasName,
        helper: t(
          'tutorial:home.register_name_workspace_hint',
          'A registered name turns this account into a recognizable identity.'
        ),
        icon: DriveFileRenameOutlineRoundedIcon,
        key: 'register_name' as const,
        label: hasPendingRegisterName
          ? t('tutorial:home.confirming', 'Confirming')
          : t('tutorial:home.register_name', 'Register your name'),
        loading:
          !debugUseOverridesOnly &&
          !hasNameDebugOverride &&
          hasPendingRegisterName,
        onAction: () => executeEvent('openRegisterName', {}),
      },
      {
        accent: '#8DBEFF',
        actionLabel: t('tutorial:home.open', 'Open'),
        ctaLabel: t('tutorial:home.load_avatar', 'Load your avatar'),
        done: resolvedHasAvatar,
        helper: t(
          'tutorial:home.load_avatar_workspace_hint',
          'Give the dashboard a face so the whole space starts to feel like yours.'
        ),
        icon: UploadRoundedIcon,
        key: 'load_avatar' as const,
        label: t('tutorial:home.load_avatar', 'Load your avatar'),
        loading:
          !debugUseOverridesOnly &&
          !hasAvatarDebugOverride &&
          checkingAvatar,
        onAction: () => executeEvent('openAvatarUpload', {}),
      },
    ],
    [
      checkingAvatar,
      debugUseOverridesOnly,
      hasAvatarDebugOverride,
      hasName,
      hasNameDebugOverride,
      hasPendingRegisterName,
      hasQorts,
      resolvedHasAvatar,
      t,
    ]
  );

  const completedCount = useMemo(
    () => steps.filter((step) => step.done).length,
    [steps]
  );
  const currentProgressStep = useMemo(
    () => Math.min(completedCount + 1, steps.length),
    [completedCount, steps.length]
  );
  const isOnboardingVisible = dismissed === false;
  const isQortsAcquiredAwaitingNext =
    isOnboardingVisible &&
    hasQorts &&
    !hasName &&
    !hasPendingRegisterName &&
    !qortsAcquiredAcknowledged;
  const currentProgressStepDisplay = isQortsAcquiredAwaitingNext
    ? 1
    : currentProgressStep;
  const baseCurrentStep =
    steps.find((step) => !step.done) ?? steps[steps.length - 1];
  const currentStep = isQortsAcquiredAwaitingNext
    ? {
        ...steps[0],
        ctaLabel: t('tutorial:home.next', 'Next'),
        done: true,
        helper: t(
          'tutorial:home.qorts_acquired_hint',
          'The hardest part is over. Press Next when you are ready to register your name.'
        ),
        label: t('tutorial:home.qorts_acquired', '6 QORT acquired'),
        loading: false,
      }
    : baseCurrentStep;
  const CurrentStepIcon = currentStep.icon;

  useEffect(() => {
    onboardingBubbleLockRef.current = isOnboardingVisible;
  }, [isOnboardingVisible]);

  useEffect(() => {
    onboardingBubbleHoldRef.current =
      onboardingTransitionMessage != null || postOnboardingMessage != null;
  }, [onboardingTransitionMessage, postOnboardingMessage]);

  useEffect(() => {
    if (!isOnboardingVisible) {
      previousOnboardingStepRef.current = null;
      return;
    }

    const previousStepKey = previousOnboardingStepRef.current;
    previousOnboardingStepRef.current = currentStep.key;

    if (previousStepKey == null || previousStepKey === currentStep.key) {
      return;
    }

    const nextRecognitionMessage = getOnboardingRecognitionMessage(
      previousStepKey,
      currentStep.key
    );

    if (!nextRecognitionMessage) {
      setOnboardingTransitionMessage(null);
      return;
    }

    if (onboardingMessageTimeoutRef.current) {
      window.clearTimeout(onboardingMessageTimeoutRef.current);
      onboardingMessageTimeoutRef.current = null;
    }

    setOnboardingTransitionMessage(nextRecognitionMessage);
    onboardingMessageTimeoutRef.current = window.setTimeout(() => {
      onboardingMessageTimeoutRef.current = null;
      setOnboardingTransitionMessage(null);
    }, ONBOARDING_RECOGNITION_DURATION_MS);
  }, [currentStep.key, isOnboardingVisible]);

  useEffect(() => {
    if (
      !isOnboardingVisible ||
      currentStep.key !== 'register_name' ||
      !hasPendingRegisterName
    ) {
      setShowRegisterNameDelayHint(false);
      return;
    }

    setShowRegisterNameDelayHint(false);
    const hintTimer = window.setTimeout(() => {
      setShowRegisterNameDelayHint(true);
    }, 5000);

    return () => {
      window.clearTimeout(hintTimer);
    };
  }, [currentStep.key, hasPendingRegisterName, isOnboardingVisible]);

  useEffect(() => {
    const handleAvatarUploaded = () => {
      if (isOnboardingVisible && currentStep.key === 'load_avatar') {
        avatarCompletionAfterPanelCloseRef.current = true;
        return;
      }

      setHasAvatar(true);
      void checkAvatar();
    };

    const handleAvatarUploadClosed = () => {
      if (!avatarCompletionAfterPanelCloseRef.current) {
        return;
      }

      avatarCompletionAfterPanelCloseRef.current = false;
      setAvatarStepCompleted(true);
      setHasAvatar(true);
      void checkAvatar();
    };

    subscribeToEvent('avatarUploaded', handleAvatarUploaded);
    subscribeToEvent('avatarUploadClosed', handleAvatarUploadClosed);

    return () => {
      unsubscribeFromEvent('avatarUploaded', handleAvatarUploaded);
      unsubscribeFromEvent('avatarUploadClosed', handleAvatarUploadClosed);
    };
  }, [checkAvatar, currentStep.key, isOnboardingVisible]);

  useEffect(() => {
    const wasOnboardingVisible = wasOnboardingVisibleRef.current;
    wasOnboardingVisibleRef.current = isOnboardingVisible;

    if (!wasOnboardingVisible && isOnboardingVisible) {
      onboardingJustCompletedRef.current = false;
      setPostOnboardingMessage(null);
      setOnboardingTransitionMessage(null);
      return;
    }

    if (!wasOnboardingVisible || isOnboardingVisible) {
      return;
    }

    if (!onboardingJustCompletedRef.current) {
      return;
    }

    onboardingJustCompletedRef.current = false;

    if (reactionTimeoutRef.current) {
      window.clearTimeout(reactionTimeoutRef.current);
      reactionTimeoutRef.current = null;
    }

    if (onboardingMessageTimeoutRef.current) {
      window.clearTimeout(onboardingMessageTimeoutRef.current);
    }

    setEphemeralReaction(null);
    setOnboardingTransitionMessage(null);
    setPostOnboardingMessage(
      'All set. You can start building your workspace above.'
    );
    setShowOnboardingCompletionConfetti(true);

    if (onboardingConfettiTimeoutRef.current) {
      window.clearTimeout(onboardingConfettiTimeoutRef.current);
    }

    onboardingConfettiTimeoutRef.current = window.setTimeout(() => {
      onboardingConfettiTimeoutRef.current = null;
      setShowOnboardingCompletionConfetti(false);
    }, 4200);
  }, [isOnboardingVisible]);

  useEffect(() => {
    if (workspaceState.mode === 'empty' || postOnboardingMessage == null) {
      return;
    }

    setPostOnboardingMessage(null);
  }, [postOnboardingMessage, workspaceState.mode]);

  const musicSearchQuery = workspaceState.musicQuery.trim();
  const knownMusicTracksById = useMemo(() => {
    const nextMap = new Map<string, MusicTrack>();

    for (const track of earbumpDiscoveryTracks) {
      nextMap.set(track.id, track);
    }

    for (const track of earbumpSearchTracks) {
      nextMap.set(track.id, track);
    }

    if (selectedTrackSnapshot) {
      nextMap.set(selectedTrackSnapshot.id, selectedTrackSnapshot);
    }

    return nextMap;
  }, [earbumpDiscoveryTracks, earbumpSearchTracks, selectedTrackSnapshot]);

  const resolveMusicTrack = useCallback(
    (track: MusicTrack) => {
      const knownDuration = musicTrackDurations[track.id];

      if (!Number.isFinite(knownDuration) || knownDuration <= 0) {
        return track;
      }

      const durationLabel = formatPlaybackTime(knownDuration);
      return track.length === durationLabel
        ? track
        : {
            ...track,
            length: durationLabel,
          };
    },
    [musicTrackDurations]
  );

  useEffect(() => {
    if (!workspaceHydrated) {
      return undefined;
    }

    discoveryRequestRef.current?.abort();
    const controller = new AbortController();
    discoveryRequestRef.current = controller;
    setIsEarbumpDiscoveryLoading(true);

    void fetchEarbumpRecentTracks({
      limit: 12,
      signal: controller.signal,
    })
      .then((tracks) => {
        const visibleTracks = filterBlockedMusicTracks(tracks);
        setEarbumpDiscoveryTracks(visibleTracks);
        setEarbumpDiscoveryError(null);

        if (visibleTracks.length === 0) {
          return;
        }

        setSelectedTrackSnapshot((current) => current ?? visibleTracks[0]);

        applyWorkspaceState((current) =>
          current.selectedTrackId
            ? current
            : {
                ...current,
                selectedTrackId: visibleTracks[0].id,
              }
        );
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }

        console.error('Failed to load EarBump discovery tracks', error);
        setEarbumpDiscoveryTracks([]);
        setEarbumpDiscoveryError('Unable to load EarBump right now.');
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsEarbumpDiscoveryLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [applyWorkspaceState, filterBlockedMusicTracks, workspaceHydrated]);

  useEffect(() => {
    searchRequestRef.current?.abort();

    if (!musicSearchQuery) {
      setEarbumpSearchTracks([]);
      setEarbumpSearchError(null);
      setIsEarbumpSearchLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    searchRequestRef.current = controller;
    const timeoutId = window.setTimeout(() => {
      setIsEarbumpSearchLoading(true);

      void searchEarbumpTracks(musicSearchQuery, {
        limit: 12,
        signal: controller.signal,
      })
        .then((tracks) => {
          setEarbumpSearchTracks(filterBlockedMusicTracks(tracks));
          setEarbumpSearchError(null);
        })
        .catch((error: unknown) => {
          if (isAbortError(error)) {
            return;
          }

          console.error('Failed to search EarBump tracks', error);
          setEarbumpSearchTracks([]);
          setEarbumpSearchError('Unable to search EarBump right now.');
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsEarbumpSearchLoading(false);
          }
        });
    }, 220);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [filterBlockedMusicTracks, musicSearchQuery]);

  useEffect(() => {
    if (!workspaceHydrated || !workspaceState.selectedTrackId) {
      return undefined;
    }

    const matchedTrack = knownMusicTracksById.get(workspaceState.selectedTrackId);
    if (matchedTrack) {
      if (!isBlockedPublisherName(matchedTrack.name)) {
        setSelectedTrackSnapshot(matchedTrack);
      }
      return undefined;
    }

    selectedTrackRequestRef.current?.abort();
    const controller = new AbortController();
    selectedTrackRequestRef.current = controller;

    void fetchEarbumpTrackById(workspaceState.selectedTrackId, {
      signal: controller.signal,
    })
      .then((track) => {
        if (track && !isBlockedPublisherName(track.name)) {
          setSelectedTrackSnapshot(track);
        }
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          console.error('Failed to restore selected EarBump track', error);
        }
      });

    return () => {
      controller.abort();
    };
  }, [
    isBlockedPublisherName,
    knownMusicTracksById,
    workspaceHydrated,
    workspaceState.selectedTrackId,
  ]);

  const visibleDiscoveryTracks = useMemo(
    () => filterBlockedMusicTracks(earbumpDiscoveryTracks),
    [earbumpDiscoveryTracks, filterBlockedMusicTracks]
  );
  const visibleSearchTracks = useMemo(
    () => filterBlockedMusicTracks(earbumpSearchTracks),
    [earbumpSearchTracks, filterBlockedMusicTracks]
  );
  const selectedTrackCandidate =
    workspaceState.selectedTrackId
      ? knownMusicTracksById.get(workspaceState.selectedTrackId) ??
        (selectedTrackSnapshot?.id === workspaceState.selectedTrackId
          ? selectedTrackSnapshot
          : null)
      : null;
  const activeTrackSource =
    (selectedTrackCandidate && !isBlockedPublisherName(selectedTrackCandidate.name)
      ? selectedTrackCandidate
      : null) ??
    visibleDiscoveryTracks[0] ??
    (selectedTrackSnapshot && !isBlockedPublisherName(selectedTrackSnapshot.name)
      ? selectedTrackSnapshot
      : null);
  const activeTrack = useMemo(
    () =>
      activeTrackSource ? resolveMusicTrack(activeTrackSource) : EMPTY_MUSIC_TRACK,
    [activeTrackSource, resolveMusicTrack]
  );
  useEffect(() => {
    if (!selectedTrackCandidate || !isBlockedPublisherName(selectedTrackCandidate.name)) {
      return;
    }

    stopSharedEarbumpAudio(audioRef.current);
    setMusicPlaybackTime(0);
    setMusicProgress(0);
    setSelectedTrackSnapshot(visibleDiscoveryTracks[0] ?? null);
    applyWorkspaceState((current) => ({
      ...current,
      musicPlaying: false,
      selectedTrackId: visibleDiscoveryTracks[0]?.id ?? '',
    }));
  }, [
    applyWorkspaceState,
    isBlockedPublisherName,
    selectedTrackCandidate,
    visibleDiscoveryTracks,
  ]);
  const activeTrackResourceKey = useMemo(
    () => buildTrackResourceKey(activeTrack),
    [activeTrack]
  );
  const activeTrackResource = useAtomValue(
    resourceKeySelector(activeTrackResourceKey)
  );
  const activeTrackResourceStatus =
    typeof activeTrackResource?.status?.status === 'string'
      ? activeTrackResource.status.status
      : null;
  const activeTrackPeerCount =
    typeof activeTrackResource?.status?.numberOfPeers === 'number'
      ? activeTrackResource.status.numberOfPeers
      : null;
  const activeTrackReadyPercent = getTrackReadyPercent(
    activeTrackResourceStatus,
    Number(activeTrackResource?.status?.percentLoaded ?? 0)
  );
  const activeTrackReadyState = getTrackReadyState(
    activeTrackResourceStatus,
    Boolean(activeTrack.id)
  );
  const activeTrackPlaybackUrl =
    activeTrackReadyState === 'ready' ? buildTrackPlaybackUrl(activeTrack) : '';
  const isTrackPreparing = activeTrackReadyState === 'downloading';
  const isTrackReady = activeTrackReadyState === 'ready';
  const isTrackLoadError = activeTrackReadyState === 'error';
  const isResolvingSelectedTrack =
    workspaceHydrated &&
    Boolean(workspaceState.selectedTrackId) &&
    activeTrack.id !== workspaceState.selectedTrackId;
  const currentPlaybackTime = useMemo(
    () => formatPlaybackTime(musicPlaybackTime),
    [musicPlaybackTime]
  );
  const activeTrackDurationSeconds = useMemo(() => {
    if (!activeTrack.id) return 0;

    const audio = audioRef.current;
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) {
      return audio.duration;
    }

    const storedDuration = musicTrackDurations[activeTrack.id];
    return Number.isFinite(storedDuration) && storedDuration > 0
      ? storedDuration
      : 0;
  }, [activeTrack.id, musicTrackDurations]);
  const hasTrackPlaybackMetadata = activeTrackDurationSeconds > 0;
  const isTrackPlayable = isTrackReady || hasTrackPlaybackMetadata;
  const isTrackPeerStarved =
    isTrackPreparing &&
    !hasTrackPlaybackMetadata &&
    activeTrackReadyPercent > 0 &&
    (activeTrackPeerCount ?? 0) === 0;
  const discoveryTracks = useMemo(
    () =>
      earbumpDiscoveryTracks
        .filter((track) => !isBlockedPublisherName(track.name))
        .filter((track) => track.id !== activeTrack.id)
        .slice(0, 3)
        .map(resolveMusicTrack),
    [activeTrack.id, earbumpDiscoveryTracks, isBlockedPublisherName, resolveMusicTrack]
  );
  const browserTracks = useMemo(() => {
    if (musicSearchQuery) {
      return visibleSearchTracks.map(resolveMusicTrack);
    }

    return discoveryTracks;
  }, [discoveryTracks, musicSearchQuery, resolveMusicTrack, visibleSearchTracks]);
  const playbackQueue = useMemo(() => {
    const sourceTracks = musicSearchQuery ? visibleSearchTracks : visibleDiscoveryTracks;
    const resolvedTracks = sourceTracks.map(resolveMusicTrack);

    if (!activeTrack.id) {
      return resolvedTracks;
    }

    return [
      activeTrack,
      ...resolvedTracks.filter((track) => track.id !== activeTrack.id),
    ];
  }, [
    activeTrack,
    musicSearchQuery,
    resolveMusicTrack,
    visibleDiscoveryTracks,
    visibleSearchTracks,
  ]);
  const isMusicBrowserLoading = musicSearchQuery
    ? isEarbumpSearchLoading
    : isEarbumpDiscoveryLoading;
  const musicBrowserError = musicSearchQuery
    ? earbumpSearchError
    : earbumpDiscoveryError;
  const musicLoadingHint = useMemo(() => {
    if (!activeTrack.id) return null;
    if (musicStreamError) return musicStreamError;
    if (isTrackLoadError) return 'This track could not finish loading on your node.';
    if (hasTrackPlaybackMetadata) return null;
    if (!isTrackPreparing || isTrackPlayable) return null;

    if (isTrackPeerStarved) {
      return 'No peers for remaining data';
    }

    if (activeTrackReadyPercent > 0) {
      return (activeTrackPeerCount ?? 0) > 0
        ? `Preparing on your node... ${Math.round(activeTrackReadyPercent)}% (${activeTrackPeerCount} peer${
            activeTrackPeerCount === 1 ? '' : 's'
          })`
        : `Preparing on your node... ${Math.round(activeTrackReadyPercent)}%`;
    }

    if (activeTrackResourceStatus === 'SEARCHING') {
      return 'Looking for peers...';
    }

    if (activeTrackResourceStatus === 'BUILDING') {
      return 'Finalizing the track on your node...';
    }

    return 'Preparing on your node...';
  }, [
    activeTrack.id,
    activeTrackPeerCount,
    activeTrackReadyPercent,
    activeTrackResource,
    activeTrackResourceStatus,
    hasTrackPlaybackMetadata,
    isTrackLoadError,
    isTrackPeerStarved,
    isTrackPreparing,
    isTrackPlayable,
    isTrackReady,
    musicStreamError,
  ]);
  const musicStatusSlotMessage =
    musicLoadingHint ??
    (isEarbumpDiscoveryLoading
      ? 'Syncing with EarBump library...'
      : earbumpDiscoveryError);
  useEffect(() => {
    if (!activeTrack.id || !activeTrack.name) {
      setMusicStreamError(null);
      return;
    }

    if (activeTrackReadyState === 'ready' || hasTrackPlaybackMetadata) {
      setMusicStreamError(null);
      return;
    }

    if (activeTrackReadyState === 'error') {
      return;
    }

    void downloadResource({
      identifier: activeTrack.id,
      name: activeTrack.name,
      service: EARBUMP_AUDIO_SERVICE,
    });
  }, [
    activeTrack.id,
    activeTrack.name,
    activeTrackReadyState,
    downloadResource,
    hasTrackPlaybackMetadata,
  ]);

  useEffect(() => {
    if (!isTrackLoadError || !workspaceState.musicPlaying) {
      return;
    }

    applyWorkspaceState((current) =>
      current.musicPlaying
        ? {
            ...current,
            musicPlaying: false,
          }
        : current
    );
  }, [applyWorkspaceState, isTrackLoadError, workspaceState.musicPlaying]);

  const filteredHotkeyCatalog = useMemo(() => {
    const normalized = hotkeySearchQuery.trim().toLowerCase();
    if (!normalized) return hotkeyCatalog;

    return hotkeyCatalog.filter((app) =>
      [
        app.appName,
        app.label,
        app.description,
      ].some((value) => value.toLowerCase().includes(normalized))
    );
  }, [hotkeyCatalog, hotkeySearchQuery]);

  const featuredHotkeyCatalog = useMemo(() => {
    const featuredOrder = new Map(
      CURATED_HOTKEY_APP_NAMES.map((appName, index) => [appName.toLowerCase(), index])
    );

    return filteredHotkeyCatalog
      .filter((app) => featuredOrder.has(app.appName.toLowerCase()))
      .sort(
        (left, right) =>
          (featuredOrder.get(left.appName.toLowerCase()) ?? 999) -
          (featuredOrder.get(right.appName.toLowerCase()) ?? 999)
      )
      .slice(0, HOTKEY_SLOT_COUNT);
  }, [filteredHotkeyCatalog]);

  const featuredHotkeyCatalogKeys = useMemo(
    () => new Set(featuredHotkeyCatalog.map((app) => app.appName.toLowerCase())),
    [featuredHotkeyCatalog]
  );

  const libraryHotkeyCatalog = useMemo(
    () =>
      filteredHotkeyCatalog.filter(
        (app) => !featuredHotkeyCatalogKeys.has(app.appName.toLowerCase())
      ),
    [featuredHotkeyCatalogKeys, filteredHotkeyCatalog]
  );
  const isBayPickerOpen = openModulePickerDialog || openHotkeyPickerDialog;

  const qortinoMood = useMemo(() => {
    if (qortinoGratefulState) return 'grateful' as const;
    if (isBayPickerOpen) return 'guide' as const;
    if (isOnboardingVisible) return 'guide' as const;
    if (isWorkspaceFreshlyUnlocked) return 'celebrate' as const;
    if (workspaceState.mode === 'music' && workspaceState.musicPlaying) {
      return 'music' as const;
    }
    if (workspaceState.mode === 'hotkeys') return 'hotkeys' as const;
    return 'empty' as const;
  }, [
    qortinoGratefulState,
    isOnboardingVisible,
    isWorkspaceFreshlyUnlocked,
    isBayPickerOpen,
    workspaceState.mode,
    workspaceState.musicPlaying,
  ]);

  const persistentOnboardingMessage = isOnboardingVisible
    ? isQortsAcquiredAwaitingNext
      ? 'Nice work. The hardest part is done. Press Next when you are ready.'
      : currentStep.key === 'register_name' &&
          hasPendingRegisterName &&
          showRegisterNameDelayHint
        ? 'Saving name on-chain. This can take a moment.'
        : getPersistentOnboardingMessage(currentStep.key)
    : null;
  const qortinoDisplayedMessage = truncateQortinoBubbleMessage(
    qortinoGratefulState?.message?.trim() ||
      postOnboardingMessage?.trim() ||
      onboardingTransitionMessage?.trim() ||
      persistentOnboardingMessage?.trim() ||
      ephemeralReaction?.trim() ||
      null
  );
  /*
    if (isOnboardingVisible) {
      if (currentStep.key === 'get_six_qorts') {
        return 'We start with 6 QORT. Pick any route above and Iâ€™ll queue the next step.';
      }
      if (currentStep.key === 'register_name') {
        return 'Name next. That unlocks your identity across the hub.';
      }
      return 'One last move. Give your profile a face and this bay becomes yours.';
    }

    if (isWorkspaceFreshlyUnlocked) {
      return 'This bay is unlocked now. Choose the first module and I will start living around it.';
    }

    if (workspaceState.mode === 'hotkeys') {
      return 'Quick routes armed. Tap a tile and Iâ€™ll keep pace.';
    }

    if (workspaceState.mode === 'music') {
      if (workspaceState.musicPlaying) {
        return `${activeTrack.title} is setting the tone. Iâ€™ll keep the bay calm while it plays.`;
      }
      return 'Drop into music mode when you want a little company.';
    }

    return 'The bay is free now. Add a widget or a hotkey deck and Iâ€™ll build around it.';
  }, [
    activeTrack.title,
    currentStep.key,
    ephemeralReaction,
    isOnboardingVisible,
    isWorkspaceFreshlyUnlocked,
    isBayPickerOpen,
    workspaceState.mode,
    workspaceState.musicPlaying,
  ]);
  */

  const firstEmptyHotkeySlot = useMemo(
    () => workspaceState.hotkeys.findIndex((slot) => slot == null),
    [workspaceState.hotkeys]
  );
  const musicControlRingColor =
    isTrackLoadError
      ? alpha('#FF8F8F', 0.94)
      : isTrackPeerStarved
        ? alpha('#F6C76E', 0.96)
      : isTrackPlayable
        ? alpha('#A9CAFF', 0.92)
        : alpha('#84B2FF', 0.94);
  const musicControlRingTrackColor = isTrackLoadError
    ? alpha('#FF8F8F', 0.2)
    : isTrackPeerStarved
      ? alpha('#F6C76E', 0.2)
    : alpha('#DCE8FF', 0.14);
  const musicControlShowsPause =
    workspaceState.musicPlaying && isTrackPlayable && !isTrackLoadError;
  const musicControlShowsDownload =
    Boolean(activeTrack.id) && isTrackPreparing && !isTrackPlayable;
  const musicControlShowsReadyPulse =
    Boolean(activeTrack.id) &&
    !workspaceState.musicPlaying &&
    isTrackPlayable &&
    !isTrackLoadError;

  const qortinoIsTalking = Boolean(qortinoDisplayedMessage);
  const qortinoBodyStageScale = Math.max(1, qortinoLookDebug.bodyScale);
  const qortinoBodyStageWidthScale = Math.max(
    1,
    qortinoLookDebug.bodyScale * qortinoLookDebug.bodyWidthScale
  );
  const qortinoAntennaStageBump = Math.max(
    0,
    (qortinoLookDebug.antennaScale * qortinoLookDebug.antennaLength - 1) * 22
  );
  const qortinoMascotStageWidth = Math.round(
    QORTINO_MASCOT_SIZE * qortinoBodyStageWidthScale +
      QORTINO_MASCOT_STAGE_PADDING_X
  );
  const qortinoMascotStageHeight = Math.round(
    QORTINO_MASCOT_SIZE * qortinoBodyStageScale +
      QORTINO_MASCOT_STAGE_PADDING_Y +
      qortinoAntennaStageBump
  );
  const handleCycleTrack = useCallback(
    (direction: 'next' | 'previous') => {
      if (playbackQueue.length === 0) {
        return;
      }

      const activeIndex = playbackQueue.findIndex(
        (track) => track.id === workspaceState.selectedTrackId
      );
      const currentIndex = activeIndex >= 0 ? activeIndex : 0;
      const nextIndex =
        direction === 'next'
          ? (currentIndex + 1) % playbackQueue.length
          : (currentIndex - 1 + playbackQueue.length) % playbackQueue.length;
      const nextTrack = playbackQueue[nextIndex];

      if (!nextTrack) {
        return;
      }

      setMusicPlaybackTime(0);
      setMusicProgress(0);
      setMusicStreamError(null);
      setSelectedTrackSnapshot(nextTrack);
      applyWorkspaceState((current) => ({
        ...current,
        mode: 'music',
        musicPlaying: true,
        selectedTrackId: nextTrack.id,
      }));
      pushReaction(`${nextTrack.title} is in rotation.`);
    },
    [applyWorkspaceState, playbackQueue, pushReaction, workspaceState.selectedTrackId]
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }

    const handleLoadedMetadata = () => {
      if (!activeTrack.id || !Number.isFinite(audio.duration) || audio.duration <= 0) {
        return;
      }

      setMusicStreamError(null);

      setMusicTrackDurations((current) => {
        if (current[activeTrack.id] === audio.duration) {
          return current;
        }

        return {
          ...current,
          [activeTrack.id]: audio.duration,
        };
      });
    };

    const handleTimeUpdate = () => {
      const duration =
        audio.duration > 0 ? audio.duration : musicTrackDurations[activeTrack.id] ?? 0;
      const nextPlaybackTime = Number.isFinite(audio.currentTime)
        ? audio.currentTime
        : 0;

      setMusicPlaybackTime(nextPlaybackTime);
      setMusicProgress(duration > 0 ? nextPlaybackTime / duration : 0);
    };

    const handleEnded = () => {
      if (workspaceState.repeatMode === 'one') {
        audio.currentTime = 0;
        setMusicPlaybackTime(0);
        setMusicProgress(0);
        void audio.play().catch((error) => {
          console.error('Failed to replay EarBump track', error);
          applyWorkspaceState((current) => ({
            ...current,
            musicPlaying: false,
          }));
        });
        return;
      }

      handleCycleTrack('next');
    };

    const handleCanPlay = () => {
      setMusicStreamError(null);
    };

    const handleError = () => {
      console.error('Failed to stream EarBump audio track', activeTrack);
      setMusicStreamError('Playback stalled. Press play to retry.');
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      applyWorkspaceState((current) => ({
        ...current,
        musicPlaying: false,
      }));
    };

    const handleStalled = () => {
      if (!activeTrack.id) {
        return;
      }

      setMusicStreamError('Track stalled. Rebuilding the stream...');
      void downloadResource({
        identifier: activeTrack.id,
        name: activeTrack.name,
        service: EARBUMP_AUDIO_SERVICE,
      });
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    audio.addEventListener('stalled', handleStalled);
    handleLoadedMetadata();
    handleTimeUpdate();

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('stalled', handleStalled);
    };
  }, [
    activeTrack,
    activeTrack.id,
    activeTrack.name,
    applyWorkspaceState,
    downloadResource,
    handleCycleTrack,
    musicTrackDurations,
    workspaceState.repeatMode,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!workspaceHydrated || isResolvingSelectedTrack) {
      return;
    }

    if (!activeTrack.id || !activeTrackPlaybackUrl) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setMusicPlaybackTime(0);
      setMusicProgress(0);
      return;
    }

    if (audio.src !== activeTrackPlaybackUrl) {
      audio.pause();
      audio.src = activeTrackPlaybackUrl;
      audio.load();
      setMusicPlaybackTime(0);
      setMusicProgress(0);
    }

    if (workspaceState.mode !== 'music' || !workspaceState.musicPlaying) {
      audio.pause();
      return;
    }

    void audio.play().catch((error) => {
      console.error('Failed to play EarBump stream', error);
      applyWorkspaceState((current) => ({
        ...current,
        musicPlaying: false,
      }));
    });
  }, [
    activeTrack.id,
    activeTrackPlaybackUrl,
    applyWorkspaceState,
    isResolvingSelectedTrack,
    workspaceHydrated,
    workspaceState.mode,
    workspaceState.musicPlaying,
  ]);

  const seekMusicPlayback = useCallback(
    (clientX: number) => {
      const audio = audioRef.current;
      const progressBar = musicProgressBarRef.current;
      if (!audio || !progressBar || !isTrackPlayable || activeTrackDurationSeconds <= 0) {
        return;
      }

      const rect = progressBar.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }

      const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      const nextTime = ratio * activeTrackDurationSeconds;

      audio.currentTime = nextTime;
      setMusicPlaybackTime(nextTime);
      setMusicProgress(ratio);
      setMusicStreamError(null);
    },
    [activeTrackDurationSeconds, isTrackPlayable]
  );

  const handleMusicProgressPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isTrackPlayable || activeTrackDurationSeconds <= 0) {
        return;
      }

      event.preventDefault();
      seekMusicPlayback(event.clientX);

      const handleWindowPointerMove = (moveEvent: PointerEvent) => {
        seekMusicPlayback(moveEvent.clientX);
      };

      const handleWindowPointerUp = () => {
        window.removeEventListener('pointermove', handleWindowPointerMove);
        window.removeEventListener('pointerup', handleWindowPointerUp);
      };

      window.addEventListener('pointermove', handleWindowPointerMove);
      window.addEventListener('pointerup', handleWindowPointerUp, {
        once: true,
      });
    },
    [activeTrackDurationSeconds, isTrackPlayable, seekMusicPlayback]
  );

  const handleSelectWorkspaceMode = useCallback(
    (mode: WorkspaceMode) => {
      applyWorkspaceState((current) => ({
        ...current,
        mode,
        musicPlaying: mode === 'music' ? current.musicPlaying : false,
        onboardingCelebrationSeen:
          current.onboardingCelebrationSeen || dismissed === true,
      }));

      if (mode === 'hotkeys') {
        setOpenModulePickerDialog(false);
        setOpenHotkeyPickerDialog(true);
        pushReaction('Hotkeys panel ready.');
      } else if (mode === 'music') {
        setOpenModulePickerDialog(false);
        setOpenHotkeyPickerDialog(false);
        pushReaction('Music panel ready.');
      } else {
        setOpenModulePickerDialog(false);
        setOpenHotkeyPickerDialog(false);
        pushReaction('Panel cleared.');
      }
    },
    [applyWorkspaceState, dismissed, pushReaction]
  );

  const handleSetHotkey = useCallback(
    (appName: string) => {
      const parsedSlot = parseHotkeySlotValue(appName);
      const knownApp =
        hotkeyAppsByName.get(
          `${parsedSlot.service.toLowerCase()}${HOTKEY_SLOT_VALUE_SEPARATOR}${parsedSlot.appName.toLowerCase()}`
        ) ?? hotkeyAppsByName.get(parsedSlot.appName.toLowerCase());
      const nextSlotValue = encodeHotkeySlotValue(
        knownApp?.service ?? parsedSlot.service,
        knownApp?.appName ?? parsedSlot.appName
      );
      applyWorkspaceState((current) => {
        const nextHotkeys = [...current.hotkeys];
        nextHotkeys[selectedHotkeySlot] = nextSlotValue;
        return {
          ...current,
          hotkeys: nextHotkeys,
          mode: 'hotkeys',
          onboardingCelebrationSeen:
            current.onboardingCelebrationSeen || dismissed === true,
        };
      });
      setOpenModulePickerDialog(false);
      setOpenHotkeyPickerDialog(true);
      setSelectedHotkeySlot((current) =>
        Math.min(current + 1, HOTKEY_SLOT_COUNT - 1)
      );
    },
    [
      applyWorkspaceState,
      dismissed,
      hotkeyAppsByName,
      selectedHotkeySlot,
    ]
  );

  const handleClearHotkey = useCallback(
    (slotIndex: number) => {
      applyWorkspaceState((current) => {
        const nextHotkeys = [...current.hotkeys];
        nextHotkeys[slotIndex] = null;

        return {
          ...current,
          hotkeys: nextHotkeys,
          mode: 'hotkeys',
          onboardingCelebrationSeen:
            current.onboardingCelebrationSeen || dismissed === true,
        };
      });
      setSelectedHotkeySlot(slotIndex);
      setOpenModulePickerDialog(false);
      setOpenHotkeyPickerDialog(true);
    },
    [applyWorkspaceState, dismissed]
  );

  const handleRunHotkey = useCallback(
    (slotValue: string) => {
      if (!slotValue) {
        return;
      }

      const parsedSlot = parseHotkeySlotValue(slotValue);
      const knownApp =
        hotkeyAppsByName.get(
          `${parsedSlot.service.toLowerCase()}${HOTKEY_SLOT_VALUE_SEPARATOR}${parsedSlot.appName.toLowerCase()}`
        ) ?? hotkeyAppsByName.get(parsedSlot.appName.toLowerCase());

      executeEvent('addTab', {
        data: {
          name: knownApp?.appName ?? parsedSlot.appName,
          path: '',
          service: knownApp?.service ?? parsedSlot.service,
        },
      });
      executeEvent('open-apps-mode', {});
    },
    [hotkeyAppsByName]
  );

  const handleToggleTrack = useCallback(
    (trackId: string) => {
      if (!trackId) {
        return;
      }

      const audio = audioRef.current;
      const isSameTrack = workspaceState.selectedTrackId === trackId;
      const wasPlaying = workspaceState.musicPlaying;
      const track = knownMusicTracksById.get(trackId) ?? null;
      const hadPlaybackFailure =
        isTrackLoadError || musicStreamError != null || audio?.error != null;

      if (isSameTrack && !wasPlaying && hadPlaybackFailure) {
        if (audio) {
          audio.pause();
          audio.removeAttribute('src');
          audio.load();
        }
        setMusicPlaybackTime(0);
        setMusicProgress(0);
        setMusicStreamError(null);
        if (track) {
          void downloadResource({
            identifier: track.id,
            name: track.name,
            service: EARBUMP_AUDIO_SERVICE,
          });
        }
      }

      applyWorkspaceState((current) => {
        return {
          ...current,
          mode: 'music',
          musicPlaying: isSameTrack ? !current.musicPlaying : true,
          onboardingCelebrationSeen:
            current.onboardingCelebrationSeen || dismissed === true,
          selectedTrackId: trackId,
        };
      });
      if (track) {
        setSelectedTrackSnapshot(track);
      }

      if (!isSameTrack) {
        setMusicPlaybackTime(0);
        setMusicProgress(0);
        setMusicStreamError(null);
      }

      if (track && !isSameTrack) {
        pushReaction(`Locked on ${track.title}.`);
        return;
      }
      if (!wasPlaying && isTrackPlayable) {
        pushReaction('Music player ready.');
        return;
      }
      return;
      /*
        pushReaction(`Locked on ${track.title}. Iâ€™m listening with you.`);
      */
    },
    [
      applyWorkspaceState,
      dismissed,
      downloadResource,
      isTrackLoadError,
      isTrackPlayable,
      knownMusicTracksById,
      musicStreamError,
      pushReaction,
      workspaceState.musicPlaying,
      workspaceState.selectedTrackId,
    ]
  );

  const handleToggleRepeatMode = useCallback(() => {
    applyWorkspaceState((current) => ({
      ...current,
      repeatMode: current.repeatMode === 'all' ? 'one' : 'all',
    }));
  }, [applyWorkspaceState]);

  const handleSelectTrackFromBrowser = useCallback(
    (trackId: string) => {
      setMusicPlaybackTime(0);
      setMusicProgress(0);
      setOpenMusicSearchDialog(false);
      handleToggleTrack(trackId);
    },
    [handleToggleTrack]
  );

  const handleOpenModulePicker = useCallback(() => {
    applyWorkspaceState((current) => ({
      ...current,
      onboardingCelebrationSeen: true,
    }));
    setOpenHotkeyPickerDialog(false);
    setOpenModulePickerDialog(true);
  }, [applyWorkspaceState]);

  const handleOpenHotkeyPicker = useCallback(
    (slotIndex = 0) => {
      applyWorkspaceState((current) => ({
        ...current,
        mode: 'hotkeys',
        onboardingCelebrationSeen:
          current.onboardingCelebrationSeen || dismissed === true,
      }));
      setSelectedHotkeySlot(slotIndex);
      setHotkeySearchQuery('');
      setOpenModulePickerDialog(false);
      setOpenHotkeyPickerDialog(true);
    },
    [applyWorkspaceState, dismissed]
  );

  const workspaceLabelColor = alpha(theme.palette.text.secondary, 0.78);
  const subtleLine = getBlueAmbientLineBackground(theme, 'soft');
  const curatedAccentBlue = isDarkMode
    ? alpha(GROUP_ACTIVITY_BLUE.gradientTop, 0.96)
    : alpha(GROUP_ACTIVITY_BLUE.gradientBottom, 0.92);
  /*
  useEffect(() => {
    const handleAvatar = () => {
      pushReaction('Avatar tools open. Letâ€™s give this place a face.');
    };

    const handleRegisterName = () => {
      pushReaction('Name flow open. This is where the hub starts recognizing you.');
    };

    const handleReceive = () => {
      pushReaction('Receive panel open. Hold steady and let the address do the work.');
    };

    const handleSend = () => {
      pushReaction('Send panel open. We can move carefully from here.');
    };

    const handleAppsLibrarySearch = (
      event: Event
    ) => {
      const query =
        (
          event as CustomEvent<{
            data?: {
              query?: string;
            };
          }>
        )?.detail?.data?.query ?? '';

      if (typeof query === 'string' && query.trim().length > 0) {
        pushReaction(`App search is tuned to ${query.trim()}.`);
        return;
      }

      pushReaction('App library open. We can wire the next lane from here.');
    };

    const handleContextHint = (event: Event) => {
      const message =
        (
          event as CustomEvent<{
            data?: { message?: string };
          }>
        )?.detail?.data?.message ?? '';

      if (typeof message === 'string' && message.trim().length > 0) {
        pushReaction(message.trim());
      }
    };

    const handleAddTab = (event: Event) => {
      const data =
        (
          event as CustomEvent<{
            data?: {
              identifier?: string;
              name?: string;
              path?: string;
              service?: string;
            };
          }>
        )?.detail?.data ?? {};
      const rawName = data.name?.toLowerCase?.() ?? '';

      if (rawName === 'q-tube') {
        pushReaction('Q-Tube launched. Feed the signal.');
        return;
      }

      if (rawName === 'quitter') {
        pushReaction('Quitter is live. Letâ€™s read the pulse.');
        return;
      }

      if (rawName === 'q-mail') {
        pushReaction('Q-Mail opened. Quiet channel, clear signal.');
        return;
      }

      if (rawName === 'q-blog') {
        pushReaction('Q-Blog is up. This lane is for making a mark.');
        return;
      }

      if (rawName === 'q-trade') {
        pushReaction('Q-Trade is open. Iâ€™ll keep the board steady.');
        return;
      }

      if (rawName === 'q-mintership') {
        pushReaction('Q-Mintership opened. This is the path toward joining the minters.');
        return;
      }

      if (rawName === 'earbump') {
        pushReaction('Earbump tab open. If you play something, Iâ€™ll vibe with you.');
      }
    };

    subscribeToEvent('openAvatarUpload', handleAvatar);
    subscribeToEvent('openRegisterName', handleRegisterName);
    subscribeToEvent('openSendQortInternal', handleSend);
    subscribeToEvent('openReceiveQortInternal', handleReceive);
    subscribeToEvent('openAppsLibrarySearch', handleAppsLibrarySearch);
    subscribeToEvent('qortinoContextHint', handleContextHint);
    subscribeToEvent('addTab', handleAddTab);

    return () => {
      unsubscribeFromEvent('openAvatarUpload', handleAvatar);
      unsubscribeFromEvent('openRegisterName', handleRegisterName);
      unsubscribeFromEvent('openSendQortInternal', handleSend);
      unsubscribeFromEvent('openReceiveQortInternal', handleReceive);
      unsubscribeFromEvent('openAppsLibrarySearch', handleAppsLibrarySearch);
      unsubscribeFromEvent('qortinoContextHint', handleContextHint);
      unsubscribeFromEvent('addTab', handleAddTab);
    };
  }, [pushReaction]);
  */

  useEffect(() => {
    const handleContextHint = (event: Event) => {
      const message =
        (
          event as CustomEvent<{
            data?: { message?: string };
          }>
        )?.detail?.data?.message ?? '';

      if (typeof message === 'string' && message.trim().length > 0) {
        pushReaction(message.trim());
      }
    };

    subscribeToEvent('qortinoContextHint', handleContextHint);

    return () => {
      unsubscribeFromEvent('qortinoContextHint', handleContextHint);
    };
  }, [pushReaction]);

  /*
  useEffect(() => {
    if (dismissed !== true) return;

    const interval = window.setInterval(() => {
      const recentlySpoke = Date.now() - lastReactionAtRef.current < 240000;
      if (
        recentlySpoke ||
        openModulePickerDialog ||
        openHotkeyPickerDialog ||
        openMusicSearchDialog ||
        workspaceState.musicPlaying
      ) {
        return;
      }

      const nextFact = QORTINO_IDLE_FACTS[idleFactIndexRef.current];
      idleFactIndexRef.current =
        (idleFactIndexRef.current + 1) % QORTINO_IDLE_FACTS.length;
      pushReaction(nextFact);
    }, 300000);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    dismissed,
    openHotkeyPickerDialog,
    openModulePickerDialog,
    openMusicSearchDialog,
    pushReaction,
    workspaceState.musicPlaying,
  ]);
  */

  const handleRunCurrentStepAction = useCallback(() => {
    if (currentStep.key === 'register_name') {
      pushReaction('Name flow open. This is where the hub starts recognizing you.');
    } else if (currentStep.key === 'load_avatar') {
      pushReaction('Avatar flow ready. Letâ€™s give this place a face.');
    }

    currentStep.onAction();
  }, [currentStep, pushReaction]);

  const currentStepPrimaryAction = useMemo(() => {
    if (isQortsAcquiredAwaitingNext) {
      return {
        label: t('tutorial:home.next', 'Next'),
        onClick: () => {
          setQortsAcquiredAcknowledged(true);
          if (onboardingMessageTimeoutRef.current) {
            window.clearTimeout(onboardingMessageTimeoutRef.current);
          }
          setOnboardingTransitionMessage('Nice work. The hardest part is done.');
          onboardingMessageTimeoutRef.current = window.setTimeout(() => {
            onboardingMessageTimeoutRef.current = null;
            setOnboardingTransitionMessage(null);
          }, ONBOARDING_RECOGNITION_DURATION_MS);
        },
      };
    }

    if (currentStep.key === 'get_six_qorts') {
      return {
        label: t(
          'tutorial:home.get_six_qorts_way1_action',
          'Go to onboarding'
        ),
        onClick: () => {
          pushReaction("Onboarding route open. I'll keep the next step warm.");
          openExternalUrl(ONBOARDING_URL);
        },
      };
    }

    return {
      label: currentStep.ctaLabel,
      loading: currentStep.loading === true,
      onClick: handleRunCurrentStepAction,
    };
  }, [
    currentStep.ctaLabel,
    currentStep.key,
    currentStep.loading,
    handleRunCurrentStepAction,
    isQortsAcquiredAwaitingNext,
    pushReaction,
    t,
  ]);

  const currentStepSecondaryActions = useMemo(() => {
    if (currentStep.key !== 'get_six_qorts' || isQortsAcquiredAwaitingNext) {
      return [];
    }

    return [
      {
        label: t(
          'tutorial:home.get_six_qorts_way2_action',
          'Open support chat'
        ),
        onClick: () => {
          pushReaction(
            "Support chat is open. Ask for the 6 QORT and I'll queue step two."
          );
          openExternalUrl(SUPPORT_CHAT_URL);
        },
      },
      {
        label: t(
          'tutorial:home.get_six_qorts_way3_action',
          'Open Q-Trade'
        ),
        onClick: () => {
          pushReaction(
            "Q-Trade is up. If you grab QORT there, I'll take you forward."
          );
          openApp('Q-Trade');
        },
      },
    ];
  }, [currentStep.key, isQortsAcquiredAwaitingNext, pushReaction, t]);

  const currentStepGetQortMethods = useMemo(() => {
    if (currentStep.key !== 'get_six_qorts' || isQortsAcquiredAwaitingNext) {
      return [];
    }

    return [
      {
        description: t(
          'tutorial:home.get_six_qorts_way1',
          'Finish the onboarding instruction on qortal.dev'
        ),
        icon: SchoolRoundedIcon,
        key: 'onboarding',
        label: currentStepPrimaryAction.label,
        onClick: currentStepPrimaryAction.onClick,
        recommended: true,
      },
      {
        description: t(
          'tutorial:home.get_six_qorts_way2',
          'Ask in the Nextcloud support chat for 6 QORT.'
        ),
        icon: SupportAgentRoundedIcon,
        key: 'support',
        label: t(
          'tutorial:home.get_six_qorts_way2_action',
          'Open support chat'
        ),
        onClick: () => {
          pushReaction(
            "Support chat is open. Ask for the 6 QORT and I'll queue step two."
          );
          openExternalUrl(SUPPORT_CHAT_URL);
        },
        recommended: false,
      },
      {
        description: t(
          'tutorial:home.get_six_qorts_way3',
          'Buy QORT using Q-Trade'
        ),
        icon: ShoppingBagRoundedIcon,
        key: 'q-trade',
        label: t(
          'tutorial:home.get_six_qorts_way3_action',
          'Open Q-Trade'
        ),
        onClick: () => {
          pushReaction(
            "Q-Trade is up. If you grab QORT there, I'll take you forward."
          );
          openApp('Q-Trade');
        },
        recommended: false,
      },
    ];
  }, [currentStep.key, currentStepPrimaryAction.label, currentStepPrimaryAction.onClick, isQortsAcquiredAwaitingNext, pushReaction, t]);

  const workspaceBayBackground =
    theme.palette.mode === 'dark'
      ? `linear-gradient(180deg, ${alpha('#20242D', 0.9)} 0%, ${alpha(
          '#171B23',
          0.96
        )} 100%)`
      : `linear-gradient(180deg, ${alpha('#FFFFFF', 0.72)} 0%, ${alpha(
          '#F3F6FB',
          0.9
        )} 100%)`;
  const workspaceBaySeparatorExtension = Math.max(
    qortinoLayoutDebug.separatorOffsetY,
    0
  );
  const workspaceBayHeightPx =
    QORTINO_WORKSPACE_BAY_HEIGHT_PX + workspaceBaySeparatorExtension;
  const onboardingCompanionLift = 8;
  const progressRowOffsetY = qortinoLayoutDebug.progressOffsetY + 12;
  const progressRowReservedTop = Math.max(progressRowOffsetY, 0);
  const progressRowVisualOffsetY = Math.min(progressRowOffsetY, 0);

  const workspaceBaySection = (
    <Box
      sx={{
        background: workspaceBayBackground,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: 0,
        px: isOnboardingVisible ? 2.15 : 2,
        py: isOnboardingVisible ? 1.72 : 1.25,
        position: 'relative',
        zIndex: 1,
        '&::after': {
          background: alpha(theme.palette.common.white, 0.05),
          content: '""',
          height: '1px',
          left: '18px',
          position: 'absolute',
          right: '18px',
          bottom: 0,
        },
      }}
    >
      {isOnboardingVisible ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1.02,
            height: '100%',
            '@container qortino-card (max-width: 390px)': {
              gap: 0.9,
            },
          }}
        >
          <Box
            sx={{
              alignItems: 'baseline',
              display: 'flex',
              justifyContent: 'space-between',
              '@container qortino-card (max-width: 390px)': {
                gap: 0.8,
              },
            }}
          >
            <Typography
              sx={{
                color: workspaceLabelColor,
                fontSize: '0.66rem',
                fontWeight: 700,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
              }}
            >
              Getting started
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.52),
                fontSize: '0.64rem',
                fontWeight: 600,
                letterSpacing: '0.04em',
              }}
            >
              Step {currentProgressStepDisplay} / {steps.length}
            </Typography>
          </Box>
          {currentStep.key === 'get_six_qorts' && !isQortsAcquiredAwaitingNext ? (
            <Box
              sx={{
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                gap: 1,
                minHeight: 0,
                transform: 'translateY(10px)',
              }}
            >
              <Box
                sx={{
                  alignItems: 'flex-start',
                  display: 'grid',
                  gap: '12px',
                  gridTemplateColumns: '40px minmax(0, 1fr)',
                  minWidth: 0,
                  pb: 1.22,
                  pt: 0.2,
                  position: 'relative',
                  '@container qortino-card (max-width: 390px)': {
                    gap: '10px',
                    gridTemplateColumns: '34px minmax(0, 1fr)',
                  },
                  '&::after': {
                    background: alpha(
                      theme.palette.common.white,
                      isDarkMode ? 0.06 : 0.12
                    ),
                    bottom: 0,
                    content: '""',
                    height: '1px',
                    left: 0,
                    position: 'absolute',
                    right: 0,
                  },
                }}
              >
                <CurrentStepIcon
                  sx={{
                    color: alpha(currentStep.accent, 0.92),
                    fontSize: '32px',
                    mt: '2px',
                    '@container qortino-card (max-width: 390px)': {
                      fontSize: '28px',
                    },
                  }}
                />
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.48,
                    minWidth: 0,
                  }}
                >
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.primary, 0.96),
                      fontSize: '0.98rem',
                      fontWeight: 700,
                      letterSpacing: '-0.02em',
                      lineHeight: 1.08,
                      '@container qortino-card (max-width: 390px)': {
                        fontSize: '0.9rem',
                      },
                    }}
                  >
                    {currentStep.label}
                  </Typography>
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.76),
                      fontSize: '0.71rem',
                      letterSpacing: '-0.01em',
                      lineHeight: 1.3,
                      maxWidth: '30ch',
                      '@container qortino-card (max-width: 390px)': {
                        fontSize: '0.67rem',
                        lineHeight: 1.24,
                      },
                    }}
                  >
                    {t(
                      'tutorial:home.get_qorts_workspace_hint',
                      'Unlock your first 6 QORT to activate the rest of the setup.'
                    )}
                  </Typography>
                </Box>
              </Box>

              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  mt: 0.42,
                }}
              >
                  {currentStepGetQortMethods.map((method, index) => (
                    <GettingStartedMethodRow
                      accent={currentStep.accent}
                      description={method.description}
                      emphasized={method.recommended}
                      icon={method.icon}
                      key={method.key}
                      label={method.label}
                      onClick={method.onClick}
                      showChevron={method.recommended}
                      showDivider={index < currentStepGetQortMethods.length - 1}
                    />
                  ))}
                </Box>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                gap: 1,
                minHeight: 0,
                transform: 'translateY(10px)',
              }}
            >
              <Box
                sx={{
                  alignItems: 'flex-start',
                  display: 'grid',
                  gap: '12px',
                  gridTemplateColumns: '40px minmax(0, 1fr)',
                  minWidth: 0,
                  pb: 1.16,
                  pt: 0.2,
                  position: 'relative',
                  '@container qortino-card (max-width: 390px)': {
                    gap: '10px',
                    gridTemplateColumns: '34px minmax(0, 1fr)',
                  },
                  '&::after': {
                    background: alpha(
                      theme.palette.common.white,
                      isDarkMode ? 0.06 : 0.12
                    ),
                    bottom: 0,
                    content: '""',
                    height: '1px',
                    left: 0,
                    position: 'absolute',
                    right: 0,
                  },
                }}
              >
                <CurrentStepIcon
                  sx={{
                    color: alpha(currentStep.accent, 0.92),
                    fontSize: '32px',
                    mt: '2px',
                    '@container qortino-card (max-width: 390px)': {
                      fontSize: '28px',
                    },
                  }}
                />
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.48,
                    minWidth: 0,
                  }}
                >
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.primary, 0.96),
                      fontSize: '0.98rem',
                      fontWeight: 700,
                      letterSpacing: '-0.008em',
                      lineHeight: 1.08,
                      maxWidth: '19ch',
                      '@container qortino-card (max-width: 390px)': {
                        fontSize: '0.92rem',
                      },
                    }}
                  >
                    {currentStep.label}
                  </Typography>
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.76),
                      fontSize: '0.71rem',
                      letterSpacing: '0.01em',
                      lineHeight: 1.3,
                      maxWidth: '31ch',
                      '@container qortino-card (max-width: 390px)': {
                        fontSize: '0.67rem',
                        lineHeight: 1.24,
                      },
                    }}
                  >
                    {currentStep.helper}
                  </Typography>
                </Box>
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.48,
                  mt: 0.42,
                }}
              >
                <GettingStartedPrimaryAction
                  accent={currentStep.accent}
                  label={currentStepPrimaryAction.label}
                  loading={currentStepPrimaryAction.loading}
                  onClick={currentStepPrimaryAction.onClick}
                />
                {currentStepSecondaryActions.length > 0 ? (
                  <Box
                    sx={{
                      alignItems: 'flex-start',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 0.08,
                      ml: -0.1,
                    }}
                  >
                    {currentStepSecondaryActions.map((action, index) => (
                      <GettingStartedSecondaryAction
                        accent={currentStep.accent}
                        key={`${currentStep.key}-secondary-${index}`}
                        label={action.label}
                        onClick={action.onClick}
                      />
                    ))}
                  </Box>
                ) : null}
              </Box>
            </Box>
          )}
        </Box>
      ) : workspaceState.mode === 'empty' ? (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        gap: 1,
        justifyContent: 'center',
        textAlign: 'center',
      }}
    >
      <ButtonBase
        onClick={handleOpenModulePicker}
        sx={{
          alignItems: 'center',
          background:
            theme.palette.mode === 'dark'
              ? 'linear-gradient(180deg, rgba(140,184,255,0.9) 0%, rgba(109,166,255,0.88) 100%)'
              : 'linear-gradient(180deg, rgba(148,190,255,0.92) 0%, rgba(118,171,255,0.88) 100%)',
          border: `1px solid ${alpha('#8DB8FF', 0.22)}`,
          borderRadius: '14px',
          boxShadow: `0 10px 24px ${alpha('#000', 0.18)}, 0 0 0 1px ${alpha(
            '#fff',
            0.05
          )} inset, 0 0 18px ${alpha('#8DB8FF', 0.16)}`,
          display: 'inline-flex',
          height: '42px',
          justifyContent: 'center',
          transition:
            'transform 120ms ease, box-shadow 140ms ease, filter 140ms ease',
          width: '42px',
          '&:hover': {
            boxShadow: `0 12px 26px ${alpha('#000', 0.22)}, 0 0 0 1px ${alpha(
              '#fff',
              0.06
            )} inset, 0 0 22px ${alpha('#8DB8FF', 0.2)}`,
            filter: 'brightness(1.03)',
            transform: 'translateY(-1px)',
          },
        }}
      >
        <AddRoundedIcon sx={{ color: APP_BLUE_SURFACE_TEXT, fontSize: '21px' }} />
      </ButtonBase>
      <Typography
        sx={{
          color: alpha(theme.palette.text.primary, 0.92),
          fontSize: '0.78rem',
          lineHeight: 1.45,
          maxWidth: '24ch',
        }}
      >
        Choose what lives above QORTINO.
      </Typography>
    </Box>
  ) : workspaceState.mode === 'hotkeys' ? (
    <Box
      sx={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          pb: '12px',
          pl: '10px',
          pr: '10px',
          pt: '10px',
          transform: `translateY(${qortinoLayoutDebug.musicHeaderOffsetY - 11}px)`,
          '@container qortino-card (max-width: 390px)': {
            pb: '10px',
            pl: '8px',
            pr: '8px',
            pt: '8px',
          },
        }}
      >
        <Typography
          sx={{
            color: alpha(theme.palette.text.secondary, 0.82),
            fontSize: '0.66rem',
            fontWeight: 700,
            letterSpacing: '0.11em',
            textTransform: 'uppercase',
          }}
        >
          Hotkeys
        </Typography>
        <Box sx={{ display: 'flex', gap: '6px' }}>
          <IconButton
            onClick={() =>
              handleOpenHotkeyPicker(
                firstEmptyHotkeySlot >= 0 ? firstEmptyHotkeySlot : 0
              )
            }
            size="small"
            sx={{
              borderRadius: '9px',
              color: alpha('#9FC4FF', 0.92),
              height: '30px',
              width: '30px',
              '&:hover': {
                background: alpha('#8DB8FF', 0.1),
              },
            }}
          >
            <TuneRoundedIcon sx={{ fontSize: '18px' }} />
          </IconButton>
          <IconButton
            onClick={() => handleSelectWorkspaceMode('empty')}
            size="small"
            sx={{
              borderRadius: '9px',
              color: alpha(theme.palette.text.secondary, 0.84),
              height: '30px',
              width: '30px',
              '&:hover': {
                background: alpha(theme.palette.common.white, isDarkMode ? 0.05 : 0.08),
              },
            }}
          >
            <CloseRoundedIcon sx={{ fontSize: '18px' }} />
          </IconButton>
        </Box>
      </Box>

      <Box
        sx={{
          alignContent: 'start',
          display: 'grid',
          flex: 1,
          gap: '10px',
          gridAutoRows: 'minmax(0, 1fr)',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          minHeight: 0,
          width: '100%',
          px: '10px',
          pb: '10px',
          '@container qortino-card (max-width: 390px)': {
            gap: '8px',
            px: '8px',
            pb: '8px',
          },
        }}
      >
        {workspaceState.hotkeys.map((appName, index) => {
          const app = appName ? resolveHotkeyApp(appName) : null;

          return (
            <ButtonBase
              key={`slot-${index}`}
              onClick={() =>
                app ? handleRunHotkey(app.appName) : handleOpenHotkeyPicker(index)
              }
              sx={{
                alignItems: 'center',
                background: 'transparent',
                border: '1px solid transparent',
                borderRadius: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 0.8,
                height: '100%',
                justifyContent: 'center',
                minWidth: 0,
                px: 0.7,
                py: 0.7,
                transition:
                  'background 150ms ease, box-shadow 150ms ease, transform 120ms ease',
                '&:hover': {
                  background: `linear-gradient(180deg, ${alpha('#9FC4FF', 0.18)} 0%, ${alpha(
                    '#8DB8FF',
                    0.1
                  )} 58%, ${alpha('#8DB8FF', 0.04)} 100%)`,
                  boxShadow: `inset 0 0 0 1px ${alpha('#9FC4FF', 0.14)}`,
                  transform: 'translateY(-1px)',
                },
              }}
            >
              {app ? (
                <>
                  <HotkeyAppAvatar appName={app.appName} radius={11} size={34} />
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.primary, 0.92),
                      display: '-webkit-box',
                      fontSize: '0.61rem',
                      fontWeight: 700,
                      lineHeight: 1.18,
                      overflow: 'hidden',
                      textAlign: 'center',
                      textOverflow: 'ellipsis',
                      WebkitBoxOrient: 'vertical',
                      WebkitLineClamp: 2,
                    }}
                  >
                    {app.label}
                  </Typography>
                </>
              ) : (
                <>
                  <Box
                    sx={{
                      alignItems: 'center',
                      color: alpha(theme.palette.text.secondary, 0.62),
                      display: 'flex',
                      height: '34px',
                      justifyContent: 'center',
                      width: '34px',
                    }}
                  >
                    <AddRoundedIcon sx={{ fontSize: '19px' }} />
                  </Box>
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.7),
                      fontSize: '0.59rem',
                      fontWeight: 700,
                      lineHeight: 1.12,
                      textAlign: 'center',
                    }}
                  >
                    Add app
                  </Typography>
                </>
              )}
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  ) : (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.02 }}>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          transform: `translateY(${qortinoLayoutDebug.musicHeaderOffsetY - 1}px)`,
        }}
      >
        <IconButton
          onClick={() => setOpenMusicSearchDialog(true)}
          size="small"
          sx={{
            color: alpha('#9FC4FF', 0.92),
            height: '30px',
            width: '30px',
          }}
        >
          <SearchRoundedIcon sx={{ fontSize: '18px' }} />
        </IconButton>
        <Typography
          sx={{
            color: alpha(theme.palette.text.secondary, 0.82),
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          Music player
        </Typography>
        <IconButton
          onClick={() => handleSelectWorkspaceMode('empty')}
          size="small"
          sx={{
            color: alpha(theme.palette.text.secondary, 0.82),
            height: '30px',
            width: '30px',
          }}
        >
          <CloseRoundedIcon sx={{ fontSize: '18px' }} />
        </IconButton>
      </Box>

      <Box
        sx={{
          alignItems: 'center',
          display: 'grid',
          gap: '14px',
          gridTemplateColumns: '28px minmax(0, 1fr) 28px',
        }}
      >
        <ButtonBase
          onClick={() => handleCycleTrack('previous')}
          sx={{
            ...smallTransportButtonSx(theme),
            transform: `translateY(${qortinoLayoutDebug.prevNextOffsetY - 8}px)`,
          }}
        >
          <SkipPreviousRoundedIcon sx={{ fontSize: '15px' }} />
        </ButtonBase>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.08,
          }}
        >
          <ButtonBase
            onClick={() => handleToggleTrack(activeTrack.id)}
            sx={{
              alignItems: 'center',
              borderRadius: '50%',
              display: 'flex',
              height: '110px',
              isolation: 'isolate',
              justifyContent: 'center',
              position: 'relative',
              transform: `translateY(${qortinoLayoutDebug.vinylOffsetY + 12}px)`,
              width: '110px',
            }}
          >
            <MusicCoverArt
              isSpinning={workspaceState.musicPlaying && isTrackReady && !isTrackLoadError}
              size={110}
              track={activeTrack}
            />
            {activeTrack.id && !isTrackReady ? (
              <Box
                sx={{
                  height: '50px',
                  left: '50%',
                  pointerEvents: 'none',
                  position: 'absolute',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '50px',
                  zIndex: 2,
                }}
              >
                <CircularProgress
                  size={50}
                  thickness={4.1}
                  value={100}
                  variant="determinate"
                  sx={{
                    color: musicControlRingTrackColor,
                    inset: 0,
                    position: 'absolute',
                  }}
                />
                {isTrackPreparing && activeTrackReadyPercent <= 0 ? (
                  <CircularProgress
                    size={50}
                    thickness={4.1}
                    variant="indeterminate"
                    sx={{
                      animationDuration: '1.8s',
                      color: musicControlRingColor,
                      inset: 0,
                      position: 'absolute',
                      '& .MuiCircularProgress-circle': {
                        strokeLinecap: 'round',
                      },
                    }}
                  />
                ) : (
                  <CircularProgress
                    size={50}
                    thickness={4.1}
                    value={Math.max(
                      musicControlShowsReadyPulse ? 100 : 8,
                      activeTrackReadyPercent
                    )}
                    variant="determinate"
                    sx={{
                      color: musicControlRingColor,
                      inset: 0,
                      position: 'absolute',
                      transition: 'color 180ms ease',
                      '& .MuiCircularProgress-circle': {
                        strokeLinecap: 'round',
                        transition: 'stroke-dashoffset 260ms ease',
                      },
                    }}
                  />
                )}
              </Box>
            ) : null}
            <Box
              sx={{
                alignItems: 'center',
                backdropFilter: 'blur(10px)',
                background: alpha('#FFFFFF', workspaceState.musicPlaying ? 0.78 : 0.68),
                borderRadius: '50%',
                boxShadow: `0 8px 18px ${alpha('#000', 0.2)}`,
                color: alpha('#243A67', 0.88),
                display: 'flex',
                height: '36px',
                justifyContent: 'center',
                left: '50%',
                position: 'absolute',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: '36px',
                zIndex: 3,
              }}
            >
              {musicControlShowsPause ? (
                <PauseRoundedIcon sx={{ fontSize: '22px' }} />
              ) : musicControlShowsDownload ? (
                <DownloadRoundedIcon sx={{ fontSize: '18px' }} />
              ) : (
                <PlayArrowRoundedIcon sx={{ fontSize: '22px' }} />
              )}
            </Box>
          </ButtonBase>
          <Box
            sx={{
              maxWidth: '100%',
              minWidth: 0,
              textAlign: 'center',
              transform: `translateY(${qortinoLayoutDebug.titleAuthorOffsetY + 21}px)`,
              width: '100%',
            }}
          >
            <Typography
              sx={{
                color: alpha(theme.palette.text.primary, 0.92),
                fontSize: '0.78rem',
                fontWeight: 700,
                lineHeight: 1.15,
                overflow: 'hidden',
                textOverflow: 'clip',
                whiteSpace: 'nowrap',
                width: '100%',
              }}
            >
              {truncateTrackLabel(activeTrack.title)}
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.72),
                fontSize: '0.61rem',
                mt: 0.12,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {activeTrack.artist}
            </Typography>
          </Box>
        </Box>
        <ButtonBase
          onClick={() => handleCycleTrack('next')}
          sx={{
            ...smallTransportButtonSx(theme),
            transform: `translateY(${qortinoLayoutDebug.prevNextOffsetY - 8}px)`,
          }}
        >
          <SkipNextRoundedIcon sx={{ fontSize: '15px' }} />
        </ButtonBase>
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 0.18,
          mt: 0.36,
          pt: `${progressRowReservedTop}px`,
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'grid',
            gap: '8px',
            gridTemplateColumns: 'auto minmax(0, 1fr) auto auto',
            position: 'relative',
            transform: `translateY(${progressRowVisualOffsetY}px)`,
            zIndex: 1,
          }}
        >
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.68),
              fontSize: '0.55rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {currentPlaybackTime}
          </Typography>
          <Box
            ref={musicProgressBarRef}
            onPointerDown={handleMusicProgressPointerDown}
            sx={{
              cursor:
                isTrackPlayable && activeTrackDurationSeconds > 0
                  ? 'pointer'
                  : 'default',
              display: 'flex',
              alignItems: 'center',
              height: '12px',
              position: 'relative',
              touchAction: 'none',
            }}
          >
            <Box
              sx={{
                background: getBlueTier3ProgressBackground(theme, isDarkMode),
                borderRadius: '999px',
                height: '4px',
                overflow: 'hidden',
                position: 'relative',
                width: '100%',
              }}
            >
              <Box
                sx={{
                  background:
                    'linear-gradient(90deg, rgba(144,186,255,0.96) 0%, rgba(111,166,255,0.9) 100%)',
                  borderRadius: '999px',
                  boxShadow: `0 0 14px ${alpha('#8DB8FF', 0.22)}`,
                  height: '100%',
                  transition: 'width 260ms ease',
                  width: `${Math.min(Math.max(musicProgress, 0), 1) * 100}%`,
                }}
              />
            </Box>
          </Box>
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.68),
              fontSize: '0.55rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {activeTrack.length}
          </Typography>
          <ButtonBase
            onClick={handleToggleRepeatMode}
            sx={{
              alignItems: 'center',
              color: alpha(
                workspaceState.repeatMode === 'one'
                  ? '#9FC4FF'
                  : theme.palette.text.secondary,
                workspaceState.repeatMode === 'one' ? 0.96 : 0.8
              ),
              display: 'inline-flex',
              height: '18px',
              justifyContent: 'center',
              position: 'relative',
              width: '18px',
              zIndex: 1,
            }}
          >
            {workspaceState.repeatMode === 'one' ? (
              <RepeatOneRoundedIcon sx={{ fontSize: '15px' }} />
            ) : (
              <RepeatRoundedIcon sx={{ fontSize: '15px' }} />
            )}
          </ButtonBase>
        </Box>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            height: `${MUSIC_STATUS_SLOT_HEIGHT_PX}px`,
            justifyContent: 'center',
            overflow: 'hidden',
            pointerEvents: 'none',
            position: 'relative',
          }}
        >
          <Typography
            sx={{
              color: alpha(
                isTrackLoadError
                  ? '#FFB4B4'
                  : isTrackPeerStarved
                    ? '#F6D089'
                    : theme.palette.text.secondary,
                isTrackLoadError || isTrackPeerStarved ? 0.9 : 0.7
              ),
              fontSize: '0.58rem',
              fontWeight: 600,
              lineHeight: 1.35,
              maxWidth: '100%',
              opacity: musicStatusSlotMessage ? 1 : 0,
              textAlign: 'center',
              transform: `translateY(${qortinoLayoutDebug.nodeStatusOffsetY}px)`,
              transition: 'opacity 140ms ease',
              visibility: musicStatusSlotMessage ? 'visible' : 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {musicStatusSlotMessage ?? ' '}
          </Typography>
        </Box>
      </Box>
    </Box>
      )}
    </Box>
  );

  const qortinoStatusLabel = isQortinoTickled
    ? 'ticklish'
    : qortinoGratefulState
      ? 'grateful'
    : isOnboardingVisible
      ? 'helpful'
      : isWorkspaceFreshlyUnlocked
        ? 'happy'
        : workspaceState.mode === 'music' && workspaceState.musicPlaying
          ? 'listening'
          : 'idle';
  const qortinoMascotCenteredOffsetY = Math.round(
    (QORTINO_MASCOT_SIZE - qortinoMascotStageHeight) / 2
  );
  const applyQortinoSandboxSnapshot = useCallback(
    (snapshot: QortinoSandboxSnapshot) => {
      setQortinoSandboxPresetKey(snapshot.presetKey);
      setQortinoSandboxStatusLabel(snapshot.statusLabel);
      setQortinoSandboxBubbleMessage(snapshot.bubbleMessage);
      setQortinoSandboxPreviewNonce((current) => current + 1);
    },
    []
  );
  const applyQortinoSandboxPreset = useCallback(
    (presetKey: QortinoSandboxPresetKey) => {
      const preset = QORTINO_SANDBOX_PRESET_BY_KEY[presetKey];
      setIsQortinoSandboxTickled(false);
      applyQortinoSandboxSnapshot({
        bubbleMessage: preset.bubbleMessage,
        presetKey,
        statusLabel: preset.statusLabel,
      });
    },
    [applyQortinoSandboxSnapshot]
  );
  const handleResetQortinoSandbox = useCallback(() => {
    setIsQortinoSandboxTickled(false);
    applyQortinoSandboxSnapshot(qortinoSandboxBaseSnapshotRef.current);
  }, [applyQortinoSandboxSnapshot]);
  const handleCycleQortinoSandboxPreset = useCallback(
    (direction: 'next' | 'previous') => {
      const currentIndex = QORTINO_SANDBOX_PRESETS.findIndex(
        (preset) => preset.key === qortinoSandboxPresetKey
      );
      const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex =
        direction === 'next'
          ? (safeCurrentIndex + 1) % QORTINO_SANDBOX_PRESETS.length
          : (safeCurrentIndex - 1 + QORTINO_SANDBOX_PRESETS.length) %
            QORTINO_SANDBOX_PRESETS.length;
      applyQortinoSandboxPreset(QORTINO_SANDBOX_PRESETS[nextIndex].key);
    },
    [applyQortinoSandboxPreset, qortinoSandboxPresetKey]
  );
  const qortinoSandboxMood =
    QORTINO_SANDBOX_PRESET_BY_KEY[qortinoSandboxPresetKey].mood;
  const qortinoSandboxEffectiveStatusLabel = isQortinoSandboxTickled
    ? 'ticklish'
    : qortinoSandboxStatusLabel.trim() || ' ';
  const qortinoSandboxDisplayedMessage =
    qortinoSandboxBubbleMessage.trim() || null;
  const qortinoSandboxIsListening = qortinoSandboxPresetKey === 'listening';
  const qortinoCelebrationConfettiOptions = useMemo(
    () => ({
      colors: ['#8DB8FF', '#A7CAFF', '#D7E6FF', '#FFFFFF'],
      drift: 0,
      gravity: 0.72,
      origin: { x: 0.48, y: 0.9 },
      particleCount: 68,
      scalar: 0.82,
      spread: 84,
      startVelocity: 24,
      ticks: 180,
    }),
    []
  );
  const qortinoSandboxMotionKey = [
    qortinoSandboxPreviewNonce,
    qortinoSandboxPresetKey,
    qortinoSandboxStatusLabel,
    qortinoSandboxBubbleMessage,
  ].join(':');
  const renderQortinoCompanionPreviewSection = useCallback(
    ({
      displayedMessage,
      isTickled,
      isListening,
      isTalking,
      messageKey,
      mood,
      onMascotDragOver,
      onMascotDrop,
      onMascotPointerDown,
      onMascotPointerRelease,
      showConfetti = false,
      statusLabel,
      }: {
        displayedMessage: string | null;
        isTickled: boolean;
        isListening: boolean;
        isTalking: boolean;
        messageKey: string;
        mood:
          | 'celebrate'
          | 'empty'
          | 'grateful'
          | 'guide'
          | 'hotkeys'
          | 'music';
        onMascotDragOver?: (event: ReactDragEvent<HTMLDivElement>) => void;
        onMascotDrop?: (event: ReactDragEvent<HTMLDivElement>) => void;
        onMascotPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
        onMascotPointerRelease?: () => void;
        showConfetti?: boolean;
        statusLabel: string;
      }) => {
        const shouldShowQortinoConfetti = showConfetti;

      return (
      <Box
        sx={{
          background:
            theme.palette.mode === 'dark'
              ? `linear-gradient(90deg, ${alpha('#23324A', 0.08)} 0%, ${alpha(
                  '#1D2A3C',
                  0.06
                )} 20%, ${alpha('#141B25', 0.03)} 38%, ${alpha('#11161E', 0)} 62%), radial-gradient(88% 78% at 8% 96%, ${alpha(
                  '#23324A',
                  0.16
                )} 0%, ${alpha('#1A2534', 0.08)} 24%, ${alpha('#11161E', 0)} 68%), linear-gradient(180deg, ${alpha(
                  '#13171D',
                  0.98
                )} 0%, ${alpha('#0E1319', 1)} 100%)`
              : `linear-gradient(90deg, ${alpha('#D8E8FF', 0.08)} 0%, ${alpha(
                  '#E7F0FB',
                  0.06
                )} 22%, ${alpha('#F4F7FB', 0.03)} 40%, ${alpha('#FFFFFF', 0)} 64%), radial-gradient(88% 78% at 8% 96%, ${alpha(
                  '#D8E8FF',
                  0.18
                )} 0%, ${alpha('#E7F0FB', 0.08)} 24%, ${alpha('#FFFFFF', 0)} 68%), linear-gradient(180deg, ${alpha(
                  '#F4F7FB',
                  0.98
                )} 0%, ${alpha('#EEF3F8', 1)} 100%)`,
          minHeight: 0,
          mt: 0,
          overflow: 'hidden',
          position: 'relative',
          px: 2,
          pb: 1.5,
          pt: 0,
        }}
      >
        <DotPattern
          color={isDarkMode ? '#8DB8FF' : '#6EA5FF'}
          cr={1.15}
          cx={1}
          cy={1}
          height={17}
          width={17}
          sx={{
            opacity: isDarkMode ? 0.5 : 0.34,
            pointerEvents: 'none',
            transform: 'translate(-4px, 6px)',
            zIndex: 0,
            maskImage:
              'radial-gradient(70% 76% at 18% 76%, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.86) 26%, rgba(255,255,255,0.44) 52%, rgba(255,255,255,0.14) 69%, transparent 84%), linear-gradient(to right, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.38) 34%, transparent 62%)',
            WebkitMaskImage:
              'radial-gradient(70% 76% at 18% 76%, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.86) 26%, rgba(255,255,255,0.44) 52%, rgba(255,255,255,0.14) 69%, transparent 84%), linear-gradient(to right, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.38) 34%, transparent 62%)',
          }}
        />
        {shouldShowQortinoConfetti ? (
          <Confetti
            key={`qortino-confetti-${messageKey}`}
            aria-hidden="true"
            manualstart={false}
            options={qortinoCelebrationConfettiOptions}
            style={{
              inset: 0,
              pointerEvents: 'none',
              position: 'absolute',
              width: '100%',
              height: '100%',
              zIndex: 0,
            }}
          />
        ) : null}
        <Box
          sx={{
            inset: 0,
            pointerEvents: 'none',
            position: 'absolute',
            '&::before': {
              background: subtleLine,
              content: '""',
              height: '1px',
              left: '18px',
              position: 'absolute',
              right: '18px',
              top: 0,
            },
          }}
        />
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            transform: `translateY(${-(qortinoLayoutDebug.separatorOffsetY + onboardingCompanionLift)}px)`,
          }}
        >
          <Box
            sx={{
              alignItems: 'flex-start',
              display: 'flex',
              justifyContent: 'flex-end',
              mb: 1.05,
              mt: '10px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <Box
              sx={{
                alignItems: 'flex-start',
                display: 'flex',
                flexDirection: 'column',
                gap: '3px',
                minWidth: '78px',
              }}
            >
              <Typography
                sx={{
                  color: workspaceLabelColor,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  letterSpacing: '0.14em',
                  transform: `translate(${qortinoCompanionDebug.nameOffsetX}px, ${qortinoCompanionDebug.nameOffsetY + 1}px)`,
                  textTransform: 'uppercase',
                }}
              >
                QORTINO
              </Typography>
              <Box
                sx={{
                  alignSelf: 'flex-start',
                  overflow: 'visible',
                  position: 'relative',
                  transform: `translate(${qortinoCompanionDebug.statusOffsetX}px, ${qortinoCompanionDebug.statusOffsetY + 5}px)`,
                }}
              >
                <Box
                  sx={{
                    border: '1px solid transparent',
                    borderRadius: '4px',
                    px: '3px',
                    py: '1px',
                    visibility: 'hidden',
                  }}
                >
                  <Typography
                    sx={{
                      color: 'transparent',
                      fontSize: '0.58rem',
                      fontWeight: 700,
                      letterSpacing: '0.02em',
                    }}
                  >
                    {QORTINO_STATUS_REFERENCE_LABEL}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    background: alpha('#8DB8FF', isDarkMode ? 0.1 : 0.18),
                    border: `1px solid ${alpha('#8DB8FF', isDarkMode ? 0.32 : 0.4)}`,
                    borderRadius: '4px',
                    boxShadow: `inset 0 1px 0 ${alpha(
                      theme.palette.common.white,
                      isDarkMode ? 0.08 : 0.22
                    )}`,
                    position: 'absolute',
                    px: '3px',
                    py: '1px',
                    right: 0,
                    top: 0,
                  }}
                >
                  <Typography
                    sx={{
                      color: alpha('#FFFFFF', 0.98),
                      fontSize: '0.58rem',
                      fontWeight: 700,
                      letterSpacing: '0.02em',
                    }}
                  >
                    {statusLabel}
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Box>
          <Box
            sx={{
              alignItems: 'end',
              columnGap: 1,
              display: 'grid',
              gridTemplateColumns: `${qortinoMascotStageWidth}px minmax(0, 1fr)`,
              mt: '-11px',
              minHeight: `${Math.max(qortinoMascotStageHeight, 96)}px`,
              position: 'relative',
              zIndex: 1,
            }}
          >
            <Box
              sx={{
                alignItems: 'flex-end',
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'center',
                height: `${qortinoMascotStageHeight}px`,
                overflow: 'visible',
                touchAction: 'none',
                transform: `translateY(${qortinoMascotCenteredOffsetY}px)`,
                width: `${qortinoMascotStageWidth}px`,
              }}
              onDragOver={onMascotDragOver}
              onDrop={onMascotDrop}
              onPointerCancel={onMascotPointerRelease}
              onPointerDown={onMascotPointerDown}
              onPointerUp={onMascotPointerRelease}
              onLostPointerCapture={onMascotPointerRelease}
            >
              <QortinoMascot
                isDarkMode={isDarkMode}
                isTickled={isTickled}
                isListening={isListening}
                isTalking={isTalking}
                lookDebug={qortinoLookDebug}
                mood={mood}
              />
            </Box>
            <Box
              sx={{
                alignItems: 'start',
                display: 'flex',
                flexDirection: 'column',
                gap: 1.02,
                justifyContent: 'center',
                minHeight: `${qortinoMascotStageHeight}px`,
                minWidth: 0,
                width: '100%',
              }}
            >
              {displayedMessage ? (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  style={{ minWidth: 0 }}
                >
                  <Box
                    sx={{
                      alignSelf: 'flex-start',
                      background:
                        theme.palette.mode === 'dark'
                          ? 'linear-gradient(180deg, rgba(31,36,45,0.88) 0%, rgba(19,23,29,0.96) 100%)'
                          : 'linear-gradient(180deg, rgba(255,255,255,0.86) 0%, rgba(243,247,252,0.94) 100%)',
                      border: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.065 : 0.14)}`,
                      borderRadius: '15px',
                      boxShadow: `0 14px 24px ${alpha('#000', isDarkMode ? 0.18 : 0.08)}`,
                      display: 'flex',
                      maxWidth: { xs: 'calc(100% - 4px)', sm: '204px' },
                      minHeight: '76px',
                      minWidth: 0,
                      overflow: 'hidden',
                      p: 0.9,
                      position: 'relative',
                      transform: `translate(${qortinoCompanionDebug.bubbleOffsetX}px, ${
                        qortinoCompanionDebug.bubbleOffsetY + 5
                      }px)`,
                      '&::before': {
                        background: alpha(
                          theme.palette.common.white,
                          isDarkMode ? 0.07 : 0.15
                        ),
                        bottom: '14px',
                        clipPath: 'polygon(0 50%, 100% 0, 100% 100%)',
                        content: '""',
                        height: '18px',
                        left: '-12px',
                        position: 'absolute',
                        width: '12px',
                      },
                      '&::after': {
                        background:
                          theme.palette.mode === 'dark'
                            ? 'linear-gradient(180deg, rgba(31,36,45,0.88) 0%, rgba(19,23,29,0.96) 100%)'
                            : 'linear-gradient(180deg, rgba(255,255,255,0.86) 0%, rgba(243,247,252,0.94) 100%)',
                        bottom: '15px',
                        clipPath: 'polygon(0 50%, 100% 0, 100% 100%)',
                        content: '""',
                        filter: `drop-shadow(0 6px 10px ${alpha('#000', isDarkMode ? 0.12 : 0.05)})`,
                        height: '16px',
                        left: '-10px',
                        position: 'absolute',
                        width: '10px',
                      },
                    }}
                  >
                    <motion.div
                      key={messageKey}
                      initial={{ opacity: 0.35, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22, ease: 'easeOut' }}
                      style={{ width: '100%' }}
                    >
                      <Typography
                        sx={{
                          color: alpha(theme.palette.text.primary, 0.94),
                          display: '-webkit-box',
                          fontSize: '0.73rem',
                          fontWeight: 600,
                          letterSpacing: '-0.015em',
                          lineHeight: 1.4,
                          overflow: 'hidden',
                          overflowWrap: 'anywhere',
                          textOverflow: 'ellipsis',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: 3,
                          wordBreak: 'break-word',
                        }}
                      >
                        {displayedMessage}
                      </Typography>
                    </motion.div>
                  </Box>
                </motion.div>
              ) : null}
            </Box>
          </Box>
        </Box>
      </Box>
      );
    },
    [
      isDarkMode,
      onboardingCompanionLift,
      qortinoCompanionDebug.bubbleOffsetX,
      qortinoCompanionDebug.bubbleOffsetY,
      qortinoCompanionDebug.nameOffsetX,
      qortinoCompanionDebug.nameOffsetY,
      qortinoCompanionDebug.statusOffsetX,
      qortinoCompanionDebug.statusOffsetY,
      qortinoLayoutDebug.separatorOffsetY,
      qortinoLookDebug,
      qortinoMascotCenteredOffsetY,
      qortinoMascotStageHeight,
      qortinoMascotStageWidth,
      qortinoCelebrationConfettiOptions,
      subtleLine,
      theme,
      workspaceLabelColor,
    ]
  );

  const qortinoCompanionSection = renderQortinoCompanionPreviewSection({
    displayedMessage: qortinoDisplayedMessage,
    isTickled: isQortinoTickled,
    isListening: workspaceState.mode === 'music' && workspaceState.musicPlaying,
    isTalking: qortinoIsTalking,
    messageKey: qortinoGratefulState
      ? `grateful-${qortinoGratefulState.nonce}`
      : qortinoDisplayedMessage ?? 'empty',
    mood: qortinoMood,
    onMascotDragOver: handleQortinoDonationDragOver,
    onMascotDrop: handleQortinoDonationDrop,
    onMascotPointerDown: handleQortinoPointerDown,
    onMascotPointerRelease: handleQortinoPointerRelease,
    showConfetti: showOnboardingCompletionConfetti && Boolean(postOnboardingMessage),
    statusLabel: qortinoStatusLabel,
  });
  const qortinoDonationOverlayMessage = truncateQortinoBubbleMessage(
    qortinoDonationOverlayState?.message ?? null,
    84
  );
  const qortinoDonationOverlay = (
    <AnimatePresence initial={false} mode="wait">
      {qortinoDonationOverlayState ? (
        <Portal>
          <Box
            sx={{
              bottom: 26,
              display: 'flex',
              left: 26,
              pointerEvents: 'none',
              position: 'fixed',
              zIndex: 1505,
            }}
          >
            <motion.div
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.995 }}
              initial={{ opacity: 0, y: 12, scale: 0.985 }}
              key={qortinoDonationOverlayState.nonce}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              <Box
                sx={{
                  alignItems: 'flex-end',
                  display: 'flex',
                  gap: 1.7,
                }}
              >
                <Box
                  sx={{
                    alignItems: 'flex-end',
                    display: 'flex',
                    height: `${QORTINO_MASCOT_SIZE + 34}px`,
                    justifyContent: 'center',
                    position: 'relative',
                    width: `${QORTINO_MASCOT_SIZE + 18}px`,
                  }}
                >
                  <Box
                    sx={{
                      background: `radial-gradient(ellipse at center, ${alpha(
                        '#05070C',
                        isDarkMode ? 0.28 : 0.12
                      )} 0%, ${alpha('#05070C', 0)} 72%)`,
                      bottom: 8,
                      filter: 'blur(12px)',
                      height: '16px',
                      left: '50%',
                      position: 'absolute',
                      transform: 'translateX(-50%)',
                      width: `${Math.round(QORTINO_MASCOT_SIZE * 0.62)}px`,
                      zIndex: 0,
                    }}
                  />
                  <Box
                    sx={{
                      transform: 'translateY(-3px) scale(1.02)',
                      transformOrigin: 'center bottom',
                      zIndex: 1,
                    }}
                  >
                    <QortinoMascot
                      isDarkMode={isDarkMode}
                      isListening={false}
                      isTalking
                      isTickled={false}
                      lookDebug={qortinoLookDebug}
                      mood="celebrate"
                    />
                  </Box>
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.7,
                    maxWidth: 'min(340px, calc(100vw - 170px))',
                    minWidth: 0,
                    pb: 0.35,
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: 0.8,
                      minWidth: 0,
                      pl: 0.15,
                    }}
                  >
                    <Typography
                      sx={{
                        color: alpha('#EEF5FF', 0.7),
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        letterSpacing: '0.18em',
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      QORTINO
                    </Typography>
                    <Box
                      sx={{
                        background: alpha('#8DB8FF', isDarkMode ? 0.1 : 0.18),
                        border: `1px solid ${alpha('#8DB8FF', isDarkMode ? 0.32 : 0.4)}`,
                        borderRadius: '6px',
                        boxShadow: `inset 0 1px 0 ${alpha(
                          theme.palette.common.white,
                          isDarkMode ? 0.08 : 0.22
                        )}`,
                        flexShrink: 0,
                        px: '4px',
                        py: '2px',
                      }}
                    >
                      <Typography
                        sx={{
                          color: alpha('#FFFFFF', 0.98),
                          fontSize: '0.58rem',
                          fontWeight: 700,
                          letterSpacing: '0.02em',
                        }}
                      >
                        happy
                      </Typography>
                    </Box>
                  </Box>
                  <Box
                    sx={{
                      background: theme.palette.mode === 'dark'
                        ? `linear-gradient(180deg, ${alpha('#1D232C', 0.98)} 0%, ${alpha(
                            '#161B23',
                            0.995
                          )} 100%)`
                        : `linear-gradient(180deg, ${alpha('#FFFFFF', 0.95)} 0%, ${alpha(
                            '#F2F6FB',
                            0.98
                          )} 100%)`,
                      border: `1px solid ${alpha(
                        theme.palette.common.white,
                        isDarkMode ? 0.09 : 0.18
                      )}`,
                      borderRadius: '16px',
                      boxShadow: `0 12px 28px ${alpha(
                        '#000000',
                        isDarkMode ? 0.26 : 0.1
                      )}, inset 0 1px 0 ${alpha('#FFFFFF', isDarkMode ? 0.05 : 0.6)}`,
                      minHeight: '74px',
                      px: 2,
                      py: 1.45,
                      position: 'relative',
                      '&::before': {
                        background: theme.palette.mode === 'dark'
                          ? `linear-gradient(135deg, ${alpha('#FFFFFF', 0.028)} 0%, ${alpha(
                              '#FFFFFF',
                              0
                            )} 60%)`
                          : `linear-gradient(135deg, ${alpha('#FFFFFF', 0.42)} 0%, ${alpha(
                              '#FFFFFF',
                              0
                            )} 58%)`,
                        borderRadius: 'inherit',
                        content: '""',
                        inset: '1px',
                        pointerEvents: 'none',
                        position: 'absolute',
                      },
                    }}
                  >
                    <Typography
                      sx={{
                        color: alpha('#F6F8FF', 0.98),
                        display: '-webkit-box',
                        fontSize: '0.95rem',
                        fontWeight: 700,
                        letterSpacing: '-0.014em',
                        lineHeight: 1.34,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        WebkitBoxOrient: 'vertical',
                        WebkitLineClamp: 3,
                        wordBreak: 'break-word',
                      }}
                    >
                      {qortinoDonationOverlayMessage}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </motion.div>
          </Box>
        </Portal>
      ) : null}
    </AnimatePresence>
  );
  const qortinoSandboxCurrentPreset =
    QORTINO_SANDBOX_PRESET_BY_KEY[qortinoSandboxPresetKey];
  const qortinoSandboxPreviewSection = renderQortinoCompanionPreviewSection({
    displayedMessage: qortinoSandboxDisplayedMessage,
    isTickled: isQortinoSandboxTickled,
    isListening: qortinoSandboxIsListening,
    isTalking: Boolean(qortinoSandboxDisplayedMessage),
    messageKey: qortinoSandboxMotionKey,
    mood: qortinoSandboxMood,
    onMascotPointerDown: handleQortinoSandboxPointerDown,
    onMascotPointerRelease: handleQortinoSandboxPointerRelease,
    statusLabel: qortinoSandboxEffectiveStatusLabel,
  });
  const qortinoSandboxWorkspaceSection = (
    <Box
      sx={{
        background: workspaceBayBackground,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.15,
        justifyContent: 'center',
        minHeight: 0,
        px: 2,
        py: 1.35,
        position: 'relative',
        zIndex: 1,
        '&::after': {
          background: alpha(theme.palette.common.white, 0.05),
          bottom: 0,
          content: '""',
          height: '1px',
          left: '18px',
          position: 'absolute',
          right: '18px',
        },
      }}
    >
      <Box
        sx={{
          alignItems: 'baseline',
          display: 'flex',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Typography
          sx={{
            color: workspaceLabelColor,
            fontSize: '0.66rem',
            fontWeight: 700,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
          }}
        >
          QORTINO Sandbox
        </Typography>
        <Typography
          sx={{
            color: alpha(theme.palette.text.secondary, 0.52),
            fontSize: '0.62rem',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {qortinoSandboxCurrentPreset.statusLabel}
        </Typography>
      </Box>
      <Box
        sx={{
          alignItems: 'center',
          background:
            theme.palette.mode === 'dark'
              ? `linear-gradient(180deg, ${alpha('#141922', 0.72)} 0%, ${alpha(
                  '#10151D',
                  0.82
                )} 100%)`
              : `linear-gradient(180deg, ${alpha('#FFFFFF', 0.62)} 0%, ${alpha(
                  '#F2F5FA',
                  0.88
                )} 100%)`,
          border: `1px solid ${alpha(
            theme.palette.common.white,
            isDarkMode ? 0.06 : 0.14
          )}`,
          borderRadius: '14px',
          display: 'flex',
          flex: 1,
          justifyContent: 'center',
          minHeight: 0,
          px: 1.4,
          py: 1.6,
          textAlign: 'center',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.7,
            maxWidth: '27ch',
          }}
        >
          <Typography
            sx={{
              color: alpha(theme.palette.text.primary, 0.9),
              fontSize: '0.8rem',
              fontWeight: 700,
              letterSpacing: '-0.015em',
            }}
          >
            {qortinoSandboxCurrentPreset.description}
          </Typography>
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.72),
              fontSize: '0.67rem',
              lineHeight: 1.45,
            }}
          >
            This isolated lab mirrors QORTINO’s live geometry, bubble, and status
            behavior without touching onboarding, music, or hotkeys.
          </Typography>
        </Box>
      </Box>
    </Box>
  );

  return (
    <>
      <Box
        ref={panelRef}
        sx={{
          ...dashboardPanelSx(theme, 'base'),
          borderRadius: '18px',
          containerName: 'qortino-card',
          containerType: 'inline-size',
          display: 'grid',
          gridTemplateRows: `${workspaceBayHeightPx}px minmax(0, 1fr)`,
          height: '100%',
          overflow: 'hidden',
          position: 'relative',
          width: '100%',
        }}
        onMouseMove={handleDashboardPanelPointerMove}
        onMouseLeave={handleDashboardPanelPointerLeave}
      >
        <ErrorBoundary
          fallback={
            <QortinoSectionRuntimeFallback
              body="QORTINO below is still safe. Refresh the Hub and if this keeps happening we will trace the exact crash from here."
              theme={theme}
              title="Workspace bay hit a runtime snag."
              variant="workspace"
            />
          }
        >
          {workspaceBaySection}
        </ErrorBoundary>

        <ErrorBoundary
          fallback={
            <QortinoSectionRuntimeFallback
              body="The workspace bay above is still safe. Refresh the Hub and if this keeps happening we will trace the exact crash from here."
              theme={theme}
              title="QORTINO hit a runtime snag."
              variant="qortino"
            />
          }
        >
          {qortinoCompanionSection}
        </ErrorBoundary>
      </Box>
      {qortinoDonationOverlay}
      <Dialog
        open={openQortinoSandboxDialog}
        onClose={() => setOpenQortinoSandboxDialog(false)}
        BackdropProps={{
          sx: {
            backdropFilter: 'blur(10px)',
            background: alpha('#04070C', 0.42),
          },
        }}
        PaperProps={{
          sx: {
            background:
              theme.palette.mode === 'dark'
                ? 'linear-gradient(180deg, rgba(27,31,38,0.98) 0%, rgba(20,24,30,0.99) 100%)'
                : 'linear-gradient(180deg, rgba(250,252,255,0.98) 0%, rgba(239,244,250,0.99) 100%)',
            border: `1px solid ${alpha(
              theme.palette.common.white,
              isDarkMode ? 0.08 : 0.18
            )}`,
            borderRadius: '24px',
            boxShadow: `0 28px 70px ${alpha('#000', 0.32)}`,
            maxWidth: '1040px',
            overflow: 'hidden',
            width: 'min(1040px, calc(100vw - 28px))',
          },
        }}
      >
        <DialogTitle
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            pb: 1.2,
            pt: 1.7,
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2 }}>
            <Typography
              sx={{
                color: alpha(theme.palette.text.primary, 0.96),
                fontSize: '1.02rem',
                fontWeight: 700,
                letterSpacing: '-0.02em',
              }}
            >
              QORTINO Sandbox
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.72),
                fontSize: '0.72rem',
                lineHeight: 1.45,
              }}
            >
              Cycle the live presets, edit the bubble, and replay the preview without
              disturbing dashboard systems.
            </Typography>
          </Box>
          <IconButton
            onClick={() => setOpenQortinoSandboxDialog(false)}
            size="small"
            sx={{
              borderRadius: '10px',
              color: alpha(theme.palette.text.secondary, 0.82),
              height: '32px',
              width: '32px',
            }}
          >
            <CloseRoundedIcon sx={{ fontSize: '18px' }} />
          </IconButton>
        </DialogTitle>
        <DialogContent
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2.1,
            pb: 2.4,
          }}
        >
          <Box
            sx={{
              display: 'grid',
              gap: 2.1,
              gridTemplateColumns: {
                xs: '1fr',
                lg: 'minmax(0, 396px) minmax(0, 1fr)',
              },
              minWidth: 0,
            }}
          >
            <Box
              sx={{
                height: '508px',
                justifySelf: 'center',
                maxWidth: '396px',
                minWidth: 0,
                width: '100%',
              }}
            >
              <Box
                sx={{
                  ...dashboardPanelSx(theme, 'base'),
                  borderRadius: '18px',
                  containerName: 'qortino-card',
                  containerType: 'inline-size',
                  display: 'grid',
                  gridTemplateRows: `${workspaceBayHeightPx}px minmax(0, 1fr)`,
                  height: '100%',
                  overflow: 'hidden',
                  position: 'relative',
                  width: '100%',
                }}
              >
                {qortinoSandboxWorkspaceSection}
                {qortinoSandboxPreviewSection}
              </Box>
            </Box>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1.45,
                minWidth: 0,
              }}
            >
              <Box
                sx={{
                  display: 'grid',
                  gap: '10px',
                  gridTemplateColumns: {
                    xs: 'repeat(2, minmax(0, 1fr))',
                    sm: 'repeat(3, minmax(0, 1fr))',
                  },
                }}
              >
                {QORTINO_SANDBOX_PRESETS.map((preset) => {
                  const isActive = preset.key === qortinoSandboxPresetKey;
                  return (
                    <ButtonBase
                      key={preset.key}
                      onClick={() => applyQortinoSandboxPreset(preset.key)}
                      sx={{
                        alignItems: 'flex-start',
                        background: isActive
                          ? `linear-gradient(180deg, ${alpha('#9FC4FF', 0.18)} 0%, ${alpha(
                              '#8DB8FF',
                              0.1
                            )} 100%)`
                          : alpha(theme.palette.common.white, isDarkMode ? 0.02 : 0.32),
                        border: `1px solid ${alpha(
                          '#8DB8FF',
                          isActive ? 0.26 : 0.08
                        )}`,
                        borderRadius: '14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.42,
                        minHeight: '66px',
                        px: 1.1,
                        py: 0.95,
                        textAlign: 'left',
                        transition: 'background 140ms ease, border-color 140ms ease',
                        '&:hover': {
                          background: `linear-gradient(180deg, ${alpha(
                            '#9FC4FF',
                            0.14
                          )} 0%, ${alpha('#8DB8FF', 0.07)} 100%)`,
                        },
                      }}
                    >
                      <Typography
                        sx={{
                          color: alpha(theme.palette.text.primary, 0.94),
                          fontSize: '0.76rem',
                          fontWeight: 700,
                          letterSpacing: '-0.01em',
                        }}
                      >
                        {preset.statusLabel}
                      </Typography>
                      <Typography
                        sx={{
                          color: alpha(theme.palette.text.secondary, 0.72),
                          fontSize: '0.63rem',
                          lineHeight: 1.4,
                        }}
                      >
                        {preset.description}
                      </Typography>
                    </ButtonBase>
                  );
                })}
              </Box>
              <Box
                sx={{
                  display: 'grid',
                  gap: '10px',
                  gridTemplateColumns: {
                    xs: 'repeat(2, minmax(0, 1fr))',
                    sm: 'repeat(4, minmax(0, 1fr))',
                  },
                }}
              >
                <Button
                  onClick={() => handleCycleQortinoSandboxPreset('previous')}
                  sx={{
                    ...getBlueTier1ButtonSx(theme),
                    minHeight: '42px',
                  }}
                >
                  Previous
                </Button>
                <Button
                  onClick={() => handleCycleQortinoSandboxPreset('next')}
                  sx={{
                    ...getBlueTier1ButtonSx(theme),
                    minHeight: '42px',
                  }}
                >
                  Next
                </Button>
                <Button
                  onClick={() =>
                    setQortinoSandboxPreviewNonce((current) => current + 1)
                  }
                  sx={{
                    ...getBlueTier1ButtonSx(theme),
                    minHeight: '42px',
                  }}
                >
                  Replay
                </Button>
                <Button
                  onClick={handleResetQortinoSandbox}
                  sx={{
                    ...getBlueTier1ButtonSx(theme),
                    minHeight: '42px',
                  }}
                >
                  Reset
                </Button>
              </Box>
              <TextField
                fullWidth
                label="Status tag"
                value={qortinoSandboxStatusLabel}
                onChange={(event) => setQortinoSandboxStatusLabel(event.target.value)}
                variant="outlined"
                sx={{
                  '& .MuiInputBase-root': {
                    background: alpha(theme.palette.common.white, isDarkMode ? 0.025 : 0.54),
                    borderRadius: '14px',
                  },
                }}
              />
              <TextField
                fullWidth
                label="Bubble copy"
                multiline
                minRows={4}
                value={qortinoSandboxBubbleMessage}
                onChange={(event) => setQortinoSandboxBubbleMessage(event.target.value)}
                variant="outlined"
                sx={{
                  '& .MuiInputBase-root': {
                    alignItems: 'flex-start',
                    background: alpha(theme.palette.common.white, isDarkMode ? 0.025 : 0.54),
                    borderRadius: '16px',
                  },
                }}
              />
              <Typography
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.72),
                  fontSize: '0.69rem',
                  lineHeight: 1.55,
                }}
              >
                Bubble text and status edits stay local to this modal. The live card keeps
                using onboarding, hotkey, and music logic untouched.
              </Typography>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
      <Dialog
        open={openModulePickerDialog}
        onClose={() => setOpenModulePickerDialog(false)}
        BackdropProps={{
          sx: {
            backdropFilter: 'blur(10px)',
            background: alpha('#04070C', 0.42),
          },
        }}
        PaperProps={{
          sx: {
            background:
              theme.palette.mode === 'dark'
                ? 'linear-gradient(180deg, rgba(26,30,37,0.96) 0%, rgba(18,21,27,0.98) 100%)'
                : 'linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(246,248,251,0.98) 100%)',
            border: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.08 : 0.16)}`,
            borderRadius: '18px',
            boxShadow: `0 26px 60px ${alpha('#000', 0.34)}`,
            maxWidth: '420px',
            width: 'calc(100% - 32px)',
          },
        }}
      >
        <DialogTitle
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            pb: 1,
          }}
        >
          <Box>
            <Typography sx={{ fontSize: '1rem', fontWeight: 700 }}>
              Choose a module
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.78),
                fontSize: '0.76rem',
                mt: 0.3,
              }}
            >
              Pick what lives above QORTINO.
            </Typography>
          </Box>
          <IconButton onClick={() => setOpenModulePickerDialog(false)} size="small">
            <CloseRoundedIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 0.8, pb: 2.1 }}>
          {WORKSPACE_MODULES.map((module) => (
            <ButtonBase
              key={module.key}
              onClick={() => {
                if (module.appName) {
                  setOpenModulePickerDialog(false);
                  window.setTimeout(() => {
                    openApp(module.appName as string, module.appPath ?? '');
                  }, 0);
                  return;
                }
                if (module.mode === 'hotkeys') {
                  handleOpenHotkeyPicker(firstEmptyHotkeySlot >= 0 ? firstEmptyHotkeySlot : 0);
                  return;
                }
                if (module.mode) {
                  handleSelectWorkspaceMode(module.mode);
                }
              }}
              sx={{
                alignItems: 'center',
                background:
                  theme.palette.mode === 'dark'
                    ? 'rgba(255,255,255,0.03)'
                    : 'rgba(20,24,32,0.03)',
                border: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.06 : 0.12)}`,
                borderRadius: '14px',
                display: 'grid',
                gap: '12px',
                gridTemplateColumns: '40px minmax(0, 1fr)',
                px: 1,
                py: 0.95,
                textAlign: 'left',
                transition: 'transform 120ms ease, border-color 140ms ease, box-shadow 140ms ease',
                '&:hover': {
                  borderColor: alpha('#8DB8FF', 0.24),
                  boxShadow: `0 8px 20px ${alpha('#000', 0.16)}`,
                  transform: 'translateY(-1px)',
                },
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  background: alpha('#8DB8FF', 0.12),
                  borderRadius: '12px',
                  color: alpha('#A8CAFF', 0.96),
                  display: 'flex',
                  height: '40px',
                  justifyContent: 'center',
                  width: '40px',
                }}
              >
                <module.icon sx={{ fontSize: '19px' }} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.82rem', fontWeight: 700 }}>
                  {module.label}
                </Typography>
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.7),
                    fontSize: '0.68rem',
                    lineHeight: 1.4,
                    mt: 0.2,
                  }}
                >
                  {module.description}
                </Typography>
              </Box>
            </ButtonBase>
          ))}
        </DialogContent>
      </Dialog>

      <Dialog
        open={openHotkeyPickerDialog}
        onClose={() => setOpenHotkeyPickerDialog(false)}
        BackdropProps={{
          sx: {
            backdropFilter: 'blur(10px)',
            background: alpha('#04070C', 0.42),
          },
        }}
        PaperProps={{
          sx: {
            background:
              theme.palette.mode === 'dark'
                ? 'linear-gradient(180deg, rgba(26,30,37,0.96) 0%, rgba(18,21,27,0.98) 100%)'
                : 'linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(246,248,251,0.98) 100%)',
            border: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.08 : 0.16)}`,
            borderRadius: '18px',
            boxShadow: `0 26px 60px ${alpha('#000', 0.34)}`,
            maxHeight: 'min(90vh, 946px)',
            maxWidth: '568px',
            width: 'calc(100% - 32px)',
          },
        }}
      >
        <DialogTitle
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            pb: 1,
          }}
        >
          <Box>
            <Typography sx={{ fontSize: '1rem', fontWeight: 700 }}>
              Select hotkeys
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.78),
                fontSize: '0.76rem',
                mt: 0.3,
              }}
            >
              Saved automatically for this account.
            </Typography>
          </Box>
          <IconButton onClick={() => setOpenHotkeyPickerDialog(false)} size="small">
            <CloseRoundedIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1.1,
            minHeight: 0,
            overflow: 'hidden',
            pb: 2.1,
          }}
        >
          <Box
            sx={{
              alignSelf: 'center',
              display: 'grid',
              gap: '8px',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              maxWidth: '348px',
              px: '8px',
              width: '100%',
            }}
          >
            {workspaceState.hotkeys.map((appName, index) => {
              const app = appName ? resolveHotkeyApp(appName) : null;
              const isActive = selectedHotkeySlot === index;

              return (
                <ButtonBase
                  key={`picker-slot-${index}`}
                  onClick={() => setSelectedHotkeySlot(index)}
                  sx={{
                    alignItems: 'center',
                    background:
                      theme.palette.mode === 'dark'
                        ? alpha('#1D222A', isActive ? 0.96 : 0.76)
                        : alpha('#F4F7FB', isActive ? 0.98 : 0.88),
                    border: `1px solid ${alpha(
                      isActive ? '#8DB8FF' : theme.palette.common.white,
                      isDarkMode ? (isActive ? 0.26 : 0.06) : 0.14
                    )}`,
                    borderRadius: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.5,
                    minHeight: 0,
                    px: 0.55,
                    py: 0.55,
                    aspectRatio: '1 / 1',
                    position: 'relative',
                  }}
                >
                  {app ? (
                    <ButtonBase
                      aria-label={`Clear Slot ${index + 1}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleClearHotkey(index);
                      }}
                      sx={{
                        alignItems: 'center',
                        color: alpha(theme.palette.text.secondary, 0.68),
                        display: 'inline-flex',
                        height: '16px',
                        justifyContent: 'center',
                        position: 'absolute',
                        right: '6px',
                        top: '6px',
                        transition: 'color 140ms ease, text-shadow 140ms ease',
                        width: '16px',
                        '&:hover': {
                          color: curatedAccentBlue,
                          textShadow: `0 0 8px ${alpha(
                            GROUP_ACTIVITY_BLUE.primary,
                            isDarkMode ? 0.18 : 0.1
                          )}`,
                        },
                      }}
                    >
                      <CloseRoundedIcon sx={{ fontSize: '12px' }} />
                    </ButtonBase>
                  ) : null}
                  {app ? (
                    <>
                      <HotkeyAppAvatar appName={app.appName} radius={11} size={28} />
                      <Typography
                        sx={{
                          display: '-webkit-box',
                          fontSize: '0.56rem',
                          fontWeight: 700,
                          lineHeight: 1.12,
                          overflow: 'hidden',
                          textAlign: 'center',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: 2,
                        }}
                      >
                        {app.label}
                      </Typography>
                    </>
                  ) : (
                    <>
                      <AddRoundedIcon
                        sx={{
                          color: alpha(theme.palette.text.secondary, 0.58),
                          fontSize: '17px',
                        }}
                      />
                      <Typography
                        sx={{
                          color: alpha(theme.palette.text.secondary, 0.72),
                          fontSize: '0.54rem',
                          fontWeight: 600,
                        }}
                      >
                        Slot {index + 1}
                      </Typography>
                    </>
                  )}
                </ButtonBase>
              );
            })}
          </Box>

          <Box
            component="input"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setHotkeySearchQuery(event.target.value)
            }
            placeholder="Search Q-Apps"
            sx={{
              appearance: 'none',
              background:
                theme.palette.mode === 'dark'
                  ? 'rgba(255,255,255,0.035)'
                  : 'rgba(12,20,32,0.045)',
              border: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.06 : 0.12)}`,
              borderRadius: '12px',
              color: theme.palette.text.primary,
              font: 'inherit',
              fontSize: '0.82rem',
              outline: 'none',
              px: 1.25,
              py: 0.9,
              '&::placeholder': {
                color: alpha(theme.palette.text.secondary, 0.64),
              },
            }}
            value={hotkeySearchQuery}
          />

          <Box
            sx={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              gap: 0.9,
              minHeight: 0,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                flex: 1,
                flexDirection: 'column',
                gap: 0.7,
                minHeight: 0,
                overflowY: 'auto',
                pr: 0.2,
              }}
            >
              {featuredHotkeyCatalog.length > 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.55 }}>
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.74),
                      fontSize: '0.64rem',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Recommended
                  </Typography>
                  {featuredHotkeyCatalog.map((app) => (
                    <ButtonBase
                      key={`featured-${app.service}-${app.appName}`}
                      onClick={() =>
                        handleSetHotkey(
                          encodeHotkeySlotValue(app.service, app.appName)
                        )
                      }
                      sx={{
                        alignItems: 'center',
                        background: `linear-gradient(180deg, ${alpha('#8DB8FF', 0.18)} 0%, ${alpha(
                          '#6EA7FF',
                          0.08
                        )} 100%)`,
                        border: `1px solid ${alpha('#8DB8FF', 0.16)}`,
                        borderRadius: '14px',
                        display: 'grid',
                        gap: '12px',
                        gridTemplateColumns: '40px minmax(0, 1fr) auto',
                        px: 0.95,
                        py: 0.82,
                        position: 'relative',
                        textAlign: 'left',
                        '&:hover': {
                          background: `linear-gradient(180deg, ${alpha('#8DB8FF', 0.26)} 0%, ${alpha(
                            '#6EA7FF',
                            0.12
                          )} 100%)`,
                        },
                      }}
                    >
                      <Typography
                        sx={{
                          color: curatedAccentBlue,
                          fontSize: '0.44rem',
                          fontWeight: 700,
                          letterSpacing: '0.035em',
                          lineHeight: 1,
                          position: 'absolute',
                          right: '10px',
                          textTransform: 'uppercase',
                          top: '9px',
                        }}
                      >
                        <Box component="span" sx={{ color: alpha(theme.palette.text.secondary, 0.62) }}>
                          [
                        </Box>{' '}
                        CURATED{' '}
                        <Box component="span" sx={{ color: alpha(theme.palette.text.secondary, 0.62) }}>
                          ]
                        </Box>
                      </Typography>
                      <Box
                        sx={{
                          alignItems: 'center',
                          background: alpha('#8DB8FF', 0.12),
                          borderRadius: '12px',
                          color: alpha('#A8CAFF', 0.96),
                          display: 'flex',
                          height: '40px',
                          justifyContent: 'center',
                          width: '40px',
                        }}
                      >
                        <HotkeyAppAvatar appName={app.appName} radius={12} size={40} />
                      </Box>
                      <Box sx={{ minWidth: 0, pr: 9 }}>
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700 }}>
                          {app.label}
                        </Typography>
                        <Typography
                          sx={{
                            color: alpha(theme.palette.text.secondary, 0.68),
                            fontSize: '0.64rem',
                            mt: 0.18,
                          }}
                        >
                          {app.description || app.appName}
                        </Typography>
                      </Box>
                      <ChevronRightRoundedIcon
                        sx={{
                          color: alpha('#8DB8FF', 0.84),
                          fontSize: '18px',
                        }}
                      />
                    </ButtonBase>
                  ))}
                </Box>
              )}

              {featuredHotkeyCatalog.length > 0 && libraryHotkeyCatalog.length > 0 ? (
                <Box
                  sx={{
                    background: alpha(theme.palette.common.white, isDarkMode ? 0.06 : 0.12),
                    height: '1px',
                    my: 0.1,
                    width: '100%',
                  }}
                />
              ) : null}

              {libraryHotkeyCatalog.map((app) => (
                <ButtonBase
                  key={`${app.service}-${app.appName}`}
                  onClick={() =>
                    handleSetHotkey(
                      encodeHotkeySlotValue(app.service, app.appName)
                    )
                  }
                  sx={{
                    alignItems: 'center',
                    background:
                      theme.palette.mode === 'dark'
                        ? 'rgba(255,255,255,0.03)'
                        : 'rgba(20,24,32,0.03)',
                    border: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.06 : 0.12)}`,
                    borderRadius: '14px',
                    display: 'grid',
                    gap: '12px',
                    gridTemplateColumns: '40px minmax(0, 1fr) auto',
                    px: 0.95,
                    py: 0.82,
                    textAlign: 'left',
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      background: alpha('#8DB8FF', 0.12),
                      borderRadius: '12px',
                      color: alpha('#A8CAFF', 0.96),
                      display: 'flex',
                      height: '40px',
                      justifyContent: 'center',
                      width: '40px',
                    }}
                  >
                    <HotkeyAppAvatar appName={app.appName} radius={12} size={40} />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 700 }}>
                      {app.label}
                    </Typography>
                    <Typography
                      sx={{
                        color: alpha(theme.palette.text.secondary, 0.68),
                        fontSize: '0.64rem',
                        mt: 0.18,
                      }}
                    >
                      {app.description || app.appName}
                    </Typography>
                  </Box>
                  <ChevronRightRoundedIcon
                    sx={{
                      color: alpha('#8DB8FF', 0.84),
                      fontSize: '18px',
                    }}
                  />
                </ButtonBase>
              ))}
            </Box>

            {filteredHotkeyCatalog.length === 0 && (
              <Box
                sx={{
                  alignItems: 'center',
                  border: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.06 : 0.12)}`,
                  borderRadius: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.35,
                  justifyContent: 'center',
                  minHeight: '84px',
                  px: 1.2,
                  py: 1,
                  textAlign: 'center',
                }}
              >
                {isHotkeyAppsLoading ? (
                  <>
                    <CircularProgress size={18} thickness={4} />
                    <Typography
                      sx={{
                        color: alpha(theme.palette.text.secondary, 0.68),
                        fontSize: '0.64rem',
                        lineHeight: 1.4,
                      }}
                    >
                      Loading Q-Apps library...
                    </Typography>
                  </>
                ) : (
                  <>
                    <Typography
                      sx={{
                        color: alpha(theme.palette.text.primary, 0.88),
                        fontSize: '0.76rem',
                        fontWeight: 700,
                      }}
                    >
                      {hotkeyAppsError ? 'Q-Apps unavailable' : 'No Q-Apps match yet'}
                    </Typography>
                    <Typography
                      sx={{
                        color: alpha(theme.palette.text.secondary, 0.68),
                        fontSize: '0.64rem',
                        lineHeight: 1.4,
                        maxWidth: '28ch',
                      }}
                    >
                      {hotkeyAppsError ||
                        'Try another app name to wire a shortcut into the selected slot.'}
                    </Typography>
                  </>
                )}
              </Box>
            )}
          </Box>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openMusicSearchDialog}
        onClose={() => setOpenMusicSearchDialog(false)}
        BackdropProps={{
          sx: {
            backdropFilter: 'blur(10px)',
            background: alpha('#04070C', 0.42),
          },
        }}
        PaperProps={{
          sx: {
            background:
              theme.palette.mode === 'dark'
                ? 'linear-gradient(180deg, rgba(26,30,37,0.96) 0%, rgba(18,21,27,0.98) 100%)'
                : 'linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(246,248,251,0.98) 100%)',
            border: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.08 : 0.16)}`,
            borderRadius: '18px',
            boxShadow: `0 26px 60px ${alpha('#000', 0.34)}`,
            maxWidth: '480px',
            width: 'calc(100% - 32px)',
          },
        }}
      >
        <DialogTitle
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            pb: 1,
          }}
        >
          <Box>
            <Typography sx={{ fontSize: '1rem', fontWeight: 700 }}>
              Search Earbump
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.78),
                fontSize: '0.76rem',
                mt: 0.3,
              }}
            >
              Find a track, press play, and drop it into the player above.
            </Typography>
          </Box>
          <IconButton onClick={() => setOpenMusicSearchDialog(false)} size="small">
            <CloseRoundedIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, pb: 2.1 }}>
          <Box
            component="input"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              applyWorkspaceState((current) => ({
                ...current,
                musicQuery: event.target.value,
              }))
            }
            placeholder="Search tracks or artists"
            sx={{
              appearance: 'none',
              background:
                theme.palette.mode === 'dark'
                  ? 'rgba(255,255,255,0.035)'
                  : 'rgba(12,20,32,0.045)',
              border: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.06 : 0.12)}`,
              borderRadius: '12px',
              color: theme.palette.text.primary,
              font: 'inherit',
              fontSize: '0.82rem',
              outline: 'none',
              px: 1.25,
              py: 0.9,
              '&::placeholder': {
                color: alpha(theme.palette.text.secondary, 0.64),
              },
            }}
            value={workspaceState.musicQuery}
          />

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.68),
                fontSize: '0.66rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {workspaceState.musicQuery.trim() ? 'Results' : 'Discovery'}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.55 }}>
              {isMusicBrowserLoading ? (
                <Box
                  sx={{
                    alignItems: 'center',
                    border: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.06 : 0.12)}`,
                    borderRadius: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.8,
                    justifyContent: 'center',
                    minHeight: '96px',
                    px: 1.2,
                    py: 1,
                    textAlign: 'center',
                  }}
                >
                  <CircularProgress size={20} thickness={4.2} />
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.74),
                      fontSize: '0.68rem',
                      fontWeight: 600,
                    }}
                  >
                    {musicSearchQuery
                      ? 'Searching the EarBump library...'
                      : 'Loading EarBump discovery...'}
                  </Typography>
                </Box>
              ) : null}
              {!isMusicBrowserLoading && musicBrowserError ? (
                <Box
                  sx={{
                    alignItems: 'center',
                    border: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.06 : 0.12)}`,
                    borderRadius: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.35,
                    justifyContent: 'center',
                    minHeight: '88px',
                    px: 1.2,
                    py: 1,
                    textAlign: 'center',
                  }}
                >
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.primary, 0.88),
                      fontSize: '0.78rem',
                      fontWeight: 700,
                    }}
                  >
                    EarBump is quiet right now
                  </Typography>
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.68),
                      fontSize: '0.64rem',
                      lineHeight: 1.4,
                      maxWidth: '30ch',
                    }}
                  >
                    {musicBrowserError}
                  </Typography>
                </Box>
              ) : null}
              {!isMusicBrowserLoading && !musicBrowserError
                ? browserTracks.map((track) => (
                <ButtonBase
                  key={track.id}
                  onClick={() => handleSelectTrackFromBrowser(track.id)}
                  sx={{
                    alignItems: 'center',
                    background:
                      theme.palette.mode === 'dark'
                        ? 'rgba(255,255,255,0.03)'
                        : 'rgba(20,24,32,0.03)',
                    border: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.06 : 0.12)}`,
                    borderRadius: '14px',
                    display: 'grid',
                    gap: '12px',
                    gridTemplateColumns: '42px minmax(0, 1fr) auto auto',
                    px: 0.85,
                    py: 0.75,
                    textAlign: 'left',
                  }}
                >
                  <MusicCoverArt size={42} track={track} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      sx={{
                        color: alpha(theme.palette.text.primary, 0.9),
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {track.title}
                    </Typography>
                    <Typography
                      sx={{
                        color: alpha(theme.palette.text.secondary, 0.72),
                        fontSize: '0.64rem',
                        mt: 0.2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {track.artist} â€¢ {track.uploaded}
                    </Typography>
                  </Box>
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.68),
                      fontSize: '0.62rem',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {track.length}
                  </Typography>
                  <Box
                    sx={{
                      alignItems: 'center',
                      background: alpha('#8DB8FF', 0.12),
                      borderRadius: '10px',
                      color: alpha('#A9C9FF', 0.95),
                      display: 'flex',
                      height: '30px',
                      justifyContent: 'center',
                      width: '30px',
                    }}
                  >
                    <PlayArrowRoundedIcon sx={{ fontSize: '18px' }} />
                  </Box>
                </ButtonBase>
              ))
                : null}
              {!isMusicBrowserLoading &&
              !musicBrowserError &&
              browserTracks.length === 0 ? (
                <Box
                  sx={{
                    alignItems: 'center',
                    border: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.06 : 0.12)}`,
                    borderRadius: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.35,
                    justifyContent: 'center',
                    minHeight: '88px',
                    px: 1.2,
                    py: 1,
                    textAlign: 'center',
                  }}
                >
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.primary, 0.88),
                      fontSize: '0.78rem',
                      fontWeight: 700,
                    }}
                  >
                    No tracks surfaced
                  </Typography>
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.68),
                      fontSize: '0.64rem',
                      lineHeight: 1.4,
                      maxWidth: '28ch',
                    }}
                  >
                    Try another title or artist to pull something into the player.
                  </Typography>
                </Box>
              ) : null}
            </Box>
          </Box>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openQortsDialog}
        onClose={() => setOpenQortsDialog(false)}
        PaperProps={{
          sx: {
            background:
              theme.palette.mode === 'dark'
                ? 'linear-gradient(180deg, rgba(26,30,37,0.96) 0%, rgba(18,21,27,0.98) 100%)'
                : 'linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(246,248,251,0.98) 100%)',
            border: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.08 : 0.16)}`,
            borderRadius: '18px',
            boxShadow: `0 26px 60px ${alpha('#000', 0.34)}`,
            maxWidth: '460px',
            width: 'calc(100% - 32px)',
          },
        }}
      >
        <DialogTitle
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            pb: 1,
          }}
        >
          <Box>
            <Typography sx={{ fontSize: '1rem', fontWeight: 700 }}>
              {t('tutorial:home.get_six_qorts', 'Get 6 QORT')}
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.78),
                fontSize: '0.76rem',
                mt: 0.3,
              }}
            >
              {t(
                'tutorial:home.get_six_qorts_intro',
                'There are 3 ways to get your first 6 QORT:'
              )}
            </Typography>
          </Box>
          <IconButton onClick={() => setOpenQortsDialog(false)} size="small">
            <CloseRoundedIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, pb: 2.1 }}>
          <QortOptionRow
            icon={SchoolRoundedIcon}
            label={t(
              'tutorial:home.get_six_qorts_way1',
              'Finish the onboarding instruction on qortal.dev'
            )}
            onClick={() => openExternalUrl(ONBOARDING_URL)}
            actionLabel={t(
              'tutorial:home.get_six_qorts_way1_action',
              'Go to onboarding'
            )}
            theme={theme}
          />
          <QortOptionRow
            icon={SupportAgentRoundedIcon}
            label={t(
              'tutorial:home.get_six_qorts_way2',
              'Ask in the Nextcloud support chat for 6 QORT.'
            )}
            onClick={() => openExternalUrl(SUPPORT_CHAT_URL)}
            actionLabel={t(
              'tutorial:home.get_six_qorts_way2_action',
              'Open support chat'
            )}
            theme={theme}
          />
          <QortOptionRow
            icon={ShoppingBagRoundedIcon}
            label={t(
              'tutorial:home.get_six_qorts_way3',
              'Buy QORT using Q-Trade'
            )}
            onClick={() => {
              openApp('Q-Trade');
              setOpenQortsDialog(false);
            }}
            actionLabel={t(
              'tutorial:home.get_six_qorts_way3_action',
              'Open Q-Trade'
            )}
            theme={theme}
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

const GettingStartedMethodRow = ({
  accent = '#8DB8FF',
  description,
  emphasized = false,
  icon: Icon,
  label,
  onClick,
  showChevron = false,
  showDivider = false,
}: {
  accent?: string;
  description: string;
  emphasized?: boolean;
  icon: typeof SchoolRoundedIcon;
  label: string;
  onClick: () => void;
  showChevron?: boolean;
  showDivider?: boolean;
}) => {
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';

  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        alignItems: 'center',
        borderRadius: 0,
        display: 'grid',
        gap: '10px',
        gridTemplateColumns: '22px minmax(0, 1fr) auto',
        minHeight: '56px',
        px: 0,
        py: 0.9,
        position: 'relative',
        textAlign: 'left',
        transition: 'color 140ms ease',
        width: '100%',
        '@container qortino-card (max-width: 390px)': {
          gap: '9px',
          gridTemplateColumns: '20px minmax(0, 1fr) auto',
          minHeight: '52px',
          py: 0.82,
        },
        '&::before': {
          background: `linear-gradient(90deg, ${alpha(
            accent,
            0
          )} 0%, ${alpha(accent, isDarkMode ? 0.032 : 0.028)} 16%, ${alpha(
            accent,
            isDarkMode ? 0.082 : 0.07
          )} 50%, ${alpha(accent, isDarkMode ? 0.032 : 0.028)} 84%, ${alpha(
            accent,
            0
          )} 100%)`,
          borderRadius: '6px',
          content: '""',
          inset: '6px -8px',
          opacity: 0,
          pointerEvents: 'none',
          position: 'absolute',
          transition: 'opacity 150ms ease',
        },
        '&:hover::before, &:focus-visible::before': {
          opacity: 1,
        },
        '&::after': showDivider
          ? {
              background: alpha(
                theme.palette.common.white,
                isDarkMode ? 0.07 : 0.14
              ),
              bottom: 0,
              content: '""',
              height: '1px',
              left: 0,
              position: 'absolute',
              right: 0,
            }
          : undefined,
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          color: alpha(accent, emphasized ? 0.94 : 0.82),
          display: 'flex',
          justifyContent: 'center',
          width: '22px',
          '@container qortino-card (max-width: 390px)': {
            width: '20px',
          },
        }}
      >
        <Icon
          sx={{
            fontSize: emphasized ? '18px' : '17px',
            '@container qortino-card (max-width: 390px)': {
              fontSize: emphasized ? '17px' : '16px',
            },
          }}
        />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        {emphasized ? (
          <Typography
            sx={{
              color: alpha(accent, 0.8),
              fontSize: '0.54rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              lineHeight: 1,
              mb: 0.22,
              textTransform: 'uppercase',
            }}
          >
            Recommended
          </Typography>
        ) : null}
        <Typography
          sx={{
            color: alpha(theme.palette.text.primary, 0.94),
            fontSize: emphasized ? '0.84rem' : '0.8rem',
            fontWeight: emphasized ? 700 : 600,
            letterSpacing: '-0.015em',
            lineHeight: 1.08,
            '@container qortino-card (max-width: 390px)': {
              fontSize: emphasized ? '0.79rem' : '0.75rem',
            },
          }}
        >
          {label}
        </Typography>
        <Typography
          sx={{
            color: alpha(theme.palette.text.secondary, 0.74),
            fontSize: '0.67rem',
            lineHeight: 1.3,
            mt: 0.14,
            '@container qortino-card (max-width: 390px)': {
              fontSize: '0.63rem',
            },
          }}
        >
          {description}
        </Typography>
      </Box>
      {showChevron ? (
        <ChevronRightRoundedIcon
          sx={{
            color: alpha(accent, 0.82),
            fontSize: '18px',
            mr: 0.1,
          }}
        />
      ) : (
        <Box sx={{ width: '18px' }} />
      )}
    </ButtonBase>
  );
};

const GettingStartedPrimaryAction = ({
  accent = '#8DB8FF',
  disabled = false,
  label,
  loading = false,
  onClick,
}: {
  accent?: string;
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onClick: () => void;
}) => {
  const theme = useTheme();

  return (
    <ButtonBase
      disabled={disabled || loading}
      onClick={onClick}
      sx={{
        alignItems: 'center',
        background:
          theme.palette.mode === 'dark'
            ? `linear-gradient(180deg, ${alpha(accent, 0.18)} 0%, ${alpha(
                accent,
                0.11
              )} 100%)`
            : `linear-gradient(180deg, ${alpha(accent, 0.16)} 0%, ${alpha(
                accent,
                0.1
              )} 100%)`,
        border: `1px solid ${alpha(accent, theme.palette.mode === 'dark' ? 0.22 : 0.18)}`,
        borderRadius: '8px',
        boxShadow: `inset 0 1px 0 ${alpha(
          theme.palette.common.white,
          theme.palette.mode === 'dark' ? 0.08 : 0.22
        )}`,
        color: alpha('#FFFFFF', 0.98),
        justifyContent: 'flex-start',
        minHeight: '32px',
        px: 1.1,
        py: 0.5,
        textAlign: 'left',
        transition:
          'transform 120ms ease, filter 140ms ease, background 160ms ease, border-color 160ms ease',
        width: '100%',
        '@container qortino-card (max-width: 390px)': {
          minHeight: '30px',
          px: 0.95,
          py: 0.48,
        },
        '&:hover': {
          borderColor: alpha(accent, theme.palette.mode === 'dark' ? 0.3 : 0.22),
          filter: 'brightness(1.02)',
          transform: 'translateY(-1px)',
        },
        '&.Mui-disabled': {
          opacity: 0.78,
        },
      }}
    >
      <Typography
        sx={{
          color: alpha('#FFFFFF', 0.98),
          fontSize: '0.7rem',
          fontWeight: 600,
          letterSpacing: '0.01em',
          lineHeight: 1.16,
          '@container qortino-card (max-width: 390px)': {
            fontSize: '0.67rem',
          },
        }}
      >
        {loading ? 'Confirming...' : label}
      </Typography>
    </ButtonBase>
  );
};

const GettingStartedSecondaryAction = ({
  accent = '#8DB8FF',
  label,
  onClick,
}: {
  accent?: string;
  label: string;
  onClick: () => void;
}) => {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        alignItems: 'center',
        color: alpha('#C3D8FF', 0.84),
        columnGap: 0.42,
        display: 'inline-flex',
        fontSize: '0.65rem',
        fontWeight: 600,
        justifyContent: 'flex-start',
        minHeight: '20px',
        px: 0.1,
        py: 0.05,
        textAlign: 'left',
        transition: 'color 140ms ease, opacity 120ms ease',
        '@container qortino-card (max-width: 390px)': {
          fontSize: '0.62rem',
        },
        '&:hover': {
          color: alpha('#E0EBFF', 0.98),
        },
      }}
    >
      <Box
        sx={{
          background: alpha(accent, 0.7),
          borderRadius: '999px',
          flexShrink: 0,
          height: '4px',
          width: '4px',
        }}
      />
      <Typography
        sx={{
          color: 'inherit',
          fontSize: 'inherit',
          fontWeight: 'inherit',
          lineHeight: 1.16,
        }}
      >
        {label}
      </Typography>
    </ButtonBase>
  );
};

const smallTransportButtonSx = (theme: ReturnType<typeof useTheme>) => ({
  alignItems: 'center',
  background:
    theme.palette.mode === 'dark'
      ? 'rgba(255,255,255,0.04)'
      : 'rgba(20,24,32,0.045)',
  border: `1px solid ${alpha(
    theme.palette.common.white,
    theme.palette.mode === 'dark' ? 0.06 : 0.12
  )}`,
  borderRadius: '9px',
  color: alpha('#9BC2FF', 0.94),
  display: 'inline-flex',
  height: '24px',
  justifyContent: 'center',
  transition: 'transform 120ms ease, border-color 140ms ease',
  width: '24px',
  '&:hover': {
    borderColor: alpha('#8DB8FF', 0.2),
    transform: 'translateY(-1px)',
  },
});

const QortOptionRow = ({
  actionLabel,
  icon: Icon,
  label,
  onClick,
  theme,
}: {
  actionLabel: string;
  icon: typeof SchoolRoundedIcon;
  label: string;
  onClick: () => void;
  theme: ReturnType<typeof useTheme>;
}) => (
  <Box
    sx={{
      alignItems: 'center',
      display: 'grid',
      gap: 1,
      gridTemplateColumns: 'auto minmax(0, 1fr) auto',
      py: 0.7,
    }}
  >
    <Box
      sx={{
        alignItems: 'center',
        background: alpha('#8DB8FF', 0.14),
        border: `1px solid ${alpha('#8DB8FF', 0.2)}`,
        borderRadius: '12px',
        color: alpha('#B9D3FF', 0.96),
        display: 'flex',
        height: '38px',
        justifyContent: 'center',
        width: '38px',
      }}
    >
      <Icon sx={{ fontSize: '20px' }} />
    </Box>
    <Typography
      sx={{
        color: alpha(theme.palette.text.primary, 0.9),
        fontSize: '0.78rem',
        lineHeight: 1.4,
      }}
    >
      {label}
    </Typography>
    <Button
      onClick={onClick}
      sx={{
        ...getBlueTier1ButtonSx(),
        borderRadius: '10px',
        fontSize: '0.7rem',
        fontWeight: 700,
        px: 1.15,
        py: 0.7,
        textTransform: 'none',
      }}
    >
      {actionLabel}
    </Button>
  </Box>
);
