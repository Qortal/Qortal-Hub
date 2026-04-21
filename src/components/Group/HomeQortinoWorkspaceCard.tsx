import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { motion } from 'framer-motion';
import { useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import DriveFileRenameOutlineRoundedIcon from '@mui/icons-material/DriveFileRenameOutlineRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
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
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import LibraryMusicRoundedIcon from '@mui/icons-material/LibraryMusicRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import SchoolRoundedIcon from '@mui/icons-material/SchoolRounded';
import { balanceAtom, txListAtom, userInfoAtom } from '../../atoms/global';
import { getArbitraryEndpointReact, getBaseApiReact } from '../../App';
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
import {
  APP_BLUE_SURFACE_TEXT,
  getBlueAmbientLineBackground,
  getBlueTier1ButtonSx,
  getBlueTier2BadgeSx,
  getBlueTier3ProgressBackground,
  getBlueTier3StepperState,
} from './groupActivityColorSystem';
import type { GettingStartedDebugOverrides } from './homeGettingStartedDebug';
import { GETTING_STARTED_LS_KEY } from './HomeGettingStarted';

const LS_KEY = GETTING_STARTED_LS_KEY;
const AVATAR_SERVICE = 'THUMBNAIL';
const AVATAR_IDENTIFIER = 'qortal_avatar';
const MIN_BALANCE_FOR_QORTS = 6;
const QORTINO_WORKSPACE_SETTINGS_KEY = 'home-qortino-workspace-v1';
const ONBOARDING_URL = 'https://qortal.dev/onboarding';
const SUPPORT_CHAT_URL = 'https://link.qortal.dev/support';
const QORTINO_MASCOT_BASE_SIZE = 168;
const QORTINO_MASCOT_SCALE = 0.62;
const QORTINO_MASCOT_SIZE = Math.round(
  QORTINO_MASCOT_BASE_SIZE * QORTINO_MASCOT_SCALE
);
const QORTINO_WORKSPACE_BAY_HEIGHT_PX = 238;
const HOTKEY_SLOT_COUNT = 8;

type WorkspaceMode = 'empty' | 'hotkeys' | 'announcements' | 'music';
type StepKey = 'get_six_qorts' | 'register_name' | 'load_avatar';
type HotkeyActionId =
  | 'q-tube'
  | 'quitter'
  | 'q-mail'
  | 'q-blog'
  | 'q-trade'
  | 'q-mintership'
  | 'earbump';

type HotkeySlotValue = HotkeyActionId | null;

type MusicTrack = {
  artist: string;
  coverColors: [string, string, string];
  id: string;
  length: string;
  title: string;
  uploaded: string;
};

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
};

type WorkspaceModuleDefinition = {
  description: string;
  icon: typeof AppsRoundedIcon;
  label: string;
  mode: Exclude<WorkspaceMode, 'empty'>;
};

type HotkeyActionDefinition = {
  description: string;
  icon: typeof VideoLibraryRoundedIcon;
  id: HotkeyActionId;
  label: string;
  reaction: string;
  run: () => void;
};

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
  selectedTrackId: 'midnight-relay',
  version: 1,
};

const MUSIC_TRACKS: MusicTrack[] = [
  {
    artist: 'QORTINO FM',
    coverColors: ['#6EA7FF', '#243B72', '#9CCBFF'],
    id: 'midnight-relay',
    length: '3:18',
    title: 'Midnight Relay',
    uploaded: '10 min ago',
  },
  {
    artist: 'QORTINO FM',
    coverColors: ['#8F6CFF', '#2844A8', '#D9A3FF'],
    id: 'blue-archive',
    length: '4:02',
    title: 'Blue Archive',
    uploaded: '33 min ago',
  },
  {
    artist: 'QORTINO FM',
    coverColors: ['#56D3C9', '#2C59CF', '#8BC3FF'],
    id: 'signal-bloom',
    length: '2:46',
    title: 'Signal Bloom',
    uploaded: '1 hour ago',
  },
];

const ANNOUNCEMENT_ITEMS = [
  {
    label: 'Workspace bay is now configurable after onboarding.',
    time: 'Today',
  },
  {
    label: 'QORTINO reacts to the module you pin above him.',
    time: 'Preview',
  },
  {
    label: 'Music player is wired as the first living widget foundation.',
    time: 'Prototype',
  },
] as const;

const WORKSPACE_MODULES: WorkspaceModuleDefinition[] = [
  {
    description: 'Curated shortcuts for your most-used routes.',
    icon: AppsRoundedIcon,
    label: 'Hotkeys',
    mode: 'hotkeys',
  },
  {
    description: 'Quiet notes and updates inside the bay.',
    icon: CampaignRoundedIcon,
    label: 'Announcements',
    mode: 'announcements',
  },
  {
    description: 'A compact Earbump player with search and quick playback.',
    icon: LibraryMusicRoundedIcon,
    label: 'Music player',
    mode: 'music',
  },
];

const sanitizeWorkspaceState = (value: unknown): WorkspaceState => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_WORKSPACE_STATE };
  }

  const parsed = value as Partial<WorkspaceState>;
  const nextMode: WorkspaceMode =
    parsed.mode === 'hotkeys' ||
    parsed.mode === 'announcements' ||
    parsed.mode === 'music'
      ? parsed.mode
      : 'empty';

  const sanitizedHotkeys = Array.isArray(parsed.hotkeys)
    ? parsed.hotkeys
        .slice(0, HOTKEY_SLOT_COUNT)
        .map((item): HotkeySlotValue =>
          item === 'q-tube' ||
          item === 'quitter' ||
          item === 'q-mail' ||
          item === 'q-blog' ||
          item === 'q-trade' ||
          item === 'q-mintership' ||
          item === 'earbump'
            ? item
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
      typeof parsed.selectedTrackId === 'string' &&
      MUSIC_TRACKS.some((track) => track.id === parsed.selectedTrackId)
        ? parsed.selectedTrackId
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

const openApp = (name: string, path = '') => {
  executeEvent('addTab', { data: { service: 'APP', name, path } });
  executeEvent('open-apps-mode', {});
};

const getFallbackStorageKey = (userAddress: string | undefined) =>
  userAddress
    ? `${QORTINO_WORKSPACE_SETTINGS_KEY}_${userAddress}`
    : QORTINO_WORKSPACE_SETTINGS_KEY;

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
  const fallbackKey = getFallbackStorageKey(userAddress);

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

  try {
    return sanitizeWorkspaceState(localStorage.getItem(fallbackKey) ? JSON.parse(localStorage.getItem(fallbackKey) as string) : null);
  } catch {
    return { ...DEFAULT_WORKSPACE_STATE };
  }
};

const StepProgress = ({
  currentStep,
  isDarkMode,
  totalSteps,
}: {
  currentStep: number;
  isDarkMode: boolean;
  totalSteps: number;
}) => {
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: '8px',
        minWidth: 0,
      }}
    >
      {Array.from({ length: totalSteps }, (_, index) => {
        const stepNumber = index + 1;
        const status =
          currentStep === stepNumber
            ? 'active'
            : currentStep < stepNumber
              ? 'inactive'
              : 'complete';

        return (
          <motion.div
            key={stepNumber}
            initial={false}
            animate={status}
            variants={{
              inactive: getBlueTier3StepperState(isDarkMode, 'inactive'),
              active: getBlueTier3StepperState(isDarkMode, 'active'),
              complete: getBlueTier3StepperState(isDarkMode, 'complete'),
            }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            style={{
              alignItems: 'center',
              borderRadius: 999,
              borderStyle: 'solid',
              borderWidth: 1,
              display: 'flex',
              height: '17px',
              justifyContent: 'center',
              width: '17px',
            }}
          >
            {status === 'active' ? (
              <Box
                sx={{
                  bgcolor: '#ffffff',
                  borderRadius: '50%',
                  height: '5px',
                  width: '5px',
                }}
              />
            ) : status === 'complete' ? (
              <CheckCircleRoundedIcon sx={{ color: '#fff', fontSize: '11px' }} />
            ) : null}
          </motion.div>
        );
      })}
    </Box>
  );
};

const parseTrackDuration = (duration: string) => {
  const [minutes, seconds] = duration.split(':').map((value) => Number(value));
  return minutes * 60 + seconds;
};

const formatPlaybackTime = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const MusicCoverArt = ({
  size,
  track,
}: {
  size: number;
  track: MusicTrack;
}) => (
  <Box
    sx={{
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
      width: `${size}px`,
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

const QortinoHeadphones = ({ isDarkMode }: { isDarkMode: boolean }) => (
  <Box
    aria-hidden
    sx={{
      inset: 0,
      pointerEvents: 'none',
      position: 'absolute',
    }}
  >
    <Box
      sx={{
        border: `5px solid ${alpha('#8DB8FF', isDarkMode ? 0.72 : 0.62)}`,
        borderBottomColor: 'transparent',
        borderLeftColor: alpha('#A6CBFF', isDarkMode ? 0.82 : 0.72),
        borderRadius: '50%',
        borderRightColor: alpha('#A6CBFF', isDarkMode ? 0.82 : 0.72),
        borderTopColor: alpha('#D5E5FF', isDarkMode ? 0.44 : 0.34),
        height: '100px',
        left: '34px',
        position: 'absolute',
        top: '36px',
        width: '100px',
      }}
    />
    <Box
      sx={{
        background: `linear-gradient(180deg, ${alpha('#202A3B', 0.92)} 0%, ${alpha(
          '#101622',
          0.96
        )} 100%)`,
        border: `1px solid ${alpha('#9DC3FF', 0.22)}`,
        borderRadius: '14px',
        boxShadow: `0 10px 18px ${alpha('#000', 0.28)}, inset 0 1px 0 ${alpha(
          '#fff',
          0.08
        )}`,
        height: '29px',
        left: '31px',
        position: 'absolute',
        top: '78px',
        width: '15px',
      }}
    />
    <Box
      sx={{
        background: `linear-gradient(180deg, ${alpha('#202A3B', 0.92)} 0%, ${alpha(
          '#101622',
          0.96
        )} 100%)`,
        border: `1px solid ${alpha('#9DC3FF', 0.22)}`,
        borderRadius: '14px',
        boxShadow: `0 10px 18px ${alpha('#000', 0.28)}, inset 0 1px 0 ${alpha(
          '#fff',
          0.08
        )}`,
        height: '29px',
        position: 'absolute',
        right: '31px',
        top: '78px',
        width: '15px',
      }}
    />
  </Box>
);

const QortinoMascot = ({
  isDarkMode,
  isListening,
  mood,
}: {
  isDarkMode: boolean;
  isListening: boolean;
  mood: 'celebrate' | 'empty' | 'guide' | 'hotkeys' | 'music' | 'notes';
}) => {
  const orbGlow = isListening
    ? alpha('#7FB5FF', isDarkMode ? 0.28 : 0.2)
    : alpha('#7FB5FF', isDarkMode ? 0.18 : 0.12);

  return (
    <Box
      sx={{
        '@keyframes qortinoBob': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        '@keyframes qortinoBlink': {
          '0%, 45%, 100%': { transform: 'scaleY(1)' },
          '48%, 52%': { transform: 'scaleY(0.16)' },
        },
        '@keyframes qortinoPulse': {
          '0%, 100%': { opacity: 0.5, transform: 'scale(0.98)' },
          '50%': { opacity: 1, transform: 'scale(1.04)' },
        },
        height: `${QORTINO_MASCOT_SIZE}px`,
        position: 'relative',
        width: `${QORTINO_MASCOT_SIZE}px`,
      }}
    >
      <Box
        sx={{
          animation: 'qortinoBob 5.8s ease-in-out infinite',
          height: `${QORTINO_MASCOT_BASE_SIZE}px`,
          left: 0,
          position: 'relative',
          top: 0,
          transform: `scale(${QORTINO_MASCOT_SCALE})`,
          transformOrigin: 'top left',
          width: `${QORTINO_MASCOT_BASE_SIZE}px`,
        }}
      >
        <Box
          sx={{
            background: `radial-gradient(circle, ${orbGlow} 0%, ${alpha(
              '#7FB5FF',
              0
            )} 70%)`,
            filter: 'blur(14px)',
            inset: '8px',
            opacity: mood === 'celebrate' ? 1 : 0.82,
            position: 'absolute',
          }}
        />
        <Box
          sx={{
            background: `radial-gradient(circle at 30% 22%, ${alpha(
              '#CFE3FF',
              isDarkMode ? 0.34 : 0.24
            )} 0%, ${alpha('#A9C8FF', isDarkMode ? 0.18 : 0.12)} 18%, ${alpha(
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
              0.08
            )}, inset 0 -1px 0 ${alpha('#000', 0.22)}`,
            height: '152px',
            left: '8px',
            position: 'absolute',
            top: '6px',
            width: '152px',
          }}
        />
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
            height: '58px',
            left: '44px',
            position: 'absolute',
            top: '58px',
            width: '80px',
          }}
        />
        <Box
          sx={{
            animation: 'qortinoBlink 6.2s ease-in-out infinite',
            bgcolor: '#DDEBFF',
            borderRadius: '999px',
            boxShadow: `0 0 12px ${alpha('#7FB5FF', 0.2)}`,
            height: '9px',
            left: '64px',
            position: 'absolute',
            top: '80px',
            width: '9px',
            transformOrigin: 'center',
          }}
        />
        <Box
          sx={{
            animation: 'qortinoBlink 6.2s ease-in-out infinite 120ms',
            bgcolor: '#DDEBFF',
            borderRadius: '999px',
            boxShadow: `0 0 12px ${alpha('#7FB5FF', 0.2)}`,
            height: '9px',
            left: '94px',
            position: 'absolute',
            top: '80px',
            width: '9px',
            transformOrigin: 'center',
          }}
        />
        <Box
          sx={{
            borderBottom: `2px solid ${alpha('#DDEBFF', 0.78)}`,
            borderRadius: '0 0 999px 999px',
            height: '8px',
            left: '71px',
            position: 'absolute',
            top: '97px',
            width: '26px',
          }}
        />
        <Box
          sx={{
            background: `linear-gradient(180deg, ${alpha('#D2E3FF', 0.38)} 0%, ${alpha(
              '#D2E3FF',
              0
            )} 100%)`,
            borderRadius: '999px',
            height: '18px',
            left: '79px',
            position: 'absolute',
            top: '18px',
            width: '10px',
          }}
        />
        <Box
          sx={{
            background: alpha('#8AB8FF', 0.88),
            borderRadius: '50%',
            boxShadow: `0 0 10px ${alpha('#7FB5FF', 0.32)}`,
            height: '12px',
            left: '78px',
            position: 'absolute',
            top: '10px',
            width: '12px',
          }}
        />
        {isListening ? <QortinoHeadphones isDarkMode={isDarkMode} /> : null}
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
        {(isListening || mood === 'celebrate') && (
          <>
            <MusicNoteDecoration delay={0} isDarkMode={isDarkMode} left="20px" top="34px" />
            <MusicNoteDecoration delay={0.2} isDarkMode={isDarkMode} left="132px" top="42px" />
            <MusicNoteDecoration delay={0.4} isDarkMode={isDarkMode} left="22px" top="124px" />
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
  );
};

const MusicNoteDecoration = ({
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
      '@keyframes qortinoNoteFloat': {
        '0%, 100%': { opacity: 0.2, transform: 'translateY(0px) scale(0.94)' },
        '50%': { opacity: 0.85, transform: 'translateY(-8px) scale(1)' },
      },
      animation: `qortinoNoteFloat 3.4s ease-in-out ${delay}s infinite`,
      color: alpha('#95BEFF', isDarkMode ? 0.92 : 0.76),
      left,
      position: 'absolute',
      top,
    }}
  >
    <GraphicEqRoundedIcon sx={{ fontSize: '16px' }} />
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
}: HomeQortinoWorkspaceCardProps) => {
  const { t } = useTranslation(['tutorial']);
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const panelRef = useDashboardPanelMouseLight<HTMLDivElement>();
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const txList = useAtomValue(txListAtom);
  const userAddress = userInfo?.address;
  const name = userInfo?.name;

  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [paymentsFallbackTotal, setPaymentsFallbackTotal] = useState<number | null>(null);
  const [hasAvatar, setHasAvatar] = useState(false);
  const [checkingAvatar, setCheckingAvatar] = useState(false);
  const [openQortsDialog, setOpenQortsDialog] = useState(false);
  const [openMusicSearchDialog, setOpenMusicSearchDialog] = useState(false);
  const [openModulePickerDialog, setOpenModulePickerDialog] = useState(false);
  const [openHotkeyPickerDialog, setOpenHotkeyPickerDialog] = useState(false);
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>({
    ...DEFAULT_WORKSPACE_STATE,
  });
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [selectedHotkeySlot, setSelectedHotkeySlot] = useState(0);
  const [hotkeySearchQuery, setHotkeySearchQuery] = useState('');
  const [musicProgress, setMusicProgress] = useState(0.16);
  const [ephemeralReaction, setEphemeralReaction] = useState<string | null>(null);
  const reactionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastReactionRef = useRef<string | null>(null);
  const lastReactionAtRef = useRef(0);

  const pushReaction = useCallback((nextMessage: string) => {
    const now = Date.now();
    if (
      lastReactionRef.current === nextMessage &&
      now - lastReactionAtRef.current < 1400
    ) {
      return;
    }

    lastReactionRef.current = nextMessage;
    lastReactionAtRef.current = now;

    if (reactionTimeoutRef.current) {
      window.clearTimeout(reactionTimeoutRef.current);
    }
    setEphemeralReaction(nextMessage);
    reactionTimeoutRef.current = window.setTimeout(() => {
      setEphemeralReaction(null);
    }, 4200);
  }, []);

  useEffect(() => {
    return () => {
      if (reactionTimeoutRef.current) {
        window.clearTimeout(reactionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (userAddress == null) {
      setDismissed(null);
      return;
    }

    setDismissed(
      localStorage.getItem(`${LS_KEY}_${userAddress}`) === 'completed'
    );
  }, [userAddress, debugReplayToken]);

  useEffect(() => {
    let active = true;
    setWorkspaceHydrated(false);

    void loadWorkspaceState(userAddress).then((nextState) => {
      if (!active) return;
      setWorkspaceState(nextState);
      setWorkspaceHydrated(true);
    });

    return () => {
      active = false;
    };
  }, [userAddress]);

  useEffect(() => {
    if (!workspaceHydrated) return;
    void persistWorkspaceState(workspaceState, userAddress);
  }, [userAddress, workspaceHydrated, workspaceState]);

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
    : hasAvatarDebugOverride || hasAvatar;
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
      setDismissed(true);
      onGettingStartedComplete?.();
      pushReaction('We did it. This bay is yours now.');
    }
  }, [
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
    dismissed === true &&
    workspaceHydrated &&
    !workspaceState.onboardingCelebrationSeen;

  const hotkeyActions = useMemo<Record<HotkeyActionId, HotkeyActionDefinition>>(
    () => ({
      earbump: {
        description: 'Launch Earbump',
        icon: LibraryMusicRoundedIcon,
        id: 'earbump',
        label: 'Earbump',
        reaction: 'Earbump is open. Queue something good and I am in.',
        run: () => openApp('Earbump'),
      },
      'q-blog': {
        description: 'Launch Q-Blog',
        icon: EditRoundedIcon,
        id: 'q-blog',
        label: 'Q-Blog',
        reaction: 'Opening Q-Blog. Write something good.',
        run: () => openApp('Q-Blog'),
      },
      'q-mail': {
        description: 'Launch Q-Mail',
        icon: MailOutlineRoundedIcon,
        id: 'q-mail',
        label: 'Q-Mail',
        reaction: 'Mail route open. Quiet and direct.',
        run: () => openApp('Q-Mail'),
      },
      'q-trade': {
        description: 'Launch Q-Trade',
        icon: ShoppingBagRoundedIcon,
        id: 'q-trade',
        label: 'Q-Trade',
        reaction: 'Q-Trade is up. Let’s make the next move.',
        run: () => openApp('Q-Trade'),
      },
      'q-mintership': {
        description: 'Launch Q-Mintership',
        icon: SpaRoundedIcon,
        id: 'q-mintership',
        label: 'Q-Mintership',
        reaction: 'Q-Mintership is open. This lane points straight at minting.',
        run: () => openApp('q-mintership'),
      },
      'q-tube': {
        description: 'Launch Q-Tube',
        icon: VideoLibraryRoundedIcon,
        id: 'q-tube',
        label: 'Q-Tube',
        reaction: 'Q-Tube queued. Bring the signal.',
        run: () => openApp('Q-Tube'),
      },
      quitter: {
        description: 'Launch Quitter',
        icon: ForumRoundedIcon,
        id: 'quitter',
        label: 'Quitter',
        reaction: 'Quitter feed, coming up.',
        run: () => openApp('Quitter'),
      },
    }),
    []
  );

  const hotkeyCatalog = useMemo(
    () =>
      (Object.keys(hotkeyActions) as HotkeyActionId[]).map(
        (id) => hotkeyActions[id]
      ),
    [hotkeyActions]
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
          ? t('tutorial:home.confirming_transaction', 'Confirming transaction')
          : t('tutorial:home.register_name', 'Register your name'),
        loading:
          !debugUseOverridesOnly &&
          !hasNameDebugOverride &&
          hasPendingRegisterName,
        onAction: () => executeEvent('openRegisterName', {}),
      },
      {
        accent: '#93D1B8',
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
  const currentStep =
    steps.find((step) => !step.done) ?? steps[steps.length - 1];
  const CurrentStepIcon = currentStep.icon;
  const isOnboardingVisible = dismissed !== true;
  const filteredMusicTracks = useMemo(() => {
    const normalized = workspaceState.musicQuery.trim().toLowerCase();
    if (!normalized) return MUSIC_TRACKS;
    return MUSIC_TRACKS.filter(
      (track) =>
        track.title.toLowerCase().includes(normalized) ||
        track.artist.toLowerCase().includes(normalized)
    );
  }, [workspaceState.musicQuery]);

  const activeTrack =
    MUSIC_TRACKS.find((track) => track.id === workspaceState.selectedTrackId) ??
    MUSIC_TRACKS[0];
  const activeTrackDuration = useMemo(
    () => parseTrackDuration(activeTrack.length),
    [activeTrack.length]
  );
  const currentPlaybackTime = useMemo(
    () => formatPlaybackTime(activeTrackDuration * Math.min(Math.max(musicProgress, 0.08), 1)),
    [activeTrackDuration, musicProgress]
  );
  const discoveryTracks = useMemo(
    () => MUSIC_TRACKS.filter((track) => track.id !== workspaceState.selectedTrackId).slice(0, 3),
    [workspaceState.selectedTrackId]
  );
  const browserTracks = useMemo(() => {
    if (workspaceState.musicQuery.trim()) {
      return filteredMusicTracks;
    }

    return discoveryTracks;
  }, [discoveryTracks, filteredMusicTracks, workspaceState.musicQuery]);
  const filteredHotkeyCatalog = useMemo(() => {
    const normalized = hotkeySearchQuery.trim().toLowerCase();
    if (!normalized) return hotkeyCatalog;

    return hotkeyCatalog.filter(
      (action) =>
        action.label.toLowerCase().includes(normalized) ||
        action.description.toLowerCase().includes(normalized)
    );
  }, [hotkeyCatalog, hotkeySearchQuery]);
  const isBayPickerOpen = openModulePickerDialog || openHotkeyPickerDialog;

  const qortinoMood = useMemo(() => {
    if (isBayPickerOpen) return 'guide' as const;
    if (isOnboardingVisible) return 'guide' as const;
    if (isWorkspaceFreshlyUnlocked) return 'celebrate' as const;
    if (workspaceState.mode === 'music' && workspaceState.musicPlaying) {
      return 'music' as const;
    }
    if (workspaceState.mode === 'hotkeys') return 'hotkeys' as const;
    if (workspaceState.mode === 'announcements') return 'notes' as const;
    return 'empty' as const;
  }, [
    isOnboardingVisible,
    isWorkspaceFreshlyUnlocked,
    isBayPickerOpen,
    workspaceState.mode,
    workspaceState.musicPlaying,
  ]);

  const qortinoMessage = useMemo(() => {
    if (ephemeralReaction) return ephemeralReaction;

    if (isBayPickerOpen) {
      return 'Choose what lives in the bay above me. I will adapt to it.';
    }

    if (isOnboardingVisible) {
      if (currentStep.key === 'get_six_qorts') {
        return 'We start with 6 QORT. Pick any route above and I’ll queue the next step.';
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
      return 'Quick routes armed. Tap a tile and I’ll keep pace.';
    }

    if (workspaceState.mode === 'announcements') {
      return 'Quiet signal feed. Good place for curated updates.';
    }

    if (workspaceState.mode === 'music') {
      if (workspaceState.musicPlaying) {
        return `Headphones on. ${activeTrack.title} is setting the tone.`;
      }
      return 'Drop into music mode when you want a little company.';
    }

    return 'The bay is free now. Add a widget or a hotkey deck and I’ll build around it.';
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

  const configuredHotkeysCount = useMemo(
    () =>
      workspaceState.hotkeys.filter((hotkeyId) =>
        hotkeyId != null && Boolean(hotkeyActions[hotkeyId])
      ).length,
    [hotkeyActions, workspaceState.hotkeys]
  );
  const firstEmptyHotkeySlot = useMemo(
    () => workspaceState.hotkeys.findIndex((slot) => slot == null),
    [workspaceState.hotkeys]
  );

  const qortinoCompanionStatus = useMemo(() => {
    if (isBayPickerOpen) return 'Configuring the bay';
    if (isOnboardingVisible) return 'Guiding setup';
    if (isWorkspaceFreshlyUnlocked) return 'Ready to settle in';
    if (workspaceState.mode === 'music') {
      return workspaceState.musicPlaying ? 'Listening live' : 'Waiting on a track';
    }
    if (workspaceState.mode === 'hotkeys') return 'Routing with you';
    if (workspaceState.mode === 'announcements') return 'Reading notes';
    return 'Watching the bay';
  }, [
    isOnboardingVisible,
    isWorkspaceFreshlyUnlocked,
    isBayPickerOpen,
    workspaceState.mode,
    workspaceState.musicPlaying,
  ]);

  const qortinoMemoryStatus = useMemo(() => {
    if (isOnboardingVisible) {
      return `Step ${currentProgressStep} of ${steps.length}`;
    }
    if (isWorkspaceFreshlyUnlocked) return 'Bay unlocked';
    if (workspaceState.mode === 'music') {
    return workspaceState.musicPlaying ? activeTrack.title : 'Player saved';
    }
    if (workspaceState.mode === 'hotkeys') {
      return `${configuredHotkeysCount} routes saved`;
    }
    if (workspaceState.mode === 'announcements') {
      return `${ANNOUNCEMENT_ITEMS.length} notes docked`;
    }
    return 'Saved per account';
  }, [
    activeTrack.title,
    configuredHotkeysCount,
    currentProgressStep,
    isOnboardingVisible,
    isWorkspaceFreshlyUnlocked,
    steps.length,
    workspaceState.mode,
    workspaceState.musicPlaying,
  ]);

  const applyWorkspaceState = useCallback(
    (updater: (current: WorkspaceState) => WorkspaceState) => {
      setWorkspaceState((current) => sanitizeWorkspaceState(updater(current)));
    },
    []
  );

  const handleCycleTrack = useCallback(
    (direction: 'next' | 'previous') => {
      const activeIndex = MUSIC_TRACKS.findIndex(
        (track) => track.id === workspaceState.selectedTrackId
      );
      const currentIndex = activeIndex >= 0 ? activeIndex : 0;
      const nextIndex =
        direction === 'next'
          ? (currentIndex + 1) % MUSIC_TRACKS.length
          : (currentIndex - 1 + MUSIC_TRACKS.length) % MUSIC_TRACKS.length;
      const nextTrack = MUSIC_TRACKS[nextIndex];

      setMusicProgress(0.18);
      applyWorkspaceState((current) => ({
        ...current,
        mode: 'music',
        musicPlaying: true,
        selectedTrackId: nextTrack.id,
      }));
      pushReaction(`${nextTrack.title} is in rotation now.`);
    },
    [applyWorkspaceState, pushReaction, workspaceState.selectedTrackId]
  );

  useEffect(() => {
    if (workspaceState.mode !== 'music' || !workspaceState.musicPlaying) {
      setMusicProgress((current) => (current > 0.18 ? 0.18 : current));
      return;
    }

    const interval = window.setInterval(() => {
      setMusicProgress((current) => {
        const next = current + 0.035;
        if (next >= 0.96) {
          return workspaceState.repeatMode === 'one' ? 0.18 : 0.96;
        }

        return next;
      });
    }, 980);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    workspaceState.mode,
    workspaceState.musicPlaying,
    workspaceState.repeatMode,
    workspaceState.selectedTrackId,
  ]);

  useEffect(() => {
    if (
      workspaceState.mode !== 'music' ||
      !workspaceState.musicPlaying ||
      workspaceState.repeatMode !== 'all' ||
      musicProgress < 0.96
    ) {
      return;
    }

    handleCycleTrack('next');
  }, [
    handleCycleTrack,
    musicProgress,
    workspaceState.mode,
    workspaceState.musicPlaying,
    workspaceState.repeatMode,
  ]);

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
        pushReaction('Hotkeys deck online. I will keep the top lane ready.');
      } else if (mode === 'announcements') {
        setOpenModulePickerDialog(false);
        setOpenHotkeyPickerDialog(false);
        pushReaction('Developer notes docked. Quiet signal, steady view.');
      } else if (mode === 'music') {
        setOpenModulePickerDialog(false);
        setOpenHotkeyPickerDialog(false);
        pushReaction('Music player ready. I will vibe when you do.');
      } else {
        setOpenModulePickerDialog(false);
        setOpenHotkeyPickerDialog(false);
        pushReaction('Back to an open bay. We can rewire this anytime.');
      }
    },
    [applyWorkspaceState, dismissed, pushReaction]
  );

  const handleSetHotkey = useCallback(
    (actionId: HotkeyActionId) => {
      applyWorkspaceState((current) => {
        const nextHotkeys = [...current.hotkeys];
        nextHotkeys[selectedHotkeySlot] = actionId;
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
      setSelectedHotkeySlot((current) => {
        const nextEmptyIndex = workspaceState.hotkeys.findIndex(
          (slot, index) => index > current && slot == null
        );
        return nextEmptyIndex >= 0 ? nextEmptyIndex : current;
      });
      pushReaction(`${hotkeyActions[actionId].label} is wired into the deck.`);
    },
    [
      applyWorkspaceState,
      dismissed,
      hotkeyActions,
      pushReaction,
      selectedHotkeySlot,
      workspaceState.hotkeys,
    ]
  );

  const handleRunHotkey = useCallback(
    (actionId: HotkeyActionId) => {
      hotkeyActions[actionId].run();
      pushReaction(hotkeyActions[actionId].reaction);
    },
    [hotkeyActions, pushReaction]
  );

  const handleToggleTrack = useCallback(
    (trackId: string) => {
      applyWorkspaceState((current) => {
        const sameTrack = current.selectedTrackId === trackId;
        return {
          ...current,
          mode: 'music',
          musicPlaying: sameTrack ? !current.musicPlaying : true,
          onboardingCelebrationSeen:
            current.onboardingCelebrationSeen || dismissed === true,
          selectedTrackId: trackId,
        };
      });

      const track = MUSIC_TRACKS.find((item) => item.id === trackId);
      if (track) {
        pushReaction(`Locked on ${track.title}. I’m listening with you.`);
      }
    },
    [applyWorkspaceState, dismissed, pushReaction]
  );

  const handleToggleRepeatMode = useCallback(() => {
    applyWorkspaceState((current) => ({
      ...current,
      repeatMode: current.repeatMode === 'all' ? 'one' : 'all',
    }));
  }, [applyWorkspaceState]);

  const handleSelectTrackFromBrowser = useCallback(
    (trackId: string) => {
      setMusicProgress(0.18);
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
    pushReaction('Choose what lives in the bay above me. I will adapt to it.');
  }, [applyWorkspaceState, pushReaction]);

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
      pushReaction('Pick the Q-Apps you want in this deck. I will remember them.');
    },
    [applyWorkspaceState, dismissed, pushReaction]
  );

  const workspaceLabelColor = alpha(theme.palette.text.secondary, 0.78);
  const subtleLine = getBlueAmbientLineBackground(theme, 'soft');
  useEffect(() => {
    const handleWallets = () => {
      pushReaction('Wallets are open. I’ll keep watch while you move funds.');
    };

    const handleUserSearch = () => {
      pushReaction('User search is live. I’ll stay with the trace.');
    };

    const handleMinting = () => {
      pushReaction('Minting panel open. This is where the long game lives.');
    };

    const handleBackup = () => {
      pushReaction('Backup flow ready. Quiet move, strong move.');
    };

    const handleAvatar = () => {
      pushReaction('Avatar tools open. Let’s give this place a face.');
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
        pushReaction('Quitter is live. Let’s read the pulse.');
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
        pushReaction('Q-Trade is open. I’ll keep the board steady.');
        return;
      }

      if (rawName === 'q-mintership') {
        pushReaction('Q-Mintership opened. This is the path toward joining the minters.');
        return;
      }

      if (rawName === 'earbump') {
        pushReaction('Earbump tab open. If you play something, I’ll vibe with you.');
      }
    };

    subscribeToEvent('openWalletsApp', handleWallets);
    subscribeToEvent('openUserLookupDrawer', handleUserSearch);
    subscribeToEvent('openMintingPanel', handleMinting);
    subscribeToEvent('openBackupWallet', handleBackup);
    subscribeToEvent('openAvatarUpload', handleAvatar);
    subscribeToEvent('openRegisterName', handleRegisterName);
    subscribeToEvent('openSendQortInternal', handleSend);
    subscribeToEvent('openReceiveQortInternal', handleReceive);
    subscribeToEvent('openAppsLibrarySearch', handleAppsLibrarySearch);
    subscribeToEvent('addTab', handleAddTab);

    return () => {
      unsubscribeFromEvent('openWalletsApp', handleWallets);
      unsubscribeFromEvent('openUserLookupDrawer', handleUserSearch);
      unsubscribeFromEvent('openMintingPanel', handleMinting);
      unsubscribeFromEvent('openBackupWallet', handleBackup);
      unsubscribeFromEvent('openAvatarUpload', handleAvatar);
      unsubscribeFromEvent('openRegisterName', handleRegisterName);
      unsubscribeFromEvent('openSendQortInternal', handleSend);
      unsubscribeFromEvent('openReceiveQortInternal', handleReceive);
      unsubscribeFromEvent('openAppsLibrarySearch', handleAppsLibrarySearch);
      unsubscribeFromEvent('addTab', handleAddTab);
    };
  }, [pushReaction]);

  const handleRunCurrentStepAction = useCallback(() => {
    if (currentStep.key === 'register_name') {
      pushReaction('Name flow open. This is where the hub starts recognizing you.');
    } else if (currentStep.key === 'load_avatar') {
      pushReaction('Avatar flow ready. Let’s give this place a face.');
    }

    currentStep.onAction();
  }, [currentStep, pushReaction]);

  const workspaceBayContent = isOnboardingVisible ? (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.2,
        '@container qortino-card (max-width: 390px)': {
          gap: 1,
        },
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          '@container qortino-card (max-width: 390px)': {
            gap: 1,
          },
        }}
      >
        <Typography
          sx={{
            color: workspaceLabelColor,
            fontSize: '0.68rem',
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}
        >
          Getting started
        </Typography>
        <Box
          sx={{
            ...getBlueTier2BadgeSx(theme, true),
            borderRadius: '999px',
            color: APP_BLUE_SURFACE_TEXT,
            px: 1,
            py: 0.45,
          }}
        >
          <Typography sx={{ fontSize: '0.66rem', fontWeight: 700 }}>
            Step {currentProgressStep} / {steps.length}
          </Typography>
        </Box>
      </Box>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1.1,
          minWidth: 0,
          '@container qortino-card (max-width: 390px)': {
            alignItems: 'flex-start',
            gap: 0.9,
          },
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            background: alpha(currentStep.accent, 0.14),
            border: `1px solid ${alpha(currentStep.accent, 0.22)}`,
            borderRadius: '12px',
            color: currentStep.accent,
            display: 'flex',
            flexShrink: 0,
            height: '42px',
            justifyContent: 'center',
            width: '42px',
            '@container qortino-card (max-width: 390px)': {
              borderRadius: '11px',
              height: '38px',
              width: '38px',
            },
          }}
        >
          <CurrentStepIcon
            sx={{
              fontSize: '22px',
              '@container qortino-card (max-width: 390px)': {
                fontSize: '20px',
              },
            }}
          />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{
              color: alpha(theme.palette.text.primary, 0.96),
              fontSize: '1rem',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              lineHeight: 1.1,
              '@container qortino-card (max-width: 390px)': {
                fontSize: '0.96rem',
                lineHeight: 1.08,
              },
            }}
          >
            {currentStep.label}
          </Typography>
          <Typography
            sx={{
              color: alpha(theme.palette.text.secondary, 0.8),
              fontSize: '0.76rem',
              letterSpacing: '-0.01em',
              lineHeight: 1.4,
              mt: 0.5,
              '@container qortino-card (max-width: 390px)': {
                fontSize: '0.72rem',
                lineHeight: 1.34,
                mt: 0.42,
              },
            }}
          >
            {currentStep.helper}
          </Typography>
        </Box>
      </Box>
      {currentStep.key === 'get_six_qorts' ? (
        <>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 0.8,
              '@container qortino-card (max-width: 390px)': {
                gap: 0.55,
              },
            }}
          >
            <MiniActionPill
              label={t(
                'tutorial:home.get_six_qorts_way1_action',
                'Go to onboarding'
              )}
              onClick={() => {
                pushReaction("Onboarding route open. I'll keep the next step warm.");
                openExternalUrl(ONBOARDING_URL);
              }}
            />
            <MiniActionPill
              label={t(
                'tutorial:home.get_six_qorts_way2_action',
                'Open support chat'
              )}
              onClick={() => {
                pushReaction("Support chat is open. Ask for the 6 QORT and I'll queue step two.");
                openExternalUrl(SUPPORT_CHAT_URL);
              }}
            />
            <MiniActionPill
              label={t(
                'tutorial:home.get_six_qorts_way3_action',
                'Open Q-Trade'
              )}
              onClick={() => {
                pushReaction("Q-Trade is up. If you grab QORT there, I'll take you forward.");
                openApp('Q-Trade');
              }}
            />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 0.2 }}>
            <StepProgress
              currentStep={currentProgressStep}
              isDarkMode={isDarkMode}
              totalSteps={steps.length}
            />
          </Box>
        </>
      ) : (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.2 }}>
          <Button
            onClick={handleRunCurrentStepAction}
            sx={{
              ...getBlueTier1ButtonSx(),
              borderRadius: '11px',
              fontSize: '0.75rem',
              fontWeight: 700,
              minHeight: '34px',
              px: 1.4,
              py: 0.8,
              textTransform: 'none',
            }}
          >
            {currentStep.loading ? (
              <CircularProgress size={14} sx={{ color: APP_BLUE_SURFACE_TEXT }} />
            ) : (
              currentStep.ctaLabel
            )}
          </Button>
          <StepProgress
            currentStep={currentProgressStep}
            isDarkMode={isDarkMode}
            totalSteps={steps.length}
          />
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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.9 }}>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <Typography
          sx={{
            color: alpha(theme.palette.text.secondary, 0.82),
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          Hotkeys
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.35 }}>
          <IconButton
            onClick={() =>
              handleOpenHotkeyPicker(
                firstEmptyHotkeySlot >= 0 ? firstEmptyHotkeySlot : 0
              )
            }
            size="small"
            sx={{
              color: alpha('#9FC4FF', 0.9),
              height: '30px',
              width: '30px',
            }}
          >
            <TuneRoundedIcon sx={{ fontSize: '18px' }} />
          </IconButton>
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
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: '8px',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        }}
      >
        {workspaceState.hotkeys.map((actionId, index) => {
          const action = actionId ? hotkeyActions[actionId] : null;

          return (
            <ButtonBase
              key={`slot-${index}`}
              onClick={() =>
                action ? handleRunHotkey(action.id) : handleOpenHotkeyPicker(index)
              }
              sx={{
                alignItems: 'center',
                background:
                  theme.palette.mode === 'dark'
                    ? 'linear-gradient(180deg, rgba(38,43,52,0.7) 0%, rgba(26,30,36,0.86) 100%)'
                    : 'linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(245,248,252,0.9) 100%)',
                border: `1px solid ${alpha(
                  action ? '#8DB8FF' : theme.palette.common.white,
                  isDarkMode ? (action ? 0.12 : 0.06) : 0.12
                )}`,
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 0.45,
                minHeight: '50px',
                px: 0.6,
                py: 0.65,
                transition:
                  'transform 120ms ease, border-color 140ms ease, box-shadow 140ms ease',
                '&:hover': {
                  borderColor: alpha('#8DB8FF', 0.24),
                  boxShadow: `0 6px 14px ${alpha('#000', 0.16)}`,
                  transform: 'translateY(-1px)',
                },
              }}
            >
              {action ? (
                <>
                  <action.icon
                    sx={{ color: alpha('#8DB8FF', 0.92), fontSize: '18px' }}
                  />
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.primary, 0.9),
                      fontSize: '0.58rem',
                      fontWeight: 700,
                      lineHeight: 1.08,
                    }}
                  >
                    {action.label}
                  </Typography>
                </>
              ) : (
                <>
                  <AddRoundedIcon
                    sx={{ color: alpha(theme.palette.text.secondary, 0.54), fontSize: '18px' }}
                  />
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.68),
                      fontSize: '0.56rem',
                      fontWeight: 600,
                    }}
                  >
                    Add
                  </Typography>
                </>
              )}
            </ButtonBase>
          );
        })}
      </Box>
    </Box>
  ) : workspaceState.mode === 'announcements' ? (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.95 }}>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <Typography
          sx={{
            color: alpha(theme.palette.text.secondary, 0.82),
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          Announcements
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

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.82 }}>
        {ANNOUNCEMENT_ITEMS.map((item) => (
          <Box
            key={item.label}
            sx={{
              alignItems: 'flex-start',
              display: 'grid',
              gap: 0.75,
              gridTemplateColumns: 'auto 1fr auto',
            }}
          >
            <CampaignRoundedIcon
              sx={{
                color: alpha('#8DB8FF', 0.84),
                fontSize: '14px',
                mt: '2px',
              }}
            />
            <Typography
              sx={{
                color: alpha(theme.palette.text.primary, 0.88),
                fontSize: '0.71rem',
                lineHeight: 1.42,
              }}
            >
              {item.label}
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.62),
                fontSize: '0.63rem',
                fontWeight: 600,
                letterSpacing: '0.02em',
                whiteSpace: 'nowrap',
              }}
            >
              {item.time}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  ) : (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.85 }}>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
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
          gap: '12px',
          gridTemplateColumns: '28px minmax(0, 1fr) 28px',
        }}
      >
        <ButtonBase
          onClick={() => handleCycleTrack('previous')}
          sx={smallTransportButtonSx(theme)}
        >
          <SkipPreviousRoundedIcon sx={{ fontSize: '15px' }} />
        </ButtonBase>
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 0.6,
          }}
        >
          <ButtonBase
            onClick={() => handleToggleTrack(activeTrack.id)}
            sx={{
              alignItems: 'center',
              borderRadius: '50%',
              display: 'flex',
              height: '110px',
              justifyContent: 'center',
              position: 'relative',
              width: '110px',
            }}
          >
            <MusicCoverArt size={110} track={activeTrack} />
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
              }}
            >
              {workspaceState.musicPlaying ? (
                <PauseRoundedIcon sx={{ fontSize: '22px' }} />
              ) : (
                <PlayArrowRoundedIcon sx={{ fontSize: '22px' }} />
              )}
            </Box>
          </ButtonBase>
          <Box sx={{ minWidth: 0, textAlign: 'center' }}>
            <Typography
              sx={{
                color: alpha(theme.palette.text.primary, 0.92),
                fontSize: '0.78rem',
                fontWeight: 700,
                lineHeight: 1.15,
              }}
            >
              {activeTrack.title}
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.72),
                fontSize: '0.61rem',
                mt: 0.12,
              }}
            >
              {activeTrack.artist}
            </Typography>
          </Box>
        </Box>
        <ButtonBase
          onClick={() => handleCycleTrack('next')}
          sx={smallTransportButtonSx(theme)}
        >
          <SkipNextRoundedIcon sx={{ fontSize: '15px' }} />
        </ButtonBase>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.32 }}>
        <Box
          sx={{
            alignItems: 'center',
            display: 'grid',
            gap: '8px',
            gridTemplateColumns: 'auto minmax(0, 1fr) auto auto',
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
            sx={{
              background: getBlueTier3ProgressBackground(theme, isDarkMode),
              borderRadius: '999px',
              height: '4px',
              overflow: 'hidden',
              position: 'relative',
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
                width: `${Math.min(Math.max(musicProgress, 0.08), 1) * 100}%`,
              }}
            />
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
              width: '18px',
            }}
          >
            {workspaceState.repeatMode === 'one' ? (
              <RepeatOneRoundedIcon sx={{ fontSize: '15px' }} />
            ) : (
              <RepeatRoundedIcon sx={{ fontSize: '15px' }} />
            )}
          </ButtonBase>
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
          gridTemplateRows: `${QORTINO_WORKSPACE_BAY_HEIGHT_PX}px minmax(0, 1fr)`,
          height: '100%',
          overflow: 'hidden',
          position: 'relative',
          width: '100%',
        }}
        onMouseMove={handleDashboardPanelPointerMove}
        onMouseLeave={handleDashboardPanelPointerLeave}
      >
        <Box
          sx={{
            background:
              theme.palette.mode === 'dark'
                ? `linear-gradient(180deg, ${alpha('#20242D', 0.9)} 0%, ${alpha(
                    '#171B23',
                    0.96
                  )} 100%)`
                : `linear-gradient(180deg, ${alpha('#FFFFFF', 0.72)} 0%, ${alpha(
                    '#F3F6FB',
                    0.9
                  )} 100%)`,
            borderBottom: `1px solid ${alpha(theme.palette.common.white, 0.05)}`,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minHeight: 0,
            px: 2,
            py: isOnboardingVisible ? 1.55 : 1.25,
            position: 'relative',
          }}
        >
          {workspaceBayContent}
        </Box>

        <Box
          sx={{
            background:
              theme.palette.mode === 'dark'
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
            minHeight: 0,
            overflow: 'hidden',
            position: 'relative',
            px: 2,
            py: 1.5,
          }}
        >
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
              alignItems: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              mb: 0.8,
              position: 'relative',
              zIndex: 1,
            }}
          >
            <Typography
              sx={{
                color: workspaceLabelColor,
                fontSize: '0.68rem',
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
              }}
            >
              QORTINO
            </Typography>
            <Box
              sx={{
                ...getBlueTier2BadgeSx(theme, workspaceState.mode !== 'empty'),
                borderRadius: '999px',
                px: 0.9,
                py: 0.35,
              }}
            >
              <Typography
                sx={{
                  color:
                    workspaceState.mode !== 'empty'
                      ? APP_BLUE_SURFACE_TEXT
                      : alpha(theme.palette.text.secondary, 0.82),
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                }}
              >
                {isOnboardingVisible
                  ? 'guide mode'
                  : isWorkspaceFreshlyUnlocked
                    ? 'unlocked'
                  : workspaceState.mode === 'music' && workspaceState.musicPlaying
                    ? 'listening'
                    : workspaceState.mode === 'hotkeys'
                      ? 'routing'
                      : workspaceState.mode === 'announcements'
                        ? 'notes'
                        : 'standby'}
              </Typography>
            </Box>
          </Box>
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'grid',
                      gap: { xs: 1.4, sm: 1.8 },
                      gridTemplateColumns: {
                        xs: '1fr',
                        sm: `${QORTINO_MASCOT_SIZE + 12}px minmax(0, 1fr)`,
                      },
                      minHeight: 0,
                      position: 'relative',
                      zIndex: 1,
                      '@container qortino-card (max-width: 390px)': {
                        gap: '14px',
                        gridTemplateColumns: `${QORTINO_MASCOT_SIZE + 4}px minmax(0, 1fr)`,
                      },
                    }}
                  >
            <Box sx={{ alignItems: 'center', display: 'flex', justifyContent: 'center' }}>
              <QortinoMascot
                isDarkMode={isDarkMode}
                isListening={workspaceState.mode === 'music' && workspaceState.musicPlaying}
                mood={qortinoMood}
              />
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.95 }}>
              <motion.div
                key={qortinoMessage}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                <Box
                  sx={{
                    background:
                      theme.palette.mode === 'dark'
                        ? 'linear-gradient(180deg, rgba(31,36,45,0.88) 0%, rgba(19,23,29,0.96) 100%)'
                        : 'linear-gradient(180deg, rgba(255,255,255,0.86) 0%, rgba(243,247,252,0.94) 100%)',
                    border: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.065 : 0.14)}`,
                    borderRadius: '15px',
                    boxShadow: `0 14px 24px ${alpha('#000', isDarkMode ? 0.18 : 0.08)}`,
                    p: 1.15,
                    position: 'relative',
                    '&::after': {
                      background:
                        theme.palette.mode === 'dark'
                          ? 'linear-gradient(135deg, rgba(31,36,45,0.88) 0%, rgba(19,23,29,0.96) 100%)'
                          : 'linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(243,247,252,0.96) 100%)',
                      borderBottom: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.04 : 0.12)}`,
                      borderRight: `1px solid ${alpha(theme.palette.common.white, isDarkMode ? 0.04 : 0.12)}`,
                      borderRadius: '0 0 8px 0',
                      bottom: '-7px',
                      content: '""',
                      height: '14px',
                      left: '22px',
                      position: 'absolute',
                      transform: 'rotate(45deg)',
                      width: '14px',
                    },
                  }}
                >
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.primary, 0.94),
                      fontSize: '0.79rem',
                      fontWeight: 600,
                      letterSpacing: '-0.015em',
                      lineHeight: 1.46,
                    }}
                  >
                    {qortinoMessage}
                  </Typography>
                </Box>
              </motion.div>

              <Box
                sx={{
                  display: 'grid',
                  gap: 0.75,
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                }}
              >
                <StatChip
                  label="Companion"
                  value={qortinoCompanionStatus}
                  theme={theme}
                />
                <StatChip
                  label="Memory"
                  value={qortinoMemoryStatus}
                  theme={theme}
                />
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>

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
              key={module.mode}
              onClick={() => {
                if (module.mode === 'hotkeys') {
                  handleOpenHotkeyPicker(firstEmptyHotkeySlot >= 0 ? firstEmptyHotkeySlot : 0);
                  return;
                }
                handleSelectWorkspaceMode(module.mode);
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
            maxWidth: '520px',
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
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.1, pb: 2.1 }}>
          <Box
            sx={{
              display: 'grid',
              gap: '8px',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            }}
          >
            {workspaceState.hotkeys.map((actionId, index) => {
              const action = actionId ? hotkeyActions[actionId] : null;
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
                    borderRadius: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.3,
                    minHeight: '50px',
                    px: 0.6,
                    py: 0.65,
                  }}
                >
                  {action ? (
                    <>
                      <action.icon sx={{ color: alpha('#8DB8FF', 0.94), fontSize: '17px' }} />
                      <Typography sx={{ fontSize: '0.56rem', fontWeight: 700 }}>
                        {action.label}
                      </Typography>
                    </>
                  ) : (
                    <>
                      <AddRoundedIcon sx={{ color: alpha(theme.palette.text.secondary, 0.58), fontSize: '17px' }} />
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

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.55 }}>
            {filteredHotkeyCatalog.map((action) => (
              <ButtonBase
                key={action.id}
                onClick={() => handleSetHotkey(action.id)}
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
                  <action.icon sx={{ fontSize: '18px' }} />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.78rem', fontWeight: 700 }}>
                    {action.label}
                  </Typography>
                  <Typography
                    sx={{
                      color: alpha(theme.palette.text.secondary, 0.68),
                      fontSize: '0.64rem',
                      mt: 0.18,
                    }}
                  >
                    {action.description}
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
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.primary, 0.88),
                    fontSize: '0.76rem',
                    fontWeight: 700,
                  }}
                >
                  No Q-Apps match yet
                </Typography>
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.secondary, 0.68),
                    fontSize: '0.64rem',
                    lineHeight: 1.4,
                    maxWidth: '28ch',
                  }}
                >
                  Try another app name to wire a shortcut into the selected slot.
                </Typography>
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
              {browserTracks.map((track) => (
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
                      {track.artist} • {track.uploaded}
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
              ))}
              {browserTracks.length === 0 && (
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
              )}
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

const MiniActionPill = ({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) => (
  <ButtonBase
    onClick={onClick}
    sx={{
      alignItems: 'center',
      background: 'rgba(132, 175, 240, 0.12)',
      border: `1px solid ${alpha('#8DB8FF', 0.22)}`,
      borderRadius: '999px',
      color: alpha('#CFE0FF', 0.96),
      display: 'inline-flex',
      fontSize: '0.66rem',
      fontWeight: 700,
      gap: 0.4,
      px: 1.1,
      py: 0.65,
      textAlign: 'center',
      transition: 'transform 120ms ease, border-color 140ms ease',
      '@container qortino-card (max-width: 390px)': {
        fontSize: '0.63rem',
        px: 0.92,
        py: 0.56,
      },
      '&:hover': {
        borderColor: alpha('#8DB8FF', 0.34),
        transform: 'translateY(-1px)',
      },
    }}
  >
    {label}
  </ButtonBase>
);

const StatChip = ({
  label,
  theme,
  value,
}: {
  label: string;
  theme: ReturnType<typeof useTheme>;
  value: string;
}) => (
  <Box
    sx={{
      background:
        theme.palette.mode === 'dark'
          ? 'rgba(255,255,255,0.03)'
          : 'rgba(20,24,32,0.03)',
      border: `1px solid ${alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.06 : 0.12)}`,
      borderRadius: '12px',
      minHeight: '52px',
      px: 1,
      py: 0.8,
    }}
  >
    <Typography
      sx={{
        color: alpha(theme.palette.text.secondary, 0.64),
        fontSize: '0.63rem',
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </Typography>
    <Typography
      sx={{
        color: alpha(theme.palette.text.primary, 0.9),
        fontSize: '0.73rem',
        fontWeight: 600,
        mt: 0.35,
      }}
    >
      {value}
    </Typography>
  </Box>
);

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
