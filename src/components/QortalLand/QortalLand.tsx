import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CallRoundedIcon from '@mui/icons-material/CallRounded';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import InsertEmoticonRoundedIcon from '@mui/icons-material/InsertEmoticonRounded';
import KeyboardReturnRoundedIcon from '@mui/icons-material/KeyboardReturnRounded';
import PaidRoundedIcon from '@mui/icons-material/PaidRounded';
import SportsEsportsRoundedIcon from '@mui/icons-material/SportsEsportsRounded';
import {
  Box,
  Button,
  ClickAwayListener,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { useAtomValue } from 'jotai';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { balanceAtom, userInfoAtom } from '../../atoms/global';
import defaultCharacterSpritesheetUrl from '../../assets/qortalland/default-character-spritesheet.webp';
import characterSkin1FaceUrl from '../../assets/qortalland/character-skin-1-face.webp';
import characterSkin2Url from '../../assets/qortalland/character-skin-2.webp';
import characterSkin2FaceUrl from '../../assets/qortalland/character-skin-2-face.webp';
import characterSkin3Url from '../../assets/qortalland/character-skin-3.webp';
import characterSkin3FaceUrl from '../../assets/qortalland/character-skin-3-face.webp';
import characterSkin4Url from '../../assets/qortalland/character-skin-4.webp';
import characterSkin4FaceUrl from '../../assets/qortalland/character-skin-4-face.webp';
import characterSkin5Url from '../../assets/qortalland/character-skin-5.webp';
import characterSkin5FaceUrl from '../../assets/qortalland/character-skin-5-face.webp';
import characterSkin6Url from '../../assets/qortalland/character-skin-6.webp';
import characterSkin6FaceUrl from '../../assets/qortalland/character-skin-6-face.webp';
import { useGroupCallContext } from '../../contexts/GroupCallContext';
import { useVoiceCall, type VoiceCallApi } from '../../hooks/useVoiceCall';
import { getPrimaryNamesForAddresses } from '../Group/groupApi';
import { useQortalLandGame } from './games/useQortalLandGame';
import { ProximityVoiceControl } from './proximity/ProximityVoiceControl';
import { useQortalLandProximityVoice } from './proximity/useQortalLandProximityVoice';
import {
  QORTAL_LAND_OPTIMIZED_ASSET_DIMENSIONS,
  qortalLandOptimizedAssetRenderScale,
} from './qortalLandOptimizedAssets';
import { collectQortalLandRoomAssetIds } from './qortalLandRoomAssetPolicy';
import {
  publishQortalLandPresence,
  shouldSuspendQortalLandPresence,
} from './qortalLandPresence';

type QortalLandSkinId = 1 | 2 | 3 | 4 | 5 | 6;

type LandPlayerState = {
  authorAddress: string;
  sessionId: string;
  destinationHash?: string;
  sequence: number;
  roomId: LandRoomId;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  fromTimelineAt: number;
  timelineAt: number;
  timelineOffsetMs: number;
  displayX: number;
  displayY: number;
  fromDirection: string;
  fromMovement: string;
  direction: string;
  movement: string;
  sentAt: number;
  receivedAt: number;
  lastSeenAt: number;
  velocityX: number;
  velocityY: number;
  afk: boolean;
  dnd: boolean;
  voiceEnabled: boolean;
  voiceMuted: boolean;
  skinId: QortalLandSkinId;
};

type LocalLandState = {
  roomId: LandRoomId;
  x: number;
  y: number;
  direction: string;
  movement: string;
  afk: boolean;
  dnd: boolean;
  voiceEnabled: boolean;
  voiceMuted: boolean;
  skinId: QortalLandSkinId;
};

type LandChatBubble = {
  messageId: string;
  authorAddress: string;
  sessionId: string;
  sequence: number;
  text: string;
  createdAt: number;
  expiresAt: number;
};

type LandChatMode = 'say' | 'yell' | 'emote';
type LandChatTab = 'local' | 'whispers';
type LandChatPanelGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};
type LandChatPanelInteraction = {
  mode: 'drag' | 'resize-top-right' | 'resize-bottom-right';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startGeometry: LandChatPanelGeometry;
};

type LandChatTranscriptMessage = {
  messageId: string;
  authorAddress: string;
  sessionId: string;
  sequence: number;
  text: string;
  mode: LandChatMode;
  moodAction?: LandSocialActionType;
  timestamp: number;
};

type LandChatEmoji = {
  key: string;
  label: string;
  fileName: string;
  shortcuts: string[];
};

type LandChatTextPart =
  | { type: 'text'; text: string }
  | { type: 'emoji'; emoji: LandChatEmoji; shortcut: string };

type LandActionTarget = {
  key: string;
  authorAddress: string;
  sessionId: string;
  destinationHash?: string;
  roomId: LandRoomId;
  anchorX: number;
  anchorY: number;
  menuX: number;
  menuY: number;
};

type LandSocialActionType =
  | 'buzz'
  | 'love'
  | 'devil'
  | 'angel'
  | 'rain'
  | 'sunshine';

type LandActionType = 'qort_received' | LandSocialActionType;

type LandActionAnimation = {
  actionId: string;
  type: LandActionType;
  fromAddress: string;
  sourceSessionId: string;
  sequence: number;
  toAddress: string;
  targetSessionId: string;
  amount: number;
  roomId: LandRoomId | '';
  createdAt: number;
  expiresAt: number;
};

const LAND_SOCIAL_ACTIONS: ReadonlyArray<{
  type: LandSocialActionType;
  label: string;
  symbol: string;
  color: string;
}> = [
  { type: 'buzz', label: 'Buzz', symbol: '⚡', color: '#67e8f9' },
  { type: 'love', label: 'Love', symbol: '♥', color: '#ff6f9f' },
  { type: 'devil', label: 'Devil', symbol: '😈', color: '#ff695e' },
  { type: 'angel', label: 'Angel', symbol: '😇', color: '#ffe48a' },
  { type: 'rain', label: 'Rain', symbol: '☂', color: '#74b9ff' },
  { type: 'sunshine', label: 'Sunshine', symbol: '☀', color: '#ffd45a' },
];

const LAND_SOCIAL_ACTION_CARD_COLORS: Record<LandSocialActionType, string> = {
  buzz: '#35c8ff',
  love: '#ff6fae',
  devil: '#a66cff',
  angel: '#d6ad5c',
  rain: '#5d9fff',
  sunshine: '#e2ad32',
};

const isLandSocialActionType = (value: string): value is LandSocialActionType =>
  LAND_SOCIAL_ACTIONS.some((action) => action.type === value);

type LandCallPresence = {
  callId: string;
  peerAddress: string;
  roomId: LandRoomId;
  expiresAt: number;
};

type LandGamePresence = {
  matchId: string;
  peerAddress: string;
  roomId: LandRoomId;
  expiresAt: number;
};

type QortalLandProps = {
  groupId: number;
  groupName: string;
  myAddress: string;
  isActive?: boolean;
};

type QortalLandCharacterCustomization = {
  hair: string;
  face: string;
  clothes: string;
};

type QortalLandCharacterCustomizationField =
  keyof QortalLandCharacterCustomization;
type QortalLandCharacterPreviewFacing = 'front' | 'right' | 'back' | 'left';

const QORTAL_LAND_CHARACTER_CUSTOMIZATION_DEFAULTS: QortalLandCharacterCustomization =
  {
    hair: 'default',
    face: 'default',
    clothes: 'default',
  };

const QORTAL_LAND_CHARACTER_CUSTOMIZATION_OPTIONS = {
  hair: [
    { value: 'default', label: 'Original Hair' },
    { value: 'dark_spiky', label: 'Dark Spiky' },
    { value: 'silver', label: 'Silver' },
    { value: 'neon_pink', label: 'Neon Pink' },
  ],
  face: [
    { value: 'default', label: 'Original Face' },
    { value: 'calm', label: 'Calm' },
    { value: 'sharp', label: 'Sharp' },
    { value: 'visor', label: 'Visor' },
  ],
  clothes: [
    { value: 'default', label: 'Original Clothes' },
    { value: 'club_jacket', label: 'Club Jacket' },
    { value: 'street_black', label: 'Street Black' },
    { value: 'neon_trim', label: 'Neon Trim' },
  ],
} as const;

const QORTAL_LAND_CHARACTER_PREVIEW_FACINGS: QortalLandCharacterPreviewFacing[] =
  ['front', 'right', 'back', 'left'];

const LAND_SEND_INTERVAL_MS = 200;
const LAND_AFK_TIMEOUT_MS = 2 * 60 * 1000;
const LAND_AFK_CHECK_INTERVAL_MS = 5_000;
const LAND_HEARTBEAT_MS = 2000;
const LAND_REMOTE_TTL_MS = 30000;
const LAND_REMOTE_INTERPOLATION_BUFFER_MS = 180;
const LAND_REMOTE_TIMELINE_CATCH_UP_MS = 20;
const LAND_REMOTE_RECONCILE_MS = 120;
const LAND_REMOTE_EXTRAPOLATE_MS = 1100;
const LAND_REMOTE_STOP_WALKING_AFTER_MS = 1450;
const LAND_REMOTE_MAX_VELOCITY_PX_PER_MS = 0.32;
const LAND_REMOTE_MAX_EXTRAPOLATE_DISTANCE = 180;
const LAND_CHAT_BUBBLE_TTL_MS = 15000;
const LAND_CHAT_RECONCILE_LIMIT = 25;
const LAND_CHAT_MAX_TEXT_BYTES = 1024;
const LAND_CHAT_MAX_INPUT_CHARS = 420;
const LAND_CHAT_TRANSCRIPT_LIMIT = 80;
const LAND_CHAT_VISIBLE_IDLE_MS = 5000;
const LAND_ACTION_ANIMATION_TTL_MS = 4200;
const LAND_SOCIAL_ACTION_COOLDOWN_MS = 1200;
const LAND_ACTIONS_PER_AVATAR_MAX = 2;
const LAND_CALL_STATUS_INTERVAL_MS = 10000;
const LAND_CALL_STATUS_TTL_MS = 26000;
const QORTAL_LAND_CHANNEL_ID = 'qortal-land';
const QORTAL_LAND_CHARACTER_SKIN_STORAGE_KEY = 'qortalland.characterSkin';
const QORTAL_LAND_CHARACTER_SKINS: ReadonlyArray<{
  id: QortalLandSkinId;
  label: string;
  spritesheetUrl: string;
  faceUrl: string;
}> = [
  {
    id: 1,
    label: 'Original',
    spritesheetUrl: defaultCharacterSpritesheetUrl,
    faceUrl: characterSkin1FaceUrl,
  },
  {
    id: 2,
    label: 'Nova',
    spritesheetUrl: characterSkin2Url,
    faceUrl: characterSkin2FaceUrl,
  },
  {
    id: 3,
    label: 'Luna',
    spritesheetUrl: characterSkin3Url,
    faceUrl: characterSkin3FaceUrl,
  },
  {
    id: 4,
    label: 'Aqua',
    spritesheetUrl: characterSkin4Url,
    faceUrl: characterSkin4FaceUrl,
  },
  {
    id: 5,
    label: 'Amber',
    spritesheetUrl: characterSkin5Url,
    faceUrl: characterSkin5FaceUrl,
  },
  {
    id: 6,
    label: 'Frost',
    spritesheetUrl: characterSkin6Url,
    faceUrl: characterSkin6FaceUrl,
  },
];

const normalizeQortalLandSkinId = (value: unknown): QortalLandSkinId => {
  const numeric = Math.floor(Number(value));
  return numeric >= 1 && numeric <= QORTAL_LAND_CHARACTER_SKINS.length
    ? (numeric as QortalLandSkinId)
    : 1;
};

const qortalLandSkinTextureKey = (skinId: QortalLandSkinId): string =>
  `qortalland-character-skin-${skinId}`;

const qortalLandSkinAnimationKey = (
  skinId: QortalLandSkinId,
  movement: 'idle' | 'walk',
  facing: 'side' | 'down' | 'up'
): string => `${qortalLandSkinTextureKey(skinId)}-${movement}-${facing}`;

const qortalLandSkinForId = (skinId: unknown) =>
  QORTAL_LAND_CHARACTER_SKINS[normalizeQortalLandSkinId(skinId) - 1];

const LAND_CHARACTER_FRAME_SIZE = 320;
const LAND_CHARACTER_FRAMES_PER_DIRECTION = 7;
const LAND_CHARACTER_FEET_BASELINE = 292;
const LAND_CHARACTER_RENDER_SCALE = 0.56;
const LAND_CHARACTER_LABEL_OFFSET = 248;
const LAND_CHARACTER_AVAILABILITY_OFFSET = 42;
const LAND_CHARACTER_CHAT_BUBBLE_OFFSET = 292;
const QORTAL_LAND_CHARACTER_CUSTOMIZATION_STORAGE_KEY =
  'qortalland.characterCustomization';
type LandRoomId = 'club' | 'skywalk' | 'mall' | 'park';
const QORTAL_LAND_DEFAULT_ROOM_ID: LandRoomId = 'club';
const QORTAL_LAND_SKYWALK_ROOM_ID: LandRoomId = 'skywalk';
const QORTAL_LAND_MALL_ROOM_ID: LandRoomId = 'mall';
const QORTAL_LAND_PARK_ROOM_ID: LandRoomId = 'park';
const QORTAL_LAND_START_ROOM_ID: LandRoomId = QORTAL_LAND_DEFAULT_ROOM_ID;

type QortalLandRoomFloorLayout = {
  topY: number;
  bottomY: number;
  back: {
    minX: number;
    maxX: number;
  };
  front: {
    minX: number;
    maxX: number;
  };
};

type QortalLandRoomTransitionTarget = {
  roomId: LandRoomId;
  x: number;
  y: number;
  direction: string;
};

type QortalLandRoomLayout = {
  width: number;
  height: number;
  floor: QortalLandRoomFloorLayout;
  interactions?: {
    djBooth?: {
      x: number;
      y: number;
      promptY: number;
      radius: number;
      weightedXScale: number;
    };
  };
  transitions?: {
    clubToSkywalk?: {
      target: QortalLandRoomTransitionTarget;
    };
    skywalkToClubReturn?: {
      target: QortalLandRoomTransitionTarget;
    };
  };
};

const QORTAL_LAND_ROOM_LAYOUTS: Record<LandRoomId, QortalLandRoomLayout> = {
  [QORTAL_LAND_DEFAULT_ROOM_ID]: {
    width: 1800,
    height: 820,
    floor: {
      topY: 302,
      bottomY: 686,
      back: { minX: 273, maxX: 1523 },
      front: { minX: 87, maxX: 1709 },
    },
    interactions: {
      djBooth: {
        x: 900,
        y: 374,
        promptY: 280,
        radius: 148,
        weightedXScale: 0.74,
      },
    },
    transitions: {
      clubToSkywalk: {
        target: {
          roomId: QORTAL_LAND_PARK_ROOM_ID,
          x: 1488,
          y: 492,
          direction: 'l',
        },
      },
      skywalkToClubReturn: {
        target: {
          roomId: QORTAL_LAND_DEFAULT_ROOM_ID,
          x: 1495,
          y: 374,
          direction: 'd',
        },
      },
    },
  },
  [QORTAL_LAND_SKYWALK_ROOM_ID]: {
    width: 1800,
    height: 820,
    floor: {
      topY: 338,
      bottomY: 666,
      back: { minX: 128, maxX: 1672 },
      front: { minX: 150, maxX: 1650 },
    },
  },
  [QORTAL_LAND_MALL_ROOM_ID]: {
    width: 1800,
    height: 820,
    floor: {
      topY: 332,
      bottomY: 700,
      back: { minX: 150, maxX: 1650 },
      front: { minX: 70, maxX: 1730 },
    },
  },
  [QORTAL_LAND_PARK_ROOM_ID]: {
    width: 1800,
    height: 820,
    floor: {
      topY: 282,
      bottomY: 704,
      back: { minX: 110, maxX: 1690 },
      front: { minX: 24, maxX: 1776 },
    },
  },
};

const LAND_WIDTH = QORTAL_LAND_ROOM_LAYOUTS[QORTAL_LAND_DEFAULT_ROOM_ID].width;
const LAND_HEIGHT =
  QORTAL_LAND_ROOM_LAYOUTS[QORTAL_LAND_DEFAULT_ROOM_ID].height;
const QORTAL_LAND_DEV_PNG_ASSET_KEY_PREFIX = 'qortalland-dev-png';
const QORTAL_LAND_DEV_PNG_PROPS_STORAGE_KEY = 'qortalland.devPngProps';
const QORTAL_LAND_DEV_PROCEDURAL_CLUB_SHELL_STORAGE_KEY =
  'qortalland.devProceduralClubShell';
const QORTAL_LAND_DEV_COLLISION_DEBUG_STORAGE_KEY =
  'qortalland.devCollisionDebug';
const QORTAL_LAND_DEV_LOOK_STORAGE_KEY = 'qortalland.devLook';
const QORTAL_LAND_DEV_PNG_PLACEMENT_STORAGE_PREFIX = 'qortalland.devPlacement.';
const QORTAL_LAND_DEV_ASSETS_CHANGED_EVENT = 'qortalland:devAssetsChanged';
const QORTAL_LAND_DEVELOPMENT_CLUB_FLOOR_ASSET_ID = 'architecture/club_floor';
const QORTAL_LAND_DEVELOPMENT_CLUB_FLOOR_PLACEMENT_ID = 'club.floor_png';
const QORTAL_LAND_DEVELOPMENT_PARK_SKYLINE_ASSET_ID =
  'architecture/park_skyline';
const QORTAL_LAND_DEVELOPMENT_PARK_SKYLINE_PLACEMENT_ID = 'park.skyline_png';
const QORTAL_LAND_DEVELOPMENT_PARK_FLOOR_ASSET_ID = 'architecture/park_floor';
const QORTAL_LAND_DEVELOPMENT_PARK_FLOOR_PLACEMENT_ID = 'park.floor_png';
const QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_CLOSED_ASSET_ID =
  'architecture/park_portal_closed';
const QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_OPEN_1_ASSET_ID =
  'architecture/park_portal_open_1';
const QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_OPEN_2_ASSET_ID =
  'architecture/park_portal_open_2';
const QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_OPEN_3_ASSET_ID =
  'architecture/park_portal_open_3';
const QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_OPEN_4_ASSET_ID =
  'architecture/park_portal_open_4';
const QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_PLACEMENT_ID = 'park.portal_png';
const QORTAL_LAND_DEVELOPMENT_BACK_WALL_ASSET_ID =
  'architecture/back_wall_main';
const QORTAL_LAND_DEVELOPMENT_BACK_WALL_PLACEMENT_ID =
  'club.back_wall_main_png';
const QORTAL_LAND_DEVELOPMENT_LEFT_WALL_ASSET_ID =
  'architecture/club_wall_left';
const QORTAL_LAND_DEVELOPMENT_LEFT_WALL_PLACEMENT_ID = 'club.wall_left_png';
const QORTAL_LAND_DEVELOPMENT_RIGHT_WALL_ASSET_ID =
  'architecture/club_wall_right';
const QORTAL_LAND_DEVELOPMENT_RIGHT_WALL_PLACEMENT_ID = 'club.wall_right_png';
const QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_CLOSED_ASSET_ID =
  'architecture/door_closed';
const QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_SEMI_OPEN_ASSET_ID =
  'architecture/door_semi_open';
const QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_OPEN_ASSET_ID =
  'architecture/door_open';
const QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_PLACEMENT_ID = 'club.skywalk_door_png';
const QORTAL_LAND_DEVELOPMENT_CLUB_BAR_ASSET_ID = 'furniture/bar_counter_long';
const QORTAL_LAND_DEVELOPMENT_CLUB_BAR_PLACEMENT_ID =
  'club.bar_counter_long_wide_png';
const QORTAL_LAND_DEVELOPMENT_BACK_BAR_ASSET_ID =
  'technology/back_bar_unit_long';
const QORTAL_LAND_DEVELOPMENT_BACK_BAR_PLACEMENT_ID =
  'club.back_bar_unit_long_png';
const QORTAL_LAND_DEVELOPMENT_DJ_BOOTH_ASSET_ID = 'technology/dj_booth';
const QORTAL_LAND_DEVELOPMENT_DJ_BOOTH_PLACEMENT_ID = 'club.dj_booth_png';
const QORTAL_LAND_DEVELOPMENT_SOFA_MODERN_A_TEAL_ASSET_ID =
  'furniture/sofa_modern_a_teal';
const QORTAL_LAND_DEVELOPMENT_SOFA_MODERN_A_PURPLE_ASSET_ID =
  'furniture/sofa_modern_a_purple';
const QORTAL_LAND_DEVELOPMENT_TABLE_ROUND_LOW_ASSET_ID =
  'furniture/table_round_low';
const QORTAL_LAND_DEVELOPMENT_BAR_STOOL_ROUND_ASSET_ID =
  'furniture/bar_stool_round';
const QORTAL_LAND_DEVELOPMENT_SPEAKER_LEFT_ASSET_ID = 'technology/speaker_left';
const QORTAL_LAND_DEVELOPMENT_SPEAKER_RIGHT_ASSET_ID =
  'technology/speaker_right';
const QORTAL_LAND_DEVELOPMENT_PLANTER_RECT_TROPICAL_ASSET_ID =
  'decorations/planter_rect_tropical';
const QORTAL_LAND_DEVELOPMENT_PLANTER_TALL_TROPICAL_ASSET_ID =
  'decorations/planter_tall_tropical';
const QORTAL_LAND_DEVELOPMENT_QORTAL_NEON_LIGHT_ASSET_ID =
  'decorations/qortal_neon_light';
const QORTAL_LAND_DEVELOPMENT_PARK_BENCH_PLANTER_LEFT_ASSET_ID =
  'decorations/park_bench_planter_left';
const QORTAL_LAND_DEVELOPMENT_PARK_TREE_ROUND_LARGE_ASSET_ID =
  'decorations/park_tree_round_large';
const QORTAL_LAND_DEVELOPMENT_PARK_TREE_ROUND_TALL_ASSET_ID =
  'decorations/park_tree_round_tall';
const QORTAL_LAND_DEVELOPMENT_PARK_TREE_PLANTER_LAMP_ASSET_ID =
  'decorations/park_tree_planter_lamp';
const QORTAL_LAND_DEVELOPMENT_PARK_FOUNTAIN_BLUE_ASSET_ID =
  'decorations/park_fountain_blue';
const QORTAL_LAND_DEVELOPMENT_PARK_FOUNTAIN_BLUE_PLACEMENT_ID =
  'park.fountain_blue_png';
const QORTAL_LAND_DEVELOPMENT_PARK_PLANTER_ROW_TREES_ASSET_ID =
  'decorations/park_planter_row_trees';
const QORTAL_LAND_DEVELOPMENT_PARK_PLANTER_ROW_TREES_PLACEMENT_ID =
  'park.planter_row_trees_png';
const QORTAL_LAND_DEVELOPMENT_PARK_PLANTER_CORNER_TREES_ASSET_ID =
  'decorations/park_planter_corner_trees';
const QORTAL_LAND_DEVELOPMENT_PARK_BENCH_STRAIGHT_ASSET_ID =
  'furniture/park_bench_straight';
const QORTAL_LAND_DEVELOPMENT_PARK_BENCH_CURVED_ASSET_ID =
  'furniture/park_bench_curved';
const QORTAL_LAND_DEVELOPMENT_DANCE_FLOOR_ASSET_ID = 'lighting/dance_floor';
const QORTAL_LAND_DEVELOPMENT_SOFA_MODERN_A_ASSET_IDS = [
  QORTAL_LAND_DEVELOPMENT_SOFA_MODERN_A_TEAL_ASSET_ID,
  QORTAL_LAND_DEVELOPMENT_SOFA_MODERN_A_PURPLE_ASSET_ID,
];
const QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_ASSET_IDS = [
  QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_CLOSED_ASSET_ID,
  QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_SEMI_OPEN_ASSET_ID,
  QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_OPEN_ASSET_ID,
];
const QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_ASSET_IDS = [
  QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_CLOSED_ASSET_ID,
  QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_OPEN_1_ASSET_ID,
  QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_OPEN_2_ASSET_ID,
  QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_OPEN_3_ASSET_ID,
  QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_OPEN_4_ASSET_ID,
];
const QORTAL_LAND_CLUB_SKYWALK_DOOR_PROXIMITY_RADIUS = 128;
const QORTAL_LAND_CLUB_SKYWALK_DOOR_SOURCE_WIDTH = 70;
const QORTAL_LAND_CLUB_SKYWALK_DOOR_SOURCE_HEIGHT = 365;
const QORTAL_LAND_CLUB_SKYWALK_DOOR_RETURN_OFFSET_X = 150;
const QORTAL_LAND_CLUB_SKYWALK_DOOR_RETURN_OFFSET_Y = -34;
const QORTAL_LAND_CLUB_SKYWALK_DOOR_OPEN_THRESHOLD = 0.78;
const QORTAL_LAND_CLUB_SKYWALK_DOOR_OPEN_SPEED = 0.0044;
const QORTAL_LAND_CLUB_SKYWALK_DOOR_CLOSE_SPEED = 0.0022;
const QORTAL_LAND_PARK_PORTAL_PROXIMITY_RADIUS = 136;
const QORTAL_LAND_PARK_PORTAL_SOURCE_WIDTH = 685;
const QORTAL_LAND_PARK_PORTAL_SOURCE_HEIGHT = 1099;
const QORTAL_LAND_PARK_PORTAL_OPEN_THRESHOLD = 0.72;
const QORTAL_LAND_PARK_PORTAL_OPEN_SPEED = 0.0042;
const QORTAL_LAND_PARK_PORTAL_CLOSE_SPEED = 0.0024;
const QORTAL_LAND_PLAYER_COLLISION_RADIUS_X = 18;
const QORTAL_LAND_PLAYER_COLLISION_RADIUS_Y = 10;
const QORTAL_LAND_DJ_PEDESTAL_MAX_ELEVATION = 52;

type QortalLandDevelopmentPngAsset = {
  id: string;
  path: string;
  url: string;
  renderScaleX: number;
  renderScaleY: number;
};

type QortalLandDevelopmentPngPropPlacement = {
  id: string;
  assetId: string;
  roomIds?: LandRoomId[];
  x: number;
  y: number;
  depth?: number;
  depthMode?: 'fixed' | 'y-sort';
  depthOffset?: number;
  originX?: number;
  originY?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  alpha?: number;
  angle?: number;
  flipX?: boolean;
  count?: number;
  spacing?: number;
  warp?: {
    tlX?: number;
    tlY?: number;
    trX?: number;
    trY?: number;
    brX?: number;
    brY?: number;
    blX?: number;
    blY?: number;
  };
  visible?: boolean;
  collision?: QortalLandDevelopmentPlacementCollision;
  collisions?: QortalLandDevelopmentPlacementCollision[];
  contactShadow?: {
    offsetX?: number;
    offsetY?: number;
    width: number;
    height: number;
    alpha?: number;
    color?: number;
    depth?: number;
    depthOffset?: number;
  };
};

type QortalLandDevelopmentPlacementCollision = {
  shape: 'ellipse' | 'rect';
  offsetX?: number;
  offsetY?: number;
  width: number;
  height: number;
  paddingX?: number;
  paddingY?: number;
};

type QortalLandDevelopmentLookSettings = {
  enabled: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  shadow: number;
};

const QORTAL_LAND_DEVELOPMENT_LOOK_DEFAULTS: QortalLandDevelopmentLookSettings =
  {
    enabled: true,
    brightness: 1.1,
    contrast: 1.05,
    saturation: 1,
    shadow: 0.1,
  };

const qortalLandDevelopmentPngModules = (import.meta as any).glob(
  '../../assets/qortalland/source/**/*.png',
  { eager: true, import: 'default' }
) as Record<string, string>;

const qortalLandDevelopmentWebpModules = (import.meta as any).glob(
  '../../assets/qortalland/source/**/*.webp',
  { eager: true, import: 'default' }
) as Record<string, string>;

const qortalLandDevelopmentWebpUrlById = new Map(
  Object.entries(qortalLandDevelopmentWebpModules).map(([path, url]) => {
    const id = path
      .replace(/^.*\/qortalland\/source\//, '')
      .replace(/\.webp$/i, '')
      .replace(/\\/g, '/');
    return [id, url] as const;
  })
);

const qortalLandDevelopmentPngAssets: QortalLandDevelopmentPngAsset[] =
  Object.entries(qortalLandDevelopmentPngModules).map(([path, url]) => {
    const id = path
      .replace(/^.*\/qortalland\/source\//, '')
      .replace(/\.png$/i, '')
      .replace(/\\/g, '/');
    const optimizedUrl = qortalLandDevelopmentWebpUrlById.get(id);
    const renderScale =
      optimizedUrl && QORTAL_LAND_OPTIMIZED_ASSET_DIMENSIONS[id]
        ? qortalLandOptimizedAssetRenderScale(id)
        : { x: 1, y: 1 };
    return {
      id,
      path,
      url: optimizedUrl ?? url,
      renderScaleX: renderScale.x,
      renderScaleY: renderScale.y,
    };
  });

const qortalLandDevelopmentPngAssetById = new Map(
  qortalLandDevelopmentPngAssets.map((asset) => [asset.id, asset])
);

const warnedMissingDevelopmentPngAssets = new Set<string>();

const qortalLandDevelopmentPngTextureKey = (assetId: string): string =>
  `${QORTAL_LAND_DEV_PNG_ASSET_KEY_PREFIX}:${assetId}`;

const qortalLandChatEmojiModules = (import.meta as any).glob(
  '../../assets/qortalland/chat-emojis/yahoo/*.gif',
  { eager: true, import: 'default' }
) as Record<string, string>;

const qortalLandChatEmojiUrlByFileName = new Map(
  Object.entries(qortalLandChatEmojiModules).map(([path, url]) => [
    path.split(/[\\/]/).pop() || path,
    url,
  ])
);

const qortalLandChatEmojiTextureKey = (emojiKey: string): string =>
  `qortalland-chat-emoji:${emojiKey}`;

const QORTAL_LAND_CHAT_EMOJIS: LandChatEmoji[] = [
  {
    key: 'smile',
    label: 'Smile',
    fileName: 'smile.gif',
    shortcuts: [':)', ':smile:'],
  },
  {
    key: 'smiley',
    label: 'Smiley',
    fileName: 'smiley.gif',
    shortcuts: [':D', ':smiley:'],
  },
  {
    key: 'lol',
    label: 'Laugh',
    fileName: 'lol.gif',
    shortcuts: [':))', ':lol:'],
  },
  {
    key: 'rofl',
    label: 'ROFL',
    fileName: 'rofl.gif',
    shortcuts: ['=))', ':rofl:'],
  },
  {
    key: 'wink',
    label: 'Wink',
    fileName: 'wink.gif',
    shortcuts: [';)', ':wink:'],
  },
  {
    key: 'cry',
    label: 'Cry',
    fileName: 'cry.gif',
    shortcuts: [":'(", ':cry:'],
  },
  {
    key: 'bawling',
    label: 'Bawling',
    fileName: 'bawling.gif',
    shortcuts: [":'((", ':bawling:'],
  },
  {
    key: 'grin',
    label: 'Grin',
    fileName: 'grin.gif',
    shortcuts: [':>', ':grin:'],
  },
  {
    key: 'triumph',
    label: 'Triumph',
    fileName: 'triumph.gif',
    shortcuts: ['\\:D/', ':triumph:'],
  },
  {
    key: 'clown',
    label: 'Clown',
    fileName: 'joker.gif',
    shortcuts: [':0)', ':clown:', ':joker:'],
  },
  {
    key: 'love',
    label: 'Love',
    fileName: 'kiss.gif',
    shortcuts: [':X', ':love:'],
  },
  {
    key: 'heart',
    label: 'Heart',
    fileName: 'heart.gif',
    shortcuts: ['<3', ':heart:'],
  },
  {
    key: 'hug',
    label: 'Hug',
    fileName: 'hug.gif',
    shortcuts: ['>:D<', ':hug:'],
  },
  {
    key: 'how_interesting',
    label: 'How interesting',
    fileName: 'how_interesting.gif',
    shortcuts: ['8->', ':how interesting:', ':how_interesting:'],
  },
  {
    key: 'heartbreak',
    label: 'Heartbreak',
    fileName: 'heartbreak.gif',
    shortcuts: ['</3', ':heartbreak:'],
  },
  {
    key: 'rage',
    label: 'Rage',
    fileName: 'rage.gif',
    shortcuts: ['>_<', ':rage:'],
  },
  {
    key: 'pig',
    label: 'Pig',
    fileName: 'pig.gif',
    shortcuts: [':@)', ':pig:'],
  },
  {
    key: 'kiss',
    label: 'Kiss',
    fileName: 'kiss.gif',
    shortcuts: [':*', ':kiss:'],
  },
  {
    key: 'confused',
    label: 'Confused',
    fileName: 'confused.gif',
    shortcuts: [':/', ':confused:'],
  },
  {
    key: 'confounded',
    label: 'Confounded',
    fileName: 'confounded.gif',
    shortcuts: [':s', ':confounded:'],
  },
  {
    key: 'get_outta_here',
    label: 'Get outta here',
    fileName: 'get_outta_here.gif',
    shortcuts: [':-J', ':get_outta_here:'],
  },
  {
    key: 'loser',
    label: 'Loser',
    fileName: 'loser.gif',
    shortcuts: [':-L', ':loser:', ':looser:'],
  },
  {
    key: 'whistle',
    label: 'Whistle',
    fileName: 'whistle.gif',
    shortcuts: [':-"', ':whistle:'],
  },
  {
    key: 'neutral',
    label: 'Neutral',
    fileName: 'neutral.gif',
    shortcuts: [':|', ':neutral:'],
  },
  {
    key: 'naughty',
    label: 'Naughty',
    fileName: 'naughty.gif',
    shortcuts: ['>:)', ':naughty:'],
  },
  {
    key: 'relaxed',
    label: 'Relaxed',
    fileName: 'relaxed.gif',
    shortcuts: [';;)', ':relaxed:'],
  },
  {
    key: 'i_dunno',
    label: 'I dunno',
    fileName: 'i_dunno.gif',
    shortcuts: [':-??', ':i_dunno:'],
  },
  {
    key: 'pensive',
    label: 'Pensive',
    fileName: 'pensive.gif',
    shortcuts: [':-?', ':pensive:'],
  },
  {
    key: 'money',
    label: 'Money',
    fileName: 'money.gif',
    shortcuts: [':-$', ':money:'],
  },
  {
    key: 'peace',
    label: 'Peace',
    fileName: 'peace.gif',
    shortcuts: [':->-', ':peace:'],
  },
  {
    key: 'tongue',
    label: 'Tongue',
    fileName: 'tongue.gif',
    shortcuts: [':p', ':tongue:'],
  },
  {
    key: 'time_out',
    label: 'Time out',
    fileName: 'time_out.gif',
    shortcuts: [':-T', ':time_out:'],
  },
  {
    key: 'dog',
    label: 'Dog',
    fileName: 'dog.gif',
    shortcuts: [':o3', ':dog:'],
  },
  {
    key: 'angry',
    label: 'Angry',
    fileName: 'angry.gif',
    shortcuts: [':-W', ':angry:'],
  },
  {
    key: 'blush',
    label: 'Blush',
    fileName: 'blush.gif',
    shortcuts: [':3', ':blush:'],
  },
  {
    key: 'sad',
    label: 'Sad',
    fileName: 'frowning.gif',
    shortcuts: [':(', ':sad:'],
  },
  {
    key: 'surprised',
    label: 'Surprised',
    fileName: 'open_mouth.gif',
    shortcuts: [':o', ':surprised:'],
  },
  {
    key: 'cool',
    label: 'Cool',
    fileName: 'sunglasses.gif',
    shortcuts: ['B)', '8-)', ':cool:'],
  },
];

const QORTAL_LAND_AVAILABLE_CHAT_EMOJIS = QORTAL_LAND_CHAT_EMOJIS.filter(
  (emoji) => qortalLandChatEmojiUrlByFileName.has(emoji.fileName)
);

const QORTAL_LAND_CHAT_EMOJI_SHORTCUTS = QORTAL_LAND_CHAT_EMOJIS.flatMap(
  (emoji) => emoji.shortcuts.map((shortcut) => ({ emoji, shortcut }))
).sort((a, b) => b.shortcut.length - a.shortcut.length);

const splitLandChatEmojiText = (
  text: string,
  options: { requireTrailingWhitespace?: boolean } = {}
): LandChatTextPart[] => {
  const parts: LandChatTextPart[] = [];
  const lowerText = text.toLowerCase();
  let pendingText = '';
  let index = 0;

  while (index < text.length) {
    const match = QORTAL_LAND_CHAT_EMOJI_SHORTCUTS.find(
      ({ shortcut }) =>
        lowerText.startsWith(shortcut.toLowerCase(), index) &&
        (index === 0 || /\s/.test(text[index - 1])) &&
        (options.requireTrailingWhitespace
          ? /\s/.test(text[index + shortcut.length] || '')
          : index + shortcut.length === text.length ||
            /\s/.test(text[index + shortcut.length] || ''))
    );

    if (!match) {
      pendingText += text[index];
      index += 1;
      continue;
    }

    if (pendingText) {
      parts.push({ type: 'text', text: pendingText });
      pendingText = '';
    }
    parts.push({
      type: 'emoji',
      emoji: match.emoji,
      shortcut: text.slice(index, index + match.shortcut.length),
    });
    index += match.shortcut.length;
  }

  if (pendingText) {
    parts.push({ type: 'text', text: pendingText });
  }

  return parts;
};

const renderLandChatTextParts = (
  text: string,
  options: { requireTrailingWhitespace?: boolean } = {}
) =>
  splitLandChatEmojiText(text, options).map((part, index) => {
    if (part.type === 'text') {
      return (
        <Box component="span" key={`text-${index}`}>
          {part.text}
        </Box>
      );
    }

    const emojiUrl = qortalLandChatEmojiUrlByFileName.get(part.emoji.fileName);
    if (!emojiUrl) {
      return (
        <Box component="span" key={`missing-emoji-${index}`}>
          {part.shortcut}
        </Box>
      );
    }

    return (
      <Box
        alt={part.emoji.label}
        component="img"
        key={`emoji-${part.emoji.key}-${index}`}
        src={emojiUrl}
        sx={{
          display: 'inline-block',
          height: 18,
          margin: '0 2px',
          objectFit: 'contain',
          verticalAlign: '-4px',
          width: 'auto',
        }}
      />
    );
  });

const clampQortalLandLookValue = (
  value: number,
  min: number,
  max: number,
  fallback: number
): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
};

const readQortalLandDevelopmentLookSettings =
  (): QortalLandDevelopmentLookSettings => {
    if (typeof window === 'undefined')
      return { ...QORTAL_LAND_DEVELOPMENT_LOOK_DEFAULTS };
    try {
      const raw = window.localStorage.getItem(QORTAL_LAND_DEV_LOOK_STORAGE_KEY);
      if (!raw) return { ...QORTAL_LAND_DEVELOPMENT_LOOK_DEFAULTS };
      const parsed = JSON.parse(
        raw
      ) as Partial<QortalLandDevelopmentLookSettings>;
      return {
        enabled:
          typeof parsed.enabled === 'boolean'
            ? parsed.enabled
            : QORTAL_LAND_DEVELOPMENT_LOOK_DEFAULTS.enabled,
        brightness: clampQortalLandLookValue(
          Number(parsed.brightness),
          0.65,
          1.25,
          QORTAL_LAND_DEVELOPMENT_LOOK_DEFAULTS.brightness
        ),
        contrast: clampQortalLandLookValue(
          Number(parsed.contrast),
          0.75,
          1.55,
          QORTAL_LAND_DEVELOPMENT_LOOK_DEFAULTS.contrast
        ),
        saturation: clampQortalLandLookValue(
          Number(parsed.saturation),
          0.75,
          1.65,
          QORTAL_LAND_DEVELOPMENT_LOOK_DEFAULTS.saturation
        ),
        shadow: clampQortalLandLookValue(
          Number(parsed.shadow),
          0,
          0.5,
          QORTAL_LAND_DEVELOPMENT_LOOK_DEFAULTS.shadow
        ),
      };
    } catch {
      return { ...QORTAL_LAND_DEVELOPMENT_LOOK_DEFAULTS };
    }
  };

const writeQortalLandDevelopmentLookSettings = (
  settings: QortalLandDevelopmentLookSettings
): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    QORTAL_LAND_DEV_LOOK_STORAGE_KEY,
    JSON.stringify(settings)
  );
};

const qortalLandCharacterCustomizationStorageKey = (address: string): string =>
  `${QORTAL_LAND_CHARACTER_CUSTOMIZATION_STORAGE_KEY}.${address || 'local'}`;

const qortalLandCharacterSkinStorageKey = (address: string): string =>
  `${QORTAL_LAND_CHARACTER_SKIN_STORAGE_KEY}.${address || 'local'}`;

const readQortalLandCharacterSkin = (address: string): QortalLandSkinId => {
  if (typeof window === 'undefined') return 1;
  return normalizeQortalLandSkinId(
    window.localStorage.getItem(qortalLandCharacterSkinStorageKey(address))
  );
};

const writeQortalLandCharacterSkin = (
  address: string,
  skinId: QortalLandSkinId
): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    qortalLandCharacterSkinStorageKey(address),
    String(skinId)
  );
};

const readQortalLandCharacterCustomization = (
  address: string
): QortalLandCharacterCustomization => {
  if (typeof window === 'undefined')
    return { ...QORTAL_LAND_CHARACTER_CUSTOMIZATION_DEFAULTS };
  try {
    const raw = window.localStorage.getItem(
      qortalLandCharacterCustomizationStorageKey(address)
    );
    if (!raw) return { ...QORTAL_LAND_CHARACTER_CUSTOMIZATION_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<QortalLandCharacterCustomization>;
    const hasOption = (
      category: keyof QortalLandCharacterCustomization,
      value: unknown
    ): value is string =>
      typeof value === 'string' &&
      QORTAL_LAND_CHARACTER_CUSTOMIZATION_OPTIONS[category].some(
        (option) => option.value === value
      );
    return {
      hair: hasOption('hair', parsed.hair)
        ? parsed.hair
        : QORTAL_LAND_CHARACTER_CUSTOMIZATION_DEFAULTS.hair,
      face: hasOption('face', parsed.face)
        ? parsed.face
        : QORTAL_LAND_CHARACTER_CUSTOMIZATION_DEFAULTS.face,
      clothes: hasOption('clothes', parsed.clothes)
        ? parsed.clothes
        : QORTAL_LAND_CHARACTER_CUSTOMIZATION_DEFAULTS.clothes,
    };
  } catch {
    return { ...QORTAL_LAND_CHARACTER_CUSTOMIZATION_DEFAULTS };
  }
};

const writeQortalLandCharacterCustomization = (
  address: string,
  customization: QortalLandCharacterCustomization
): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    qortalLandCharacterCustomizationStorageKey(address),
    JSON.stringify(customization)
  );
};

const qortalLandDevelopmentLookSignature = (
  settings: QortalLandDevelopmentLookSettings
): string =>
  [
    settings.enabled ? 'on' : 'off',
    settings.brightness.toFixed(3),
    settings.contrast.toFixed(3),
    settings.saturation.toFixed(3),
    settings.shadow.toFixed(3),
  ].join(':');

const readQortalLandDevelopmentPngPlacementOverride = (
  placementId: string
): Partial<QortalLandDevelopmentPngPropPlacement> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(
      `${QORTAL_LAND_DEV_PNG_PLACEMENT_STORAGE_PREFIX}${placementId}`
    );
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const override: Partial<QortalLandDevelopmentPngPropPlacement> = {};
    for (const key of [
      'x',
      'y',
      'depth',
      'depthOffset',
      'originX',
      'originY',
      'scale',
      'scaleX',
      'scaleY',
      'alpha',
      'count',
      'spacing',
    ] as const) {
      const value = Number(parsed[key]);
      if (Number.isFinite(value)) {
        override[key] = value;
      }
    }
    if (typeof parsed.flipX === 'boolean') {
      override.flipX = parsed.flipX;
    }
    if (parsed.warp && typeof parsed.warp === 'object') {
      const warpSource = parsed.warp as Record<string, unknown>;
      const warp: NonNullable<QortalLandDevelopmentPngPropPlacement['warp']> =
        {};
      for (const key of [
        'tlX',
        'tlY',
        'trX',
        'trY',
        'brX',
        'brY',
        'blX',
        'blY',
      ] as const) {
        const value = Number(warpSource[key]);
        if (Number.isFinite(value)) {
          warp[key] = value;
        }
      }
      override.warp = warp;
    }
    return override;
  } catch {
    return {};
  }
};

const writeQortalLandDevelopmentPngPlacementOverride = (
  placementId: string,
  placement: Partial<QortalLandDevelopmentPngPropPlacement>
): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    `${QORTAL_LAND_DEV_PNG_PLACEMENT_STORAGE_PREFIX}${placementId}`,
    JSON.stringify(placement)
  );
};

const clearQortalLandDevelopmentPngPlacementOverride = (
  placementId: string
): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(
    `${QORTAL_LAND_DEV_PNG_PLACEMENT_STORAGE_PREFIX}${placementId}`
  );
};

const notifyQortalLandDevelopmentAssetsChanged = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(QORTAL_LAND_DEV_ASSETS_CHANGED_EVENT));
};

const shouldShowQortalLandDevelopmentPngProps = (): boolean => {
  if (typeof window === 'undefined') return false;
  const queryMode = new URLSearchParams(window.location.search).get(
    'qortallandAssets'
  );
  if (
    queryMode === 'png' ||
    queryMode === 'props' ||
    queryMode === '1' ||
    queryMode === 'true'
  ) {
    return true;
  }
  if (
    queryMode === 'procedural' ||
    queryMode === '0' ||
    queryMode === 'false'
  ) {
    return false;
  }
  return (
    window.localStorage.getItem(QORTAL_LAND_DEV_PNG_PROPS_STORAGE_KEY) !== '0'
  );
};

const shouldShowQortalLandProceduralClubShell = (): boolean => {
  if (typeof window === 'undefined') return false;
  return (
    window.localStorage.getItem(
      QORTAL_LAND_DEV_PROCEDURAL_CLUB_SHELL_STORAGE_KEY
    ) === '1'
  );
};

const shouldShowQortalLandCollisionDebug = (): boolean => {
  if (typeof window === 'undefined') return false;
  return (
    window.localStorage.getItem(QORTAL_LAND_DEV_COLLISION_DEBUG_STORAGE_KEY) ===
    '1'
  );
};

const shouldUseDevelopmentClubBarPng = (): boolean =>
  shouldShowQortalLandDevelopmentPngProps() &&
  qortalLandDevelopmentPngAssetById.has(
    QORTAL_LAND_DEVELOPMENT_CLUB_BAR_ASSET_ID
  );

const shouldUseDevelopmentClubSofasPng = (): boolean =>
  shouldShowQortalLandDevelopmentPngProps() &&
  QORTAL_LAND_DEVELOPMENT_SOFA_MODERN_A_ASSET_IDS.every((assetId) =>
    qortalLandDevelopmentPngAssetById.has(assetId)
  );

const QORTAL_LAND_DEVELOPMENT_CLUB_FLOOR_DEFAULT_PLACEMENT: QortalLandDevelopmentPngPropPlacement =
  {
    id: QORTAL_LAND_DEVELOPMENT_CLUB_FLOOR_PLACEMENT_ID,
    assetId: QORTAL_LAND_DEVELOPMENT_CLUB_FLOOR_ASSET_ID,
    roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
    x: 0,
    y: 0,
    depthMode: 'fixed',
    depth: -95,
    originX: 0,
    originY: 0,
    scale: 1,
  };

const QORTAL_LAND_DEVELOPMENT_PARK_SKYLINE_DEFAULT_PLACEMENT: QortalLandDevelopmentPngPropPlacement =
  {
    id: QORTAL_LAND_DEVELOPMENT_PARK_SKYLINE_PLACEMENT_ID,
    assetId: QORTAL_LAND_DEVELOPMENT_PARK_SKYLINE_ASSET_ID,
    roomIds: [QORTAL_LAND_PARK_ROOM_ID],
    x: 900,
    y: 282,
    depthMode: 'fixed',
    depth: -99,
    originX: 0.5,
    originY: 1,
    scale: 0.98,
    alpha: 1,
  };

const QORTAL_LAND_DEVELOPMENT_PARK_FLOOR_DEFAULT_PLACEMENT: QortalLandDevelopmentPngPropPlacement =
  {
    id: QORTAL_LAND_DEVELOPMENT_PARK_FLOOR_PLACEMENT_ID,
    assetId: QORTAL_LAND_DEVELOPMENT_PARK_FLOOR_ASSET_ID,
    roomIds: [QORTAL_LAND_PARK_ROOM_ID],
    x: 900,
    y: 704,
    depthMode: 'fixed',
    depth: -95,
    originX: 0.5,
    originY: 1,
    scale: 0.946,
  };

const QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_DEFAULT_PLACEMENT: QortalLandDevelopmentPngPropPlacement =
  {
    id: QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_PLACEMENT_ID,
    assetId: QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_CLOSED_ASSET_ID,
    roomIds: [QORTAL_LAND_PARK_ROOM_ID],
    x: 551,
    y: 330,
    depthMode: 'fixed',
    depth: 200,
    originX: 0.5,
    originY: 1,
    scale: 0.24,
    alpha: 1,
    collisions: [
      {
        shape: 'rect',
        offsetX: -250,
        offsetY: -92,
        width: 88,
        height: 740,
      },
      {
        shape: 'rect',
        offsetX: 305,
        offsetY: -92,
        width: 88,
        height: 740,
      },
    ],
  };

const QORTAL_LAND_DEVELOPMENT_BACK_WALL_DEFAULT_PLACEMENT: QortalLandDevelopmentPngPropPlacement =
  {
    id: QORTAL_LAND_DEVELOPMENT_BACK_WALL_PLACEMENT_ID,
    assetId: QORTAL_LAND_DEVELOPMENT_BACK_WALL_ASSET_ID,
    roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
    x: 901,
    y: 314,
    depthMode: 'fixed',
    depth: -100,
    originX: 0.5,
    originY: 1,
    scale: 0.9,
  };

const QORTAL_LAND_DEVELOPMENT_LEFT_WALL_DEFAULT_PLACEMENT: QortalLandDevelopmentPngPropPlacement =
  {
    id: QORTAL_LAND_DEVELOPMENT_LEFT_WALL_PLACEMENT_ID,
    assetId: QORTAL_LAND_DEVELOPMENT_LEFT_WALL_ASSET_ID,
    roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
    x: 188,
    y: 116,
    depthMode: 'fixed',
    depth: -98,
    originX: 0.464,
    originY: 0.105,
    scale: 1.09,
  };

const QORTAL_LAND_DEVELOPMENT_RIGHT_WALL_DEFAULT_PLACEMENT: QortalLandDevelopmentPngPropPlacement =
  {
    id: QORTAL_LAND_DEVELOPMENT_RIGHT_WALL_PLACEMENT_ID,
    assetId: QORTAL_LAND_DEVELOPMENT_RIGHT_WALL_ASSET_ID,
    roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
    x: 1621,
    y: 39,
    depthMode: 'fixed',
    depth: -98,
    originX: 0.583,
    originY: -0.004,
    scale: 1.09,
  };

const QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_DEFAULT_PLACEMENT: QortalLandDevelopmentPngPropPlacement =
  {
    id: QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_PLACEMENT_ID,
    assetId: QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_CLOSED_ASSET_ID,
    roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
    x: 1593,
    y: 362,
    depthMode: 'fixed',
    depth: -82,
    originX: 0.011,
    originY: 0.382,
    scale: 0.79,
    warp: {
      tlX: 11,
      tlY: 0,
      trX: 0,
      trY: 0,
      brX: 0,
      brY: 11,
      blX: 10,
      blY: 8,
    },
  };

const QORTAL_LAND_DEVELOPMENT_CLUB_BAR_DEFAULT_PLACEMENT: QortalLandDevelopmentPngPropPlacement =
  {
    id: QORTAL_LAND_DEVELOPMENT_CLUB_BAR_PLACEMENT_ID,
    assetId: QORTAL_LAND_DEVELOPMENT_CLUB_BAR_ASSET_ID,
    roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
    x: 900,
    y: 400,
    depthMode: 'fixed',
    depth: 370,
    originX: 0.5,
    originY: 0.649,
    scaleX: 0.552,
    scaleY: 0.379,
    collision: {
      shape: 'rect',
      offsetY: -72,
      width: 1370,
      height: 165,
      paddingY: -7,
    },
  };

const QORTAL_LAND_DEVELOPMENT_BACK_BAR_DEFAULT_PLACEMENT: QortalLandDevelopmentPngPropPlacement =
  {
    id: QORTAL_LAND_DEVELOPMENT_BACK_BAR_PLACEMENT_ID,
    assetId: QORTAL_LAND_DEVELOPMENT_BACK_BAR_ASSET_ID,
    roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
    x: 900,
    y: 184,
    depthMode: 'fixed',
    depth: 330,
    originX: 0.5,
    originY: 0.5,
    scale: 0.37,
  };

const QORTAL_LAND_DEVELOPMENT_DJ_BOOTH_DEFAULT_PLACEMENT: QortalLandDevelopmentPngPropPlacement =
  {
    id: QORTAL_LAND_DEVELOPMENT_DJ_BOOTH_PLACEMENT_ID,
    assetId: QORTAL_LAND_DEVELOPMENT_DJ_BOOTH_ASSET_ID,
    roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
    x: 901,
    y: 277,
    depthMode: 'fixed',
    depth: 400,
    originX: 0.512,
    originY: 0.724,
    scale: 0.14,
    contactShadow: {
      offsetY: 11,
      width: 220,
      height: 14,
      alpha: 0.32,
      depth: 385,
    },
  };

const QORTAL_LAND_DEVELOPMENT_SOFA_MODERN_A_DEFAULT_PLACEMENTS: QortalLandDevelopmentPngPropPlacement[] =
  [
    {
      id: 'club.sofa_modern_a_teal_png',
      assetId: QORTAL_LAND_DEVELOPMENT_SOFA_MODERN_A_TEAL_ASSET_ID,
      roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
      x: 1340,
      y: 542,
      depth: 480,
      depthMode: 'y-sort',
      depthOffset: 20,
      originX: 0.5,
      originY: 0.9,
      scale: 0.19,
      alpha: 1,
      contactShadow: {
        offsetY: 6,
        width: 230,
        height: 28,
        alpha: 0.24,
      },
      collision: {
        shape: 'ellipse',
        offsetY: -10,
        width: 900,
        height: 170,
      },
    },
    {
      id: 'club.sofa_modern_a_purple_png',
      assetId: QORTAL_LAND_DEVELOPMENT_SOFA_MODERN_A_PURPLE_ASSET_ID,
      roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
      x: 405,
      y: 542,
      depth: 665,
      depthMode: 'y-sort',
      depthOffset: 20,
      originX: 0.5,
      originY: 0.9,
      scale: 0.21,
      alpha: 1,
      contactShadow: {
        offsetY: 6,
        width: 250,
        height: 30,
        alpha: 0.24,
      },
      collision: {
        shape: 'ellipse',
        offsetY: -10,
        width: 900,
        height: 170,
      },
    },
  ];

const QORTAL_LAND_DEVELOPMENT_TABLE_DEFAULT_PLACEMENTS: QortalLandDevelopmentPngPropPlacement[] =
  [
    {
      id: 'club.table_round_low_left_png',
      assetId: QORTAL_LAND_DEVELOPMENT_TABLE_ROUND_LOW_ASSET_ID,
      roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
      x: 403,
      y: 581,
      depth: 685,
      depthMode: 'y-sort',
      depthOffset: 20,
      originX: 0.5,
      originY: 0.88,
      scale: 0.14,
      alpha: 1,
      contactShadow: {
        offsetY: 4,
        width: 136,
        height: 24,
        alpha: 0.2,
      },
      collision: {
        shape: 'ellipse',
        offsetY: -6,
        width: 760,
        height: 300,
      },
    },
    {
      id: 'club.table_round_low_right_png',
      assetId: QORTAL_LAND_DEVELOPMENT_TABLE_ROUND_LOW_ASSET_ID,
      roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
      x: 1336,
      y: 581,
      depthMode: 'y-sort',
      depthOffset: 20,
      originX: 0.5,
      originY: 0.88,
      scale: 0.14,
      alpha: 1,
      contactShadow: {
        offsetY: 4,
        width: 136,
        height: 24,
        alpha: 0.2,
      },
      collision: {
        shape: 'ellipse',
        offsetY: -6,
        width: 760,
        height: 300,
      },
    },
  ];

const QORTAL_LAND_DEVELOPMENT_BAR_STOOL_GROUP_DEFAULT_PLACEMENT: QortalLandDevelopmentPngPropPlacement =
  {
    id: 'club.bar_stool_round_group_png',
    assetId: QORTAL_LAND_DEVELOPMENT_BAR_STOOL_ROUND_ASSET_ID,
    roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
    x: 900,
    y: 402,
    depthMode: 'y-sort',
    depthOffset: 20,
    originX: 0.5,
    originY: 0.863,
    scale: 0.14,
    alpha: 1,
    count: 5,
    spacing: 118,
    contactShadow: {
      offsetY: 4,
      width: 52,
      height: 14,
      alpha: 0.18,
    },
    collision: {
      shape: 'ellipse',
      offsetY: 10,
      width: 190,
      height: 180,
      paddingX: -7,
      paddingY: -4,
    },
  };

const QORTAL_LAND_DEVELOPMENT_SPEAKER_DEFAULT_PLACEMENTS: QortalLandDevelopmentPngPropPlacement[] =
  [
    {
      id: 'club.speaker_left_png',
      assetId: QORTAL_LAND_DEVELOPMENT_SPEAKER_LEFT_ASSET_ID,
      roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
      x: 215,
      y: 636,
      depthMode: 'y-sort',
      depthOffset: 20,
      originX: 0.5,
      originY: 0.976,
      scale: 0.66,
      alpha: 1,
      contactShadow: {
        offsetY: 5,
        width: 74,
        height: 18,
        alpha: 0.22,
      },
      collision: {
        shape: 'ellipse',
        offsetY: -36,
        width: 84,
        height: 92,
      },
    },
    {
      id: 'club.speaker_right_png',
      assetId: QORTAL_LAND_DEVELOPMENT_SPEAKER_RIGHT_ASSET_ID,
      roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
      x: 1590,
      y: 636,
      depthMode: 'y-sort',
      depthOffset: 20,
      originX: 0.5,
      originY: 0.954,
      scale: 0.66,
      alpha: 1,
      contactShadow: {
        offsetY: 5,
        width: 74,
        height: 18,
        alpha: 0.22,
      },
      collision: {
        shape: 'ellipse',
        offsetY: -36,
        width: 84,
        height: 92,
      },
    },
  ];

const QORTAL_LAND_DEVELOPMENT_DECORATION_DEFAULT_PLACEMENTS: QortalLandDevelopmentPngPropPlacement[] =
  [
    {
      id: 'club.planter_rect_tropical_png',
      assetId: QORTAL_LAND_DEVELOPMENT_PLANTER_RECT_TROPICAL_ASSET_ID,
      roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
      x: 1407,
      y: 335,
      depthMode: 'y-sort',
      depthOffset: 20,
      originX: 0.553,
      originY: 0.847,
      scale: 0.18,
      alpha: 1,
      contactShadow: {
        offsetY: 5,
        width: 180,
        height: 24,
        alpha: 0.22,
      },
      collision: {
        shape: 'ellipse',
        offsetY: 18,
        width: 760,
        height: 190,
      },
    },
    {
      id: 'club.planter_tall_tropical_png',
      assetId: QORTAL_LAND_DEVELOPMENT_PLANTER_TALL_TROPICAL_ASSET_ID,
      roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
      x: 409,
      y: 320,
      depthMode: 'y-sort',
      depthOffset: 20,
      originX: 0.5,
      originY: 0.915,
      scale: 0.16,
      alpha: 1,
      contactShadow: {
        offsetY: 5,
        width: 92,
        height: 22,
        alpha: 0.22,
      },
      collision: {
        shape: 'ellipse',
        offsetY: 12,
        width: 430,
        height: 230,
      },
    },
    {
      id: 'club.qortal_neon_light_png',
      assetId: QORTAL_LAND_DEVELOPMENT_QORTAL_NEON_LIGHT_ASSET_ID,
      roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
      x: 1551,
      y: 239,
      depthMode: 'fixed',
      depth: 335,
      originX: 0.581,
      originY: 0.472,
      scale: 0.17,
      alpha: 1,
      warp: {
        tlX: 250,
        tlY: 0,
        trX: -50,
        trY: 0,
        brX: 0,
        brY: 500,
        blX: 220,
        blY: 0,
      },
    },
  ];

const QORTAL_LAND_DEVELOPMENT_PARK_PROP_DEFAULT_PLACEMENTS: QortalLandDevelopmentPngPropPlacement[] =
  [
    {
      id: 'park.bench_planter_left_png',
      assetId: QORTAL_LAND_DEVELOPMENT_PARK_BENCH_PLANTER_LEFT_ASSET_ID,
      roomIds: [QORTAL_LAND_PARK_ROOM_ID],
      x: 310,
      y: 321,
      depthMode: 'y-sort',
      depthOffset: 18,
      originX: 0.5,
      originY: 0.75,
      scale: 0.22,
      angle: 0,
      alpha: 1,
      contactShadow: {
        offsetY: 10,
        width: 330,
        height: 38,
        alpha: 0.18,
      },
      collision: {
        shape: 'ellipse',
        offsetY: 20,
        width: 1260,
        height: 190,
      },
    },
    {
      id: 'park.bench_straight_png',
      assetId: QORTAL_LAND_DEVELOPMENT_PARK_BENCH_STRAIGHT_ASSET_ID,
      roomIds: [QORTAL_LAND_PARK_ROOM_ID],
      x: 1150,
      y: 620,
      depthMode: 'y-sort',
      depthOffset: 12,
      originX: 0.5,
      originY: 0.9,
      scale: 0.18,
      angle: 0,
      alpha: 1,
      contactShadow: {
        offsetY: 8,
        width: 260,
        height: 30,
        alpha: 0.16,
      },
      collision: {
        shape: 'rect',
        offsetY: 16,
        width: 1040,
        height: 150,
      },
    },
    {
      id: 'park.bench_curved_png',
      assetId: QORTAL_LAND_DEVELOPMENT_PARK_BENCH_CURVED_ASSET_ID,
      roomIds: [QORTAL_LAND_PARK_ROOM_ID],
      x: 1260,
      y: 388,
      depthMode: 'y-sort',
      depthOffset: 12,
      originX: 0.5,
      originY: 0.75,
      scale: 0.22,
      angle: 0,
      alpha: 1,
      contactShadow: {
        offsetY: 8,
        width: 270,
        height: 30,
        alpha: 0.16,
      },
      collisions: [
        {
          shape: 'rect',
          offsetY: 62,
          width: 860,
          height: 120,
        },
        {
          shape: 'ellipse',
          offsetX: -486,
          offsetY: 48,
          width: 260,
          height: 210,
        },
        {
          shape: 'ellipse',
          offsetX: 486,
          offsetY: 48,
          width: 260,
          height: 210,
        },
        {
          shape: 'rect',
          offsetY: -6,
          width: 720,
          height: 84,
        },
      ],
    },
    {
      id: 'park.tree_round_large_png',
      assetId: QORTAL_LAND_DEVELOPMENT_PARK_TREE_ROUND_LARGE_ASSET_ID,
      roomIds: [QORTAL_LAND_PARK_ROOM_ID],
      x: 1520,
      y: 350,
      depthMode: 'y-sort',
      depthOffset: 22,
      originX: 0.5,
      originY: 0.85,
      scale: 0.18,
      angle: 0,
      alpha: 1,
      contactShadow: {
        offsetY: 10,
        width: 180,
        height: 36,
        alpha: 0.18,
      },
      collision: {
        shape: 'ellipse',
        offsetY: 18,
        width: 820,
        height: 260,
      },
    },
    {
      id: 'park.tree_round_tall_png',
      assetId: QORTAL_LAND_DEVELOPMENT_PARK_TREE_ROUND_TALL_ASSET_ID,
      roomIds: [QORTAL_LAND_PARK_ROOM_ID],
      x: 1600,
      y: 500,
      depthMode: 'y-sort',
      depthOffset: 22,
      originX: 0.5,
      originY: 0.85,
      scale: 0.18,
      angle: 0,
      alpha: 1,
      contactShadow: {
        offsetY: 10,
        width: 150,
        height: 34,
        alpha: 0.18,
      },
      collision: {
        shape: 'ellipse',
        offsetY: 18,
        width: 600,
        height: 240,
      },
    },
    {
      id: 'park.tree_planter_lamp_png',
      assetId: QORTAL_LAND_DEVELOPMENT_PARK_TREE_PLANTER_LAMP_ASSET_ID,
      roomIds: [QORTAL_LAND_PARK_ROOM_ID],
      x: 1520,
      y: 610,
      depthMode: 'y-sort',
      depthOffset: 22,
      originX: 0.5,
      originY: 0.85,
      scale: 0.2,
      angle: 0,
      alpha: 1,
      contactShadow: {
        offsetY: 10,
        width: 240,
        height: 36,
        alpha: 0.18,
      },
      collision: {
        shape: 'ellipse',
        offsetY: 18,
        width: 1000,
        height: 250,
      },
    },
    {
      id: QORTAL_LAND_DEVELOPMENT_PARK_FOUNTAIN_BLUE_PLACEMENT_ID,
      assetId: QORTAL_LAND_DEVELOPMENT_PARK_FOUNTAIN_BLUE_ASSET_ID,
      roomIds: [QORTAL_LAND_PARK_ROOM_ID],
      x: 1253,
      y: 490,
      depthMode: 'y-sort',
      depthOffset: 18,
      originX: 0.5,
      originY: 0.86,
      scale: 0.19,
      angle: 0,
      alpha: 1,
      contactShadow: {
        offsetY: 10,
        width: 210,
        height: 34,
        alpha: 0.16,
      },
      collision: {
        shape: 'ellipse',
        offsetY: 20,
        width: 900,
        height: 270,
      },
    },
    {
      id: QORTAL_LAND_DEVELOPMENT_PARK_PLANTER_ROW_TREES_PLACEMENT_ID,
      assetId: QORTAL_LAND_DEVELOPMENT_PARK_PLANTER_ROW_TREES_ASSET_ID,
      roomIds: [QORTAL_LAND_PARK_ROOM_ID],
      x: 820,
      y: 310,
      depthMode: 'fixed',
      depth: 200,
      originX: 0.5,
      originY: 0.86,
      scale: 0.2,
      angle: 0,
      alpha: 1,
      contactShadow: {
        offsetY: 10,
        width: 280,
        height: 34,
        alpha: 0.16,
      },
      collision: {
        shape: 'ellipse',
        offsetY: 18,
        width: 1120,
        height: 230,
      },
    },
    {
      id: 'park.planter_corner_trees_png',
      assetId: QORTAL_LAND_DEVELOPMENT_PARK_PLANTER_CORNER_TREES_ASSET_ID,
      roomIds: [QORTAL_LAND_PARK_ROOM_ID],
      x: 189,
      y: 597,
      depthMode: 'y-sort',
      depthOffset: 22,
      originX: 0.5,
      originY: 0.86,
      scale: 0.38,
      angle: 0,
      alpha: 1,
      contactShadow: {
        offsetY: 10,
        width: 280,
        height: 34,
        alpha: 0.16,
      },
      collisions: [
        {
          shape: 'ellipse',
          offsetY: -55,
          width: 780,
          height: 250,
        },
        {
          shape: 'ellipse',
          offsetX: -115,
          offsetY: -350,
          width: 420,
          height: 360,
        },
        {
          shape: 'ellipse',
          offsetX: 80,
          offsetY: -300,
          width: 360,
          height: 250,
        },
        {
          shape: 'ellipse',
          offsetX: 145,
          offsetY: -130,
          width: 360,
          height: 270,
        },
      ],
    },
  ];

const QORTAL_LAND_DEVELOPMENT_DANCE_FLOOR_DEFAULT_PLACEMENT: QortalLandDevelopmentPngPropPlacement =
  {
    id: 'club.dance_floor_png',
    assetId: QORTAL_LAND_DEVELOPMENT_DANCE_FLOOR_ASSET_ID,
    roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
    x: 900,
    y: 537,
    depthMode: 'fixed',
    depth: -86,
    originX: 0.5,
    originY: 0.5,
    scale: 0.72,
    alpha: 1,
  };

const getQortalLandDevelopmentClubBarPlacement =
  (): QortalLandDevelopmentPngPropPlacement => ({
    ...QORTAL_LAND_DEVELOPMENT_CLUB_BAR_DEFAULT_PLACEMENT,
    ...readQortalLandDevelopmentPngPlacementOverride(
      QORTAL_LAND_DEVELOPMENT_CLUB_BAR_PLACEMENT_ID
    ),
  });

const getQortalLandDevelopmentBackBarPlacement =
  (): QortalLandDevelopmentPngPropPlacement => ({
    ...QORTAL_LAND_DEVELOPMENT_BACK_BAR_DEFAULT_PLACEMENT,
    ...readQortalLandDevelopmentPngPlacementOverride(
      QORTAL_LAND_DEVELOPMENT_BACK_BAR_PLACEMENT_ID
    ),
  });

const getQortalLandDevelopmentDjBoothPlacement =
  (): QortalLandDevelopmentPngPropPlacement => ({
    ...QORTAL_LAND_DEVELOPMENT_DJ_BOOTH_DEFAULT_PLACEMENT,
    ...readQortalLandDevelopmentPngPlacementOverride(
      QORTAL_LAND_DEVELOPMENT_DJ_BOOTH_PLACEMENT_ID
    ),
  });

const getQortalLandDevelopmentClubDoorPlacement =
  (): QortalLandDevelopmentPngPropPlacement => ({
    ...QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_DEFAULT_PLACEMENT,
    ...readQortalLandDevelopmentPngPlacementOverride(
      QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_PLACEMENT_ID
    ),
  });

const getQortalLandDevelopmentParkPortalPlacement =
  (): QortalLandDevelopmentPngPropPlacement => ({
    ...QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_DEFAULT_PLACEMENT,
    ...readQortalLandDevelopmentPngPlacementOverride(
      QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_PLACEMENT_ID
    ),
  });

const QORTAL_LAND_EDITABLE_DEVELOPMENT_PLACEMENTS = [
  {
    label: 'Club Floor',
    sourceLabel: 'source/architecture/club_floor.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_CLUB_FLOOR_DEFAULT_PLACEMENT,
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Park Floor',
    sourceLabel: 'source/architecture/park_floor.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_PARK_FLOOR_DEFAULT_PLACEMENT,
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Park Skyline',
    sourceLabel: 'source/architecture/park_skyline.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_PARK_SKYLINE_DEFAULT_PLACEMENT,
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Park Portal',
    sourceLabel:
      'source/architecture/park_portal_closed.png + park_portal_open_1..4.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_DEFAULT_PLACEMENT,
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Park Bench Planter',
    sourceLabel: 'source/decorations/park_bench_planter_left.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_PARK_PROP_DEFAULT_PLACEMENTS[0],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Park Bench Straight',
    sourceLabel: 'source/furniture/park_bench_straight.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_PARK_PROP_DEFAULT_PLACEMENTS[1],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Park Bench Curved',
    sourceLabel: 'source/furniture/park_bench_curved.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_PARK_PROP_DEFAULT_PLACEMENTS[2],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Park Tree Round Large',
    sourceLabel: 'source/decorations/park_tree_round_large.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_PARK_PROP_DEFAULT_PLACEMENTS[3],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Park Tree Round Tall',
    sourceLabel: 'source/decorations/park_tree_round_tall.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_PARK_PROP_DEFAULT_PLACEMENTS[4],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Park Tree Planter Lamp',
    sourceLabel: 'source/decorations/park_tree_planter_lamp.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_PARK_PROP_DEFAULT_PLACEMENTS[5],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Park Fountain Blue',
    sourceLabel: 'source/decorations/park_fountain_blue.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_PARK_PROP_DEFAULT_PLACEMENTS[6],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Park Planter Row Trees',
    sourceLabel: 'source/decorations/park_planter_row_trees.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_PARK_PROP_DEFAULT_PLACEMENTS[7],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Park Planter Corner Trees',
    sourceLabel: 'source/decorations/park_planter_corner_trees.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_PARK_PROP_DEFAULT_PLACEMENTS[8],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Main Back Wall',
    sourceLabel: 'source/architecture/back_wall_main.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_BACK_WALL_DEFAULT_PLACEMENT,
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Left Wall',
    sourceLabel: 'source/architecture/club_wall_left.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_LEFT_WALL_DEFAULT_PLACEMENT,
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Right Wall',
    sourceLabel: 'source/architecture/club_wall_right.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_RIGHT_WALL_DEFAULT_PLACEMENT,
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Club Door',
    sourceLabel:
      'source/architecture/door_closed.png + door_semi_open.png + door_open.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_DEFAULT_PLACEMENT,
    allowSeparateScale: false,
    allowWarp: true,
    allowGroupControls: false,
  },
  {
    label: 'Club Bar',
    sourceLabel: 'source/furniture/bar_counter_long.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_CLUB_BAR_DEFAULT_PLACEMENT,
    allowSeparateScale: true,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Back Bar Unit',
    sourceLabel: 'source/technology/back_bar_unit_long.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_BACK_BAR_DEFAULT_PLACEMENT,
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'DJ Booth',
    sourceLabel: 'source/technology/dj_booth.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_DJ_BOOTH_DEFAULT_PLACEMENT,
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Dance Floor',
    sourceLabel: 'source/lighting/dance_floor.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_DANCE_FLOOR_DEFAULT_PLACEMENT,
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Sofa Teal',
    sourceLabel: 'source/furniture/sofa_modern_a_teal.png',
    defaultPlacement:
      QORTAL_LAND_DEVELOPMENT_SOFA_MODERN_A_DEFAULT_PLACEMENTS[0],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Sofa Purple',
    sourceLabel: 'source/furniture/sofa_modern_a_purple.png',
    defaultPlacement:
      QORTAL_LAND_DEVELOPMENT_SOFA_MODERN_A_DEFAULT_PLACEMENTS[1],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Small Table Left',
    sourceLabel: 'source/furniture/table_round_low.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_TABLE_DEFAULT_PLACEMENTS[0],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Small Table Right',
    sourceLabel: 'source/furniture/table_round_low.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_TABLE_DEFAULT_PLACEMENTS[1],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Bar Stools',
    sourceLabel: 'source/furniture/bar_stool_round.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_BAR_STOOL_GROUP_DEFAULT_PLACEMENT,
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: true,
  },
  {
    label: 'Speaker Left',
    sourceLabel: 'source/technology/speaker_left.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_SPEAKER_DEFAULT_PLACEMENTS[0],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Speaker Right',
    sourceLabel: 'source/technology/speaker_right.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_SPEAKER_DEFAULT_PLACEMENTS[1],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Planter Wide',
    sourceLabel: 'source/decorations/planter_rect_tropical.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_DECORATION_DEFAULT_PLACEMENTS[0],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Planter Tall',
    sourceLabel: 'source/decorations/planter_tall_tropical.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_DECORATION_DEFAULT_PLACEMENTS[1],
    allowSeparateScale: false,
    allowWarp: false,
    allowGroupControls: false,
  },
  {
    label: 'Qortal Neon Light',
    sourceLabel: 'source/decorations/qortal_neon_light.png',
    defaultPlacement: QORTAL_LAND_DEVELOPMENT_DECORATION_DEFAULT_PLACEMENTS[2],
    allowSeparateScale: false,
    allowWarp: true,
    allowGroupControls: false,
  },
] as const;

type QortalLandEditableDevelopmentPlacement =
  (typeof QORTAL_LAND_EDITABLE_DEVELOPMENT_PLACEMENTS)[number];

const QORTAL_LAND_DEVELOPMENT_DEV_ROOM_OPTIONS: {
  id: LandRoomId;
  label: string;
}[] = [
  { id: QORTAL_LAND_DEFAULT_ROOM_ID, label: 'Disco' },
  { id: QORTAL_LAND_PARK_ROOM_ID, label: 'Park' },
];

const qortalLandEditableDevelopmentPlacementIsInRoom = (
  placement: QortalLandEditableDevelopmentPlacement,
  roomId: LandRoomId
): boolean => {
  const roomIds = placement.defaultPlacement.roomIds ?? [
    QORTAL_LAND_DEFAULT_ROOM_ID,
  ];
  return roomIds.includes(roomId);
};

const getQortalLandEditableDevelopmentPlacementsForRoom = (
  roomId: LandRoomId
): readonly QortalLandEditableDevelopmentPlacement[] => {
  const placements = QORTAL_LAND_EDITABLE_DEVELOPMENT_PLACEMENTS.filter(
    (placement) =>
      qortalLandEditableDevelopmentPlacementIsInRoom(placement, roomId)
  );
  return placements.length > 0
    ? placements
    : QORTAL_LAND_EDITABLE_DEVELOPMENT_PLACEMENTS;
};

const getQortalLandEditableDevelopmentPlacement = (
  placementId: string
): QortalLandEditableDevelopmentPlacement =>
  QORTAL_LAND_EDITABLE_DEVELOPMENT_PLACEMENTS.find(
    (placement) => placement.defaultPlacement.id === placementId
  ) ?? QORTAL_LAND_EDITABLE_DEVELOPMENT_PLACEMENTS[0];

const getQortalLandDevelopmentPlacement = (
  defaultPlacement: QortalLandDevelopmentPngPropPlacement
): QortalLandDevelopmentPngPropPlacement => ({
  ...defaultPlacement,
  ...readQortalLandDevelopmentPngPlacementOverride(defaultPlacement.id),
});

const shouldSkipQortalLandDevelopmentLook = (
  placement: QortalLandDevelopmentPngPropPlacement
): boolean =>
  placement.assetId === QORTAL_LAND_DEVELOPMENT_BACK_BAR_ASSET_ID ||
  placement.assetId === QORTAL_LAND_DEVELOPMENT_SPEAKER_LEFT_ASSET_ID ||
  placement.assetId === QORTAL_LAND_DEVELOPMENT_SPEAKER_RIGHT_ASSET_ID;

const qortalLandPlacementScaleForAxis = (
  placement: QortalLandDevelopmentPngPropPlacement,
  axis: 'x' | 'y'
): number => {
  const value =
    axis === 'x'
      ? (placement.scaleX ?? placement.scale ?? 1)
      : (placement.scaleY ?? placement.scale ?? 1);
  return Number.isFinite(value) ? value : 1;
};

const qortalLandClubSkywalkDoorHotspot = (
  placement = getQortalLandDevelopmentClubDoorPlacement()
): {
  x: number;
  y: number;
  proximityRadius: number;
  passMinX: number;
  passMaxX: number;
  passMinY: number;
  passMaxY: number;
  returnX: number;
  returnY: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
} => {
  const scaleX = qortalLandPlacementScaleForAxis(placement, 'x');
  const scaleY = qortalLandPlacementScaleForAxis(placement, 'y');
  const originX = placement.originX ?? 0.5;
  const originY = placement.originY ?? 0.5;
  const left =
    placement.x - originX * QORTAL_LAND_CLUB_SKYWALK_DOOR_SOURCE_WIDTH * scaleX;
  const right =
    placement.x +
    (1 - originX) * QORTAL_LAND_CLUB_SKYWALK_DOOR_SOURCE_WIDTH * scaleX;
  const top =
    placement.y -
    originY * QORTAL_LAND_CLUB_SKYWALK_DOOR_SOURCE_HEIGHT * scaleY;
  const bottom =
    placement.y +
    (1 - originY) * QORTAL_LAND_CLUB_SKYWALK_DOOR_SOURCE_HEIGHT * scaleY;
  const walkY = top + (bottom - top) * 0.78;
  const approach = clampLandPosition(
    QORTAL_LAND_DEFAULT_ROOM_ID,
    right - 68,
    walkY
  );
  const returnTarget = clampLandPosition(
    QORTAL_LAND_DEFAULT_ROOM_ID,
    right - QORTAL_LAND_CLUB_SKYWALK_DOOR_RETURN_OFFSET_X,
    walkY + QORTAL_LAND_CLUB_SKYWALK_DOOR_RETURN_OFFSET_Y
  );
  return {
    x: approach.x,
    y: approach.y,
    proximityRadius: QORTAL_LAND_CLUB_SKYWALK_DOOR_PROXIMITY_RADIUS,
    passMinX: right - 20,
    passMaxX: right + 18,
    passMinY: top + 90 * Math.abs(scaleY),
    passMaxY: bottom + 24 * Math.abs(scaleY),
    returnX: returnTarget.x,
    returnY: returnTarget.y,
    left,
    right,
    top,
    bottom,
  };
};

const qortalLandParkPortalHotspot = (
  placement = getQortalLandDevelopmentParkPortalPlacement()
): {
  x: number;
  y: number;
  proximityRadius: number;
  passMinX: number;
  passMaxX: number;
  passMinY: number;
  passMaxY: number;
  returnX: number;
  returnY: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
} => {
  const scaleX = qortalLandPlacementScaleForAxis(placement, 'x');
  const scaleY = qortalLandPlacementScaleForAxis(placement, 'y');
  const absScaleX = Math.abs(scaleX);
  const absScaleY = Math.abs(scaleY);
  const originX = placement.originX ?? 0.5;
  const originY = placement.originY ?? 1;
  const left =
    placement.x - originX * QORTAL_LAND_PARK_PORTAL_SOURCE_WIDTH * scaleX;
  const right =
    placement.x + (1 - originX) * QORTAL_LAND_PARK_PORTAL_SOURCE_WIDTH * scaleX;
  const top =
    placement.y - originY * QORTAL_LAND_PARK_PORTAL_SOURCE_HEIGHT * scaleY;
  const bottom =
    placement.y +
    (1 - originY) * QORTAL_LAND_PARK_PORTAL_SOURCE_HEIGHT * scaleY;
  const passMinX = left + 248 * absScaleX;
  const passMaxX = left + 502 * absScaleX;
  const passMinY = top + 708 * absScaleY;
  const passMaxY = top + 1046 * absScaleY;
  const returnTarget = clampLandPosition(
    QORTAL_LAND_PARK_ROOM_ID,
    left + 448 * absScaleX,
    bottom + 10 * absScaleY
  );
  return {
    x: left + 382 * absScaleX,
    y: top + 916 * absScaleY,
    proximityRadius: QORTAL_LAND_PARK_PORTAL_PROXIMITY_RADIUS,
    passMinX,
    passMaxX,
    passMinY,
    passMaxY,
    returnX: returnTarget.x,
    returnY: returnTarget.y,
    left,
    right,
    top,
    bottom,
  };
};

const QORTAL_LAND_DEVELOPMENT_PNG_PROP_PLACEMENTS: QortalLandDevelopmentPngPropPlacement[] =
  [
    QORTAL_LAND_DEVELOPMENT_CLUB_BAR_DEFAULT_PLACEMENT,
    QORTAL_LAND_DEVELOPMENT_BACK_BAR_DEFAULT_PLACEMENT,
    QORTAL_LAND_DEVELOPMENT_DJ_BOOTH_DEFAULT_PLACEMENT,
    ...QORTAL_LAND_DEVELOPMENT_SOFA_MODERN_A_DEFAULT_PLACEMENTS,
    ...QORTAL_LAND_DEVELOPMENT_TABLE_DEFAULT_PLACEMENTS,
    QORTAL_LAND_DEVELOPMENT_BAR_STOOL_GROUP_DEFAULT_PLACEMENT,
    ...QORTAL_LAND_DEVELOPMENT_SPEAKER_DEFAULT_PLACEMENTS,
    ...QORTAL_LAND_DEVELOPMENT_DECORATION_DEFAULT_PLACEMENTS,
    ...QORTAL_LAND_DEVELOPMENT_PARK_PROP_DEFAULT_PLACEMENTS,
    QORTAL_LAND_DEVELOPMENT_DANCE_FLOOR_DEFAULT_PLACEMENT,
    // Add transparent PNGs under src/assets/qortalland/source/** and place them here.
    // Example:
    // {
    //   id: 'club.dj_booth_png',
    //   assetId: 'technology/dj_booth_neon',
    //   roomIds: [QORTAL_LAND_DEFAULT_ROOM_ID],
    //   x: 900,
    //   y: 374,
    //   depthMode: 'fixed',
    //   depth: 370,
    //   originX: 0.5,
    //   originY: 1,
    //   scale: 1,
    // },
  ];

const qortalLandDevelopmentPngAssetsForRoom = (
  roomId: LandRoomId
): QortalLandDevelopmentPngAsset[] => {
  const assetIds = collectQortalLandRoomAssetIds({
    roomId,
    defaultRoomId: QORTAL_LAND_DEFAULT_ROOM_ID,
    placements: QORTAL_LAND_DEVELOPMENT_PNG_PROP_PLACEMENTS,
    extraAssetIdsByRoom: {
      [QORTAL_LAND_DEFAULT_ROOM_ID]: [
        QORTAL_LAND_DEVELOPMENT_CLUB_FLOOR_ASSET_ID,
        QORTAL_LAND_DEVELOPMENT_BACK_WALL_ASSET_ID,
        QORTAL_LAND_DEVELOPMENT_LEFT_WALL_ASSET_ID,
        QORTAL_LAND_DEVELOPMENT_RIGHT_WALL_ASSET_ID,
        ...QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_ASSET_IDS,
      ],
      [QORTAL_LAND_PARK_ROOM_ID]: [
        QORTAL_LAND_DEVELOPMENT_PARK_SKYLINE_ASSET_ID,
        QORTAL_LAND_DEVELOPMENT_PARK_FLOOR_ASSET_ID,
        ...QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_ASSET_IDS,
      ],
    },
  });
  return assetIds
    .map((assetId) => qortalLandDevelopmentPngAssetById.get(assetId))
    .filter((asset): asset is QortalLandDevelopmentPngAsset => Boolean(asset));
};

type ReticulumChatEventForLand = {
  eventId?: unknown;
  groupId?: unknown;
  channelId?: unknown;
  authorAddress?: unknown;
  authorPublicKey?: unknown;
  authorSeq?: unknown;
  timestamp?: unknown;
  eventType?: unknown;
  encryptedPayload?: unknown;
  payloadHash?: unknown;
  mentionAddressHashes?: unknown;
  signature?: unknown;
};

const createSessionId = (): string => {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID().replace(/-/g, '').slice(0, 24);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`.slice(
    0,
    24
  );
};

const createLandChatMessageId = (): string => {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
};

const parseLandChatCommand = (
  rawText: string
): {
  text: string;
  mode: LandChatMode;
  moodAction?: LandSocialActionType;
  presenceCommand?: 'afk' | 'dnd';
} => {
  const normalized = rawText.trim().replace(/\s+/g, ' ');
  if (/^\/afk$/i.test(normalized)) {
    return { text: '', mode: 'say', presenceCommand: 'afk' };
  }
  if (/^\/dnd$/i.test(normalized)) {
    return { text: '', mode: 'say', presenceCommand: 'dnd' };
  }
  const yellMatch = normalized.match(/^\/(?:y|yell)\s+(.+)$/i);
  if (yellMatch?.[1]?.trim()) {
    return { text: yellMatch[1].trim(), mode: 'yell' };
  }
  const emoteMatch = normalized.match(
    /^\/(cry|laugh|happy|sad|good|bad|hype|love)(?:\s+.*)?$/i
  );
  const emote = emoteMatch?.[1]?.toLowerCase();
  if (emote === 'cry') return { text: 'cries', mode: 'emote' };
  if (emote === 'laugh') return { text: 'laughs', mode: 'emote' };
  if (emote === 'happy')
    return { text: 'is happy', mode: 'emote', moodAction: 'sunshine' };
  if (emote === 'sad')
    return { text: 'is sad', mode: 'emote', moodAction: 'rain' };
  if (emote === 'good')
    return { text: 'is behaving.', mode: 'emote', moodAction: 'angel' };
  if (emote === 'bad')
    return { text: 'is feeling naughty.', mode: 'emote', moodAction: 'devil' };
  if (emote === 'hype')
    return { text: 'is hyped!', mode: 'emote', moodAction: 'buzz' };
  if (emote === 'love')
    return { text: 'says: Lovely!', mode: 'emote', moodAction: 'love' };
  return { text: normalized, mode: 'say' };
};

const parseQortalLandChatEvent = (
  event: ReticulumChatEventForLand,
  fallbackSessionId: string
): LandChatTranscriptMessage | null => {
  if (
    typeof event.eventId !== 'string' ||
    typeof event.authorAddress !== 'string' ||
    typeof event.encryptedPayload !== 'string'
  ) {
    return null;
  }

  let decoded: Record<string, unknown>;
  try {
    decoded = JSON.parse(event.encryptedPayload) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (decoded.qortalLand !== true) return null;
  const qortalLandType =
    typeof decoded.qortalLandType === 'string'
      ? decoded.qortalLandType
      : 'chat';
  if (qortalLandType !== 'chat') return null;

  const text = String(decoded.messageText || decoded.message || '').trim();
  if (!text) return null;

  const session =
    typeof decoded.sessionId === 'string'
      ? decoded.sessionId
      : fallbackSessionId;
  const sequence = Number(decoded.landSequence);
  const mode =
    decoded.chatMode === 'yell'
      ? 'yell'
      : decoded.chatMode === 'emote'
        ? 'emote'
        : 'say';
  const moodAction =
    typeof decoded.moodAction === 'string' &&
    isLandSocialActionType(decoded.moodAction)
      ? decoded.moodAction
      : undefined;
  const timestamp = Number(event.timestamp);

  return {
    messageId: event.eventId,
    authorAddress: event.authorAddress,
    sessionId: session,
    sequence: Number.isFinite(sequence) ? sequence : 0,
    text,
    mode,
    moodAction,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
  };
};

const mergeLandChatTranscriptMessage = (
  messages: LandChatTranscriptMessage[],
  message: LandChatTranscriptMessage
): LandChatTranscriptMessage[] => {
  const withoutDuplicate = messages.filter(
    (existing) => existing.messageId !== message.messageId
  );
  return [...withoutDuplicate, message]
    .sort((a, b) => a.timestamp - b.timestamp || a.sequence - b.sequence)
    .slice(-LAND_CHAT_TRANSCRIPT_LIMIT);
};

const utf8ByteLength = (value: string): number =>
  new TextEncoder().encode(value).length;

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' || tagName === 'textarea' || target.isContentEditable
  );
};

const addressHue = (address: string): number => {
  let hash = 0;
  for (let index = 0; index < address.length; index += 1) {
    hash = (hash * 31 + address.charCodeAt(index)) >>> 0;
  }
  return hash % 360;
};

const shortAddress = (address: string): string => {
  const trimmed = address.trim();
  if (trimmed.length <= 12) return trimmed;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
};

const displayNameForAddress = (
  address: string,
  primaryNameCache: Map<string, string>
): string => {
  const primaryName = primaryNameCache.get(address)?.trim();
  return primaryName || shortAddress(address);
};

const buildDirectVoiceCallChatId = (
  addressA: string,
  addressB: string
): string => {
  return `direct:${[addressA, addressB].sort().join(':')}`;
};

const clampNumber = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const finiteNumber = (value: unknown): number | null => {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

const normalizeQortBalance = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return normalizeQortBalance(
      record.balance ?? record.confirmed ?? record.qort ?? record.QORT
    );
  }
  return 0;
};

const formatQortAmount = (value: number): string => {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 8,
    minimumFractionDigits: 0,
  }).format(value);
};

const clampRemoteVelocity = (velocity: number): number => {
  return clampNumber(
    velocity,
    -LAND_REMOTE_MAX_VELOCITY_PX_PER_MS,
    LAND_REMOTE_MAX_VELOCITY_PX_PER_MS
  );
};

const normalizeLandRoomId = (value: unknown): LandRoomId => {
  return value === QORTAL_LAND_PARK_ROOM_ID
    ? value
    : QORTAL_LAND_DEFAULT_ROOM_ID;
};

// Keep the development tools available in source without exposing their
// secondary toolbar in the shipped QortalLand interface.
const QORTAL_LAND_DEVELOPMENT_TOOLBAR_ENABLED = false;

const initialPositionForAddress = (
  address: string
): { roomId: LandRoomId; x: number; y: number } => {
  const hue = addressHue(address);
  return {
    roomId: QORTAL_LAND_START_ROOM_ID,
    x: 610 + (hue % 8) * 90,
    y: 520 + (hue % 4) * 28,
  };
};

const roomLayoutForRoom = (roomId: LandRoomId): QortalLandRoomLayout =>
  QORTAL_LAND_ROOM_LAYOUTS[roomId] ??
  QORTAL_LAND_ROOM_LAYOUTS[QORTAL_LAND_DEFAULT_ROOM_ID];

const roomSizeForRoom = (
  roomId: LandRoomId
): { width: number; height: number } => {
  const layout = roomLayoutForRoom(roomId);
  return { width: layout.width, height: layout.height };
};

const roomFloorRange = (
  roomId: LandRoomId
): { top: number; bottom: number } => {
  const floor = roomLayoutForRoom(roomId).floor;
  return { top: floor.topY, bottom: floor.bottomY };
};

const floorBoundsForRoomY = (
  roomId: LandRoomId,
  y: number
): { minX: number; maxX: number } => {
  const floor = roomLayoutForRoom(roomId).floor;
  const ratio = Math.max(
    0,
    Math.min(1, (y - floor.topY) / (floor.bottomY - floor.topY))
  );
  return {
    minX: floor.back.minX + (floor.front.minX - floor.back.minX) * ratio,
    maxX: floor.back.maxX + (floor.front.maxX - floor.back.maxX) * ratio,
  };
};

const floorBoundsForY = (y: number): { minX: number; maxX: number } => {
  return floorBoundsForRoomY(QORTAL_LAND_DEFAULT_ROOM_ID, y);
};

const floorScaleForRoomY = (roomId: LandRoomId, y: number): number => {
  const range = roomFloorRange(roomId);
  const ratio = Math.max(
    0,
    Math.min(1, (y - range.top) / (range.bottom - range.top))
  );
  return 0.78 + ratio * 0.36;
};

const characterScaleForRoomY = (roomId: LandRoomId, y: number): number => {
  if (roomId === QORTAL_LAND_DEFAULT_ROOM_ID) {
    return 1.14 * LAND_CHARACTER_RENDER_SCALE;
  }
  return floorScaleForRoomY(roomId, y) * LAND_CHARACTER_RENDER_SCALE;
};

const avatarScaleXForDirection = (direction: string, scale: number): number => {
  return direction === 'l' ? -scale : scale;
};

const avatarAnimationKeyForDirection = (
  direction: string,
  moving: boolean,
  skinId: QortalLandSkinId
): string => {
  if (direction === 'u') {
    return qortalLandSkinAnimationKey(skinId, moving ? 'walk' : 'idle', 'up');
  }
  if (direction === 'd') {
    return qortalLandSkinAnimationKey(skinId, moving ? 'walk' : 'idle', 'down');
  }
  return qortalLandSkinAnimationKey(skinId, moving ? 'walk' : 'idle', 'side');
};

const clampLandPosition = (
  roomId: LandRoomId,
  x: number,
  y: number
): { x: number; y: number } => {
  const range = roomFloorRange(roomId);
  const nextY = Math.max(range.top + 24, Math.min(range.bottom - 28, y));
  const bounds = floorBoundsForRoomY(roomId, nextY);
  return {
    x: Math.max(bounds.minX + 35, Math.min(bounds.maxX - 35, x)),
    y: nextY,
  };
};

type QortalLandCollisionFootprint = {
  shape: 'ellipse' | 'rect';
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  paddingX: number;
  paddingY: number;
};

const qortalLandCollisionFootprintsForRoom = (
  roomId: LandRoomId
): QortalLandCollisionFootprint[] => {
  if (!shouldShowQortalLandDevelopmentPngProps()) return [];
  const footprints: QortalLandCollisionFootprint[] = [];
  for (const basePlacement of QORTAL_LAND_DEVELOPMENT_PNG_PROP_PLACEMENTS) {
    if (!basePlacement.collision && !basePlacement.collisions?.length) continue;
    const placement = {
      ...basePlacement,
      ...readQortalLandDevelopmentPngPlacementOverride(basePlacement.id),
    };
    if (placement.visible === false) continue;
    if (placement.roomIds && !placement.roomIds.includes(roomId)) continue;
    const collisions = placement.collisions?.length
      ? placement.collisions
      : placement.collision
        ? [placement.collision]
        : [];
    if (!collisions.length) continue;

    const scaleX = qortalLandPlacementScaleForAxis(placement, 'x');
    const scaleY = qortalLandPlacementScaleForAxis(placement, 'y');
    const instanceCount = Math.max(
      1,
      Math.min(12, Math.round(placement.count ?? 1))
    );
    const spacing = placement.spacing ?? 0;
    const startOffsetX = -((instanceCount - 1) * spacing) / 2;

    for (
      let instanceIndex = 0;
      instanceIndex < instanceCount;
      instanceIndex += 1
    ) {
      collisions.forEach((collision) => {
        const offsetX =
          (collision.offsetX ?? 0) * (placement.flipX ? -scaleX : scaleX);
        const offsetY = (collision.offsetY ?? 0) * scaleY;
        const radiusX = Math.max(2, Math.abs(collision.width * scaleX) / 2);
        const radiusY = Math.max(2, Math.abs(collision.height * scaleY) / 2);
        const paddingX = collision.paddingX ?? 0;
        const paddingY = collision.paddingY ?? 0;
        footprints.push({
          shape: collision.shape,
          x: placement.x + startOffsetX + instanceIndex * spacing + offsetX,
          y: placement.y + offsetY,
          radiusX,
          radiusY,
          paddingX,
          paddingY,
        });
      });
    }
  }
  return footprints;
};

const qortalLandExpandedCollisionRadii = (
  footprint: QortalLandCollisionFootprint
): { x: number; y: number } => ({
  x: Math.max(
    2,
    footprint.radiusX +
      QORTAL_LAND_PLAYER_COLLISION_RADIUS_X +
      footprint.paddingX
  ),
  y: Math.max(
    2,
    footprint.radiusY +
      QORTAL_LAND_PLAYER_COLLISION_RADIUS_Y +
      footprint.paddingY
  ),
});

const qortalLandSmoothStep = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

const qortalLandTrapezoidFactor = (
  value: number,
  zeroStart: number,
  fullStart: number,
  fullEnd: number,
  zeroEnd: number
): number => {
  if (value <= zeroStart || value >= zeroEnd) return 0;
  if (value >= fullStart && value <= fullEnd) return 1;
  if (value < fullStart) {
    return qortalLandSmoothStep((value - zeroStart) / (fullStart - zeroStart));
  }
  return qortalLandSmoothStep((zeroEnd - value) / (zeroEnd - fullEnd));
};

const qortalLandDjPedestalElevationForPosition = (
  roomId: LandRoomId,
  x: number,
  y: number
): number => {
  if (roomId !== QORTAL_LAND_DEFAULT_ROOM_ID) return 0;
  const xFactor = qortalLandTrapezoidFactor(x, 690, 790, 1010, 1110);
  const yFactor = qortalLandTrapezoidFactor(y, 302, 326, 365, 425);
  return QORTAL_LAND_DJ_PEDESTAL_MAX_ELEVATION * Math.min(xFactor, yFactor);
};

const qortalLandAvatarRenderY = (
  roomId: LandRoomId,
  x: number,
  y: number
): number => y - qortalLandDjPedestalElevationForPosition(roomId, x, y);

const isQortalLandCollisionBlocked = (
  footprint: QortalLandCollisionFootprint,
  x: number,
  y: number
): boolean => {
  const expanded = qortalLandExpandedCollisionRadii(footprint);
  const dx = x - footprint.x;
  const dy = y - footprint.y;
  if (footprint.shape === 'rect') {
    return Math.abs(dx) <= expanded.x && Math.abs(dy) <= expanded.y;
  }
  const normalizedX = dx / expanded.x;
  const normalizedY = dy / expanded.y;
  return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
};

const isQortalLandPositionBlockedByProps = (
  roomId: LandRoomId,
  x: number,
  y: number
): boolean =>
  qortalLandCollisionFootprintsForRoom(roomId).some((footprint) =>
    isQortalLandCollisionBlocked(footprint, x, y)
  );

const resolveQortalLandPropCollisions = (
  roomId: LandRoomId,
  previousX: number,
  previousY: number,
  nextX: number,
  nextY: number
): { x: number; y: number } => {
  const footprints = qortalLandCollisionFootprintsForRoom(roomId);
  if (!footprints.length) return { x: nextX, y: nextY };

  let x = nextX;
  let y = nextY;
  for (let pass = 0; pass < 4; pass += 1) {
    let moved = false;
    for (const footprint of footprints) {
      if (!isQortalLandCollisionBlocked(footprint, x, y)) continue;
      const expanded = qortalLandExpandedCollisionRadii(footprint);
      const dx = x - footprint.x;
      const dy = y - footprint.y;
      if (footprint.shape === 'rect') {
        const overlapX = expanded.x - Math.abs(dx);
        const overlapY = expanded.y - Math.abs(dy);
        if (overlapX < overlapY) {
          const fallback =
            previousX === footprint.x ? 1 : Math.sign(previousX - footprint.x);
          x += (Math.sign(dx) || fallback || 1) * (overlapX + 0.5);
        } else {
          const fallback =
            previousY === footprint.y ? 1 : Math.sign(previousY - footprint.y);
          y += (Math.sign(dy) || fallback || 1) * (overlapY + 0.5);
        }
      } else {
        const normalizedX = dx / expanded.x;
        const normalizedY = dy / expanded.y;
        const distance = Math.hypot(normalizedX, normalizedY);
        const fallbackX = previousX - footprint.x;
        const fallbackY = previousY - footprint.y;
        const fallbackDistance = Math.hypot(
          fallbackX / expanded.x,
          fallbackY / expanded.y
        );
        const pushX =
          distance > 0.0001
            ? normalizedX / distance
            : fallbackDistance > 0.0001
              ? fallbackX / expanded.x / fallbackDistance
              : 0;
        const pushY =
          distance > 0.0001
            ? normalizedY / distance
            : fallbackDistance > 0.0001
              ? fallbackY / expanded.y / fallbackDistance
              : 1;
        x = footprint.x + pushX * (expanded.x + 0.5);
        y = footprint.y + pushY * (expanded.y + 0.5);
      }
      ({ x, y } = clampLandPosition(roomId, x, y));
      moved = true;
    }
    if (!moved) return { x, y };
  }

  const xOnly = clampLandPosition(roomId, nextX, previousY);
  if (!isQortalLandPositionBlockedByProps(roomId, xOnly.x, xOnly.y))
    return xOnly;
  const yOnly = clampLandPosition(roomId, previousX, nextY);
  if (!isQortalLandPositionBlockedByProps(roomId, yOnly.x, yOnly.y))
    return yOnly;
  return clampLandPosition(roomId, previousX, previousY);
};

const isNearClubDjBooth = (
  roomId: LandRoomId,
  x: number,
  y: number
): boolean => {
  if (roomId !== QORTAL_LAND_DEFAULT_ROOM_ID) return false;
  if (qortalLandDjPedestalElevationForPosition(roomId, x, y) < 12) return false;
  const hotspot = roomLayoutForRoom(QORTAL_LAND_DEFAULT_ROOM_ID).interactions
    ?.djBooth;
  if (!hotspot) return false;
  const weightedX = (x - hotspot.x) * hotspot.weightedXScale;
  const weightedY = y - hotspot.y;
  return Math.hypot(weightedX, weightedY) <= hotspot.radius;
};

export function QortalLand({
  groupId,
  groupName,
  myAddress,
  isActive = true,
}: QortalLandProps) {
  const theme = useTheme();
  const groupCall = useGroupCallContext();
  const balance = useAtomValue(balanceAtom);
  const userInfo = useAtomValue(userInfoAtom);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<import('phaser').Game | null>(null);
  const isActiveRef = useRef(isActive);
  const landPresenceSuspendedRef = useRef(false);
  const landPresenceLeaveSentRef = useRef(false);
  const movementKeysRef = useRef<Set<string>>(new Set());
  const landGameActiveRef = useRef(false);
  const landGameInputBlockedRef = useRef(false);
  const remotePlayersRef = useRef<Map<string, LandPlayerState>>(new Map());
  const landChatBubblesRef = useRef<Map<string, LandChatBubble>>(new Map());
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  const chatMessagesViewportRef = useRef<HTMLDivElement | null>(null);
  const chatPanelDefaultSizeRef = useRef<{
    width: number;
    height: number;
  } | null>(null);
  const chatPanelGeometryRef = useRef<LandChatPanelGeometry | null>(null);
  const chatPanelInteractionRef = useRef<LandChatPanelInteraction | null>(null);
  const landActionAnimationsRef = useRef<Map<string, LandActionAnimation>>(
    new Map()
  );
  const landCallPresenceRef = useRef<Map<string, LandCallPresence>>(new Map());
  const landGamePresenceRef = useRef<Map<string, LandGamePresence>>(new Map());
  const proximitySpeakingAddressesRef = useRef<Set<string>>(new Set());
  const proximityVoicePanelRequestRef = useRef(0);
  const landCallPeerPublicKeysRef = useRef<Map<string, string>>(new Map());
  const landCallPeersRef = useRef<
    Map<
      string,
      {
        peerAddress: string;
        chatId: string;
        sourceSessionId: string;
        targetSessionId: string;
        targetDestinationHash: string;
      }
    >
  >(new Map());
  const pendingLandCallTargetRef = useRef<LandActionTarget | null>(null);
  const landCallListenersRef = useRef<
    Set<(event: string, payload: unknown) => void>
  >(new Set());
  const activeLandCallIdRef = useRef<string | null>(null);
  const lastAnnouncedLandCallRef = useRef<{
    callId: string;
    peerAddress: string;
    chatId: string;
  } | null>(null);
  const lastAnnouncedLandGameRef = useRef<{
    matchId: string;
    peerAddress: string;
  } | null>(null);
  const primaryNameCacheRef = useRef<Map<string, string>>(new Map());
  const pendingPrimaryNameLookupsRef = useRef<Set<string>>(new Set());
  const primaryNameLookupTimerRef = useRef<number | null>(null);
  const currentRoomRef = useRef<LandRoomId>(QORTAL_LAND_START_ROOM_ID);
  const initialSkinIdRef = useRef<QortalLandSkinId>(
    readQortalLandCharacterSkin(myAddress)
  );
  const localStateRef = useRef<LocalLandState>({
    ...initialPositionForAddress(myAddress || ''),
    direction: 'r',
    movement: 'idle',
    afk: false,
    dnd: false,
    voiceEnabled: false,
    voiceMuted: false,
    skinId: initialSkinIdRef.current,
  });
  const lastSentRef = useRef<LocalLandState & { sentAt: number }>({
    ...localStateRef.current,
    sentAt: 0,
  });
  const sequenceRef = useRef(0);
  const landChatSequenceRef = useRef(0);
  const landActionSequenceRef = useRef(0);
  const landActionCooldownTimerRef = useRef<number | null>(null);
  const lastLandActivityAtRef = useRef(Date.now());
  const recordLandActivityRef = useRef<() => void>(() => undefined);
  const [reticulumReady, setReticulumReady] = useState<boolean | null>(null);
  const [landGameRoomId, setLandGameRoomId] = useState<LandRoomId>(
    QORTAL_LAND_START_ROOM_ID
  );
  const [loadingRoomAssets, setLoadingRoomAssets] = useState<LandRoomId | null>(
    null
  );
  const [isLandAfk, setIsLandAfk] = useState(false);
  const [isLandDnd, setIsLandDnd] = useState(false);
  const [proximityVoicePanelRequest, setProximityVoicePanelRequest] =
    useState(0);
  const [proximityVoicePanelTarget, setProximityVoicePanelTarget] =
    useState('');
  const [chatText, setChatText] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatError, setChatError] = useState('');
  const [landChatMessages, setLandChatMessages] = useState<
    LandChatTranscriptMessage[]
  >([]);
  const [isChatFocused, setIsChatFocused] = useState(false);
  const [isChatDimmed, setIsChatDimmed] = useState(true);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [activeChatTab, setActiveChatTab] = useState<LandChatTab>('local');
  const [chatPanelGeometry, setChatPanelGeometry] =
    useState<LandChatPanelGeometry | null>(null);
  const [lastChatActivityAt, setLastChatActivityAt] = useState(() =>
    Date.now()
  );
  const [, setPrimaryNameLookupVersion] = useState(0);
  const [actionTarget, setActionTarget] = useState<LandActionTarget | null>(
    null
  );
  const [sendingSocialAction, setSendingSocialAction] =
    useState<LandSocialActionType | null>(null);
  const [socialActionError, setSocialActionError] = useState('');
  const [socialActionCooldownUntil, setSocialActionCooldownUntil] = useState(0);
  const [showGamePicker, setShowGamePicker] = useState(false);
  const [sendQortTarget, setSendQortTarget] = useState<LandActionTarget | null>(
    null
  );
  const [sendQortAmount, setSendQortAmount] = useState('1');
  const [sendQortError, setSendQortError] = useState('');
  const [isSendingQort, setIsSendingQort] = useState(false);
  const [activeLandCallPeerAddress, setActiveLandCallPeerAddress] = useState<
    string | null
  >(null);
  const [landCallPresenceVersion, setLandCallPresenceVersion] = useState(0);
  const [landGamePresenceVersion, setLandGamePresenceVersion] = useState(0);
  const [landAvailabilityVersion, setLandAvailabilityVersion] = useState(0);
  const [isAssetDevPanelOpen, setIsAssetDevPanelOpen] = useState(false);
  const [selectedDevRoomId, setSelectedDevRoomId] = useState<LandRoomId>(
    QORTAL_LAND_PARK_ROOM_ID
  );
  const [isCharacterPanelOpen, setIsCharacterPanelOpen] = useState(false);
  const [selectedSkinId, setSelectedSkinId] = useState<QortalLandSkinId>(
    initialSkinIdRef.current
  );
  const [pendingSkinId, setPendingSkinId] = useState<QortalLandSkinId>(
    initialSkinIdRef.current
  );
  const [isSkinSelectorOpen, setIsSkinSelectorOpen] = useState(false);
  const [characterCustomization, setCharacterCustomization] = useState(() =>
    readQortalLandCharacterCustomization(myAddress)
  );
  const [characterPreviewFacing, setCharacterPreviewFacing] =
    useState<QortalLandCharacterPreviewFacing>('front');

  const resolveCurrentLandActionTarget = useCallback(
    (target: LandActionTarget): LandActionTarget | null => {
      if (target.authorAddress === myAddress) return target;
      const player = remotePlayersRef.current.get(target.key);
      if (
        !player ||
        player.authorAddress !== target.authorAddress ||
        player.sessionId !== target.sessionId
      ) {
        return null;
      }
      return {
        ...target,
        authorAddress: player.authorAddress,
        sessionId: player.sessionId,
        destinationHash: player.destinationHash,
        roomId: player.roomId,
      };
    },
    [myAddress]
  );
  const [devPngPropsEnabled, setDevPngPropsEnabled] = useState(() =>
    shouldShowQortalLandDevelopmentPngProps()
  );
  const [devClubBarPlacement, setDevClubBarPlacement] = useState(() =>
    getQortalLandDevelopmentClubBarPlacement()
  );
  const [devBackBarPlacement, setDevBackBarPlacement] = useState(() =>
    getQortalLandDevelopmentBackBarPlacement()
  );
  const [devDjBoothPlacement, setDevDjBoothPlacement] = useState(() =>
    getQortalLandDevelopmentDjBoothPlacement()
  );
  const [selectedDevPlacementId, setSelectedDevPlacementId] = useState(
    QORTAL_LAND_DEVELOPMENT_PARK_PLANTER_ROW_TREES_PLACEMENT_ID
  );
  const [selectedDevPlacement, setSelectedDevPlacement] = useState(() =>
    getQortalLandDevelopmentPlacement(
      getQortalLandEditableDevelopmentPlacement(
        QORTAL_LAND_DEVELOPMENT_PARK_PLANTER_ROW_TREES_PLACEMENT_ID
      ).defaultPlacement
    )
  );
  const [proceduralClubShellEnabled, setProceduralClubShellEnabled] = useState(
    () => shouldShowQortalLandProceduralClubShell()
  );
  const [collisionDebugEnabled, setCollisionDebugEnabled] = useState(() =>
    shouldShowQortalLandCollisionDebug()
  );
  const [developmentLookSettings, setDevelopmentLookSettings] = useState(() =>
    readQortalLandDevelopmentLookSettings()
  );
  const sessionId = useMemo(() => createSessionId().slice(0, 16), []);
  const qortBalance = useMemo(() => normalizeQortBalance(balance), [balance]);
  const publishLandPresenceSnapshot = useCallback(() => {
    const bySession = new Map<
      string,
      {
        address: string;
        sessionId: string;
        roomId: string;
        afk: boolean;
        dnd: boolean;
        voiceEnabled: boolean;
        voiceMuted: boolean;
        lastSeenAt: number;
      }
    >();
    if (
      myAddress &&
      !shouldSuspendQortalLandPresence(
        isActiveRef.current,
        localStateRef.current.afk
      )
    ) {
      bySession.set(`${myAddress}:${sessionId}`, {
        address: myAddress,
        sessionId,
        roomId: localStateRef.current.roomId,
        afk: localStateRef.current.afk,
        dnd: localStateRef.current.dnd,
        voiceEnabled: localStateRef.current.voiceEnabled,
        voiceMuted: localStateRef.current.voiceMuted,
        lastSeenAt: Date.now(),
      });
    }
    for (const player of remotePlayersRef.current.values()) {
      const key = `${player.authorAddress}:${player.sessionId}`;
      const previous = bySession.get(key);
      if (!previous || player.lastSeenAt > previous.lastSeenAt) {
        bySession.set(key, {
          address: player.authorAddress,
          sessionId: player.sessionId,
          roomId: player.roomId,
          afk: player.afk,
          dnd: player.dnd,
          voiceEnabled: player.voiceEnabled,
          voiceMuted: player.voiceMuted,
          lastSeenAt: player.lastSeenAt,
        });
      }
    }
    publishQortalLandPresence({
      groupId,
      members: [...bySession.values()],
    });
  }, [groupId, myAddress, sessionId]);

  const setLocalLandAvailability = useCallback(
    (next: { afk?: boolean; dnd?: boolean }) => {
      const current = localStateRef.current;
      const afk = next.afk ?? current.afk;
      const dnd = next.dnd ?? current.dnd;
      if (afk === current.afk && dnd === current.dnd) return;
      localStateRef.current = { ...current, afk, dnd };
      setIsLandAfk(afk);
      setIsLandDnd(dnd);
      lastSentRef.current = { ...lastSentRef.current, sentAt: 0 };
      publishLandPresenceSnapshot();
    },
    [publishLandPresenceSnapshot]
  );

  const recordLandActivity = useCallback(() => {
    lastLandActivityAtRef.current = Date.now();
    if (localStateRef.current.afk) {
      setLocalLandAvailability({ afk: false });
    }
  }, [setLocalLandAvailability]);

  const setLocalProximityVoicePresence = useCallback(
    (voiceEnabled: boolean, voiceMuted: boolean) => {
      const current = localStateRef.current;
      const normalizedMuted = voiceEnabled && voiceMuted;
      if (
        current.voiceEnabled === voiceEnabled &&
        current.voiceMuted === normalizedMuted
      ) {
        return;
      }
      localStateRef.current = {
        ...current,
        voiceEnabled,
        voiceMuted: normalizedMuted,
      };
      lastSentRef.current = { ...lastSentRef.current, sentAt: 0 };
      publishLandPresenceSnapshot();
    },
    [publishLandPresenceSnapshot]
  );

  useEffect(() => {
    recordLandActivityRef.current = recordLandActivity;
  }, [recordLandActivity]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (
        !localStateRef.current.afk &&
        Date.now() - lastLandActivityAtRef.current >= LAND_AFK_TIMEOUT_MS
      ) {
        setLocalLandAvailability({ afk: true });
      }
    }, LAND_AFK_CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [setLocalLandAvailability]);

  useEffect(() => {
    publishLandPresenceSnapshot();
  }, [isLandAfk, isLandDnd, landGameRoomId, publishLandPresenceSnapshot]);

  useEffect(() => {
    isActiveRef.current = isActive;
    if (!isActive) {
      movementKeysRef.current.clear();
      localStateRef.current = { ...localStateRef.current, movement: 'idle' };
      chatInputRef.current?.blur();
    } else {
      lastLandActivityAtRef.current = Date.now();
      if (localStateRef.current.afk) {
        setLocalLandAvailability({ afk: false });
      }
      lastSentRef.current = { ...lastSentRef.current, sentAt: 0 };
    }
    publishLandPresenceSnapshot();

    const game = gameRef.current;
    if (!game) return undefined;
    if (!isActive) {
      game.loop.sleep();
      return undefined;
    }

    game.loop.wake();
    const resizeFrame = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const width = Math.max(320, Math.floor(container.clientWidth || 900));
      const height = Math.max(320, Math.floor(container.clientHeight || 560));
      if (game.scale.width !== width || game.scale.height !== height) {
        game.scale.resize(width, height);
      }
    });
    return () => {
      window.cancelAnimationFrame(resizeFrame);
    };
  }, [isActive, publishLandPresenceSnapshot, setLocalLandAvailability]);

  useEffect(() => {
    const shouldSuspend = shouldSuspendQortalLandPresence(isActive, isLandAfk);
    if (!shouldSuspend) {
      if (landPresenceSuspendedRef.current) {
        lastSentRef.current = { ...lastSentRef.current, sentAt: 0 };
      }
      landPresenceSuspendedRef.current = false;
      landPresenceLeaveSentRef.current = false;
      return;
    }

    landPresenceSuspendedRef.current = true;
    publishLandPresenceSnapshot();
    if (
      landPresenceLeaveSentRef.current ||
      reticulumReady !== true ||
      !Number.isInteger(groupId) ||
      groupId <= 0 ||
      !myAddress
    ) {
      return;
    }

    landPresenceLeaveSentRef.current = true;
    sequenceRef.current += 1;
    void window.reticulumChat?.sendLandState?.(groupId, myAddress, {
      sessionId,
      sequence: sequenceRef.current,
      ...localStateRef.current,
      movement: 'leave',
      afk: localStateRef.current.afk,
      dnd: localStateRef.current.dnd,
      voiceEnabled: localStateRef.current.voiceEnabled,
      voiceMuted: localStateRef.current.voiceMuted,
      skinId: localStateRef.current.skinId,
    });
  }, [
    groupId,
    isActive,
    isLandAfk,
    myAddress,
    publishLandPresenceSnapshot,
    reticulumReady,
    sessionId,
  ]);

  const handleLandGameActiveChange = useCallback((active: boolean) => {
    landGameActiveRef.current = active;
    if (active) {
      movementKeysRef.current.clear();
      localStateRef.current = { ...localStateRef.current, movement: 'idle' };
    }
  }, []);
  useEffect(() => {
    if (!actionTarget) {
      setShowGamePicker(false);
      setSocialActionError('');
    }
  }, [actionTarget]);

  useLayoutEffect(() => {
    if (!actionTarget) return;
    const container = containerRef.current;
    const menu = actionMenuRef.current;
    if (!container || !menu) return;

    let frame = 0;
    const clampMenuToViewport = () => {
      const inset = 12;
      const maxLeft = Math.max(
        inset,
        container.clientWidth - menu.offsetWidth - inset
      );
      const maxTop = Math.max(
        inset,
        container.clientHeight - menu.offsetHeight - inset
      );
      const left = clampNumber(actionTarget.anchorX, inset, maxLeft);
      const top = clampNumber(actionTarget.anchorY, inset, maxTop);
      setActionTarget((current) => {
        if (!current || current.key !== actionTarget.key) return current;
        if (current.menuX === left && current.menuY === top) return current;
        return { ...current, menuX: left, menuY: top };
      });
    };
    const scheduleClamp = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(clampMenuToViewport);
    };

    clampMenuToViewport();
    scheduleClamp();
    const resizeObserver = new ResizeObserver(scheduleClamp);
    resizeObserver.observe(container);
    resizeObserver.observe(menu);
    window.addEventListener('resize', scheduleClamp);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleClamp);
    };
  }, [
    actionTarget?.anchorX,
    actionTarget?.anchorY,
    actionTarget?.key,
    showGamePicker,
  ]);

  useEffect(
    () => () => {
      if (landActionCooldownTimerRef.current !== null) {
        window.clearTimeout(landActionCooldownTimerRef.current);
      }
    },
    []
  );

  const emitLandCallEvent = useCallback((event: string, payload: unknown) => {
    for (const listener of landCallListenersRef.current) {
      listener(event, payload);
    }
  }, []);

  const sendLandCallSignal = useCallback(
    async (payload: Record<string, unknown>) => {
      const result = await window.reticulumChat?.sendLandCall?.(
        groupId,
        payload
      );
      return result?.success === true
        ? { success: true }
        : {
            success: false,
            error: result?.error || 'QortalLand call signal failed',
          };
    },
    [groupId]
  );

  const clearLandCallPresence = useCallback((addresses: string[]) => {
    let changed = false;
    for (const address of addresses) {
      if (address && landCallPresenceRef.current.delete(address))
        changed = true;
    }
    if (changed) setLandCallPresenceVersion((value) => value + 1);
  }, []);

  const landCallApi = useMemo<VoiceCallApi>(
    () => ({
      initiate: async (
        targetAddress,
        chatId,
        localAddress,
        signature,
        publicKey,
        callId,
        timestamp
      ) => {
        const selected = pendingLandCallTargetRef.current;
        pendingLandCallTargetRef.current = null;
        if (
          !selected ||
          selected.authorAddress !== targetAddress ||
          !selected.destinationHash
        ) {
          return {
            success: false,
            error: 'The selected QortalLand session is no longer available',
          };
        }
        const peer = {
          peerAddress: targetAddress,
          chatId,
          sourceSessionId: sessionId,
          targetSessionId: selected.sessionId,
          targetDestinationHash: selected.destinationHash,
        };
        landCallPeersRef.current.set(callId, peer);
        activeLandCallIdRef.current = callId;
        setActiveLandCallPeerAddress(targetAddress);
        const result = await sendLandCallSignal({
          callType: 'request',
          callId,
          fromAddress: localAddress,
          toAddress: targetAddress,
          chatId,
          fromPublicKey: publicKey,
          signature,
          roomId: currentRoomRef.current,
          sourceSessionId: peer.sourceSessionId,
          targetSessionId: peer.targetSessionId,
          targetDestinationHash: peer.targetDestinationHash,
          timestamp,
        });
        return result.success ? { success: true, callId } : result;
      },
      accept: async (callId, signature, publicKey, timestamp) => {
        const peer = landCallPeersRef.current.get(callId);
        if (!peer) return { success: false, error: 'Unknown QortalLand call' };
        activeLandCallIdRef.current = callId;
        setActiveLandCallPeerAddress(peer.peerAddress);
        return sendLandCallSignal({
          callType: 'accept',
          callId,
          fromAddress: myAddress,
          toAddress: peer.peerAddress,
          chatId: peer.chatId,
          fromPublicKey: publicKey,
          signature,
          roomId: currentRoomRef.current,
          sourceSessionId: peer.sourceSessionId,
          targetSessionId: peer.targetSessionId,
          targetDestinationHash: peer.targetDestinationHash,
          timestamp,
        });
      },
      reject: async (callId, reason, signature, publicKey, timestamp) => {
        const peer = landCallPeersRef.current.get(callId);
        if (!peer) {
          return { success: false, error: 'Unknown QortalLand call' };
        }
        const result = await sendLandCallSignal({
          callType: 'reject',
          callId,
          fromAddress: myAddress,
          toAddress: peer.peerAddress,
          chatId: peer.chatId,
          fromPublicKey: publicKey,
          signature,
          reason: reason || 'rejected',
          roomId: currentRoomRef.current,
          sourceSessionId: peer.sourceSessionId,
          targetSessionId: peer.targetSessionId,
          targetDestinationHash: peer.targetDestinationHash,
          timestamp: timestamp ?? Date.now(),
        });
        if (!result.success) return result;
        landCallPeersRef.current.delete(callId);
        if (lastAnnouncedLandCallRef.current?.callId === callId) {
          lastAnnouncedLandCallRef.current = null;
        }
        if (activeLandCallIdRef.current === callId) {
          activeLandCallIdRef.current = null;
          setActiveLandCallPeerAddress(null);
        }
        return result;
      },
      hangup: async (callId, signature, publicKey, timestamp) => {
        const announced = lastAnnouncedLandCallRef.current;
        const peer = landCallPeersRef.current.get(callId);
        if (!peer) {
          // The endpoint route may already have been cleared by another call
          // event. We can still remove our stale group-visible markers and let
          // the idle effect publish `ended` from the retained announcement.
          if (announced?.callId === callId) {
            clearLandCallPresence([myAddress, announced.peerAddress]);
          }
          return { success: true };
        }
        // The shared voice hook intentionally holds `ended` for 1.5 seconds
        // before moving to `idle`. Remove the local group-visible markers now,
        // while retaining lastAnnouncedLandCallRef for the idle effect to send
        // the matching group-wide `ended` event.
        clearLandCallPresence([myAddress, peer.peerAddress]);
        const result = await sendLandCallSignal({
          callType: 'hangup',
          callId,
          fromAddress: myAddress,
          toAddress: peer.peerAddress,
          chatId: peer.chatId,
          fromPublicKey: publicKey,
          signature,
          roomId: currentRoomRef.current,
          sourceSessionId: peer.sourceSessionId,
          targetSessionId: peer.targetSessionId,
          targetDestinationHash: peer.targetDestinationHash,
          timestamp,
        });
        landCallPeersRef.current.delete(callId);
        // Keep the last group-visible status until callState reaches idle. The
        // idle effect below owns the matching `ended` broadcast and local icon
        // cleanup; clearing this record here leaves the status alive until TTL.
        if (activeLandCallIdRef.current === callId) {
          activeLandCallIdRef.current = null;
          setActiveLandCallPeerAddress(null);
        }
        return result;
      },
      setLocalAddresses: async () => ({ success: true }),
      onEvent: (cb) => {
        landCallListenersRef.current.add(cb);
        return () => {
          landCallListenersRef.current.delete(cb);
        };
      },
    }),
    [clearLandCallPresence, myAddress, sendLandCallSignal, sessionId]
  );

  const landVoiceCall = useVoiceCall({
    callApi: landCallApi,
    callApiSignsSignals: true,
    enableDirectVoiceWebRtc: true,
    skipSystemReadiness: true,
    skipDirectFriendValidation: true,
    getPeerPublicKey: (address) =>
      landCallPeerPublicKeysRef.current.get(address),
    getPeerDestinationHash: (address) => {
      const callId = activeLandCallIdRef.current;
      const peer = callId ? landCallPeersRef.current.get(callId) : null;
      return peer?.peerAddress === address
        ? peer.targetDestinationHash
        : undefined;
    },
    createCallId: () => createSessionId().slice(0, 16),
    suppressGlobalSnackbars: true,
  });
  const landVoiceCallStateRef = useRef(landVoiceCall.callState);
  useEffect(() => {
    landVoiceCallStateRef.current = landVoiceCall.callState;
  }, [landVoiceCall.callState]);

  const touchLandCallPresence = useCallback(
    (
      address: string,
      peerAddress: string,
      callId: string,
      roomId: LandRoomId,
      ttlMs = LAND_CALL_STATUS_TTL_MS
    ) => {
      const normalized = address.trim();
      if (!normalized || !callId) return;
      landCallPresenceRef.current.set(normalized, {
        callId,
        peerAddress,
        roomId,
        expiresAt: Date.now() + ttlMs,
      });
      setLandCallPresenceVersion((value) => value + 1);
    },
    []
  );

  const isAddressInLandCall = useCallback((address: string): boolean => {
    const presence = landCallPresenceRef.current.get(address);
    return Boolean(presence && presence.expiresAt > Date.now());
  }, []);

  const touchLandGamePresence = useCallback(
    (
      address: string,
      peerAddress: string,
      matchId: string,
      roomId: LandRoomId,
      ttlMs = LAND_CALL_STATUS_TTL_MS
    ) => {
      const normalized = address.trim();
      if (!normalized || !matchId) return;
      landGamePresenceRef.current.set(normalized, {
        matchId,
        peerAddress,
        roomId,
        expiresAt: Date.now() + ttlMs,
      });
      setLandGamePresenceVersion((value) => value + 1);
    },
    []
  );

  const clearLandGamePresence = useCallback(
    (addresses: string[], matchId?: string) => {
      let changed = false;
      for (const address of addresses) {
        if (!address) continue;
        const presence = landGamePresenceRef.current.get(address);
        if (presence && (!matchId || presence.matchId === matchId)) {
          landGamePresenceRef.current.delete(address);
          changed = true;
        }
      }
      if (changed) setLandGamePresenceVersion((value) => value + 1);
    },
    []
  );

  const isAddressInLandGame = useCallback((address: string): boolean => {
    const presence = landGamePresenceRef.current.get(address);
    return Boolean(presence && presence.expiresAt > Date.now());
  }, []);

  useEffect(() => {
    setCharacterCustomization(readQortalLandCharacterCustomization(myAddress));
  }, [myAddress]);

  useEffect(() => {
    const skinId = readQortalLandCharacterSkin(myAddress);
    initialSkinIdRef.current = skinId;
    localStateRef.current = { ...localStateRef.current, skinId };
    lastSentRef.current = { ...lastSentRef.current, skinId, sentAt: 0 };
    setSelectedSkinId(skinId);
    setPendingSkinId(skinId);
  }, [myAddress]);

  const openSkinSelector = useCallback(() => {
    setPendingSkinId(selectedSkinId);
    setIsSkinSelectorOpen(true);
  }, [selectedSkinId]);

  const applySelectedSkin = useCallback(() => {
    const skinId = normalizeQortalLandSkinId(pendingSkinId);
    localStateRef.current = { ...localStateRef.current, skinId };
    lastSentRef.current = { ...lastSentRef.current, skinId, sentAt: 0 };
    initialSkinIdRef.current = skinId;
    setSelectedSkinId(skinId);
    writeQortalLandCharacterSkin(myAddress, skinId);
    setIsSkinSelectorOpen(false);
    recordLandActivity();
  }, [myAddress, pendingSkinId, recordLandActivity]);

  const updateCharacterCustomization = useCallback(
    (field: QortalLandCharacterCustomizationField, value: string) => {
      const next = {
        ...characterCustomization,
        [field]: value,
      };
      setCharacterCustomization(next);
      writeQortalLandCharacterCustomization(myAddress, next);
    },
    [characterCustomization, myAddress]
  );

  const cycleCharacterCustomization = useCallback(
    (field: QortalLandCharacterCustomizationField, step: -1 | 1) => {
      const options = QORTAL_LAND_CHARACTER_CUSTOMIZATION_OPTIONS[field];
      const currentIndex = options.findIndex(
        (option) => option.value === characterCustomization[field]
      );
      const nextIndex =
        (Math.max(0, currentIndex) + step + options.length) % options.length;
      updateCharacterCustomization(field, options[nextIndex].value);
    },
    [characterCustomization, updateCharacterCustomization]
  );

  const rotateCharacterPreview = useCallback((step: -1 | 1) => {
    setCharacterPreviewFacing((facing) => {
      const currentIndex =
        QORTAL_LAND_CHARACTER_PREVIEW_FACINGS.indexOf(facing);
      const nextIndex =
        (Math.max(0, currentIndex) +
          step +
          QORTAL_LAND_CHARACTER_PREVIEW_FACINGS.length) %
        QORTAL_LAND_CHARACTER_PREVIEW_FACINGS.length;
      return QORTAL_LAND_CHARACTER_PREVIEW_FACINGS[nextIndex];
    });
  }, []);

  const resetCharacterCustomization = useCallback(() => {
    const defaults = { ...QORTAL_LAND_CHARACTER_CUSTOMIZATION_DEFAULTS };
    setCharacterCustomization(defaults);
    writeQortalLandCharacterCustomization(myAddress, defaults);
  }, [myAddress]);

  const setDevelopmentPngPropsEnabled = useCallback((enabled: boolean) => {
    if (enabled) {
      window.localStorage.setItem(QORTAL_LAND_DEV_PNG_PROPS_STORAGE_KEY, '1');
    } else {
      window.localStorage.setItem(QORTAL_LAND_DEV_PNG_PROPS_STORAGE_KEY, '0');
    }
    setDevPngPropsEnabled(enabled);
    notifyQortalLandDevelopmentAssetsChanged();
  }, []);

  const editableDevPlacementsForSelectedRoom = useMemo(
    () => getQortalLandEditableDevelopmentPlacementsForRoom(selectedDevRoomId),
    [selectedDevRoomId]
  );

  const selectedDevPlacementMeta = getQortalLandEditableDevelopmentPlacement(
    selectedDevPlacementId
  );

  const selectDevelopmentPlacement = useCallback((placementId: string) => {
    const meta = getQortalLandEditableDevelopmentPlacement(placementId);
    setSelectedDevPlacementId(meta.defaultPlacement.id);
    setSelectedDevPlacement(
      getQortalLandDevelopmentPlacement(meta.defaultPlacement)
    );
  }, []);

  const selectDevelopmentRoom = useCallback(
    (roomId: LandRoomId) => {
      const nextRoomId = QORTAL_LAND_DEVELOPMENT_DEV_ROOM_OPTIONS.some(
        (option) => option.id === roomId
      )
        ? roomId
        : QORTAL_LAND_DEFAULT_ROOM_ID;
      const nextPlacements =
        getQortalLandEditableDevelopmentPlacementsForRoom(nextRoomId);
      setSelectedDevRoomId(nextRoomId);
      const firstPlacement = nextPlacements[0];
      if (firstPlacement) {
        selectDevelopmentPlacement(firstPlacement.defaultPlacement.id);
      }
    },
    [selectDevelopmentPlacement]
  );

  const writeSelectedDevelopmentPlacement = useCallback(
    (placement: QortalLandDevelopmentPngPropPlacement) => {
      writeQortalLandDevelopmentPngPlacementOverride(placement.id, {
        x: placement.x,
        y: placement.y,
        depth: placement.depth,
        originX: placement.originX,
        originY: placement.originY,
        scale: placement.scale,
        scaleX: placement.scaleX,
        scaleY: placement.scaleY,
        alpha: placement.alpha,
        count: placement.count,
        spacing: placement.spacing,
        warp: placement.warp,
      });
      notifyQortalLandDevelopmentAssetsChanged();
    },
    []
  );

  const updateSelectedDevelopmentPlacement = useCallback(
    (
      field:
        | 'x'
        | 'y'
        | 'depth'
        | 'originX'
        | 'originY'
        | 'scale'
        | 'scaleX'
        | 'scaleY'
        | 'alpha'
        | 'angle'
        | 'count'
        | 'spacing',
      value: string
    ) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return;
      const next = {
        ...selectedDevPlacement,
        [field]: numericValue,
      };
      if (field === 'scaleX' || field === 'scaleY') {
        next.scaleX =
          field === 'scaleX'
            ? numericValue
            : (selectedDevPlacement.scaleX ?? selectedDevPlacement.scale ?? 1);
        next.scaleY =
          field === 'scaleY'
            ? numericValue
            : (selectedDevPlacement.scaleY ?? selectedDevPlacement.scale ?? 1);
        delete next.scale;
      }
      if (field === 'scale') {
        delete next.scaleX;
        delete next.scaleY;
      }
      if (field === 'count') {
        next.count = Math.max(1, Math.min(12, Math.round(numericValue)));
      }
      setSelectedDevPlacement(next);
      writeSelectedDevelopmentPlacement(next);
      if (
        next.id !== QORTAL_LAND_DEVELOPMENT_CLUB_FLOOR_PLACEMENT_ID &&
        next.id !== QORTAL_LAND_DEVELOPMENT_PARK_SKYLINE_PLACEMENT_ID &&
        next.id !== QORTAL_LAND_DEVELOPMENT_PARK_FLOOR_PLACEMENT_ID &&
        next.id !== QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_PLACEMENT_ID &&
        next.id !== QORTAL_LAND_DEVELOPMENT_BACK_WALL_PLACEMENT_ID &&
        next.id !== QORTAL_LAND_DEVELOPMENT_LEFT_WALL_PLACEMENT_ID &&
        next.id !== QORTAL_LAND_DEVELOPMENT_RIGHT_WALL_PLACEMENT_ID &&
        next.id !== QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_PLACEMENT_ID &&
        !devPngPropsEnabled
      ) {
        window.localStorage.setItem(QORTAL_LAND_DEV_PNG_PROPS_STORAGE_KEY, '1');
        setDevPngPropsEnabled(true);
      }
    },
    [
      devPngPropsEnabled,
      selectedDevPlacement,
      writeSelectedDevelopmentPlacement,
    ]
  );

  const updateSelectedDevelopmentWarp = useCallback(
    (
      field: 'tlX' | 'tlY' | 'trX' | 'trY' | 'brX' | 'brY' | 'blX' | 'blY',
      value: string
    ) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return;
      const next = {
        ...selectedDevPlacement,
        warp: {
          ...(selectedDevPlacement.warp ?? {}),
          [field]: numericValue,
        },
      };
      setSelectedDevPlacement(next);
      writeSelectedDevelopmentPlacement(next);
    },
    [selectedDevPlacement, writeSelectedDevelopmentPlacement]
  );

  const resetSelectedDevelopmentPlacement = useCallback(() => {
    const meta = getQortalLandEditableDevelopmentPlacement(
      selectedDevPlacementId
    );
    clearQortalLandDevelopmentPngPlacementOverride(meta.defaultPlacement.id);
    setSelectedDevPlacement({ ...meta.defaultPlacement });
    notifyQortalLandDevelopmentAssetsChanged();
  }, [selectedDevPlacementId]);

  const setProceduralClubShellVisible = useCallback((enabled: boolean) => {
    if (enabled) {
      window.localStorage.setItem(
        QORTAL_LAND_DEV_PROCEDURAL_CLUB_SHELL_STORAGE_KEY,
        '1'
      );
    } else {
      window.localStorage.removeItem(
        QORTAL_LAND_DEV_PROCEDURAL_CLUB_SHELL_STORAGE_KEY
      );
    }
    setProceduralClubShellEnabled(enabled);
    notifyQortalLandDevelopmentAssetsChanged();
  }, []);

  const setCollisionDebugVisible = useCallback((enabled: boolean) => {
    if (enabled) {
      window.localStorage.setItem(
        QORTAL_LAND_DEV_COLLISION_DEBUG_STORAGE_KEY,
        '1'
      );
    } else {
      window.localStorage.removeItem(
        QORTAL_LAND_DEV_COLLISION_DEBUG_STORAGE_KEY
      );
    }
    setCollisionDebugEnabled(enabled);
    notifyQortalLandDevelopmentAssetsChanged();
  }, []);

  const writeDevelopmentLookSettings = useCallback(
    (settings: QortalLandDevelopmentLookSettings) => {
      writeQortalLandDevelopmentLookSettings(settings);
      setDevelopmentLookSettings(settings);
      notifyQortalLandDevelopmentAssetsChanged();
    },
    []
  );

  const setDevelopmentLookEnabled = useCallback(
    (enabled: boolean) => {
      writeDevelopmentLookSettings({
        ...developmentLookSettings,
        enabled,
      });
    },
    [developmentLookSettings, writeDevelopmentLookSettings]
  );

  const updateDevelopmentLookSetting = useCallback(
    (
      field: 'brightness' | 'contrast' | 'saturation' | 'shadow',
      value: string
    ) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return;
      const limits = {
        brightness: { min: 0.65, max: 1.25 },
        contrast: { min: 0.75, max: 1.55 },
        saturation: { min: 0.75, max: 1.65 },
        shadow: { min: 0, max: 0.5 },
      }[field];
      writeDevelopmentLookSettings({
        ...developmentLookSettings,
        [field]: clampQortalLandLookValue(
          numericValue,
          limits.min,
          limits.max,
          QORTAL_LAND_DEVELOPMENT_LOOK_DEFAULTS[field]
        ),
      });
    },
    [developmentLookSettings, writeDevelopmentLookSettings]
  );

  const resetDevelopmentLookSettings = useCallback(() => {
    writeDevelopmentLookSettings({ ...QORTAL_LAND_DEVELOPMENT_LOOK_DEFAULTS });
  }, [writeDevelopmentLookSettings]);

  const updateDevelopmentClubBarPlacement = useCallback(
    (
      field: 'x' | 'y' | 'depth' | 'originX' | 'originY' | 'scaleX' | 'scaleY',
      value: string
    ) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return;
      const next = {
        ...devClubBarPlacement,
        [field]: numericValue,
      };
      if (field === 'scaleX' || field === 'scaleY') {
        next.scaleX =
          field === 'scaleX'
            ? numericValue
            : (devClubBarPlacement.scaleX ?? devClubBarPlacement.scale ?? 1);
        next.scaleY =
          field === 'scaleY'
            ? numericValue
            : (devClubBarPlacement.scaleY ?? devClubBarPlacement.scale ?? 1);
        delete next.scale;
      }
      setDevClubBarPlacement(next);
      writeQortalLandDevelopmentPngPlacementOverride(
        QORTAL_LAND_DEVELOPMENT_CLUB_BAR_PLACEMENT_ID,
        {
          x: next.x,
          y: next.y,
          depth: next.depth,
          originX: next.originX,
          originY: next.originY,
          scaleX: next.scaleX,
          scaleY: next.scaleY,
          scale:
            next.scaleX === undefined && next.scaleY === undefined
              ? next.scale
              : undefined,
        }
      );
      if (!devPngPropsEnabled) {
        window.localStorage.setItem(QORTAL_LAND_DEV_PNG_PROPS_STORAGE_KEY, '1');
        setDevPngPropsEnabled(true);
      }
      notifyQortalLandDevelopmentAssetsChanged();
    },
    [devClubBarPlacement, devPngPropsEnabled]
  );

  const resetDevelopmentClubBarPlacement = useCallback(() => {
    clearQortalLandDevelopmentPngPlacementOverride(
      QORTAL_LAND_DEVELOPMENT_CLUB_BAR_PLACEMENT_ID
    );
    const defaults = { ...QORTAL_LAND_DEVELOPMENT_CLUB_BAR_DEFAULT_PLACEMENT };
    setDevClubBarPlacement(defaults);
    notifyQortalLandDevelopmentAssetsChanged();
  }, []);

  const updateDevelopmentBackBarPlacement = useCallback(
    (
      field: 'x' | 'y' | 'depth' | 'originX' | 'originY' | 'scale',
      value: string
    ) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return;
      const next = {
        ...devBackBarPlacement,
        [field]: numericValue,
      };
      setDevBackBarPlacement(next);
      writeQortalLandDevelopmentPngPlacementOverride(
        QORTAL_LAND_DEVELOPMENT_BACK_BAR_PLACEMENT_ID,
        {
          x: next.x,
          y: next.y,
          depth: next.depth,
          originX: next.originX,
          originY: next.originY,
          scale: next.scale,
        }
      );
      if (!devPngPropsEnabled) {
        window.localStorage.setItem(QORTAL_LAND_DEV_PNG_PROPS_STORAGE_KEY, '1');
        setDevPngPropsEnabled(true);
      }
      notifyQortalLandDevelopmentAssetsChanged();
    },
    [devBackBarPlacement, devPngPropsEnabled]
  );

  const resetDevelopmentBackBarPlacement = useCallback(() => {
    clearQortalLandDevelopmentPngPlacementOverride(
      QORTAL_LAND_DEVELOPMENT_BACK_BAR_PLACEMENT_ID
    );
    const defaults = { ...QORTAL_LAND_DEVELOPMENT_BACK_BAR_DEFAULT_PLACEMENT };
    setDevBackBarPlacement(defaults);
    notifyQortalLandDevelopmentAssetsChanged();
  }, []);

  const updateDevelopmentDjBoothPlacement = useCallback(
    (
      field: 'x' | 'y' | 'depth' | 'originX' | 'originY' | 'scale',
      value: string
    ) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return;
      const next = {
        ...devDjBoothPlacement,
        [field]: numericValue,
      };
      setDevDjBoothPlacement(next);
      writeQortalLandDevelopmentPngPlacementOverride(
        QORTAL_LAND_DEVELOPMENT_DJ_BOOTH_PLACEMENT_ID,
        {
          x: next.x,
          y: next.y,
          depth: next.depth,
          originX: next.originX,
          originY: next.originY,
          scale: next.scale,
        }
      );
      if (!devPngPropsEnabled) {
        window.localStorage.setItem(QORTAL_LAND_DEV_PNG_PROPS_STORAGE_KEY, '1');
        setDevPngPropsEnabled(true);
      }
      notifyQortalLandDevelopmentAssetsChanged();
    },
    [devDjBoothPlacement, devPngPropsEnabled]
  );

  const resetDevelopmentDjBoothPlacement = useCallback(() => {
    clearQortalLandDevelopmentPngPlacementOverride(
      QORTAL_LAND_DEVELOPMENT_DJ_BOOTH_PLACEMENT_ID
    );
    const defaults = { ...QORTAL_LAND_DEVELOPMENT_DJ_BOOTH_DEFAULT_PLACEMENT };
    setDevDjBoothPlacement(defaults);
    notifyQortalLandDevelopmentAssetsChanged();
  }, []);

  const queuePrimaryNameLookups = useCallback((addresses: string[]) => {
    const missingAddresses = addresses
      .map((address) => address.trim())
      .filter((address) => {
        if (!address) return false;
        if (primaryNameCacheRef.current.has(address)) return false;
        if (pendingPrimaryNameLookupsRef.current.has(address)) return false;
        return true;
      });
    if (missingAddresses.length === 0) return;

    missingAddresses.forEach((address) =>
      pendingPrimaryNameLookupsRef.current.add(address)
    );
    if (primaryNameLookupTimerRef.current !== null) return;

    primaryNameLookupTimerRef.current = window.setTimeout(() => {
      primaryNameLookupTimerRef.current = null;
      const batch = Array.from(pendingPrimaryNameLookupsRef.current);
      pendingPrimaryNameLookupsRef.current.clear();
      if (batch.length === 0) return;

      void getPrimaryNamesForAddresses(batch)
        .then((primaryNames) => {
          batch.forEach((address) => {
            primaryNameCacheRef.current.set(
              address,
              primaryNames[address]?.trim() || ''
            );
          });
          setPrimaryNameLookupVersion((version) => version + 1);
        })
        .catch((error) => {
          console.error('[QortalLand] Failed to resolve primary names:', error);
        });
    }, 120);
  }, []);

  const resolveLandPlayerName = useCallback((playerAddress: string): string => {
    return displayNameForAddress(playerAddress, primaryNameCacheRef.current);
  }, []);

  const handleLandGamePlayerSeen = useCallback(
    (playerAddress: string) => {
      queuePrimaryNameLookups([playerAddress]);
    },
    [queuePrimaryNameLookups]
  );

  const getProximityPosition = useCallback(
    () => ({
      roomId: localStateRef.current.roomId,
      x: localStateRef.current.x,
      y: localStateRef.current.y,
    }),
    []
  );

  const proximityVoice = useQortalLandProximityVoice({
    address: myAddress,
    publicKey: userInfo?.publicKey,
    groupId,
    sessionId,
    enabled: reticulumReady === true,
    suspended:
      landVoiceCall.callState !== 'idle' ||
      groupCall.roomState === 'joining' ||
      groupCall.roomState === 'connected',
    getPosition: getProximityPosition,
  });
  const availableProximityVoiceAddresses = useMemo(() => {
    void landAvailabilityVersion;
    const addresses = new Set<string>();
    for (const player of remotePlayersRef.current.values()) {
      if (
        player.roomId === landGameRoomId &&
        player.voiceEnabled &&
        player.authorAddress !== myAddress
      ) {
        addresses.add(player.authorAddress);
      }
    }
    return [...addresses];
  }, [landAvailabilityVersion, landGameRoomId, myAddress]);

  useEffect(() => {
    const speaking = new Set(
      proximityVoice.peers
        .filter((peer) => peer.speaking)
        .map((peer) => peer.address)
    );
    if (proximityVoice.transmitting) speaking.add(myAddress);
    proximitySpeakingAddressesRef.current = speaking;
  }, [myAddress, proximityVoice.peers, proximityVoice.transmitting]);

  const landGame = useQortalLandGame({
    address: myAddress,
    publicKey: userInfo?.publicKey,
    groupId,
    sessionId,
    roomId: landGameRoomId,
    enabled: reticulumReady === true,
    doNotDisturb: isLandDnd,
    onActivity: recordLandActivity,
    onActiveChange: handleLandGameActiveChange,
    onPlayerSeen: handleLandGamePlayerSeen,
    resolvePlayerName: resolveLandPlayerName,
  });
  landGameInputBlockedRef.current = landGame.busy;

  useLayoutEffect(() => {
    const blocked = landGame.busy;
    landGameInputBlockedRef.current = blocked;
    if (blocked) movementKeysRef.current.clear();

    const game = gameRef.current;
    if (game) game.input.enabled = !blocked;

    return () => {
      if (game && gameRef.current === game) game.input.enabled = true;
    };
  }, [landGame.busy]);

  useEffect(() => {
    const callInUse =
      landVoiceCall.callState !== 'idle' ||
      groupCall.roomState === 'joining' ||
      groupCall.roomState === 'connected';
    if (!isActive || !callInUse) return undefined;
    recordLandActivity();
    const interval = window.setInterval(recordLandActivity, 30_000);
    return () => window.clearInterval(interval);
  }, [
    groupCall.roomState,
    isActive,
    landVoiceCall.callState,
    recordLandActivity,
  ]);

  useEffect(() => {
    if (proximityVoice.transmitting) recordLandActivity();
  }, [proximityVoice.transmitting, recordLandActivity]);

  const wakeLandChatPanel = useCallback(() => {
    setIsChatDimmed(false);
    setLastChatActivityAt(Date.now());
  }, []);

  const appendLandChatMessage = useCallback(
    (message: LandChatTranscriptMessage) => {
      queuePrimaryNameLookups([message.authorAddress]);
      setLandChatMessages((messages) =>
        mergeLandChatTranscriptMessage(messages, message)
      );
      wakeLandChatPanel();
    },
    [queuePrimaryNameLookups, wakeLandChatPanel]
  );

  const focusLandChatInput = useCallback(() => {
    recordLandActivity();
    wakeLandChatPanel();
    window.setTimeout(() => {
      chatInputRef.current?.focus();
    }, 0);
  }, [recordLandActivity, wakeLandChatPanel]);

  const cancelLandChatTyping = useCallback(() => {
    setChatText('');
    setChatError('');
    setIsEmojiPickerOpen(false);
    setIsChatFocused(false);
    chatInputRef.current?.blur();
  }, []);

  const insertLandChatEmojiShortcut = useCallback(
    (shortcut: string) => {
      recordLandActivity();
      setChatText((current) => {
        const input = chatInputRef.current;
        const start = input?.selectionStart ?? current.length;
        const end = input?.selectionEnd ?? start;
        const before = current.slice(0, start);
        const after = current.slice(end);
        const insertedShortcut = `${shortcut} `;
        const leadingSpace =
          before.length > 0 && !/\s$/.test(before) ? ' ' : '';
        const trailingSpace = after.length > 0 && !/^\s/.test(after) ? ' ' : '';
        return `${before}${leadingSpace}${insertedShortcut}${trailingSpace}${after}`.slice(
          0,
          LAND_CHAT_MAX_INPUT_CHARS
        );
      });
      if (chatError) setChatError('');
      setIsEmojiPickerOpen(false);
      focusLandChatInput();
    },
    [chatError, focusLandChatInput, recordLandActivity]
  );

  useEffect(() => {
    queuePrimaryNameLookups([myAddress]);
  }, [myAddress, queuePrimaryNameLookups]);

  useEffect(() => {
    return () => {
      if (primaryNameLookupTimerRef.current !== null) {
        window.clearTimeout(primaryNameLookupTimerRef.current);
        primaryNameLookupTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!actionTarget) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (!isActiveRef.current) return;
      if (event.key === 'Escape') {
        setActionTarget(null);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [actionTarget]);

  const publishLandEventPayload = useCallback(
    async (payload: Record<string, unknown>) => {
      const timestamp = Date.now();
      const eventId = createLandChatMessageId();
      const authorSequence =
        await window.reticulumChat?.reserveAuthorSequence?.(groupId, myAddress);
      if (
        !authorSequence ||
        !/^[0-9a-f]{32}$/.test(authorSequence.authorStreamId) ||
        !Number.isInteger(authorSequence.authorSeq) ||
        authorSequence.authorSeq <= 0
      ) {
        throw new Error('Unable to reserve QortalLand chat event sequence');
      }
      let sequenceCommitted = false;
      try {
        const encryptedPayload = JSON.stringify({
          ...payload,
          qortalLand: true,
          sessionId,
          version: 1,
        });
        const payloadHash = await sha256Hex(encryptedPayload);
        const baseFields = {
          eventId,
          groupId,
          channelId: QORTAL_LAND_CHANNEL_ID,
          authorStreamId: authorSequence.authorStreamId,
          authorSeq: authorSequence.authorSeq,
          timestamp,
          eventType: 'message',
          targetEventId: null,
          replyToEventId: null,
          encryptedPayload,
          payloadHash,
          mentionAddressHashes: [],
        };
        const signed = (await window.sendMessage?.(
          'signReticulumChatEvent',
          baseFields,
          10000
        )) as
          | {
              authorAddress?: string;
              authorPublicKey?: string;
              signature?: string;
              error?: string;
            }
          | undefined;
        if (!signed || signed.error) {
          throw new Error(signed?.error || 'Unable to sign QortalLand event');
        }
        if (signed.authorAddress !== myAddress) {
          throw new Error('Signed QortalLand author mismatch');
        }
        const result = await window.reticulumChat?.publishEvent?.({
          ...baseFields,
          authorAddress: signed.authorAddress,
          authorPublicKey: signed.authorPublicKey,
          signature: signed.signature,
        });
        if (!result?.success) {
          throw new Error(result?.error || 'QortalLand event send failed');
        }
        sequenceCommitted = true;
        return { eventId, timestamp };
      } finally {
        if (!sequenceCommitted) {
          try {
            await window.reticulumChat?.releaseAuthorSequence?.(
              groupId,
              myAddress,
              authorSequence.authorStreamId,
              authorSequence.authorSeq
            );
          } catch (releaseError) {
            console.warn(
              'Unable to release QortalLand chat event sequence',
              releaseError
            );
          }
        }
      }
    },
    [groupId, myAddress, sessionId]
  );

  useEffect(() => {
    let cancelled = false;
    void window.reticulumChat?.isEnabled?.().then((enabled) => {
      if (!cancelled) setReticulumReady(enabled === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isChatFocused) {
      setIsChatDimmed(false);
      return undefined;
    }

    const elapsed = Date.now() - lastChatActivityAt;
    const delay = Math.max(0, LAND_CHAT_VISIBLE_IDLE_MS - elapsed);
    const timeout = window.setTimeout(() => {
      setIsChatDimmed(true);
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [isChatFocused, lastChatActivityAt]);

  const latestLandChatMessageId =
    landChatMessages[landChatMessages.length - 1]?.messageId || '';

  const commitChatPanelGeometry = useCallback((next: LandChatPanelGeometry) => {
    chatPanelGeometryRef.current = next;
    setChatPanelGeometry(next);
  }, []);

  const beginChatPanelInteraction = useCallback(
    (
      mode: LandChatPanelInteraction['mode'],
      pointerId: number,
      clientX: number,
      clientY: number
    ) => {
      const panel = chatPanelRef.current;
      const container = containerRef.current;
      if (!panel || !container) return;
      const panelRect = panel.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const measured: LandChatPanelGeometry = {
        x: panelRect.left - containerRect.left,
        y: panelRect.top - containerRect.top,
        width: panelRect.width,
        height: panelRect.height,
      };
      if (!chatPanelDefaultSizeRef.current) {
        chatPanelDefaultSizeRef.current = {
          width: panelRect.width,
          height: panelRect.height,
        };
      }
      commitChatPanelGeometry(measured);
      chatPanelInteractionRef.current = {
        mode,
        pointerId,
        startClientX: clientX,
        startClientY: clientY,
        startGeometry: measured,
      };
      wakeLandChatPanel();
    },
    [commitChatPanelGeometry, wakeLandChatPanel]
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const interaction = chatPanelInteractionRef.current;
      const container = containerRef.current;
      const defaults = chatPanelDefaultSizeRef.current;
      if (
        !interaction ||
        event.pointerId !== interaction.pointerId ||
        !container ||
        !defaults
      ) {
        return;
      }
      event.preventDefault();
      const bounds = container.getBoundingClientRect();
      const dx = event.clientX - interaction.startClientX;
      const dy = event.clientY - interaction.startClientY;
      const start = interaction.startGeometry;
      const minWidth = Math.min(defaults.width * 0.9, bounds.width);
      const minHeight = Math.min(defaults.height * 0.9, bounds.height);
      const maxWidth = Math.min(defaults.width * 1.3, bounds.width);
      const maxHeight = Math.min(defaults.height * 1.3, bounds.height);
      let next: LandChatPanelGeometry;

      if (interaction.mode === 'drag') {
        next = {
          ...start,
          x: clampNumber(
            start.x + dx,
            0,
            Math.max(0, bounds.width - start.width)
          ),
          y: clampNumber(
            start.y + dy,
            0,
            Math.max(0, bounds.height - start.height)
          ),
        };
      } else {
        const availableWidth = Math.max(0, bounds.width - start.x);
        const width = clampNumber(
          start.width + dx,
          Math.min(minWidth, availableWidth),
          Math.max(
            Math.min(minWidth, availableWidth),
            Math.min(maxWidth, availableWidth)
          )
        );
        if (interaction.mode === 'resize-top-right') {
          const fixedBottom = start.y + start.height;
          const availableHeight = Math.max(0, fixedBottom);
          const height = clampNumber(
            start.height - dy,
            Math.min(minHeight, availableHeight),
            Math.max(
              Math.min(minHeight, availableHeight),
              Math.min(maxHeight, availableHeight)
            )
          );
          next = {
            x: start.x,
            y: fixedBottom - height,
            width,
            height,
          };
        } else {
          const availableHeight = Math.max(0, bounds.height - start.y);
          const height = clampNumber(
            start.height + dy,
            Math.min(minHeight, availableHeight),
            Math.max(
              Math.min(minHeight, availableHeight),
              Math.min(maxHeight, availableHeight)
            )
          );
          next = {
            x: start.x,
            y: start.y,
            width,
            height,
          };
        }
      }
      commitChatPanelGeometry(next);
    };
    const finishPointerInteraction = (event: PointerEvent) => {
      if (chatPanelInteractionRef.current?.pointerId === event.pointerId) {
        chatPanelInteractionRef.current = null;
      }
    };
    window.addEventListener('pointermove', handlePointerMove, {
      passive: false,
    });
    window.addEventListener('pointerup', finishPointerInteraction);
    window.addEventListener('pointercancel', finishPointerInteraction);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPointerInteraction);
      window.removeEventListener('pointercancel', finishPointerInteraction);
    };
  }, [commitChatPanelGeometry]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      const current = chatPanelGeometryRef.current;
      if (!current) return;
      const bounds = container.getBoundingClientRect();
      const width = Math.min(current.width, bounds.width);
      const height = Math.min(current.height, bounds.height);
      commitChatPanelGeometry({
        x: clampNumber(current.x, 0, Math.max(0, bounds.width - width)),
        y: clampNumber(current.y, 0, Math.max(0, bounds.height - height)),
        width,
        height,
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [commitChatPanelGeometry]);

  useLayoutEffect(() => {
    if (activeChatTab !== 'local') return undefined;
    const viewport = chatMessagesViewportRef.current;
    if (!viewport) return undefined;
    viewport.scrollTop = viewport.scrollHeight;
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeChatTab, latestLandChatMessageId]);

  useEffect(() => {
    const handleStartChat = (event: KeyboardEvent) => {
      if (!isActiveRef.current) return;
      if (event.key !== 'Enter') return;
      if (isEditableTarget(event.target)) return;
      if (reticulumReady !== true) return;
      event.preventDefault();
      focusLandChatInput();
    };
    window.addEventListener('keydown', handleStartChat);
    return () => window.removeEventListener('keydown', handleStartChat);
  }, [focusLandChatInput, reticulumReady]);

  useEffect(() => {
    const pressedKeys = movementKeysRef.current;
    const normalizeMovementKey = (key: string): string =>
      key.trim().toLowerCase();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isActiveRef.current) return;
      if (isEditableTarget(event.target)) return;
      if (landGameActiveRef.current) {
        const blocked = normalizeMovementKey(event.key);
        if (
          [
            'arrowleft',
            'arrowright',
            'arrowup',
            'arrowdown',
            'a',
            'd',
            'w',
            's',
          ].includes(blocked)
        ) {
          event.preventDefault();
        }
        return;
      }
      const key = normalizeMovementKey(event.key);
      if (
        key === 'e' &&
        isNearClubDjBooth(
          localStateRef.current.roomId,
          localStateRef.current.x,
          localStateRef.current.y
        )
      ) {
        event.preventDefault();
        return;
      }
      if (
        ![
          'arrowleft',
          'arrowright',
          'arrowup',
          'arrowdown',
          'a',
          'd',
          'w',
          's',
        ].includes(key)
      )
        return;
      pressedKeys.add(key);
      event.preventDefault();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      pressedKeys.delete(normalizeMovementKey(event.key));
    };
    const clearKeys = () => {
      pressedKeys.clear();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearKeys);
    document.addEventListener('visibilitychange', clearKeys);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearKeys);
      document.removeEventListener('visibilitychange', clearKeys);
      clearKeys();
    };
  }, []);

  const addLandActionAnimation = useCallback(
    (
      animation: Omit<LandActionAnimation, 'createdAt' | 'expiresAt'> & {
        timestamp?: number;
      }
    ) => {
      const now = Date.now();
      const packetTimestamp = Number(animation.timestamp);
      const createdAt = Number.isFinite(packetTimestamp)
        ? Math.min(now, packetTimestamp)
        : now;
      if (createdAt <= now - LAND_ACTION_ANIMATION_TTL_MS) return;
      const existingForTarget = [...landActionAnimationsRef.current.values()]
        .filter(
          (item) =>
            item.toAddress === animation.toAddress &&
            item.targetSessionId === animation.targetSessionId
        )
        .sort((left, right) => left.createdAt - right.createdAt);
      while (existingForTarget.length >= LAND_ACTIONS_PER_AVATAR_MAX) {
        const oldest = existingForTarget.shift();
        if (oldest) landActionAnimationsRef.current.delete(oldest.actionId);
      }
      landActionAnimationsRef.current.set(animation.actionId, {
        ...animation,
        createdAt,
        expiresAt: createdAt + LAND_ACTION_ANIMATION_TTL_MS,
      });
    },
    []
  );

  const sendLandChat = useCallback(async () => {
    if (isSendingChat || reticulumReady !== true) return;
    const { text, mode, moodAction } = parseLandChatCommand(chatText);
    if (!text) return;
    recordLandActivity();
    if (utf8ByteLength(text) > LAND_CHAT_MAX_TEXT_BYTES) {
      setChatError('Message is too large');
      return;
    }
    setIsSendingChat(true);
    setChatError('');
    try {
      const landSequence = landChatSequenceRef.current + 1;
      landChatSequenceRef.current = landSequence;
      const published = await publishLandEventPayload({
        qortalLandType: 'chat',
        messageText: text,
        chatMode: mode,
        moodAction,
        landSequence,
      });
      const now = Date.now();
      const message: LandChatTranscriptMessage = {
        messageId: published.eventId,
        authorAddress: myAddress,
        sessionId,
        sequence: landSequence,
        text,
        mode,
        moodAction,
        timestamp: published.timestamp,
      };
      appendLandChatMessage(message);
      if (moodAction) {
        addLandActionAnimation({
          actionId: `${published.eventId}:mood`,
          type: moodAction,
          fromAddress: myAddress,
          sourceSessionId: sessionId,
          sequence: landSequence,
          toAddress: myAddress,
          targetSessionId: sessionId,
          amount: 0,
          roomId: currentRoomRef.current,
          timestamp: published.timestamp,
        });
      } else {
        landChatBubblesRef.current.set(published.eventId, {
          messageId: published.eventId,
          authorAddress: myAddress,
          sessionId,
          sequence: landSequence,
          text,
          createdAt: now,
          expiresAt: now + LAND_CHAT_BUBBLE_TTL_MS,
        });
      }
      setChatText('');
      setIsEmojiPickerOpen(false);
      setIsChatFocused(true);
      window.setTimeout(() => {
        chatInputRef.current?.focus();
      }, 0);
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : 'QortalLand chat send failed'
      );
    } finally {
      setIsSendingChat(false);
    }
  }, [
    addLandActionAnimation,
    appendLandChatMessage,
    chatText,
    isSendingChat,
    myAddress,
    publishLandEventPayload,
    recordLandActivity,
    reticulumReady,
    sessionId,
  ]);

  const submitLandChatFromInput = useCallback(() => {
    if (activeChatTab !== 'local') return;
    const { text, presenceCommand } = parseLandChatCommand(chatText);
    if (presenceCommand) {
      const nextAfk =
        presenceCommand === 'afk' ? !localStateRef.current.afk : undefined;
      recordLandActivity();
      if (presenceCommand === 'afk') {
        setLocalLandAvailability({ afk: nextAfk });
      } else {
        setLocalLandAvailability({ dnd: !localStateRef.current.dnd });
      }
      setChatText('');
      setChatError('');
      setIsEmojiPickerOpen(false);
      return;
    }
    if (!text) {
      cancelLandChatTyping();
      return;
    }
    void sendLandChat();
  }, [
    activeChatTab,
    cancelLandChatTyping,
    chatText,
    recordLandActivity,
    sendLandChat,
    setLocalLandAvailability,
  ]);

  const sendSocialAction = useCallback(
    async (actionType: LandSocialActionType) => {
      const target = actionTarget
        ? resolveCurrentLandActionTarget(actionTarget)
        : null;
      const now = Date.now();
      if (
        !target ||
        reticulumReady !== true ||
        sendingSocialAction ||
        socialActionCooldownUntil > now
      )
        return;
      recordLandActivity();
      setSendingSocialAction(actionType);
      setSocialActionError('');
      const actionId = createLandChatMessageId();
      const actionSequence = landActionSequenceRef.current + 1;
      landActionSequenceRef.current = actionSequence;
      try {
        const result = await window.reticulumChat?.sendLandAction?.(groupId, {
          actionId,
          actionType,
          fromAddress: myAddress,
          sourceSessionId: sessionId,
          sequence: actionSequence,
          toAddress: target.authorAddress,
          targetSessionId: target.sessionId,
          roomId: target.roomId,
        });
        if (!result?.success) {
          throw new Error(result?.error || 'The effect could not be sent');
        }
        addLandActionAnimation({
          actionId,
          type: actionType,
          fromAddress: myAddress,
          sourceSessionId: sessionId,
          sequence: actionSequence,
          toAddress: target.authorAddress,
          targetSessionId: target.sessionId,
          amount: 0,
          roomId: target.roomId,
        });
        const cooldownUntil = Date.now() + LAND_SOCIAL_ACTION_COOLDOWN_MS;
        setSocialActionCooldownUntil(cooldownUntil);
        if (landActionCooldownTimerRef.current !== null) {
          window.clearTimeout(landActionCooldownTimerRef.current);
        }
        landActionCooldownTimerRef.current = window.setTimeout(() => {
          landActionCooldownTimerRef.current = null;
          setSocialActionCooldownUntil(0);
        }, LAND_SOCIAL_ACTION_COOLDOWN_MS);
        setActionTarget(null);
      } catch (error) {
        setSocialActionError(
          error instanceof Error
            ? error.message
            : 'The effect could not be sent'
        );
      } finally {
        setSendingSocialAction(null);
      }
    },
    [
      addLandActionAnimation,
      actionTarget,
      groupId,
      myAddress,
      reticulumReady,
      recordLandActivity,
      resolveCurrentLandActionTarget,
      sendingSocialAction,
      sessionId,
      socialActionCooldownUntil,
    ]
  );

  const openSendQortDialog = useCallback((target: LandActionTarget) => {
    setActionTarget(null);
    setSendQortTarget(target);
    setSendQortAmount('1');
    setSendQortError('');
  }, []);

  const closeSendQortDialog = useCallback(() => {
    if (isSendingQort) return;
    setSendQortTarget(null);
    setSendQortError('');
  }, [isSendingQort]);

  const handleSendQort = useCallback(async () => {
    if (!sendQortTarget || isSendingQort) return;
    const amount = Number(sendQortAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setSendQortError('Enter a valid QORT amount');
      return;
    }
    if (amount > qortBalance) {
      setSendQortError('Insufficient QORT balance');
      return;
    }
    setIsSendingQort(true);
    setSendQortError('');
    try {
      const paymentResult = (await window.sendMessage?.(
        'sendCoin',
        {
          amount,
          receiver: sendQortTarget.authorAddress,
          password: null,
          skipConfirmPassword: true,
        },
        120000
      )) as { payload?: unknown; error?: string } | undefined;
      if (!paymentResult || paymentResult.error) {
        throw new Error(paymentResult?.error || 'QORT payment failed');
      }

      const actionId = createLandChatMessageId();
      const actionSequence = landActionSequenceRef.current + 1;
      landActionSequenceRef.current = actionSequence;
      let actionResult: { success: boolean; error?: string } | null = null;
      try {
        actionResult =
          (await window.reticulumChat?.sendLandAction?.(groupId, {
            actionId,
            actionType: 'qort_received',
            fromAddress: myAddress,
            sourceSessionId: sessionId,
            sequence: actionSequence,
            toAddress: sendQortTarget.authorAddress,
            targetSessionId: sendQortTarget.sessionId,
            amount,
            roomId: sendQortTarget.roomId,
          })) ?? null;
      } catch (error) {
        console.warn('Failed to send QortalLand QORT action:', error);
      }
      if (actionResult && actionResult.success !== true) {
        console.warn(
          'Failed to send QortalLand QORT action:',
          actionResult.error
        );
      }
      addLandActionAnimation({
        actionId,
        type: 'qort_received',
        fromAddress: myAddress,
        sourceSessionId: sessionId,
        sequence: actionSequence,
        toAddress: sendQortTarget.authorAddress,
        targetSessionId: sendQortTarget.sessionId,
        amount,
        roomId: sendQortTarget.roomId,
      });
      setSendQortTarget(null);
      setSendQortAmount('1');
    } catch (error) {
      setSendQortError(
        error instanceof Error ? error.message : 'QORT payment failed'
      );
    } finally {
      setIsSendingQort(false);
    }
  }, [
    addLandActionAnimation,
    groupId,
    isSendingQort,
    myAddress,
    qortBalance,
    sendQortAmount,
    sendQortTarget,
    sessionId,
  ]);

  const startLandCall = useCallback(
    (target: LandActionTarget) => {
      const currentTarget = resolveCurrentLandActionTarget(target);
      if (!myAddress || landVoiceCall.callState !== 'idle') return;
      if (!currentTarget || !currentTarget.destinationHash) return;
      if (isAddressInLandCall(currentTarget.authorAddress)) return;
      const targetIsDnd =
        remotePlayersRef.current.get(currentTarget.key)?.dnd === true;
      if (targetIsDnd) return;
      recordLandActivity();
      const chatId = buildDirectVoiceCallChatId(
        myAddress,
        currentTarget.authorAddress
      );
      pendingLandCallTargetRef.current = currentTarget;
      setActionTarget(null);
      void landVoiceCall.initiateCall(currentTarget.authorAddress, chatId);
    },
    [
      isAddressInLandCall,
      landVoiceCall,
      myAddress,
      recordLandActivity,
      resolveCurrentLandActionTarget,
    ]
  );

  useEffect(() => {
    if (!Number.isInteger(groupId) || groupId <= 0 || !myAddress) return;
    void window.reticulumChat?.subscribeGroup?.(groupId);
    void window.reticulumChat?.subscribeChannel?.(
      groupId,
      QORTAL_LAND_CHANNEL_ID
    );
    const unsubscribe = window.reticulumChat?.onLandState?.((payload) => {
      if (payload.groupId !== groupId) return;
      if (
        payload.authorAddress === myAddress &&
        payload.sessionId === sessionId
      )
        return;
      queuePrimaryNameLookups([payload.authorAddress]);
      const key = `${payload.authorAddress}:${payload.sessionId}`;
      const existing = remotePlayersRef.current.get(key);
      const now = Date.now();
      const roomId = normalizeLandRoomId(payload.roomId);
      if (payload.movement === 'leave') {
        if (!existing || payload.sequence >= existing.sequence) {
          remotePlayersRef.current.delete(key);
          setLandAvailabilityVersion((value) => value + 1);
          publishLandPresenceSnapshot();
        }
        return;
      }
      if (existing && payload.sequence <= existing.sequence) {
        existing.lastSeenAt = now;
        // A signed device route can arrive after the state that first rendered
        // this player. Merge that late route even though the state sequence is
        // unchanged so calls and games become available without movement.
        if (
          payload.sequence === existing.sequence &&
          payload.destinationHash &&
          existing.destinationHash !== payload.destinationHash
        ) {
          existing.destinationHash = payload.destinationHash;
          setLandAvailabilityVersion((value) => value + 1);
          publishLandPresenceSnapshot();
        }
        return;
      }
      const sentAt = finiteNumber(payload.timestamp) ?? now;
      const roomChanged = Boolean(existing && existing.roomId !== roomId);
      const fromX = roomChanged
        ? payload.x
        : (existing?.displayX ?? existing?.x ?? payload.x);
      const fromY = roomChanged
        ? payload.y
        : (existing?.displayY ?? existing?.y ?? payload.y);
      const stateGapMs = existing
        ? clampNumber(
            sentAt > existing.sentAt
              ? sentAt - existing.sentAt
              : now - existing.receivedAt,
            LAND_SEND_INTERVAL_MS,
            5000
          )
        : LAND_SEND_INTERVAL_MS;
      const velocitySourceMs = Math.max(stateGapMs, 1);
      const velocityX =
        existing && !roomChanged
          ? clampRemoteVelocity((payload.x - existing.x) / velocitySourceMs)
          : 0;
      const velocityY =
        existing && !roomChanged
          ? clampRemoteVelocity((payload.y - existing.y) / velocitySourceMs)
          : 0;
      const observedTimelineOffsetMs = now - sentAt;
      const timelineOffsetMs =
        roomChanged || !existing
          ? observedTimelineOffsetMs
          : observedTimelineOffsetMs < existing.timelineOffsetMs
            ? Math.max(
                observedTimelineOffsetMs,
                existing.timelineOffsetMs - LAND_REMOTE_TIMELINE_CATCH_UP_MS
              )
            : existing.timelineOffsetMs;
      const fromTimelineAt =
        roomChanged || !existing
          ? now
          : now - LAND_REMOTE_INTERPOLATION_BUFFER_MS;
      const mappedTimelineAt = sentAt + timelineOffsetMs;
      const timelineAt =
        roomChanged || !existing
          ? now
          : Math.max(
              fromTimelineAt + LAND_REMOTE_RECONCILE_MS,
              mappedTimelineAt
            );
      const afk = payload.afk === true;
      const dnd = payload.dnd === true;
      const voiceEnabled = payload.voiceEnabled === true;
      const voiceMuted = voiceEnabled && payload.voiceMuted === true;
      const skinId = normalizeQortalLandSkinId(payload.skinId);
      const destinationHash = payload.destinationHash;
      const availabilityChanged =
        !existing ||
        existing.roomId !== roomId ||
        existing.afk !== afk ||
        existing.dnd !== dnd ||
        existing.voiceEnabled !== voiceEnabled ||
        existing.voiceMuted !== voiceMuted ||
        existing.destinationHash !== destinationHash;
      remotePlayersRef.current.set(key, {
        authorAddress: payload.authorAddress,
        sessionId: payload.sessionId,
        destinationHash,
        sequence: payload.sequence,
        roomId,
        x: payload.x,
        y: payload.y,
        fromX,
        fromY,
        fromTimelineAt,
        timelineAt,
        timelineOffsetMs,
        displayX: fromX,
        displayY: fromY,
        fromDirection: roomChanged
          ? payload.direction || 'r'
          : existing?.direction || payload.direction || 'r',
        fromMovement: roomChanged
          ? payload.movement || 'idle'
          : existing?.movement || payload.movement || 'idle',
        direction: payload.direction || existing?.direction || 'r',
        movement: payload.movement || 'idle',
        sentAt,
        receivedAt: now,
        lastSeenAt: now,
        velocityX,
        velocityY,
        afk,
        dnd,
        voiceEnabled,
        voiceMuted,
        skinId,
      });
      if (availabilityChanged) {
        setLandAvailabilityVersion((value) => value + 1);
        publishLandPresenceSnapshot();
      }
    });
    return () => {
      unsubscribe?.();
      void window.reticulumChat?.unsubscribeChannel?.(
        groupId,
        QORTAL_LAND_CHANNEL_ID
      );
      void window.reticulumChat?.sendLandState?.(groupId, myAddress, {
        sessionId,
        sequence: sequenceRef.current + 1,
        ...localStateRef.current,
        movement: 'leave',
        afk: localStateRef.current.afk,
        dnd: localStateRef.current.dnd,
        voiceEnabled: localStateRef.current.voiceEnabled,
        voiceMuted: localStateRef.current.voiceMuted,
        skinId: localStateRef.current.skinId,
      });
    };
  }, [
    groupId,
    myAddress,
    publishLandPresenceSnapshot,
    queuePrimaryNameLookups,
    sessionId,
  ]);

  useEffect(() => {
    if (!Number.isInteger(groupId) || groupId <= 0 || !myAddress) return;
    let cancelled = false;
    const loadHistory = async () => {
      const history = await window.reticulumChat?.getMessageHistory?.(
        groupId,
        QORTAL_LAND_CHANNEL_ID,
        LAND_CHAT_TRANSCRIPT_LIMIT,
        { repairNetwork: false }
      );
      if (cancelled || !Array.isArray(history)) return;
      const messages = history
        .map((event) => event as ReticulumChatEventForLand)
        .filter((event) => Number(event.groupId) === groupId)
        .filter((event) => event.channelId === QORTAL_LAND_CHANNEL_ID)
        .filter((event) => event.eventType === 'message')
        .map((event) => parseQortalLandChatEvent(event, ''))
        .filter((message): message is LandChatTranscriptMessage =>
          Boolean(message)
        );
      if (!messages.length) return;
      queuePrimaryNameLookups(messages.map((message) => message.authorAddress));
      setLandChatMessages((current) =>
        messages.reduce(
          (nextMessages, message) =>
            mergeLandChatTranscriptMessage(nextMessages, message),
          current
        )
      );

      const now = Date.now();
      for (const message of messages.slice(-LAND_CHAT_RECONCILE_LIMIT)) {
        if (
          message.moodAction ||
          message.timestamp > now + 5000 ||
          now - message.timestamp >= LAND_CHAT_BUBBLE_TTL_MS ||
          landChatBubblesRef.current.has(message.messageId)
        ) {
          continue;
        }
        landChatBubblesRef.current.set(message.messageId, {
          messageId: message.messageId,
          authorAddress: message.authorAddress,
          sessionId: message.sessionId,
          sequence: message.sequence,
          text: message.text,
          createdAt: message.timestamp,
          expiresAt: message.timestamp + LAND_CHAT_BUBBLE_TTL_MS,
        });
      }
    };
    void loadHistory().catch((error) => {
      console.warn('[QortalLand] Failed to load chat history', error);
    });
    return () => {
      cancelled = true;
    };
  }, [groupId, myAddress, queuePrimaryNameLookups]);

  useEffect(() => {
    if (!Number.isInteger(groupId) || groupId <= 0 || !myAddress) return;
    const unsubscribe = window.reticulumChat?.onEvent?.(({ event }) => {
      const payload = event as ReticulumChatEventForLand;
      if (Number(payload.groupId) !== groupId) return;
      if (payload.channelId !== QORTAL_LAND_CHANNEL_ID) return;
      if (payload.eventType !== 'message') return;
      if (
        typeof payload.eventId !== 'string' ||
        typeof payload.authorAddress !== 'string' ||
        typeof payload.encryptedPayload !== 'string'
      ) {
        return;
      }
      const message = parseQortalLandChatEvent(payload, '');
      if (!message) return;
      queuePrimaryNameLookups([payload.authorAddress]);
      const now = Date.now();
      if (message.moodAction) {
        const actionId = `${payload.eventId}:mood`;
        if (!landActionAnimationsRef.current.has(actionId)) {
          addLandActionAnimation({
            actionId,
            type: message.moodAction,
            fromAddress: payload.authorAddress,
            sourceSessionId: message.sessionId,
            sequence: message.sequence,
            toAddress: payload.authorAddress,
            targetSessionId: message.sessionId,
            amount: 0,
            roomId: '',
            timestamp: now,
          });
        }
      } else {
        landChatBubblesRef.current.set(payload.eventId, {
          messageId: payload.eventId,
          authorAddress: payload.authorAddress,
          sessionId: message.sessionId,
          sequence: message.sequence,
          text: message.text,
          createdAt: now,
          expiresAt: now + LAND_CHAT_BUBBLE_TTL_MS,
        });
      }
      appendLandChatMessage(message);
    });
    return () => {
      unsubscribe?.();
    };
  }, [
    addLandActionAnimation,
    appendLandChatMessage,
    groupId,
    myAddress,
    queuePrimaryNameLookups,
  ]);

  useEffect(() => {
    if (!Number.isInteger(groupId) || groupId <= 0 || !myAddress) return;
    const unsubscribe = window.reticulumChat?.onLandAction?.((payload) => {
      if (payload.groupId !== groupId) return;
      const actionType =
        typeof payload.actionType === 'string' ? payload.actionType : '';
      if (actionType !== 'qort_received' && !isLandSocialActionType(actionType))
        return;
      const actionId =
        typeof payload.actionId === 'string' ? payload.actionId : '';
      const fromAddress =
        typeof payload.fromAddress === 'string' ? payload.fromAddress : '';
      const sourceSessionId =
        typeof payload.sourceSessionId === 'string'
          ? payload.sourceSessionId
          : '';
      const actionSequence = finiteNumber(payload.sequence);
      const toAddress =
        typeof payload.toAddress === 'string' ? payload.toAddress : '';
      const targetSessionId =
        typeof payload.targetSessionId === 'string'
          ? payload.targetSessionId
          : '';
      const amount = finiteNumber(payload.amount);
      if (
        !actionId ||
        !fromAddress ||
        !sourceSessionId ||
        actionSequence === null ||
        actionSequence <= 0 ||
        !toAddress ||
        !targetSessionId ||
        amount === null ||
        (actionType === 'qort_received' ? amount <= 0 : amount !== 0)
      )
        return;
      if (landActionAnimationsRef.current.has(actionId)) return;
      queuePrimaryNameLookups([fromAddress, toAddress]);
      addLandActionAnimation({
        actionId,
        type: actionType,
        fromAddress,
        sourceSessionId,
        sequence: actionSequence,
        toAddress,
        targetSessionId,
        amount,
        roomId:
          typeof payload.roomId === 'string' && payload.roomId.trim()
            ? normalizeLandRoomId(payload.roomId)
            : '',
        timestamp: payload.timestamp,
      });
    });
    return () => {
      unsubscribe?.();
    };
  }, [addLandActionAnimation, groupId, myAddress, queuePrimaryNameLookups]);

  useEffect(() => {
    if (!Number.isInteger(groupId) || groupId <= 0 || !myAddress) return;
    const unsubscribe = window.reticulumChat?.onLandCall?.((payload) => {
      if (payload.groupId !== groupId) return;
      const callType =
        typeof payload.callType === 'string' ? payload.callType : '';
      const callId = typeof payload.callId === 'string' ? payload.callId : '';
      const fromAddress =
        typeof payload.fromAddress === 'string' ? payload.fromAddress : '';
      const toAddress =
        typeof payload.toAddress === 'string' ? payload.toAddress : '';
      const sourceSessionId =
        typeof payload.sourceSessionId === 'string'
          ? payload.sourceSessionId
          : '';
      const targetSessionId =
        typeof payload.targetSessionId === 'string'
          ? payload.targetSessionId
          : '';
      const sourceDestinationHash =
        typeof payload.sourceDestinationHash === 'string'
          ? payload.sourceDestinationHash
          : '';
      const chatId =
        typeof payload.chatId === 'string' && payload.chatId
          ? payload.chatId
          : fromAddress && toAddress
            ? buildDirectVoiceCallChatId(fromAddress, toAddress)
            : '';
      const roomId = normalizeLandRoomId(payload.roomId);
      if (!callId || !fromAddress || !toAddress) return;
      const interactiveCall = [
        'request',
        'accept',
        'reject',
        'hangup',
      ].includes(callType);
      if (
        interactiveCall &&
        (!sourceSessionId ||
          !targetSessionId ||
          !sourceDestinationHash ||
          targetSessionId !== sessionId)
      )
        return;
      if (payload.fromPublicKey) {
        landCallPeerPublicKeysRef.current.set(
          fromAddress,
          payload.fromPublicKey
        );
      }

      if (callType === 'game_status') {
        touchLandGamePresence(fromAddress, toAddress, callId, roomId);
        return;
      }

      if (callType === 'game_ended') {
        clearLandGamePresence([fromAddress], callId);
        return;
      }

      if (callType === 'request') {
        if (toAddress !== myAddress || fromAddress === myAddress) return;
        const peer = {
          peerAddress: fromAddress,
          chatId,
          sourceSessionId: sessionId,
          targetSessionId: sourceSessionId,
          targetDestinationHash: sourceDestinationHash,
        };
        const existingCallPeer = landCallPeersRef.current.get(callId);
        const duplicateActiveRequest =
          activeLandCallIdRef.current === callId &&
          existingCallPeer?.peerAddress === fromAddress &&
          existingCallPeer.chatId === chatId;
        if (duplicateActiveRequest) return;
        const localBusy =
          landVoiceCallStateRef.current !== 'idle' ||
          Boolean(activeLandCallIdRef.current) ||
          landGameActiveRef.current;
        if (localBusy) {
          const timestamp = Date.now();
          void sendLandCallSignal({
            callType: 'reject',
            callId,
            fromAddress: myAddress,
            toAddress: fromAddress,
            chatId,
            reason: 'busy',
            roomId: currentRoomRef.current,
            sourceSessionId: peer.sourceSessionId,
            targetSessionId: peer.targetSessionId,
            targetDestinationHash: peer.targetDestinationHash,
            timestamp,
          }).catch(() => {});
          return;
        }
        landCallPeersRef.current.set(callId, peer);
        activeLandCallIdRef.current = callId;
        setActiveLandCallPeerAddress(fromAddress);
        queuePrimaryNameLookups([fromAddress]);
        emitLandCallEvent('call:incoming', {
          callId,
          fromAddress,
          chatId,
        });
        return;
      }

      if (callType === 'accept') {
        touchLandCallPresence(fromAddress, toAddress, callId, roomId);
        touchLandCallPresence(toAddress, fromAddress, callId, roomId);
        if (toAddress !== myAddress) return;
        landCallPeersRef.current.set(callId, {
          peerAddress: fromAddress,
          chatId,
          sourceSessionId: sessionId,
          targetSessionId: sourceSessionId,
          targetDestinationHash: sourceDestinationHash,
        });
        activeLandCallIdRef.current = callId;
        setActiveLandCallPeerAddress(fromAddress);
        queuePrimaryNameLookups([fromAddress]);
        emitLandCallEvent('call:accepted', { callId });
        return;
      }

      if (callType === 'reject') {
        clearLandCallPresence([fromAddress, toAddress]);
        if (toAddress === myAddress) {
          emitLandCallEvent('call:rejected', {
            callId,
            reason: payload.reason || 'rejected',
          });
        }
        landCallPeersRef.current.delete(callId);
        if (lastAnnouncedLandCallRef.current?.callId === callId) {
          lastAnnouncedLandCallRef.current = null;
        }
        if (activeLandCallIdRef.current === callId) {
          activeLandCallIdRef.current = null;
          setActiveLandCallPeerAddress(null);
        }
        return;
      }

      if (callType === 'hangup' || callType === 'ended') {
        clearLandCallPresence([fromAddress, toAddress]);
        if (lastAnnouncedLandCallRef.current?.callId === callId) {
          lastAnnouncedLandCallRef.current = null;
        }
        if (callType === 'ended') {
          return;
        }
        if (toAddress === myAddress) {
          emitLandCallEvent('call:hangup', { callId });
        }
        landCallPeersRef.current.delete(callId);
        if (activeLandCallIdRef.current === callId) {
          activeLandCallIdRef.current = null;
          setActiveLandCallPeerAddress(null);
        }
        return;
      }

      if (callType === 'status') {
        touchLandCallPresence(fromAddress, toAddress, callId, roomId);
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, [
    clearLandCallPresence,
    clearLandGamePresence,
    emitLandCallEvent,
    groupId,
    isAddressInLandCall,
    myAddress,
    queuePrimaryNameLookups,
    sendLandCallSignal,
    touchLandCallPresence,
    touchLandGamePresence,
    sessionId,
  ]);

  useEffect(() => {
    if (
      reticulumReady !== true ||
      !Number.isInteger(groupId) ||
      groupId <= 0 ||
      !myAddress
    )
      return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      const current = localStateRef.current;
      if (shouldSuspendQortalLandPresence(isActiveRef.current, current.afk)) {
        return;
      }
      const previous = lastSentRef.current;
      const moved =
        Math.abs(current.x - previous.x) >= 2 ||
        Math.abs(current.y - previous.y) >= 2 ||
        current.direction !== previous.direction ||
        current.movement !== previous.movement ||
        current.afk !== previous.afk ||
        current.dnd !== previous.dnd ||
        current.voiceEnabled !== previous.voiceEnabled ||
        current.voiceMuted !== previous.voiceMuted ||
        current.skinId !== previous.skinId;
      if (!moved && now - previous.sentAt < LAND_HEARTBEAT_MS) return;
      sequenceRef.current += 1;
      lastSentRef.current = { ...current, sentAt: now };
      void window.reticulumChat?.sendLandState?.(groupId, myAddress, {
        sessionId,
        sequence: sequenceRef.current,
        ...current,
        afk: current.afk,
        dnd: current.dnd,
        skinId: current.skinId,
      });
      // Keep the renderer-wide member list snapshot in step with the same
      // heartbeat used for network presence. Without this refresh, the local
      // Q-LAND badge can expire even while the player remains in QortalLand.
      publishLandPresenceSnapshot();
    }, LAND_SEND_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [
    groupId,
    myAddress,
    publishLandPresenceSnapshot,
    reticulumReady,
    sessionId,
  ]);

  useEffect(() => {
    if (!myAddress || reticulumReady !== true) return;
    const callActive = landVoiceCall.callState === 'connected';
    const callId = activeLandCallIdRef.current;
    const peer = callId ? landCallPeersRef.current.get(callId) : null;
    if (!callActive || !callId || !peer) return;
    const sendStatus = () => {
      touchLandCallPresence(
        myAddress,
        peer.peerAddress,
        callId,
        currentRoomRef.current
      );
      void sendLandCallSignal({
        callType: 'status',
        callId,
        fromAddress: myAddress,
        toAddress: peer.peerAddress,
        chatId: peer.chatId,
        roomId: currentRoomRef.current,
        timestamp: Date.now(),
      });
    };
    sendStatus();
    const interval = window.setInterval(
      sendStatus,
      LAND_CALL_STATUS_INTERVAL_MS
    );
    return () => {
      window.clearInterval(interval);
    };
  }, [
    landVoiceCall.callState,
    myAddress,
    reticulumReady,
    sendLandCallSignal,
    touchLandCallPresence,
  ]);

  useEffect(() => {
    const callActive = landVoiceCall.callState === 'connected';
    const callId = activeLandCallIdRef.current;
    const peer = callId ? landCallPeersRef.current.get(callId) : null;
    if (callActive && callId && peer) {
      lastAnnouncedLandCallRef.current = {
        callId,
        peerAddress: peer.peerAddress,
        chatId: peer.chatId,
      };
      return;
    }
    if (landVoiceCall.callState !== 'idle') return;
    const previous = lastAnnouncedLandCallRef.current;
    if (!previous || !myAddress || reticulumReady !== true) return;
    lastAnnouncedLandCallRef.current = null;
    void sendLandCallSignal({
      callType: 'ended',
      callId: previous.callId,
      fromAddress: myAddress,
      toAddress: previous.peerAddress,
      chatId: previous.chatId,
      roomId: currentRoomRef.current,
      timestamp: Date.now(),
    });
    clearLandCallPresence([myAddress, previous.peerAddress]);
    landCallPeersRef.current.delete(previous.callId);
    if (activeLandCallIdRef.current === previous.callId) {
      activeLandCallIdRef.current = null;
      setActiveLandCallPeerAddress(null);
    }
  }, [
    clearLandCallPresence,
    landVoiceCall.callState,
    myAddress,
    reticulumReady,
    sendLandCallSignal,
  ]);

  useEffect(() => {
    if (landVoiceCall.callState !== 'idle') return;
    const callId = activeLandCallIdRef.current;
    if (
      !callId &&
      landCallPeersRef.current.size === 0 &&
      !activeLandCallPeerAddress
    )
      return;
    const peer = callId ? landCallPeersRef.current.get(callId) : null;
    if (peer && myAddress) {
      clearLandCallPresence([myAddress, peer.peerAddress]);
    }
    activeLandCallIdRef.current = null;
    landCallPeersRef.current.clear();
    setActiveLandCallPeerAddress(null);
  }, [
    activeLandCallPeerAddress,
    clearLandCallPresence,
    landVoiceCall.callState,
    myAddress,
  ]);

  useEffect(() => {
    const current = landGame.presence;
    if (
      !current ||
      !myAddress ||
      reticulumReady !== true ||
      !Number.isInteger(groupId) ||
      groupId <= 0
    ) {
      return;
    }

    lastAnnouncedLandGameRef.current = current;
    const sendStatus = () => {
      touchLandGamePresence(
        myAddress,
        current.peerAddress,
        current.matchId,
        currentRoomRef.current
      );
      void sendLandCallSignal({
        callType: 'game_status',
        callId: current.matchId,
        fromAddress: myAddress,
        toAddress: current.peerAddress,
        roomId: currentRoomRef.current,
        timestamp: Date.now(),
      });
    };
    sendStatus();
    const interval = window.setInterval(
      sendStatus,
      LAND_CALL_STATUS_INTERVAL_MS
    );

    return () => {
      window.clearInterval(interval);
      if (lastAnnouncedLandGameRef.current?.matchId !== current.matchId) return;
      lastAnnouncedLandGameRef.current = null;
      clearLandGamePresence([myAddress], current.matchId);
      void sendLandCallSignal({
        callType: 'game_ended',
        callId: current.matchId,
        fromAddress: myAddress,
        toAddress: current.peerAddress,
        roomId: currentRoomRef.current,
        timestamp: Date.now(),
      });
    };
  }, [
    clearLandGamePresence,
    groupId,
    landGame.presence,
    myAddress,
    reticulumReady,
    sendLandCallSignal,
    touchLandGamePresence,
  ]);

  useEffect(() => {
    if (!containerRef.current || !myAddress) return;
    let destroyed = false;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame = 0;
    let removeWindowResizeListener: (() => void) | null = null;

    void import('phaser').then((Phaser) => {
      if (destroyed || !containerRef.current) return;
      const localHue = addressHue(myAddress);
      const localColor = Phaser.Display.Color.HSLToColor(
        localHue / 360,
        0.62,
        0.58
      ).color;
      const remoteHueBase = (localHue + 145) % 360;

      class QortalLandScene extends Phaser.Scene {
        private localAvatar?: any;
        private localLabel?: any;
        private localAvailabilityLabel?: any;
        private remotes = new Map<string, any>();
        private remoteLabels = new Map<string, any>();
        private remoteAvailabilityLabels = new Map<string, any>();
        private chatBubbles = new Map<
          string,
          {
            container: any;
            background: any;
            contentItems: any[];
            signature: string;
            width: number;
            height: number;
            lineCount: number;
            popStarted: boolean;
          }
        >();
        private actionAnimations = new Map<
          string,
          {
            container: any;
            aura: any;
            particles: any[];
            symbol: any;
            text: any;
          }
        >();
        private callIndicators = new Map<
          string,
          { container: any; badge: any; phone: any }
        >();
        private gameIndicators = new Map<
          string,
          { container: any; badge: any; gamepad: any }
        >();
        private proximityVoiceIndicators = new Map<
          string,
          {
            container: any;
            glyph: any;
            tooltip: any;
            tooltipBackground: any;
            tooltipTitle: any;
          }
        >();
        private pendingRoomTransition: QortalLandRoomTransitionTarget | null =
          null;
        private roomAssetLoadCallbacks = new Map<
          LandRoomId,
          Array<() => void>
        >();
        private background?: any;
        private lightSweep?: any;
        private foreground?: any;
        private parkSearchlight?: any;
        private parkFountainAmbient?: any;
        private parkPortalAmbient?: any;
        private parkFireflies?: any;
        private interactionPrompt?: {
          container: any;
          background: any;
          text: any;
        };
        private propLayers: any[] = [];
        private developmentPngPropSprites: any[] = [];
        private developmentLookTextureKeys = new Set<string>();
        private clubSkywalkDoor?: {
          closed: any;
          semiOpen: any;
          open: any;
          progress: number;
          targetProgress: number;
          baseAlpha: number;
          baseScaleX: number;
          baseScaleY: number;
          hotspotX: number;
          hotspotY: number;
          proximityRadius: number;
          passMinX: number;
          passMaxX: number;
          passMinY: number;
          passMaxY: number;
          returnX: number;
          returnY: number;
          left: number;
          right: number;
          top: number;
          bottom: number;
        };
        private parkPortalDoor?: {
          frames: any[];
          progress: number;
          targetProgress: number;
          baseAlpha: number;
          hotspotX: number;
          hotspotY: number;
          proximityRadius: number;
          passMinX: number;
          passMaxX: number;
          passMinY: number;
          passMaxY: number;
          returnX: number;
          returnY: number;
          left: number;
          right: number;
          top: number;
          bottom: number;
        };

        constructor() {
          super('QortalLandScene');
        }

        private handleDevelopmentAssetsChanged = () => {
          this.drawWorld();
          this.updateCameraLayout();
          this.updateInteractionPrompt();
        };

        private handleSceneResize = () => {
          this.drawWorld();
          this.updateCameraLayout();
          this.updateInteractionPrompt();
        };

        private updateCameraLayout() {
          const camera = this.cameras.main;
          const roomSize = roomSizeForRoom(currentRoomRef.current);
          const viewportWidth = Math.max(
            1,
            Number(this.scale.width) || camera.width || roomSize.width
          );
          const viewportHeight = Math.max(
            1,
            Number(this.scale.height) || camera.height || roomSize.height
          );
          const avatarLogicalX = Number(
            this.localAvatar?.getData?.('logicalX')
          );
          const avatarLogicalY = Number(
            this.localAvatar?.getData?.('logicalY')
          );
          const targetX = Number.isFinite(avatarLogicalX)
            ? avatarLogicalX
            : (localStateRef.current.x ?? roomSize.width / 2);
          const targetY = Number.isFinite(avatarLogicalY)
            ? avatarLogicalY
            : (localStateRef.current.y ?? roomSize.height / 2);
          const horizontalPadding = Math.max(
            0,
            (viewportWidth - roomSize.width) / 2
          );
          const verticalPadding = Math.max(
            0,
            (viewportHeight - roomSize.height) / 2
          );
          const scrollX =
            horizontalPadding > 0
              ? -horizontalPadding
              : Phaser.Math.Clamp(
                  targetX - viewportWidth / 2,
                  0,
                  roomSize.width - viewportWidth
                );
          const scrollY =
            verticalPadding > 0
              ? -verticalPadding
              : Phaser.Math.Clamp(
                  targetY - viewportHeight / 2,
                  0,
                  roomSize.height - viewportHeight
                );

          camera.stopFollow();
          camera.setBackgroundColor('#050811');
          camera.setZoom(1);
          camera.setBounds(
            -horizontalPadding,
            -verticalPadding,
            roomSize.width + horizontalPadding * 2,
            roomSize.height + verticalPadding * 2
          );
          camera.setScroll(scrollX, scrollY);
        }

        preload() {
          QORTAL_LAND_CHARACTER_SKINS.forEach((skin) => {
            this.load.spritesheet(
              qortalLandSkinTextureKey(skin.id),
              skin.spritesheetUrl,
              {
                frameWidth: LAND_CHARACTER_FRAME_SIZE,
                frameHeight: LAND_CHARACTER_FRAME_SIZE,
              }
            );
          });
          qortalLandDevelopmentPngAssetsForRoom(
            QORTAL_LAND_START_ROOM_ID
          ).forEach((asset) => {
            const textureKey = qortalLandDevelopmentPngTextureKey(asset.id);
            if (!this.textures.exists(textureKey)) {
              this.load.image(textureKey, asset.url);
            }
          });
          QORTAL_LAND_AVAILABLE_CHAT_EMOJIS.forEach((emoji) => {
            const emojiUrl = qortalLandChatEmojiUrlByFileName.get(
              emoji.fileName
            );
            const textureKey = qortalLandChatEmojiTextureKey(emoji.key);
            if (emojiUrl && !this.textures.exists(textureKey)) {
              this.load.image(textureKey, emojiUrl);
            }
          });
        }

        private areRoomAssetsReady(roomId: LandRoomId): boolean {
          return qortalLandDevelopmentPngAssetsForRoom(roomId).every((asset) =>
            this.textures.exists(qortalLandDevelopmentPngTextureKey(asset.id))
          );
        }

        private ensureRoomAssets(roomId: LandRoomId, onReady: () => void) {
          const missingAssets = qortalLandDevelopmentPngAssetsForRoom(
            roomId
          ).filter(
            (asset) =>
              !this.textures.exists(
                qortalLandDevelopmentPngTextureKey(asset.id)
              )
          );
          if (missingAssets.length === 0) {
            onReady();
            return;
          }
          const existingCallbacks = this.roomAssetLoadCallbacks.get(roomId);
          if (existingCallbacks) {
            existingCallbacks.push(onReady);
            return;
          }
          this.roomAssetLoadCallbacks.set(roomId, [onReady]);
          missingAssets.forEach((asset) => {
            this.load.image(
              qortalLandDevelopmentPngTextureKey(asset.id),
              asset.url
            );
          });
          this.load.once(Phaser.Loader.Events.COMPLETE, () => {
            const callbacks = this.roomAssetLoadCallbacks.get(roomId) ?? [];
            this.roomAssetLoadCallbacks.delete(roomId);
            callbacks.forEach((callback) => callback());
          });
          if (!this.load.isLoading()) this.load.start();
        }

        private prefetchAdjacentRoomAssets(roomId: LandRoomId) {
          const adjacentRoomId =
            roomId === QORTAL_LAND_PARK_ROOM_ID
              ? QORTAL_LAND_DEFAULT_ROOM_ID
              : QORTAL_LAND_PARK_ROOM_ID;
          this.ensureRoomAssets(adjacentRoomId, () => {});
        }

        private applyRoomTransition(
          transition: QortalLandRoomTransitionTarget
        ) {
          if (destroyed) return;
          currentRoomRef.current = transition.roomId;
          setLandGameRoomId(transition.roomId);
          setLoadingRoomAssets(null);
          this.pendingRoomTransition = null;
          movementKeysRef.current.clear();
          localStateRef.current = {
            ...localStateRef.current,
            roomId: transition.roomId,
            x: transition.x,
            y: transition.y,
            direction: transition.direction,
            movement: 'idle',
          };
          this.drawWorld();
          const scale = characterScaleForRoomY(transition.roomId, transition.y);
          const renderY = qortalLandAvatarRenderY(
            transition.roomId,
            transition.x,
            transition.y
          );
          this.localAvatar?.setData('logicalX', transition.x);
          this.localAvatar?.setData('logicalY', transition.y);
          this.localAvatar?.setPosition(transition.x, renderY);
          this.localAvatar?.setScale(
            avatarScaleXForDirection(transition.direction, scale),
            scale
          );
          this.animateAvatar(
            this.localAvatar,
            false,
            transition.direction,
            localStateRef.current.skinId
          );
          this.localAvatar?.setDepth(transition.y + 20);
          this.localLabel?.setPosition(
            transition.x,
            renderY - LAND_CHARACTER_LABEL_OFFSET * scale
          );
          this.localLabel?.setDepth(transition.y + 90);
          this.updateAvailabilityLabel(
            this.localAvailabilityLabel,
            localStateRef.current.afk,
            localStateRef.current.dnd,
            transition.x,
            renderY -
              (LAND_CHARACTER_LABEL_OFFSET +
                LAND_CHARACTER_AVAILABILITY_OFFSET) *
                scale,
            transition.y + 91
          );
          this.updateCameraLayout();
          this.updateInteractionPrompt();
          window.setTimeout(() => {
            if (!destroyed) this.prefetchAdjacentRoomAssets(transition.roomId);
          }, 0);
        }

        private requestRoomTransition(
          transition: QortalLandRoomTransitionTarget
        ) {
          if (this.pendingRoomTransition) return;
          if (this.areRoomAssetsReady(transition.roomId)) {
            this.applyRoomTransition(transition);
            return;
          }
          this.pendingRoomTransition = transition;
          movementKeysRef.current.clear();
          setLoadingRoomAssets(transition.roomId);
          this.ensureRoomAssets(transition.roomId, () => {
            if (this.pendingRoomTransition === transition) {
              this.applyRoomTransition(transition);
            }
          });
        }

        create() {
          currentRoomRef.current = localStateRef.current.roomId;
          setLandGameRoomId(currentRoomRef.current);
          const startRoomSize = roomSizeForRoom(currentRoomRef.current);
          this.cameras.main.setBounds(
            0,
            0,
            startRoomSize.width,
            startRoomSize.height
          );
          this.ensureCharacterAnimations();
          this.drawWorld();
          const start = localStateRef.current;
          const startScale = characterScaleForRoomY(start.roomId, start.y);
          this.localAvatar = this.createAvatar(
            start.x,
            start.y,
            localColor,
            true,
            start.skinId
          );
          this.localAvatar.setInteractive({
            alphaTolerance: 8,
            pixelPerfect: true,
            useHandCursor: true,
          });
          this.localAvatar.on(
            'pointerdown',
            (pointer: any, _localX: number, _localY: number, event: any) => {
              event?.stopPropagation?.();
              const bounds = containerRef.current?.getBoundingClientRect();
              if (!bounds) return;
              const pointerEvent = pointer?.event as PointerEvent | undefined;
              const menuX = clampNumber(
                (pointerEvent?.clientX ?? bounds.left + bounds.width / 2) -
                  bounds.left,
                12,
                Math.max(12, bounds.width - 290)
              );
              const menuY = clampNumber(
                (pointerEvent?.clientY ?? bounds.top + bounds.height / 2) -
                  bounds.top,
                12,
                Math.max(12, bounds.height - 24)
              );
              setActionTarget({
                key: `${myAddress}:${sessionId}`,
                authorAddress: myAddress,
                sessionId,
                roomId: currentRoomRef.current,
                anchorX: menuX,
                anchorY: menuY,
                menuX,
                menuY,
              });
            }
          );
          this.localLabel = this.add
            .text(
              start.x,
              start.y - LAND_CHARACTER_LABEL_OFFSET * startScale,
              displayNameForAddress(myAddress, primaryNameCacheRef.current),
              {
                color: '#f8fbff',
                fontFamily: 'Inter, Arial, sans-serif',
                fontSize: '12px',
                stroke: '#10151c',
                strokeThickness: 4,
              }
            )
            .setOrigin(0.5);
          this.localAvailabilityLabel = this.createAvailabilityLabel();
          this.localAvatar.setScale(startScale);
          this.localAvatar.setDepth(start.y + 20);
          this.localLabel.setDepth(start.y + 90);
          this.updateAvailabilityLabel(
            this.localAvailabilityLabel,
            start.afk,
            start.dnd,
            start.x,
            start.y -
              (LAND_CHARACTER_LABEL_OFFSET +
                LAND_CHARACTER_AVAILABILITY_OFFSET) *
                startScale,
            start.y + 91
          );
          this.interactionPrompt = this.createInteractionPrompt();
          this.updateInteractionPrompt();
          this.updateCameraLayout();
          this.scale.on('resize', this.handleSceneResize, this);
          window.addEventListener(
            QORTAL_LAND_DEV_ASSETS_CHANGED_EVENT,
            this.handleDevelopmentAssetsChanged
          );
          const removeDevelopmentAssetListener = () => {
            this.scale.off('resize', this.handleSceneResize, this);
            window.removeEventListener(
              QORTAL_LAND_DEV_ASSETS_CHANGED_EVENT,
              this.handleDevelopmentAssetsChanged
            );
          };
          this.events.once('shutdown', removeDevelopmentAssetListener);
          this.events.once('destroy', removeDevelopmentAssetListener);
          this.events.once('shutdown', this.destroyParkAmbientEffects, this);
          this.events.once('destroy', this.destroyParkAmbientEffects, this);
        }

        update(time: number, delta: number) {
          this.animateRoom(time);
          this.updateLocalPlayer(delta);
          this.updateClubSkywalkDoor(delta);
          this.updateParkPortalDoor(delta);
          this.updateCameraLayout();
          this.updateInteractionPrompt();
          this.updateRemotePlayers();
          try {
            this.updateChatBubbles();
          } catch (error) {
            console.warn('[QortalLand] Chat bubble update failed', error);
            landChatBubblesRef.current.clear();
            for (const [
              messageId,
              bubbleObjects,
            ] of this.chatBubbles.entries()) {
              this.removeChatBubble(messageId, bubbleObjects);
            }
          }
          try {
            this.updateActionAnimations();
          } catch (error) {
            console.warn('[QortalLand] Action animation update failed', error);
            landActionAnimationsRef.current.clear();
            for (const [
              actionId,
              animationObjects,
            ] of this.actionAnimations.entries()) {
              this.removeActionAnimation(actionId, animationObjects);
            }
          }
          try {
            this.updateCallIndicators();
          } catch (error) {
            console.warn('[QortalLand] Call indicator update failed', error);
            for (const [
              indicatorKey,
              indicatorObjects,
            ] of this.callIndicators.entries()) {
              this.removeCallIndicator(indicatorKey, indicatorObjects);
            }
          }
          try {
            this.updateGameIndicators();
          } catch (error) {
            console.warn('[QortalLand] Game indicator update failed', error);
            for (const [
              indicatorKey,
              indicatorObjects,
            ] of this.gameIndicators.entries()) {
              this.removeGameIndicator(indicatorKey, indicatorObjects);
            }
          }
          try {
            this.updateProximityVoiceIndicators();
          } catch (error) {
            console.warn(
              '[QortalLand] Proximity voice indicator update failed',
              error
            );
          }
        }

        private drawWorld() {
          this.destroyParkAmbientEffects();
          this.background?.destroy();
          this.lightSweep?.destroy();
          this.foreground?.destroy();
          this.propLayers.forEach((layer) => layer.destroy());
          this.developmentPngPropSprites.forEach((sprite) => sprite.destroy());
          this.developmentLookTextureKeys.forEach((textureKey) => {
            if (this.textures.exists(textureKey)) {
              this.textures.remove(textureKey);
            }
          });
          this.propLayers = [];
          this.developmentPngPropSprites = [];
          this.developmentLookTextureKeys.clear();
          this.clubSkywalkDoor = undefined;
          this.parkPortalDoor = undefined;
          const g = this.add.graphics();
          const roomId = currentRoomRef.current;
          if (roomId === QORTAL_LAND_SKYWALK_ROOM_ID) {
            this.drawSkywalkWorld(g);
            this.background = g;
            g.setDepth(-100);
            this.drawSkywalkDepthProps();
            this.drawDevelopmentPngProps();
            this.drawCollisionDebug();
            this.lightSweep = this.add.graphics();
            this.lightSweep.setDepth(-80);
            this.foreground = this.add.graphics();
            this.drawForeground(this.foreground);
            this.foreground.setDepth(roomFloorRange(roomId).bottom + 170);
            return;
          }
          if (roomId === QORTAL_LAND_MALL_ROOM_ID) {
            this.drawMallWorld(g);
            this.background = g;
            g.setDepth(-100);
            this.drawMallDepthProps();
            this.drawDevelopmentPngProps();
            this.drawCollisionDebug();
            this.lightSweep = this.add.graphics();
            this.lightSweep.setDepth(-80);
            this.foreground = this.add.graphics();
            this.drawForeground(this.foreground);
            this.foreground.setDepth(roomFloorRange(roomId).bottom + 170);
            return;
          }
          if (roomId === QORTAL_LAND_PARK_ROOM_ID) {
            this.drawParkWorld(g);
            this.background = g;
            g.setDepth(-100);
            this.drawParkSearchlight();
            this.drawParkSkylinePng();
            this.drawParkFloorPng();
            this.drawParkPortalPng();
            this.drawParkPortalAmbient();
            this.drawParkDepthProps();
            this.drawDevelopmentPngProps();
            this.drawParkFountainAmbient();
            this.drawParkFireflies();
            this.drawCollisionDebug();
            this.lightSweep = this.add.graphics();
            this.lightSweep.setDepth(-80);
            this.foreground = this.add.graphics();
            this.drawForeground(this.foreground);
            this.foreground.setDepth(roomFloorRange(roomId).bottom + 170);
            return;
          }
          const layout = roomLayoutForRoom(roomId);
          const { floor } = layout;
          const showProceduralClubShell =
            shouldShowQortalLandProceduralClubShell();

          g.fillStyle(0x070914, 1);
          g.fillRect(0, 0, layout.width, layout.height);
          if (showProceduralClubShell) {
            g.fillStyle(0x10152a, 1);
            g.fillRect(0, 0, layout.width, floor.topY);
            this.drawSideWalls(g);
            this.drawCeilingRig(g);

            g.fillStyle(0x0c0d19, 1);
            g.fillPoints(
              [
                new Phaser.Geom.Point(floor.back.minX, floor.topY),
                new Phaser.Geom.Point(floor.back.maxX, floor.topY),
                new Phaser.Geom.Point(floor.front.maxX, floor.bottomY),
                new Phaser.Geom.Point(floor.front.minX, floor.bottomY),
              ],
              true
            );
            g.lineStyle(3, 0x1be7ff, 0.16);
            g.strokePoints(
              [
                new Phaser.Geom.Point(floor.back.minX, floor.topY),
                new Phaser.Geom.Point(floor.back.maxX, floor.topY),
                new Phaser.Geom.Point(floor.front.maxX, floor.bottomY),
                new Phaser.Geom.Point(floor.front.minX, floor.bottomY),
                new Phaser.Geom.Point(floor.back.minX, floor.topY),
              ],
              false
            );

            this.drawFloorTexture(g);
            g.lineStyle(1, 0x00e7ff, 0.055);
            for (let i = 1; i <= 4; i += 1) {
              const t = i / 5;
              const leftX =
                floor.back.minX + (floor.front.minX - floor.back.minX) * t;
              const rightX =
                floor.back.maxX + (floor.front.maxX - floor.back.maxX) * t;
              const y = floor.topY + t * (floor.bottomY - floor.topY);
              g.lineBetween(leftX, y, rightX, y);
            }
            for (let i = 1; i <= 6; i += 1) {
              const t = i / 7;
              const topX =
                floor.back.minX + t * (floor.back.maxX - floor.back.minX);
              const bottomX =
                floor.front.minX + t * (floor.front.maxX - floor.front.minX);
              g.lineBetween(topX, floor.topY, bottomX, floor.bottomY);
            }

            if (!this.hasClubSkywalkDoorPng()) {
              this.drawSkywalkDoor(g, 1478, 118);
            }
          }
          this.background = g;
          g.setDepth(-100);

          this.drawClubBackWallPng();
          this.drawClubSideWallPng(
            QORTAL_LAND_DEVELOPMENT_LEFT_WALL_DEFAULT_PLACEMENT
          );
          this.drawClubSideWallPng(
            QORTAL_LAND_DEVELOPMENT_RIGHT_WALL_DEFAULT_PLACEMENT
          );
          this.drawClubSkywalkDoorPng();
          this.drawClubFloorPng();
          this.drawDepthProps();
          this.drawDevelopmentPngProps();
          this.drawCollisionDebug();
          this.lightSweep = this.add.graphics();
          this.lightSweep.setDepth(-80);
          if (showProceduralClubShell) {
            this.foreground = this.add.graphics();
            this.drawForeground(this.foreground);
            this.foreground.setDepth(floor.bottomY + 170);
          }
        }

        private drawClubFloorPng() {
          const placement = getQortalLandDevelopmentPlacement(
            QORTAL_LAND_DEVELOPMENT_CLUB_FLOOR_DEFAULT_PLACEMENT
          );
          const asset = qortalLandDevelopmentPngAssetById.get(
            placement.assetId
          );
          if (!asset) return;
          const textureKey = qortalLandDevelopmentPngTextureKey(asset.id);
          if (!this.textures.exists(textureKey)) return;
          const lookTextureKey = this.developmentLookTextureKeyForPlacement(
            placement,
            textureKey
          );
          const sprite = this.add.image(
            placement.x,
            placement.y,
            lookTextureKey
          );
          sprite.setName('club.floor_png');
          sprite.setOrigin(placement.originX ?? 0, placement.originY ?? 0);
          sprite.setScale(
            (placement.scaleX ?? placement.scale ?? 1) * asset.renderScaleX,
            (placement.scaleY ?? placement.scale ?? 1) * asset.renderScaleY
          );
          sprite.setAlpha(placement.alpha ?? 1);
          sprite.setDepth(placement.depth ?? -95);
          this.developmentPngPropSprites.push(sprite);
        }

        private drawParkSkylinePng() {
          const placement = getQortalLandDevelopmentPlacement(
            QORTAL_LAND_DEVELOPMENT_PARK_SKYLINE_DEFAULT_PLACEMENT
          );
          const asset = qortalLandDevelopmentPngAssetById.get(
            placement.assetId
          );
          if (!asset) return;
          const textureKey = qortalLandDevelopmentPngTextureKey(asset.id);
          if (!this.textures.exists(textureKey)) return;
          const lookTextureKey = this.developmentLookTextureKeyForPlacement(
            placement,
            textureKey
          );
          const sprite = this.add.image(
            placement.x,
            placement.y,
            lookTextureKey
          );
          sprite.setName('park.skyline_png');
          sprite.setOrigin(placement.originX ?? 0.5, placement.originY ?? 1);
          sprite.setScale(
            (placement.scaleX ?? placement.scale ?? 1) * asset.renderScaleX,
            (placement.scaleY ?? placement.scale ?? 1) * asset.renderScaleY
          );
          sprite.setAlpha(placement.alpha ?? 1);
          sprite.setDepth(placement.depth ?? -99);
          this.developmentPngPropSprites.push(sprite);
        }

        private drawParkFloorPng() {
          const placement = getQortalLandDevelopmentPlacement(
            QORTAL_LAND_DEVELOPMENT_PARK_FLOOR_DEFAULT_PLACEMENT
          );
          const asset = qortalLandDevelopmentPngAssetById.get(
            placement.assetId
          );
          if (!asset) return;
          const textureKey = qortalLandDevelopmentPngTextureKey(asset.id);
          if (!this.textures.exists(textureKey)) return;
          const lookTextureKey = this.developmentLookTextureKeyForPlacement(
            placement,
            textureKey
          );
          const sprite = this.add.image(
            placement.x,
            placement.y,
            lookTextureKey
          );
          sprite.setName('park.floor_png');
          sprite.setOrigin(placement.originX ?? 0.5, placement.originY ?? 1);
          sprite.setScale(
            (placement.scaleX ?? placement.scale ?? 1) * asset.renderScaleX,
            (placement.scaleY ?? placement.scale ?? 1) * asset.renderScaleY
          );
          sprite.setAlpha(placement.alpha ?? 1);
          sprite.setDepth(placement.depth ?? -95);
          this.developmentPngPropSprites.push(sprite);
        }

        private drawParkSearchlight() {
          const skylinePlacement = getQortalLandDevelopmentPlacement(
            QORTAL_LAND_DEVELOPMENT_PARK_SKYLINE_DEFAULT_PLACEMENT
          );
          const searchlight = this.add.graphics();
          searchlight.setName('park.searchlight_ambient');
          searchlight.setDepth((skylinePlacement.depth ?? -99) - 0.5);
          this.parkSearchlight = searchlight;
          this.animateParkSearchlight(this.time.now || 0);
        }

        private getParkFountainAmbientAnchor() {
          if (!shouldShowQortalLandDevelopmentPngProps()) return null;
          const basePlacement =
            QORTAL_LAND_DEVELOPMENT_PARK_PROP_DEFAULT_PLACEMENTS.find(
              (placement) =>
                placement.id ===
                QORTAL_LAND_DEVELOPMENT_PARK_FOUNTAIN_BLUE_PLACEMENT_ID
            );
          if (!basePlacement) return null;
          const placement = {
            ...basePlacement,
            ...readQortalLandDevelopmentPngPlacementOverride(basePlacement.id),
          };
          if (placement.visible === false) return null;
          const asset = qortalLandDevelopmentPngAssetById.get(
            placement.assetId
          );
          if (!asset) return null;
          const textureKey = qortalLandDevelopmentPngTextureKey(asset.id);
          if (!this.textures.exists(textureKey)) return null;
          const frame = this.textures.getFrame(textureKey) as any;
          const sourceWidth =
            Math.max(1, Number(frame?.width) || 1) * asset.renderScaleX;
          const sourceHeight =
            Math.max(1, Number(frame?.height) || 1) * asset.renderScaleY;
          const scaleX = placement.scaleX ?? placement.scale ?? 1;
          const scaleY = placement.scaleY ?? placement.scale ?? 1;
          const originX = placement.originX ?? 0.5;
          const originY = placement.originY ?? 1;
          const centerX = placement.x + (0.5 - originX) * sourceWidth * scaleX;
          const centerY = placement.y + (0.5 - originY) * sourceHeight * scaleY;
          const depth =
            placement.depthMode === 'y-sort'
              ? placement.y + (placement.depthOffset ?? 20) + 0.35
              : (placement.depth ?? placement.y) + 0.35;
          return {
            centerX,
            centerY: centerY + 4,
            sourceWidth,
            sourceHeight,
            scaleX,
            scaleY,
            depth,
          };
        }

        private drawParkFountainAmbient() {
          const anchor = this.getParkFountainAmbientAnchor();
          if (!anchor) return;
          const fountainAmbient = this.add.graphics();
          fountainAmbient.setName('park.fountain_ambient');
          fountainAmbient.setDepth(anchor.depth);
          this.parkFountainAmbient = fountainAmbient;
          this.animateParkFountainAmbient(this.time.now || 0);
        }

        private drawParkPortalAmbient() {
          if (!this.parkPortalDoor) return;
          const portalAmbient = this.add.graphics();
          portalAmbient.setName('park.portal_ambient');
          portalAmbient.setDepth(201);
          this.parkPortalAmbient = portalAmbient;
          this.animateParkPortalAmbient(this.time.now || 0);
        }

        private drawParkFireflies() {
          const fireflies = this.add.graphics();
          fireflies.setName('park.firefly_ambient');
          fireflies.setDepth(760);
          this.parkFireflies = fireflies;
          this.animateParkFireflies(this.time.now || 0);
        }

        private destroyParkAmbientEffects() {
          this.parkSearchlight?.destroy();
          this.parkFountainAmbient?.destroy();
          this.parkPortalAmbient?.destroy();
          this.parkFireflies?.destroy();
          this.parkSearchlight = undefined;
          this.parkFountainAmbient = undefined;
          this.parkPortalAmbient = undefined;
          this.parkFireflies = undefined;
        }

        private drawClubBackWallPng() {
          const placement = getQortalLandDevelopmentPlacement(
            QORTAL_LAND_DEVELOPMENT_BACK_WALL_DEFAULT_PLACEMENT
          );
          const asset = qortalLandDevelopmentPngAssetById.get(
            placement.assetId
          );
          if (!asset) return;
          const textureKey = qortalLandDevelopmentPngTextureKey(asset.id);
          if (!this.textures.exists(textureKey)) return;
          const lookTextureKey = this.developmentLookTextureKeyForPlacement(
            placement,
            textureKey
          );
          const sprite = this.add.image(
            placement.x,
            placement.y,
            lookTextureKey
          );
          sprite.setName('club.back_wall_main_png');
          sprite.setOrigin(placement.originX ?? 0.5, placement.originY ?? 1);
          sprite.setScale(
            (placement.scaleX ?? placement.scale ?? 1) * asset.renderScaleX,
            (placement.scaleY ?? placement.scale ?? 1) * asset.renderScaleY
          );
          sprite.setAlpha(placement.alpha ?? 1);
          sprite.setDepth(placement.depth ?? -96);
          this.developmentPngPropSprites.push(sprite);
        }

        private drawClubSideWallPng(
          defaultPlacement: QortalLandDevelopmentPngPropPlacement
        ) {
          const placement = getQortalLandDevelopmentPlacement(defaultPlacement);
          const asset = qortalLandDevelopmentPngAssetById.get(
            placement.assetId
          );
          if (!asset) return;
          const textureKey = qortalLandDevelopmentPngTextureKey(asset.id);
          if (!this.textures.exists(textureKey)) return;
          const lookTextureKey = this.developmentLookTextureKeyForPlacement(
            placement,
            textureKey
          );
          const sprite = this.add.image(
            placement.x,
            placement.y,
            lookTextureKey
          );
          sprite.setName(placement.id);
          sprite.setOrigin(placement.originX ?? 0.5, placement.originY ?? 0);
          sprite.setScale(
            (placement.scaleX ?? placement.scale ?? 1) * asset.renderScaleX,
            (placement.scaleY ?? placement.scale ?? 1) * asset.renderScaleY
          );
          sprite.setAlpha(placement.alpha ?? 1);
          sprite.setDepth(placement.depth ?? -98);
          this.developmentPngPropSprites.push(sprite);
        }

        private hasClubSkywalkDoorPng() {
          return QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_ASSET_IDS.every(
            (assetId) => {
              const asset = qortalLandDevelopmentPngAssetById.get(assetId);
              return (
                asset &&
                this.textures.exists(
                  qortalLandDevelopmentPngTextureKey(asset.id)
                )
              );
            }
          );
        }

        private hasParkPortalPng() {
          return QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_ASSET_IDS.every(
            (assetId) => {
              const asset = qortalLandDevelopmentPngAssetById.get(assetId);
              return (
                asset &&
                this.textures.exists(
                  qortalLandDevelopmentPngTextureKey(asset.id)
                )
              );
            }
          );
        }

        private hasWarpOffset(
          warp?: QortalLandDevelopmentPngPropPlacement['warp']
        ) {
          if (!warp) return false;
          return ['tlX', 'tlY', 'trX', 'trY', 'brX', 'brY', 'blX', 'blY'].some(
            (key) => {
              const value =
                warp[
                  key as keyof NonNullable<
                    QortalLandDevelopmentPngPropPlacement['warp']
                  >
                ];
              return Number.isFinite(value) && Math.abs(Number(value)) > 0.001;
            }
          );
        }

        private developmentLookTextureKeyForPlacement(
          placement: QortalLandDevelopmentPngPropPlacement,
          textureKey: string
        ): string {
          const settings = readQortalLandDevelopmentLookSettings();
          if (
            !settings.enabled ||
            shouldSkipQortalLandDevelopmentLook(placement)
          ) {
            return textureKey;
          }
          const frame = this.textures.getFrame(textureKey) as any;
          const sourceImage = frame?.source?.image as
            | CanvasImageSource
            | undefined;
          if (!sourceImage) return textureKey;
          const width = Math.max(1, Math.floor(frame.width ?? 1));
          const height = Math.max(1, Math.floor(frame.height ?? 1));
          const adjustedTextureKey = `${textureKey}:look:${qortalLandDevelopmentLookSignature(settings)}`;
          if (this.textures.exists(adjustedTextureKey)) {
            this.developmentLookTextureKeys.add(adjustedTextureKey);
            return adjustedTextureKey;
          }
          const canvasTexture = this.textures.createCanvas(
            adjustedTextureKey,
            width,
            height
          ) as any;
          const context = canvasTexture?.getContext?.() as
            | CanvasRenderingContext2D
            | undefined;
          if (!canvasTexture || !context) return textureKey;
          context.clearRect(0, 0, width, height);
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          context.drawImage(
            sourceImage,
            frame.cutX,
            frame.cutY,
            width,
            height,
            0,
            0,
            width,
            height
          );
          try {
            const imageData = context.getImageData(0, 0, width, height);
            const data = imageData.data;
            const brightness = settings.brightness;
            const contrast = settings.contrast;
            const saturation = settings.saturation;
            const shadow = settings.shadow;
            for (let index = 0; index < data.length; index += 4) {
              const alpha = data[index + 3];
              if (alpha === 0) continue;
              let red = data[index] / 255;
              let green = data[index + 1] / 255;
              let blue = data[index + 2] / 255;
              const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
              if (luminance < 0.58 && shadow > 0) {
                const shadowWeight = 1 - shadow * (1 - luminance / 0.58);
                red *= shadowWeight;
                green *= shadowWeight;
                blue *= shadowWeight;
              }
              const saturatedRed = luminance + (red - luminance) * saturation;
              const saturatedGreen =
                luminance + (green - luminance) * saturation;
              const saturatedBlue = luminance + (blue - luminance) * saturation;
              red = (saturatedRed - 0.5) * contrast + 0.5;
              green = (saturatedGreen - 0.5) * contrast + 0.5;
              blue = (saturatedBlue - 0.5) * contrast + 0.5;
              data[index] = Phaser.Math.Clamp(
                Math.round(red * brightness * 255),
                0,
                255
              );
              data[index + 1] = Phaser.Math.Clamp(
                Math.round(green * brightness * 255),
                0,
                255
              );
              data[index + 2] = Phaser.Math.Clamp(
                Math.round(blue * brightness * 255),
                0,
                255
              );
            }
            context.putImageData(imageData, 0, 0);
            canvasTexture.refresh?.();
            this.developmentLookTextureKeys.add(adjustedTextureKey);
            return adjustedTextureKey;
          } catch (error) {
            console.warn('[QortalLand] Development look texture failed', error);
            if (this.textures.exists(adjustedTextureKey)) {
              this.textures.remove(adjustedTextureKey);
            }
            return textureKey;
          }
        }

        private createWarpedDevelopmentPngTexture(
          placement: QortalLandDevelopmentPngPropPlacement,
          textureKey: string,
          index: number,
          width: number,
          height: number
        ): { textureKey: string; originX: number; originY: number } | null {
          const frame = this.textures.getFrame(textureKey) as any;
          const sourceImage = frame?.source?.image as
            | CanvasImageSource
            | undefined;
          if (!sourceImage) return null;
          const warp = placement.warp ?? {};
          const asset = qortalLandDevelopmentPngAssetById.get(
            placement.assetId
          );
          const renderScaleX = asset?.renderScaleX ?? 1;
          const renderScaleY = asset?.renderScaleY ?? 1;
          const maxWarpOffset = Math.max(
            80,
            Math.min(
              720,
              Math.max(width * renderScaleX, height * renderScaleY) * 0.55
            )
          );
          const warpOffset = (
            value: number | undefined,
            renderScale: number
          ): number =>
            Math.max(
              -maxWarpOffset,
              Math.min(maxWarpOffset, Number(value) || 0)
            ) / renderScale;
          const points = {
            tl: {
              x: warpOffset(warp.tlX, renderScaleX),
              y: warpOffset(warp.tlY, renderScaleY),
            },
            tr: {
              x: width + warpOffset(warp.trX, renderScaleX),
              y: warpOffset(warp.trY, renderScaleY),
            },
            br: {
              x: width + warpOffset(warp.brX, renderScaleX),
              y: height + warpOffset(warp.brY, renderScaleY),
            },
            bl: {
              x: warpOffset(warp.blX, renderScaleX),
              y: height + warpOffset(warp.blY, renderScaleY),
            },
          };
          const minX = Math.min(
            points.tl.x,
            points.tr.x,
            points.br.x,
            points.bl.x
          );
          const minY = Math.min(
            points.tl.y,
            points.tr.y,
            points.br.y,
            points.bl.y
          );
          const maxX = Math.max(
            points.tl.x,
            points.tr.x,
            points.br.x,
            points.bl.x
          );
          const maxY = Math.max(
            points.tl.y,
            points.tr.y,
            points.br.y,
            points.bl.y
          );
          const canvasWidth = Math.max(1, Math.ceil(maxX - minX));
          const canvasHeight = Math.max(1, Math.ceil(maxY - minY));
          const warpedTextureKey = `${textureKey}:warp:${placement.id}:${index}`;
          if (this.textures.exists(warpedTextureKey)) {
            this.textures.remove(warpedTextureKey);
          }
          const canvasTexture = this.textures.createCanvas(
            warpedTextureKey,
            canvasWidth,
            canvasHeight
          ) as any;
          const context = canvasTexture?.getContext?.() as
            | CanvasRenderingContext2D
            | undefined;
          if (!canvasTexture || !context) return null;
          context.clearRect(0, 0, canvasWidth, canvasHeight);
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          const sliceCount = Math.max(1, Math.ceil(height));
          for (let row = 0; row < sliceCount; row += 1) {
            const t = sliceCount === 1 ? 0 : row / (sliceCount - 1);
            const leftX = points.tl.x + (points.bl.x - points.tl.x) * t - minX;
            const leftY = points.tl.y + (points.bl.y - points.tl.y) * t - minY;
            const rightX = points.tr.x + (points.br.x - points.tr.x) * t - minX;
            const rightY = points.tr.y + (points.br.y - points.tr.y) * t - minY;
            const dx = rightX - leftX;
            const dy = rightY - leftY;
            const length = Math.max(1, Math.hypot(dx, dy));
            context.save();
            context.translate(leftX, leftY);
            context.rotate(Math.atan2(dy, dx));
            context.drawImage(
              sourceImage,
              frame.cutX,
              frame.cutY + Math.min(row, height - 1),
              width,
              1,
              0,
              0,
              length,
              1.35
            );
            context.restore();
          }
          canvasTexture.refresh?.();
          return {
            textureKey: warpedTextureKey,
            originX: ((placement.originX ?? 0.5) * width - minX) / canvasWidth,
            originY:
              ((placement.originY ?? 0.5) * height - minY) / canvasHeight,
          };
        }

        private createWarpableDevelopmentPng(
          placement: QortalLandDevelopmentPngPropPlacement,
          textureKey: string,
          index: number
        ) {
          const lookTextureKey = this.developmentLookTextureKeyForPlacement(
            placement,
            textureKey
          );
          const asset = qortalLandDevelopmentPngAssetById.get(
            placement.assetId
          );
          const baseScaleX =
            (placement.scaleX ?? placement.scale ?? 1) *
            (asset?.renderScaleX ?? 1);
          const baseScaleY =
            (placement.scaleY ?? placement.scale ?? 1) *
            (asset?.renderScaleY ?? 1);
          const depth = placement.depth ?? -82;
          const baseAlpha = placement.alpha ?? 1;
          const frame = this.textures.getFrame(lookTextureKey);
          const width = frame?.width ?? 70;
          const height = frame?.height ?? 365;
          const originX = placement.originX ?? 0.5;
          const originY = placement.originY ?? 0.5;
          const warp = placement.warp ?? {};
          const angle = placement.angle ?? 0;

          if (this.hasWarpOffset(warp)) {
            const warpedTexture = this.createWarpedDevelopmentPngTexture(
              placement,
              lookTextureKey,
              index,
              width,
              height
            );
            if (warpedTexture) {
              const sprite = this.add.image(
                placement.x,
                placement.y,
                warpedTexture.textureKey
              );
              sprite.setName(`${placement.id}:${index}`);
              sprite.setOrigin(warpedTexture.originX, warpedTexture.originY);
              sprite.setScale(baseScaleX, baseScaleY);
              sprite.setAngle(angle);
              sprite.setAlpha(index === 0 ? baseAlpha : 0);
              sprite.setFlipX(Boolean(placement.flipX));
              sprite.setDepth(depth + index * 0.01);
              this.developmentPngPropSprites.push(sprite);
              return sprite;
            }
          }

          const sprite = this.add.image(
            placement.x,
            placement.y,
            lookTextureKey
          );
          sprite.setName(`${placement.id}:${index}`);
          sprite.setOrigin(originX, originY);
          sprite.setScale(baseScaleX, baseScaleY);
          sprite.setAngle(angle);
          sprite.setAlpha(index === 0 ? baseAlpha : 0);
          sprite.setFlipX(Boolean(placement.flipX));
          sprite.setDepth(depth + index * 0.01);
          this.developmentPngPropSprites.push(sprite);
          return sprite;
        }

        private drawClubSkywalkDoorPng() {
          if (!this.hasClubSkywalkDoorPng()) return;
          const placement = getQortalLandDevelopmentClubDoorPlacement();
          const textureKeys = QORTAL_LAND_DEVELOPMENT_CLUB_DOOR_ASSET_IDS.map(
            (assetId) => qortalLandDevelopmentPngTextureKey(assetId)
          );
          const asset = qortalLandDevelopmentPngAssetById.get(
            placement.assetId
          );
          const baseScaleX =
            (placement.scaleX ?? placement.scale ?? 1) *
            (asset?.renderScaleX ?? 1);
          const baseScaleY =
            (placement.scaleY ?? placement.scale ?? 1) *
            (asset?.renderScaleY ?? 1);
          const baseAlpha = placement.alpha ?? 1;
          const sprites = textureKeys.map((textureKey, index) =>
            this.createWarpableDevelopmentPng(placement, textureKey, index)
          );
          const hotspot = qortalLandClubSkywalkDoorHotspot(placement);
          this.clubSkywalkDoor = {
            closed: sprites[0],
            semiOpen: sprites[1],
            open: sprites[2],
            progress: 0,
            targetProgress: 0,
            baseAlpha,
            baseScaleX,
            baseScaleY,
            hotspotX: hotspot.x,
            hotspotY: hotspot.y,
            proximityRadius: hotspot.proximityRadius,
            passMinX: hotspot.passMinX,
            passMaxX: hotspot.passMaxX,
            passMinY: hotspot.passMinY,
            passMaxY: hotspot.passMaxY,
            returnX: hotspot.returnX,
            returnY: hotspot.returnY,
            left: hotspot.left,
            right: hotspot.right,
            top: hotspot.top,
            bottom: hotspot.bottom,
          };
        }

        private drawParkPortalPng() {
          if (!this.hasParkPortalPng()) return;
          const placement = getQortalLandDevelopmentParkPortalPlacement();
          const textureKeys = QORTAL_LAND_DEVELOPMENT_PARK_PORTAL_ASSET_IDS.map(
            (assetId) => qortalLandDevelopmentPngTextureKey(assetId)
          );
          const baseAlpha = placement.alpha ?? 1;
          const frames = textureKeys
            .map((textureKey, index) =>
              this.createWarpableDevelopmentPng(placement, textureKey, index)
            )
            .filter(Boolean);
          const hotspot = qortalLandParkPortalHotspot(placement);
          this.parkPortalDoor = {
            frames,
            progress: 0,
            targetProgress: 0,
            baseAlpha,
            hotspotX: hotspot.x,
            hotspotY: hotspot.y,
            proximityRadius: hotspot.proximityRadius,
            passMinX: hotspot.passMinX,
            passMaxX: hotspot.passMaxX,
            passMinY: hotspot.passMinY,
            passMaxY: hotspot.passMaxY,
            returnX: hotspot.returnX,
            returnY: hotspot.returnY,
            left: hotspot.left,
            right: hotspot.right,
            top: hotspot.top,
            bottom: hotspot.bottom,
          };
        }

        private ensureCharacterAnimations() {
          QORTAL_LAND_CHARACTER_SKINS.forEach((skin) => {
            const textureKey = qortalLandSkinTextureKey(skin.id);
            (
              [
                ['idle', 'side', 0, 0, 1, 0],
                [
                  'walk',
                  'side',
                  0,
                  LAND_CHARACTER_FRAMES_PER_DIRECTION - 1,
                  10,
                  -1,
                ],
                [
                  'idle',
                  'down',
                  LAND_CHARACTER_FRAMES_PER_DIRECTION,
                  LAND_CHARACTER_FRAMES_PER_DIRECTION,
                  1,
                  0,
                ],
                [
                  'walk',
                  'down',
                  LAND_CHARACTER_FRAMES_PER_DIRECTION,
                  LAND_CHARACTER_FRAMES_PER_DIRECTION * 2 - 1,
                  10,
                  -1,
                ],
                [
                  'idle',
                  'up',
                  LAND_CHARACTER_FRAMES_PER_DIRECTION * 2,
                  LAND_CHARACTER_FRAMES_PER_DIRECTION * 2,
                  1,
                  0,
                ],
                [
                  'walk',
                  'up',
                  LAND_CHARACTER_FRAMES_PER_DIRECTION * 2,
                  LAND_CHARACTER_FRAMES_PER_DIRECTION * 3 - 1,
                  10,
                  -1,
                ],
              ] as const
            ).forEach(([movement, facing, start, end, frameRate, repeat]) => {
              const key = qortalLandSkinAnimationKey(skin.id, movement, facing);
              if (this.anims.exists(key)) return;
              this.anims.create({
                key,
                frames: this.anims.generateFrameNumbers(textureKey, {
                  start,
                  end,
                }),
                frameRate,
                repeat,
              });
            });
          });
        }

        private createAvatar(
          x: number,
          y: number,
          _color: number,
          _local: boolean,
          skinId: QortalLandSkinId
        ) {
          const normalizedSkinId = normalizeQortalLandSkinId(skinId);
          const avatar = this.add.sprite(
            x,
            y,
            qortalLandSkinTextureKey(normalizedSkinId),
            LAND_CHARACTER_FRAMES_PER_DIRECTION
          );
          avatar.setOrigin(
            0.5,
            LAND_CHARACTER_FEET_BASELINE / LAND_CHARACTER_FRAME_SIZE
          );
          avatar.setSize(104, 174);
          const initialAnimation = qortalLandSkinAnimationKey(
            normalizedSkinId,
            'idle',
            'down'
          );
          avatar.play(initialAnimation);
          avatar.setData('skinId', normalizedSkinId);
          avatar.setData('lastAnimation', initialAnimation);
          avatar.setData('logicalX', x);
          avatar.setData('logicalY', y);
          return avatar;
        }

        private animateAvatar(
          avatar: any,
          moving: boolean,
          direction: string,
          skinId: QortalLandSkinId
        ) {
          const normalizedSkinId = normalizeQortalLandSkinId(skinId);
          if (avatar?.getData?.('skinId') !== normalizedSkinId) {
            avatar?.setTexture?.(qortalLandSkinTextureKey(normalizedSkinId));
            avatar?.setData?.('skinId', normalizedSkinId);
            avatar?.setData?.('lastAnimation', '');
          }
          const animationKey = avatarAnimationKeyForDirection(
            direction,
            moving,
            normalizedSkinId
          );
          if (avatar?.getData?.('lastAnimation') === animationKey) return;
          avatar?.play?.(animationKey, true);
          avatar?.setData?.('lastAnimation', animationKey);
        }

        private updateClubSkywalkDoor(delta: number) {
          const door = this.clubSkywalkDoor;
          if (!door) return;
          const avatar = this.localAvatar;
          const isInClub =
            currentRoomRef.current === QORTAL_LAND_DEFAULT_ROOM_ID;
          const avatarLogicalX = Number(avatar?.getData?.('logicalX'));
          const avatarLogicalY = Number(avatar?.getData?.('logicalY'));
          const weightedDistance =
            avatar && isInClub
              ? Math.hypot(
                  (Number.isFinite(avatarLogicalX)
                    ? avatarLogicalX
                    : avatar.x) - door.hotspotX,
                  ((Number.isFinite(avatarLogicalY)
                    ? avatarLogicalY
                    : avatar.y) -
                    door.hotspotY) *
                    1.16
                )
              : Number.POSITIVE_INFINITY;
          door.targetProgress =
            weightedDistance <= door.proximityRadius ? 1 : 0;
          const speed =
            door.targetProgress > door.progress
              ? QORTAL_LAND_CLUB_SKYWALK_DOOR_OPEN_SPEED
              : QORTAL_LAND_CLUB_SKYWALK_DOOR_CLOSE_SPEED;
          const step = Math.max(0.001, delta * speed);
          if (door.targetProgress > door.progress) {
            door.progress = Math.min(door.targetProgress, door.progress + step);
          } else {
            door.progress = Math.max(door.targetProgress, door.progress - step);
          }

          const progress = Phaser.Math.Easing.Sine.InOut(door.progress);
          const closedAlpha =
            door.baseAlpha * (1 - Phaser.Math.Clamp(progress / 0.52, 0, 1));
          const semiOpenAlpha =
            door.baseAlpha * Math.max(0, 1 - Math.abs(progress - 0.5) / 0.5);
          const openAlpha =
            door.baseAlpha * Phaser.Math.Clamp((progress - 0.36) / 0.64, 0, 1);
          door.closed.setAlpha(closedAlpha);
          door.semiOpen.setAlpha(semiOpenAlpha);
          door.open.setAlpha(openAlpha);
          door.closed.setScale(
            door.baseScaleX * (1 - progress * 0.025),
            door.baseScaleY
          );
          door.semiOpen.setScale(
            door.baseScaleX * (0.98 + Math.sin(progress * Math.PI) * 0.045),
            door.baseScaleY
          );
          door.open.setScale(
            door.baseScaleX * (0.985 + progress * 0.028),
            door.baseScaleY
          );
        }

        private updateParkPortalDoor(delta: number) {
          const door = this.parkPortalDoor;
          if (!door) return;
          const avatar = this.localAvatar;
          const isInPark = currentRoomRef.current === QORTAL_LAND_PARK_ROOM_ID;
          const avatarLogicalX = Number(avatar?.getData?.('logicalX'));
          const avatarLogicalY = Number(avatar?.getData?.('logicalY'));
          const weightedDistance =
            avatar && isInPark
              ? Math.hypot(
                  (Number.isFinite(avatarLogicalX)
                    ? avatarLogicalX
                    : avatar.x) - door.hotspotX,
                  ((Number.isFinite(avatarLogicalY)
                    ? avatarLogicalY
                    : avatar.y) -
                    door.hotspotY) *
                    1.05
                )
              : Number.POSITIVE_INFINITY;
          door.targetProgress =
            weightedDistance <= door.proximityRadius ? 1 : 0;
          const speed =
            door.targetProgress > door.progress
              ? QORTAL_LAND_PARK_PORTAL_OPEN_SPEED
              : QORTAL_LAND_PARK_PORTAL_CLOSE_SPEED;
          const step = Math.max(0.001, delta * speed);
          if (door.targetProgress > door.progress) {
            door.progress = Math.min(door.targetProgress, door.progress + step);
          } else {
            door.progress = Math.max(door.targetProgress, door.progress - step);
          }

          const frameCount = Math.max(1, door.frames.length);
          const frameIndex = Phaser.Math.Clamp(
            Math.round(
              Phaser.Math.Easing.Sine.InOut(door.progress) * (frameCount - 1)
            ),
            0,
            frameCount - 1
          );
          door.frames.forEach((frame, index) => {
            frame?.setAlpha?.(index === frameIndex ? door.baseAlpha : 0);
          });
        }

        private createPropLayer(depth: number) {
          const layer = this.add.graphics();
          layer.setDepth(depth);
          this.propLayers.push(layer);
          return layer;
        }

        private drawDevelopmentPngProps() {
          if (!shouldShowQortalLandDevelopmentPngProps()) return;
          const roomId = currentRoomRef.current;
          for (const basePlacement of QORTAL_LAND_DEVELOPMENT_PNG_PROP_PLACEMENTS) {
            const placement = {
              ...basePlacement,
              ...readQortalLandDevelopmentPngPlacementOverride(
                basePlacement.id
              ),
            };
            if (placement.visible === false) continue;
            if (placement.roomIds && !placement.roomIds.includes(roomId))
              continue;
            const asset = qortalLandDevelopmentPngAssetById.get(
              placement.assetId
            );
            if (!asset) {
              if (!warnedMissingDevelopmentPngAssets.has(placement.assetId)) {
                warnedMissingDevelopmentPngAssets.add(placement.assetId);
                console.warn(
                  `[QortalLand] Development PNG asset not found: ${placement.assetId}`
                );
              }
              continue;
            }
            const textureKey = qortalLandDevelopmentPngTextureKey(asset.id);
            if (!this.textures.exists(textureKey)) continue;
            const instanceCount = Math.max(
              1,
              Math.min(12, Math.round(placement.count ?? 1))
            );
            const spacing = placement.spacing ?? 0;
            const startOffsetX = -((instanceCount - 1) * spacing) / 2;
            for (
              let instanceIndex = 0;
              instanceIndex < instanceCount;
              instanceIndex += 1
            ) {
              const instanceX =
                placement.x + startOffsetX + instanceIndex * spacing;
              const instanceY = placement.y;
              if (placement.contactShadow) {
                const shadow = placement.contactShadow;
                const shadowGraphic = this.add.graphics();
                shadowGraphic.setName(
                  instanceCount === 1
                    ? `${placement.id}:contact-shadow`
                    : `${placement.id}:${instanceIndex}:contact-shadow`
                );
                shadowGraphic.fillStyle(
                  shadow.color ?? 0x000000,
                  shadow.alpha ?? 0.2
                );
                shadowGraphic.fillEllipse(
                  instanceX + (shadow.offsetX ?? 0),
                  instanceY + (shadow.offsetY ?? 0),
                  shadow.width,
                  shadow.height
                );
                shadowGraphic.setDepth(
                  shadow.depth ??
                    (placement.depthMode === 'y-sort'
                      ? instanceY + (placement.depthOffset ?? 20) - 1
                      : (placement.depth ?? instanceY) +
                        (shadow.depthOffset ?? -1))
                );
                this.developmentPngPropSprites.push(shadowGraphic);
              }
              const instancePlacement = {
                ...placement,
                x: instanceX,
                y: instanceY,
                depth:
                  placement.depthMode === 'y-sort'
                    ? instanceY + (placement.depthOffset ?? 20)
                    : (placement.depth ?? instanceY),
              };
              if (this.hasWarpOffset(instancePlacement.warp)) {
                this.createWarpableDevelopmentPng(
                  instancePlacement,
                  textureKey,
                  instanceIndex
                );
                continue;
              }
              const lookTextureKey = this.developmentLookTextureKeyForPlacement(
                instancePlacement,
                textureKey
              );
              const sprite = this.add.image(
                instanceX,
                instanceY,
                lookTextureKey
              );
              sprite.setName(
                instanceCount === 1
                  ? placement.id
                  : `${placement.id}:${instanceIndex}`
              );
              sprite.setOrigin(
                placement.originX ?? 0.5,
                placement.originY ?? 1
              );
              sprite.setScale(
                (placement.scaleX ?? placement.scale ?? 1) * asset.renderScaleX,
                (placement.scaleY ?? placement.scale ?? 1) * asset.renderScaleY
              );
              sprite.setAlpha(placement.alpha ?? 1);
              sprite.setFlipX(Boolean(placement.flipX));
              sprite.setDepth(instancePlacement.depth);
              this.developmentPngPropSprites.push(sprite);
            }
          }
        }

        private drawCollisionDebug() {
          if (!shouldShowQortalLandCollisionDebug()) return;
          const roomId = currentRoomRef.current;
          for (const footprint of qortalLandCollisionFootprintsForRoom(
            roomId
          )) {
            const expanded = qortalLandExpandedCollisionRadii(footprint);
            const debugGraphic = this.add.graphics();
            debugGraphic.setName(
              `collision-debug:${footprint.x}:${footprint.y}`
            );
            debugGraphic.setDepth(9997);
            debugGraphic.lineStyle(2, 0xffe066, 0.9);
            debugGraphic.fillStyle(0xffe066, 0.14);
            if (footprint.shape === 'rect') {
              debugGraphic.fillRect(
                footprint.x - expanded.x,
                footprint.y - expanded.y,
                expanded.x * 2,
                expanded.y * 2
              );
              debugGraphic.strokeRect(
                footprint.x - expanded.x,
                footprint.y - expanded.y,
                expanded.x * 2,
                expanded.y * 2
              );
            } else {
              debugGraphic.fillEllipse(
                footprint.x,
                footprint.y,
                expanded.x * 2,
                expanded.y * 2
              );
              debugGraphic.strokeEllipse(
                footprint.x,
                footprint.y,
                expanded.x * 2,
                expanded.y * 2
              );
            }
            this.developmentPngPropSprites.push(debugGraphic);
          }
        }

        private createInteractionPrompt() {
          const hotspot = roomLayoutForRoom(QORTAL_LAND_DEFAULT_ROOM_ID)
            .interactions?.djBooth;
          const background = this.add.graphics();
          const text = this.add.text(0, 0, 'Work in Progress', {
            color: '#f8fbff',
            fontFamily: 'Inter, Arial, sans-serif',
            fontSize: '13px',
            fontStyle: '700',
            stroke: '#050711',
            strokeThickness: 4,
          });
          const container = this.add.container(
            hotspot?.x ?? 0,
            hotspot?.promptY ?? 0,
            [background, text]
          );
          container.setDepth(9998);
          container.setVisible(false);
          text.setOrigin(0.5);
          background.fillStyle(0x050711, 0.86);
          background.fillRoundedRect(-58, -19, 116, 34, 11);
          background.lineStyle(2, 0x2cf8ff, 0.58);
          background.strokeRoundedRect(-58, -19, 116, 34, 11);
          background.fillStyle(0xff2bd6, 0.14);
          background.fillRoundedRect(-52, 9, 104, 4, 2);
          return { container, background, text };
        }

        private updateInteractionPrompt() {
          if (!this.interactionPrompt || !this.localAvatar) return;
          const avatarLogicalX = Number(this.localAvatar.getData('logicalX'));
          const avatarLogicalY = Number(this.localAvatar.getData('logicalY'));
          const show = isNearClubDjBooth(
            currentRoomRef.current,
            Number.isFinite(avatarLogicalX)
              ? avatarLogicalX
              : this.localAvatar.x,
            Number.isFinite(avatarLogicalY)
              ? avatarLogicalY
              : this.localAvatar.y
          );
          this.interactionPrompt.container.setVisible(show);
          if (!show) return;
          const pulse = 0.88 + Math.sin(this.time.now / 180) * 0.12;
          const hotspot = roomLayoutForRoom(QORTAL_LAND_DEFAULT_ROOM_ID)
            .interactions?.djBooth;
          this.interactionPrompt.container.setPosition(
            hotspot?.x ?? this.interactionPrompt.container.x,
            (hotspot?.promptY ?? this.interactionPrompt.container.y) - pulse * 3
          );
          this.interactionPrompt.container.setAlpha(0.88 + pulse * 0.12);
        }

        private drawNeonText(g: any, x: number, y: number) {
          g.fillStyle(0xff2bd6, 1);
          g.fillRoundedRect(x, y, 16, 8, 4);
          g.fillRoundedRect(x, y + 8, 8, 16, 4);
          g.fillRoundedRect(x + 18, y, 8, 24, 4);
          g.fillRoundedRect(x + 32, y, 8, 24, 4);
          g.fillRoundedRect(x + 32, y + 16, 16, 8, 4);
          g.fillStyle(0x2cf8ff, 1);
          g.fillRoundedRect(x + 62, y, 10, 24, 5);
          g.fillRoundedRect(x + 80, y, 10, 24, 5);
          g.fillRoundedRect(x + 98, y, 10, 24, 5);
          g.fillRoundedRect(x + 116, y, 10, 24, 5);
          g.fillStyle(0xffae00, 1);
          g.fillRoundedRect(x + 146, y, 14, 24, 4);
          g.fillRoundedRect(x + 164, y, 14, 24, 4);
        }

        private drawFloorTexture(g: any) {
          const floor = roomLayoutForRoom(QORTAL_LAND_DEFAULT_ROOM_ID).floor;
          g.fillStyle(0x101830, 0.26);
          g.fillPoints(
            [
              new Phaser.Geom.Point(floor.back.minX + 33, floor.topY + 18),
              new Phaser.Geom.Point(floor.back.maxX - 33, floor.topY + 18),
              new Phaser.Geom.Point(floor.front.maxX - 41, floor.bottomY - 18),
              new Phaser.Geom.Point(floor.front.minX + 41, floor.bottomY - 18),
            ],
            true
          );
          for (let i = 0; i < 14; i += 1) {
            const y = floor.topY + 26 + (i % 13) * 28;
            const bounds = floorBoundsForY(y);
            const availableWidth = Math.max(1, bounds.maxX - bounds.minX - 120);
            const x = bounds.minX + 34 + ((i * 73) % availableWidth);
            const width = 56 + (i % 5) * 22;
            g.fillStyle(i % 2 === 0 ? 0x2cf8ff : 0xff2bd6, 0.018);
            g.fillRoundedRect(x, y, width, 5, 3);
          }
          for (let i = 0; i < 5; i += 1) {
            const y = 366 + i * 18;
            const bounds = floorBoundsForY(y);
            g.lineStyle(1, 0xffffff, 0.018);
            g.lineBetween(bounds.minX + 24, y, bounds.maxX - 24, y + 2);
          }
          g.fillStyle(0x2cf8ff, 0.022);
          g.fillEllipse(705, 520, 420, 72);
          g.fillStyle(0xff2bd6, 0.018);
          g.fillEllipse(1125, 580, 520, 92);
          g.fillStyle(0x000000, 0.18);
          g.fillEllipse(900, floor.bottomY + 10, 1530, 56);
        }

        private drawSideWalls(g: any) {
          const layout = roomLayoutForRoom(QORTAL_LAND_DEFAULT_ROOM_ID);
          const { floor } = layout;
          g.fillStyle(0x080b19, 0.92);
          g.fillPoints(
            [
              new Phaser.Geom.Point(0, 128),
              new Phaser.Geom.Point(floor.back.minX, floor.topY),
              new Phaser.Geom.Point(floor.front.minX, floor.bottomY),
              new Phaser.Geom.Point(0, floor.bottomY + 40),
            ],
            true
          );
          g.fillStyle(0x0b1022, 0.92);
          g.fillPoints(
            [
              new Phaser.Geom.Point(layout.width, 128),
              new Phaser.Geom.Point(floor.back.maxX, floor.topY),
              new Phaser.Geom.Point(floor.front.maxX, floor.bottomY),
              new Phaser.Geom.Point(layout.width, floor.bottomY + 40),
            ],
            true
          );
          g.lineStyle(2, 0x2cf8ff, 0.055);
          for (let y = 220; y <= 560; y += 170) {
            g.lineBetween(18, y, 155, y + 72);
            g.lineBetween(layout.width - 18, y, layout.width - 155, y + 72);
          }
          g.lineStyle(3, 0xff2bd6, 0.11);
          g.lineBetween(0, 128, floor.back.minX, floor.topY);
          g.lineStyle(3, 0x2cf8ff, 0.11);
          g.lineBetween(layout.width, 128, floor.back.maxX, floor.topY);
        }

        private drawClubBackWall(g: any) {
          const floor = roomLayoutForRoom(QORTAL_LAND_DEFAULT_ROOM_ID).floor;
          g.fillStyle(0x060917, 0.56);
          g.fillRoundedRect(188, 166, 1424, 218, 22);
          g.fillStyle(0x0d1328, 0.92);
          g.fillPoints(
            [
              new Phaser.Geom.Point(floor.back.minX, floor.topY),
              new Phaser.Geom.Point(floor.back.maxX, floor.topY),
              new Phaser.Geom.Point(1484, 392),
              new Phaser.Geom.Point(316, 392),
            ],
            true
          );
          g.lineStyle(2, 0x2cf8ff, 0.1);
          g.lineBetween(230, 327, 1570, 327);
          g.lineBetween(250, 366, 1550, 366);

          for (let i = 0; i < 7; i += 1) {
            const x = 268 + i * 196;
            const panelColor = i % 2 === 0 ? 0x071021 : 0x0a1024;
            g.fillStyle(panelColor, 0.62);
            g.fillPoints(
              [
                new Phaser.Geom.Point(x, 300),
                new Phaser.Geom.Point(x + 154, 300),
                new Phaser.Geom.Point(x + 132, 390),
                new Phaser.Geom.Point(x + 18, 390),
              ],
              true
            );
            g.lineStyle(1, i % 2 === 0 ? 0x2cf8ff : 0xff2bd6, 0.09);
            g.strokePoints(
              [
                new Phaser.Geom.Point(x, 300),
                new Phaser.Geom.Point(x + 154, 300),
                new Phaser.Geom.Point(x + 132, 390),
                new Phaser.Geom.Point(x + 18, 390),
                new Phaser.Geom.Point(x, 300),
              ],
              false
            );
          }

          g.fillStyle(0x02040b, 0.34);
          g.fillEllipse(900, 404, 1010, 72);
          g.fillStyle(0x2cf8ff, 0.032);
          g.fillTriangle(675, 88, 748, floor.topY, 796, floor.topY);
          g.fillStyle(0xff2bd6, 0.032);
          g.fillTriangle(1125, 88, 1004, floor.topY, 1052, floor.topY);
        }

        private drawCeilingRig(g: any) {
          g.lineStyle(9, 0x03040a, 0.9);
          g.lineBetween(360, 78, 1440, 78);
          g.lineStyle(3, 0x151b35, 0.88);
          g.lineBetween(360, 78, 1440, 78);
          g.lineStyle(2, 0x2cf8ff, 0.16);
          g.lineBetween(360, 78, 760, 165);
          g.lineBetween(1440, 78, 1040, 165);
          g.lineStyle(1, 0xff2bd6, 0.1);
          g.lineBetween(250, 76, 760, 165);
          g.lineBetween(1550, 76, 1040, 165);
          for (let x = 460; x <= 1340; x += 176) {
            g.fillStyle(0x02030a, 0.72);
            g.fillEllipse(x, 82, 46, 18);
            g.fillStyle(0x090b18, 1);
            g.fillCircle(x, 78, 18);
            g.fillStyle(0x0f1730, 1);
            g.fillCircle(x, 78, 12);
            g.lineStyle(2, x % 352 === 0 ? 0xff2bd6 : 0x2cf8ff, 0.42);
            g.strokeCircle(x, 78, 14);
            g.fillStyle(x % 352 === 0 ? 0xff2bd6 : 0x2cf8ff, 0.16);
            g.fillCircle(x, 78, 7);
          }
          g.fillStyle(0x02030a, 0.45);
          g.fillEllipse(900, 111, 124, 24);
          g.fillStyle(0xc7f8ff, 0.62);
          g.fillCircle(900, 86, 28);
          g.fillStyle(0x2cf8ff, 0.14);
          g.fillCircle(900, 86, 46);
          g.lineStyle(2, 0xf8fbff, 0.22);
          g.strokeCircle(900, 86, 28);
          g.lineStyle(1, 0x10152a, 0.5);
          for (let offset = -20; offset <= 20; offset += 10) {
            g.lineBetween(900 + offset, 61, 900 - offset, 111);
            g.lineBetween(875, 86 + offset, 925, 86 - offset);
          }
          for (let ray = 0; ray < 16; ray += 1) {
            const angle = (Math.PI * 2 * ray) / 16;
            const innerX = 900 + Math.cos(angle) * 6;
            const innerY = 86 + Math.sin(angle) * 6;
            const outerX = 900 + Math.cos(angle) * 28;
            const outerY = 86 + Math.sin(angle) * 28;
            g.lineStyle(1, ray % 2 === 0 ? 0xf8fbff : 0x2cf8ff, 0.18);
            g.lineBetween(innerX, innerY, outerX, outerY);
          }
        }

        private drawSkywalkDoor(g: any, x: number, y: number) {
          g.fillStyle(0x070914, 0.96);
          g.fillRoundedRect(x - 34, y - 20, 204, 238, 16);
          g.lineStyle(2, 0x2cf8ff, 0.12);
          g.strokeRoundedRect(x - 34, y - 20, 204, 238, 16);
          g.fillStyle(0x2cf8ff, 0.055);
          g.fillRoundedRect(x - 18, y - 4, 172, 208, 20);
          g.fillStyle(0xff2bd6, 0.04);
          g.fillRoundedRect(x - 5, y + 8, 146, 184, 18);
          g.fillStyle(0x050713, 0.98);
          g.fillRoundedRect(x, y, 136, 188, 16);
          g.fillStyle(0x091225, 1);
          g.fillRoundedRect(x + 14, y + 16, 108, 156, 12);
          g.fillStyle(0x02030a, 1);
          g.fillRoundedRect(x + 31, y + 34, 74, 120, 10);
          g.fillStyle(0x101b3a, 0.92);
          g.fillRoundedRect(x + 38, y + 42, 60, 104, 8);
          for (let i = 0; i < 6; i += 1) {
            const alpha = 0.18 + i * 0.055;
            g.lineStyle(2, i % 2 === 0 ? 0x2cf8ff : 0xff2bd6, alpha);
            g.lineBetween(x + 46 + i * 4, y + 50, x + 84 - i * 2, y + 140);
          }
          for (let i = 0; i < 7; i += 1) {
            g.fillStyle(i % 2 === 0 ? 0x2cf8ff : 0xff2bd6, 0.42);
            g.fillCircle(x + 52 + (i % 3) * 14, y + 55 + i * 13, 2.5);
          }
          g.lineStyle(5, 0x2cf8ff, 0.78);
          g.strokeRoundedRect(x + 14, y + 16, 108, 156, 12);
          g.lineStyle(3, 0xff2bd6, 0.5);
          g.strokeRoundedRect(x + 26, y + 28, 84, 132, 10);
          for (let i = 0; i < 4; i += 1) {
            g.lineStyle(2, 0x2cf8ff, 0.28 - i * 0.04);
            g.strokeRoundedRect(
              x + 5 - i * 7,
              y + 5 - i * 7,
              126 + i * 14,
              178 + i * 14,
              16
            );
          }
          g.fillStyle(0xf8fbff, 0.74);
          g.fillCircle(x + 104, y + 100, 5);
          g.fillStyle(0x2cf8ff, 0.3);
          g.fillRoundedRect(x + 18, y + 188, 100, 12, 6);
          g.fillStyle(0xff2bd6, 0.24);
          g.fillRoundedRect(x + 34, y + 204, 68, 8, 4);
          g.fillStyle(0xffae00, 0.5);
          g.fillTriangle(x + 68, y + 183, x + 58, y + 170, x + 78, y + 170);
        }

        private drawParkPortal(g: any, x: number, y: number, flip = false) {
          const accent = 0x78ff9a;
          const secondary = 0x2cf8ff;
          g.fillStyle(0x02050a, 0.86);
          g.fillEllipse(x + 72, y + 196, 168, 34);
          for (let i = 0; i < 4; i += 1) {
            g.lineStyle(3, i % 2 === 0 ? accent : secondary, 0.2 - i * 0.028);
            g.strokeRoundedRect(
              x - i * 9,
              y - i * 7,
              144 + i * 18,
              202 + i * 14,
              34
            );
          }
          g.fillStyle(0x061018, 0.98);
          g.fillRoundedRect(x + 8, y + 8, 128, 184, 28);
          g.fillStyle(0x10242a, 0.94);
          g.fillRoundedRect(x + 21, y + 22, 102, 158, 24);
          g.fillStyle(0x78ff9a, 0.12);
          g.fillRoundedRect(x + 32, y + 34, 80, 136, 22);
          for (let i = 0; i < 5; i += 1) {
            const offset = flip ? -i * 7 : i * 7;
            g.lineStyle(2, i % 2 === 0 ? accent : secondary, 0.28 + i * 0.04);
            g.lineBetween(
              x + 44 + offset,
              y + 48,
              x + 96 - offset * 0.4,
              y + 158
            );
          }
          g.lineStyle(5, accent, 0.72);
          g.strokeRoundedRect(x + 18, y + 18, 108, 164, 26);
          g.lineStyle(2, secondary, 0.5);
          g.strokeRoundedRect(x + 32, y + 34, 80, 132, 22);
          g.fillStyle(0xf8fbff, 0.8);
          g.fillCircle(x + (flip ? 42 : 103), y + 104, 4);
          g.fillStyle(accent, 0.32);
          g.fillRoundedRect(x + 24, y + 188, 96, 10, 5);
          g.fillStyle(secondary, 0.22);
          g.fillRoundedRect(x + 42, y + 202, 60, 7, 4);
        }

        private drawSkylineWindow(
          g: any,
          x: number,
          y: number,
          width: number,
          height: number
        ) {
          g.fillStyle(0x050817, 1);
          g.fillRoundedRect(x, y, width, height, 18);
          g.fillStyle(0x07142c, 1);
          g.fillRoundedRect(x + 12, y + 12, width - 24, height - 24, 14);
          g.lineStyle(4, 0x2cf8ff, 0.32);
          g.strokeRoundedRect(x, y, width, height, 18);
          g.lineStyle(2, 0xff2bd6, 0.18);
          g.lineBetween(
            x + 40,
            y + height - 38,
            x + width - 40,
            y + height - 38
          );
          g.fillStyle(0xff2bd6, 0.14);
          g.fillCircle(x + width * 0.68, y + 74, 42);
          g.fillStyle(0x2cf8ff, 0.08);
          g.fillCircle(x + width * 0.25, y + 92, 62);
          for (let tower = 0; tower < 17; tower += 1) {
            const towerX = x + 54 + tower * ((width - 120) / 16);
            const towerW = 34 + (tower % 4) * 9;
            const towerH = 62 + (tower % 5) * 28;
            const baseY = y + height - 42;
            g.fillStyle(tower % 2 === 0 ? 0x070a18 : 0x0b1024, 0.96);
            g.fillRect(towerX, baseY - towerH, towerW, towerH);
            for (let row = 0; row < Math.floor(towerH / 18); row += 1) {
              for (
                let col = 0;
                col < Math.max(1, Math.floor(towerW / 13));
                col += 1
              ) {
                const lit = (tower + row + col) % 3 !== 0;
                g.fillStyle(lit ? 0x2cf8ff : 0x17213c, lit ? 0.52 : 0.32);
                g.fillRoundedRect(
                  towerX + 6 + col * 13,
                  baseY - towerH + 10 + row * 17,
                  7,
                  6,
                  2
                );
              }
            }
          }
          g.fillStyle(0x000000, 0.2);
          g.fillRect(x + 18, y + height - 54, width - 36, 32);
        }

        private drawSkywalkWorld(g: any) {
          const range = roomFloorRange(QORTAL_LAND_SKYWALK_ROOM_ID);
          g.fillStyle(0x050714, 1);
          g.fillRect(0, 0, LAND_WIDTH, LAND_HEIGHT);
          g.fillStyle(0x0c1226, 1);
          g.fillRect(0, 0, LAND_WIDTH, range.top);
          this.drawSkylineWindow(g, 64, 42, LAND_WIDTH - 128, 238);
          g.fillStyle(0x050711, 1);
          g.fillPoints(
            [
              new Phaser.Geom.Point(128, range.top),
              new Phaser.Geom.Point(1672, range.top),
              new Phaser.Geom.Point(1650, range.bottom),
              new Phaser.Geom.Point(150, range.bottom),
            ],
            true
          );
          g.fillStyle(0x10172d, 0.86);
          g.fillPoints(
            [
              new Phaser.Geom.Point(150, range.top + 26),
              new Phaser.Geom.Point(1650, range.top + 26),
              new Phaser.Geom.Point(1605, range.bottom - 18),
              new Phaser.Geom.Point(195, range.bottom - 18),
            ],
            true
          );
          g.lineStyle(3, 0x2cf8ff, 0.22);
          g.strokePoints(
            [
              new Phaser.Geom.Point(128, range.top),
              new Phaser.Geom.Point(1672, range.top),
              new Phaser.Geom.Point(1650, range.bottom),
              new Phaser.Geom.Point(150, range.bottom),
              new Phaser.Geom.Point(128, range.top),
            ],
            false
          );
          for (let i = 0; i < 6; i += 1) {
            const y = range.top + 56 + i * 44;
            const bounds = floorBoundsForRoomY(QORTAL_LAND_SKYWALK_ROOM_ID, y);
            g.lineStyle(1, 0xffffff, 0.035);
            g.lineBetween(bounds.minX + 50, y, bounds.maxX - 50, y);
          }
          g.fillStyle(0x050711, 1);
          g.fillRoundedRect(132, 292, 150, 118, 14);
          g.lineStyle(3, 0xff2bd6, 0.4);
          g.strokeRoundedRect(132, 292, 150, 118, 14);
          g.fillStyle(0x2cf8ff, 0.1);
          g.fillRoundedRect(154, 316, 106, 52, 10);
          g.fillStyle(0xf8fbff, 0.8);
          g.fillCircle(244, 352, 4);
          this.drawParkPortal(g, 1518, 250, true);
          this.drawEscalator(g, LAND_WIDTH / 2, 560, false);
          g.fillStyle(0xffae00, 0.08);
          g.fillEllipse(LAND_WIDTH / 2, 586, 360, 82);
        }

        private drawMallWorld(g: any) {
          const range = roomFloorRange(QORTAL_LAND_MALL_ROOM_ID);
          g.fillStyle(0x060811, 1);
          g.fillRect(0, 0, LAND_WIDTH, LAND_HEIGHT);
          g.fillStyle(0x10182a, 1);
          g.fillRect(0, 0, LAND_WIDTH, range.top);
          g.fillStyle(0x050711, 1);
          g.fillPoints(
            [
              new Phaser.Geom.Point(150, range.top),
              new Phaser.Geom.Point(1650, range.top),
              new Phaser.Geom.Point(1730, range.bottom),
              new Phaser.Geom.Point(70, range.bottom),
            ],
            true
          );
          g.fillStyle(0x0d1222, 1);
          g.fillPoints(
            [
              new Phaser.Geom.Point(190, range.top + 42),
              new Phaser.Geom.Point(1610, range.top + 42),
              new Phaser.Geom.Point(1665, range.bottom - 12),
              new Phaser.Geom.Point(135, range.bottom - 12),
            ],
            true
          );
          g.lineStyle(3, 0x2cf8ff, 0.16);
          g.strokePoints(
            [
              new Phaser.Geom.Point(150, range.top),
              new Phaser.Geom.Point(1650, range.top),
              new Phaser.Geom.Point(1730, range.bottom),
              new Phaser.Geom.Point(70, range.bottom),
              new Phaser.Geom.Point(150, range.top),
            ],
            false
          );
          for (let row = 0; row < 5; row += 1) {
            const y = range.top + 74 + row * 58;
            const bounds = floorBoundsForRoomY(QORTAL_LAND_MALL_ROOM_ID, y);
            g.lineStyle(1, 0xffffff, 0.035);
            g.lineBetween(bounds.minX + 60, y, bounds.maxX - 60, y + 2);
          }
          this.drawEscalator(g, LAND_WIDTH / 2, 360, true);
          this.drawCinemaStorefront(g, 480, 132, 840, 210);
          g.fillStyle(0x2cf8ff, 0.05);
          g.fillEllipse(900, 585, 840, 120);
        }

        private drawParkWorld(g: any) {
          const layout = roomLayoutForRoom(QORTAL_LAND_PARK_ROOM_ID);
          const range = roomFloorRange(QORTAL_LAND_PARK_ROOM_ID);
          g.fillStyle(0x030711, 1);
          g.fillRect(0, 0, layout.width, layout.height);
          g.fillStyle(0x071329, 1);
          g.fillRect(0, 0, layout.width, range.top + 4);
          g.fillStyle(0x050711, 0.72);
          g.fillRect(
            0,
            range.top - 24,
            layout.width,
            layout.height - range.top + 24
          );
          this.drawParkPlatformSupport(g);
          g.fillStyle(0x2cf8ff, 0.035);
          g.fillEllipse(420, 616, 720, 160);
          g.fillStyle(0xff2bd6, 0.032);
          g.fillEllipse(1360, 596, 760, 154);
          g.fillStyle(0x78ff9a, 0.018);
          g.fillEllipse(900, 380, 940, 120);
        }

        private drawParkPlatformSupport(g: any) {
          const layout = roomLayoutForRoom(QORTAL_LAND_PARK_ROOM_ID);
          const { floor } = layout;
          const width = layout.width;
          const height = layout.height;
          const supportTopY = floor.bottomY + 8;
          const lowerLipY = height - 30;
          const leftBackX = Phaser.Math.Clamp(floor.back.minX, 0, width);
          const rightBackX = Phaser.Math.Clamp(floor.back.maxX, 0, width);
          const leftFrontX = Phaser.Math.Clamp(floor.front.minX, 0, width);
          const rightFrontX = Phaser.Math.Clamp(floor.front.maxX, 0, width);

          g.fillStyle(0x020511, 0.86);
          g.fillPoints(
            [
              new Phaser.Geom.Point(leftFrontX, supportTopY),
              new Phaser.Geom.Point(rightFrontX, supportTopY),
              new Phaser.Geom.Point(width, height),
              new Phaser.Geom.Point(0, height),
            ],
            true
          );

          g.fillStyle(0x071024, 0.36);
          g.fillPoints(
            [
              new Phaser.Geom.Point(0, floor.topY + 42),
              new Phaser.Geom.Point(leftBackX, floor.topY + 14),
              new Phaser.Geom.Point(leftFrontX, supportTopY),
              new Phaser.Geom.Point(0, height),
            ],
            true
          );
          g.fillPoints(
            [
              new Phaser.Geom.Point(rightBackX, floor.topY + 14),
              new Phaser.Geom.Point(width, floor.topY + 42),
              new Phaser.Geom.Point(width, height),
              new Phaser.Geom.Point(rightFrontX, supportTopY),
            ],
            true
          );

          g.fillStyle(0x0b1428, 0.74);
          g.fillPoints(
            [
              new Phaser.Geom.Point(0, lowerLipY),
              new Phaser.Geom.Point(width, lowerLipY),
              new Phaser.Geom.Point(width, height),
              new Phaser.Geom.Point(0, height),
            ],
            true
          );

          g.lineStyle(3, 0x22eaff, 0.22);
          g.lineBetween(leftBackX, floor.topY + 14, leftFrontX, supportTopY);
          g.lineBetween(rightBackX, floor.topY + 14, rightFrontX, supportTopY);
          g.lineBetween(
            leftFrontX + 18,
            supportTopY,
            rightFrontX - 18,
            supportTopY
          );

          g.lineStyle(2, 0xff2bd6, 0.18);
          g.lineBetween(0, lowerLipY, width, lowerLipY);
          g.lineStyle(2, 0x22eaff, 0.16);
          g.lineBetween(16, height - 10, width - 16, height - 10);

          g.fillStyle(0x111b35, 0.22);
          g.fillRoundedRect(92, floor.bottomY + 42, width - 184, 18, 9);
          g.fillStyle(0x030711, 0.44);
          g.fillRoundedRect(150, lowerLipY - 42, width - 300, 36, 12);

          g.fillStyle(0x2cf8ff, 0.22);
          g.fillRoundedRect(224, floor.bottomY + 26, 84, 5, 3);
          g.fillRoundedRect(width / 2 - 42, floor.bottomY + 20, 84, 5, 3);
          g.fillRoundedRect(width - 308, floor.bottomY + 26, 84, 5, 3);
        }

        private drawParkTree(g: any, x: number, y: number, color: number) {
          g.fillStyle(0x02040a, 0.35);
          g.fillEllipse(x, y + 62, 128, 28);
          g.fillStyle(0x1b1020, 1);
          g.fillRoundedRect(x - 13, y + 8, 26, 86, 10);
          g.fillStyle(color, 0.16);
          g.fillCircle(x, y, 64);
          g.fillStyle(color, 0.22);
          g.fillCircle(x - 34, y + 20, 42);
          g.fillCircle(x + 34, y + 20, 42);
          g.fillStyle(0x07180f, 0.96);
          g.fillCircle(x, y + 10, 46);
          g.lineStyle(2, color, 0.42);
          g.strokeCircle(x, y + 10, 46);
          g.fillStyle(color, 0.48);
          g.fillCircle(x + 30, y - 10, 5);
          g.fillCircle(x - 24, y + 22, 4);
        }

        private drawParkBench(g: any, x: number, y: number, color: number) {
          g.fillStyle(0x02040a, 0.32);
          g.fillEllipse(x + 82, y + 52, 190, 24);
          g.fillStyle(0x070914, 0.98);
          g.fillRoundedRect(x, y, 164, 32, 10);
          g.fillStyle(0x11182b, 1);
          g.fillRoundedRect(x + 12, y + 8, 140, 14, 7);
          g.lineStyle(3, color, 0.42);
          g.strokeRoundedRect(x, y, 164, 32, 10);
          g.fillStyle(color, 0.28);
          g.fillRoundedRect(x + 22, y + 36, 120, 12, 6);
          g.fillStyle(0x050711, 1);
          g.fillRoundedRect(x + 28, y + 26, 14, 38, 5);
          g.fillRoundedRect(x + 122, y + 26, 14, 38, 5);
        }

        private drawEscalator(
          g: any,
          centerX: number,
          centerY: number,
          up: boolean
        ) {
          const topY = centerY - 92;
          const bottomY = centerY + 112;
          const topHalf = up ? 120 : 92;
          const bottomHalf = up ? 72 : 150;
          g.fillStyle(0x02040b, 0.62);
          g.fillEllipse(centerX, bottomY + 30, 360, 48);
          g.fillStyle(0x070a17, 0.98);
          g.fillPoints(
            [
              new Phaser.Geom.Point(centerX - topHalf, topY),
              new Phaser.Geom.Point(centerX + topHalf, topY),
              new Phaser.Geom.Point(centerX + bottomHalf, bottomY),
              new Phaser.Geom.Point(centerX - bottomHalf, bottomY),
            ],
            true
          );
          g.fillStyle(0x121a30, 1);
          g.fillPoints(
            [
              new Phaser.Geom.Point(centerX - topHalf + 28, topY + 18),
              new Phaser.Geom.Point(centerX + topHalf - 28, topY + 18),
              new Phaser.Geom.Point(centerX + bottomHalf - 26, bottomY - 18),
              new Phaser.Geom.Point(centerX - bottomHalf + 26, bottomY - 18),
            ],
            true
          );
          g.lineStyle(5, 0x2cf8ff, 0.34);
          g.lineBetween(centerX - topHalf, topY, centerX - bottomHalf, bottomY);
          g.lineBetween(centerX + topHalf, topY, centerX + bottomHalf, bottomY);
          for (let i = 0; i < 7; i += 1) {
            const t = i / 6;
            const y = topY + 32 + t * (bottomY - topY - 64);
            const half = topHalf + (bottomHalf - topHalf) * t - 38;
            g.lineStyle(2, 0xffffff, 0.08);
            g.lineBetween(centerX - half, y, centerX + half, y);
          }
          g.fillStyle(0xffae00, 0.18);
          g.fillRoundedRect(centerX - 92, topY - 34, 184, 24, 10);
          g.lineStyle(2, 0xffae00, 0.42);
          g.strokeRoundedRect(centerX - 92, topY - 34, 184, 24, 10);
        }

        private drawCinemaStorefront(
          g: any,
          x: number,
          y: number,
          width: number,
          height: number
        ) {
          g.fillStyle(0x03040b, 1);
          g.fillRoundedRect(x, y, width, height, 18);
          g.fillStyle(0x0d1022, 1);
          g.fillRoundedRect(x + 24, y + 26, width - 48, height - 52, 16);
          g.lineStyle(5, 0xff2bd6, 0.52);
          g.strokeRoundedRect(x, y, width, height, 18);
          g.lineStyle(3, 0x2cf8ff, 0.38);
          g.strokeRoundedRect(x + 24, y + 26, width - 48, height - 52, 16);
          g.fillStyle(0x050711, 1);
          g.fillRoundedRect(x + 82, y + 60, width - 164, 72, 14);
          g.lineStyle(2, 0xffae00, 0.62);
          g.strokeRoundedRect(x + 82, y + 60, width - 164, 72, 14);
          g.fillStyle(0x2cf8ff, 1);
          g.fillRoundedRect(x + 204, y + 82, 22, 30, 5);
          g.fillRoundedRect(x + 234, y + 82, 22, 30, 5);
          g.fillStyle(0xff2bd6, 1);
          g.fillRoundedRect(x + 282, y + 82, 22, 30, 5);
          g.fillRoundedRect(x + 312, y + 82, 88, 10, 5);
          g.fillRoundedRect(x + 312, y + 102, 62, 10, 5);
          g.fillStyle(0xffae00, 1);
          g.fillRoundedRect(x + 428, y + 82, 84, 10, 5);
          g.fillRoundedRect(x + 428, y + 102, 84, 10, 5);
          g.fillStyle(0x050711, 1);
          g.fillRoundedRect(x + width / 2 - 88, y + height - 62, 176, 62, 14);
          g.lineStyle(2, 0xffffff, 0.1);
          g.lineBetween(
            x + width / 2,
            y + height - 58,
            x + width / 2,
            y + height - 4
          );
          for (let i = 0; i < 10; i += 1) {
            g.fillStyle(i % 2 === 0 ? 0xffae00 : 0x2cf8ff, 0.72);
            g.fillCircle(x + 70 + i * 78, y + 26, 6);
          }
        }

        private drawBooth(g: any, x: number, y: number, color: number) {
          g.fillStyle(0x03040c, 0.35);
          g.fillEllipse(x + 126, y + 85, 250, 42);
          g.fillStyle(0x090b16, 1);
          g.fillRoundedRect(x, y, 250, 88, 18);
          g.fillStyle(0x040611, 0.96);
          g.fillPoints(
            [
              new Phaser.Geom.Point(x + 12, y + 60),
              new Phaser.Geom.Point(x + 238, y + 60),
              new Phaser.Geom.Point(x + 216, y + 104),
              new Phaser.Geom.Point(x + 34, y + 104),
            ],
            true
          );
          g.fillStyle(0x02030a, 0.34);
          g.fillRoundedRect(x + 12, y + 72, 226, 24, 9);
          g.fillStyle(0x11172d, 1);
          g.fillRoundedRect(x + 8, y + 8, 234, 70, 16);
          g.fillStyle(0x151b35, 1);
          g.fillRoundedRect(x + 18, y + 15, 214, 45, 14);
          g.fillStyle(0x222b4d, 0.58);
          g.fillRoundedRect(x + 28, y + 20, 194, 15, 8);
          g.fillStyle(0x080a14, 1);
          g.fillRoundedRect(x + 58, y + 42, 134, 34, 10);
          g.lineStyle(4, color, 0.55);
          g.strokeRoundedRect(x + 14, y + 12, 222, 54, 16);
          g.fillStyle(color, 0.18);
          g.fillRoundedRect(x + 28, y + 72, 194, 16, 8);
          g.fillStyle(color, 0.1);
          g.fillRoundedRect(x + 40, y + 88, 170, 10, 5);
          g.lineStyle(2, 0xffffff, 0.08);
          g.lineBetween(x + 24, y + 22, x + 226, y + 22);
          g.fillStyle(0x010209, 0.75);
          g.fillRoundedRect(x + 28, y + 82, 22, 28, 5);
          g.fillRoundedRect(x + 200, y + 82, 22, 28, 5);
        }

        private drawBottleShelf(g: any, x: number, y: number, width: number) {
          g.fillStyle(0x02030a, 0.5);
          g.fillRoundedRect(x - 8, y + 12, width + 16, 82, 14);
          g.fillStyle(0x050611, 0.96);
          g.fillRoundedRect(x, y, width, 86, 12);
          g.fillStyle(0x0b1126, 0.82);
          g.fillRoundedRect(x + 14, y + 11, width - 28, 64, 9);
          g.lineStyle(2, 0x2cf8ff, 0.16);
          g.strokeRoundedRect(x, y, width, 86, 12);
          for (let row = 0; row < 2; row += 1) {
            g.lineStyle(2, 0xffffff, 0.055);
            g.lineBetween(
              x + 20,
              y + 35 + row * 32,
              x + width - 20,
              y + 35 + row * 32
            );
            for (let col = 0; col < 13; col += 1) {
              const bottleX = x + 24 + col * ((width - 48) / 12);
              const bottleColor =
                col % 3 === 0 ? 0xff2bd6 : col % 3 === 1 ? 0x2cf8ff : 0xffae00;
              const bottleHeight = 22 + ((col + row) % 3) * 4;
              g.fillStyle(0x02030a, 0.45);
              g.fillRoundedRect(bottleX - 3, y + 15 + row * 32, 17, 24, 4);
              g.fillStyle(bottleColor, 0.42);
              g.fillRoundedRect(
                bottleX,
                y + 13 + row * 32 - (bottleHeight - 22),
                10,
                bottleHeight,
                3
              );
              g.fillStyle(bottleColor, 0.22);
              g.fillRoundedRect(
                bottleX + 3,
                y + 8 + row * 32 - (bottleHeight - 22),
                4,
                8,
                2
              );
              g.fillStyle(0xffffff, 0.08);
              g.fillRoundedRect(
                bottleX + 2,
                y + 16 + row * 32 - (bottleHeight - 22),
                3,
                12,
                2
              );
            }
          }
        }

        private drawSpeakerStack(g: any, x: number, y: number, accent: number) {
          g.fillStyle(0x010209, 0.42);
          g.fillEllipse(x + 40, y + 126, 96, 24);
          g.fillStyle(0x03040b, 0.98);
          g.fillRoundedRect(x, y, 76, 126, 10);
          g.fillStyle(0x0b1122, 0.96);
          g.fillRoundedRect(x + 8, y + 8, 60, 110, 8);
          g.lineStyle(2, accent, 0.25);
          g.strokeRoundedRect(x, y, 76, 126, 10);
          for (let i = 0; i < 3; i += 1) {
            const cy = y + 27 + i * 36;
            g.fillStyle(0x03040b, 1);
            g.fillCircle(x + 38, cy, 22);
            g.fillStyle(0x10162a, 1);
            g.fillCircle(x + 38, cy, 17);
            g.lineStyle(2, accent, 0.26);
            g.strokeCircle(x + 38, cy, 15);
            g.lineStyle(1, 0xffffff, 0.08);
            g.strokeCircle(x + 38, cy, 9);
            g.fillStyle(accent, 0.12);
            g.fillCircle(x + 38, cy, 6);
          }
          g.lineStyle(2, accent, 0.12);
          g.lineBetween(x + 12, y + 44, x + 64, y + 44);
          g.lineBetween(x + 12, y + 82, x + 64, y + 82);
        }

        private drawFloorPlanter(g: any, x: number, y: number, color: number) {
          g.fillStyle(0x03040c, 0.34);
          g.fillEllipse(x, y + 44, 102, 24);
          g.fillStyle(0x070a14, 1);
          g.fillRoundedRect(x - 32, y + 18, 64, 42, 10);
          g.fillStyle(0x121a2f, 1);
          g.fillRoundedRect(x - 22, y + 26, 44, 24, 8);
          g.lineStyle(2, color, 0.3);
          g.strokeRoundedRect(x - 32, y + 18, 64, 42, 10);
          g.lineStyle(3, 0x2cf8ff, 0.24);
          g.lineBetween(x, y + 24, x - 38, y - 30);
          g.lineStyle(3, 0xff2bd6, 0.22);
          g.lineBetween(x, y + 24, x + 38, y - 30);
          g.fillStyle(color, 0.2);
          g.fillCircle(x, y + 33, 10);
        }

        private drawDanceFloor(g: any) {
          const centerX =
            roomLayoutForRoom(QORTAL_LAND_DEFAULT_ROOM_ID).width / 2;
          const top = 430;
          const bottom = 645;
          g.fillStyle(0x02040b, 0.45);
          g.fillPoints(
            [
              new Phaser.Geom.Point(centerX - 455, bottom),
              new Phaser.Geom.Point(centerX + 455, bottom),
              new Phaser.Geom.Point(centerX + 405, bottom + 34),
              new Phaser.Geom.Point(centerX - 405, bottom + 34),
            ],
            true
          );
          g.fillStyle(0x2cf8ff, 0.055);
          g.fillEllipse(centerX, bottom - 42, 820, 112);
          g.fillStyle(0x0a0d19, 0.96);
          g.fillPoints(
            [
              new Phaser.Geom.Point(centerX - 315, top),
              new Phaser.Geom.Point(centerX + 315, top),
              new Phaser.Geom.Point(centerX + 455, bottom),
              new Phaser.Geom.Point(centerX - 455, bottom),
            ],
            true
          );
          for (let row = 0; row < 5; row += 1) {
            for (let col = 0; col < 9; col += 1) {
              const hue = (row * 42 + col * 24) % 360;
              const color = Phaser.Display.Color.HSLToColor(
                hue / 360,
                0.9,
                0.55
              ).color;
              const rowY = top + 18 + row * 38;
              const rowWidth = 540 + row * 42;
              const cellW = rowWidth / 9 - 8;
              const startX = centerX - rowWidth / 2 + col * (rowWidth / 9);
              const lit = 0.12 + ((row + col) % 2) * 0.09;
              const skew = row * 5;
              const points = [
                new Phaser.Geom.Point(startX + skew, rowY),
                new Phaser.Geom.Point(startX + cellW + skew, rowY),
                new Phaser.Geom.Point(startX + cellW + skew + 6, rowY + 26),
                new Phaser.Geom.Point(startX + skew - 6, rowY + 26),
              ];
              g.fillStyle(0x010209, 0.3);
              g.fillPoints(
                [
                  new Phaser.Geom.Point(points[0].x + 4, points[0].y + 5),
                  new Phaser.Geom.Point(points[1].x + 4, points[1].y + 5),
                  new Phaser.Geom.Point(points[2].x + 4, points[2].y + 5),
                  new Phaser.Geom.Point(points[3].x + 4, points[3].y + 5),
                ],
                true
              );
              g.fillStyle(color, lit);
              g.fillPoints(points, true);
              g.fillStyle(0xffffff, 0.035);
              g.fillPoints(
                [
                  new Phaser.Geom.Point(points[0].x + 3, points[0].y + 3),
                  new Phaser.Geom.Point(points[1].x - 4, points[1].y + 3),
                  new Phaser.Geom.Point(points[1].x - 10, points[1].y + 9),
                  new Phaser.Geom.Point(points[0].x + 9, points[0].y + 9),
                ],
                true
              );
              g.lineStyle(1, color, 0.12);
              g.strokePoints([...points, points[0]], false);
            }
          }
          for (let row = 1; row < 5; row += 1) {
            const y = top + 12 + row * 38;
            const half = 298 + row * 24;
            g.lineStyle(1, 0xf8fbff, 0.055);
            g.lineBetween(centerX - half, y, centerX + half, y + 2);
          }
          g.lineStyle(3, 0xff2bd6, 0.32);
          g.strokePoints(
            [
              new Phaser.Geom.Point(centerX - 315, top),
              new Phaser.Geom.Point(centerX + 315, top),
              new Phaser.Geom.Point(centerX + 455, bottom),
              new Phaser.Geom.Point(centerX - 455, bottom),
              new Phaser.Geom.Point(centerX - 315, top),
            ],
            false
          );
          g.lineStyle(2, 0x2cf8ff, 0.18);
          g.lineBetween(centerX - 432, bottom - 6, centerX + 432, bottom - 6);
        }

        private drawBarDetails(g: any) {
          g.fillStyle(0x02030a, 0.4);
          g.fillEllipse(900, 390, 950, 62);
          g.fillStyle(0x2cf8ff, 0.035);
          g.fillEllipse(900, 346, 760, 42);
          g.fillStyle(0x03040b, 1);
          g.fillPoints(
            [
              new Phaser.Geom.Point(420, 338),
              new Phaser.Geom.Point(1380, 338),
              new Phaser.Geom.Point(1330, 400),
              new Phaser.Geom.Point(470, 400),
            ],
            true
          );
          g.fillStyle(0x0d1226, 1);
          g.fillPoints(
            [
              new Phaser.Geom.Point(456, 346),
              new Phaser.Geom.Point(1344, 346),
              new Phaser.Geom.Point(1294, 386),
              new Phaser.Geom.Point(506, 386),
            ],
            true
          );
          g.fillStyle(0x151c36, 0.78);
          g.fillPoints(
            [
              new Phaser.Geom.Point(492, 352),
              new Phaser.Geom.Point(1308, 352),
              new Phaser.Geom.Point(1278, 374),
              new Phaser.Geom.Point(522, 374),
            ],
            true
          );
          g.lineStyle(2, 0x2cf8ff, 0.12);
          g.lineBetween(470, 400, 1330, 400);
          g.lineStyle(2, 0xffffff, 0.055);
          g.lineBetween(506, 356, 1294, 356);
          g.fillStyle(0x050611, 0.98);
          g.fillRoundedRect(420, 314, 960, 54, 14);
          g.fillStyle(0x11172d, 1);
          g.fillRoundedRect(452, 324, 896, 30, 10);
          g.lineStyle(3, 0xff2bd6, 0.34);
          g.strokeRoundedRect(420, 314, 960, 54, 14);
          for (let x = 448; x <= 1320; x += 96) {
            g.fillStyle(0x050611, 0.95);
            g.fillRoundedRect(x, 336, 34, 46, 8);
            g.fillStyle(x % 192 === 0 ? 0xff2bd6 : 0x2cf8ff, 0.46);
            g.fillCircle(x + 17, 332, 10);
            g.fillStyle(0x000000, 0.28);
            g.fillEllipse(x + 17, 383, 42, 14);
            g.fillStyle(0x151b35, 1);
            g.fillRoundedRect(x + 7, 344, 20, 33, 6);
          }
          this.drawBottleShelf(g, 540, 178, 720);
          const hotspot = roomLayoutForRoom(QORTAL_LAND_DEFAULT_ROOM_ID)
            .interactions?.djBooth;
          this.drawDjBooth(g, hotspot?.x ?? 900, 286);
        }

        private drawDjBooth(g: any, x: number, y: number) {
          g.fillStyle(0x010209, 0.42);
          g.fillEllipse(x, y + 82, 310, 42);
          g.fillStyle(0x040611, 0.98);
          g.fillRoundedRect(x - 142, y + 18, 284, 70, 14);
          g.fillStyle(0x101735, 1);
          g.fillRoundedRect(x - 124, y + 28, 248, 42, 10);
          g.lineStyle(3, 0x2cf8ff, 0.36);
          g.strokeRoundedRect(x - 142, y + 18, 284, 70, 14);
          g.lineStyle(2, 0xff2bd6, 0.34);
          g.strokeRoundedRect(x - 92, y + 30, 184, 36, 10);

          for (const deckX of [x - 78, x + 78]) {
            g.fillStyle(0x02030a, 1);
            g.fillCircle(deckX, y + 49, 24);
            g.lineStyle(2, 0x2cf8ff, 0.28);
            g.strokeCircle(deckX, y + 49, 19);
            g.lineStyle(1, 0xf8fbff, 0.12);
            g.strokeCircle(deckX, y + 49, 10);
            g.fillStyle(0xff2bd6, 0.48);
            g.fillCircle(deckX + 6, y + 43, 3);
          }

          g.fillStyle(0x050711, 1);
          g.fillRoundedRect(x - 34, y + 31, 68, 38, 8);
          for (let i = 0; i < 4; i += 1) {
            g.fillStyle(i % 2 === 0 ? 0x2cf8ff : 0xffae00, 0.54);
            g.fillRoundedRect(x - 22 + i * 14, y + 39, 6, 18, 3);
          }
          g.lineStyle(2, 0xff2bd6, 0.18);
          g.lineBetween(x - 106, y + 22, x - 134, y - 8);
          g.lineBetween(x + 106, y + 22, x + 134, y - 8);
          g.fillStyle(0xff2bd6, 0.28);
          g.fillCircle(x - 136, y - 10, 5);
          g.fillStyle(0x2cf8ff, 0.28);
          g.fillCircle(x + 136, y - 10, 5);

          g.fillStyle(0x2cf8ff, 0.14);
          g.fillRoundedRect(x - 118, y + 76, 236, 8, 4);
          g.fillStyle(0xff2bd6, 0.12);
          g.fillRoundedRect(x - 72, y + 88, 144, 7, 4);
        }

        private drawDepthProps() {
          // Club props now come from the transparent PNG development asset pipeline.
        }

        private drawSkywalkDepthProps() {
          const railLayer = this.createPropLayer(410);
          railLayer.fillStyle(0x02040a, 0.72);
          railLayer.fillRoundedRect(180, 382, 1440, 38, 16);
          railLayer.lineStyle(3, 0x2cf8ff, 0.24);
          railLayer.lineBetween(205, 392, 1595, 392);
          for (let x = 240; x <= 1560; x += 120) {
            railLayer.fillStyle(0x2cf8ff, 0.2);
            railLayer.fillRoundedRect(x, 398, 10, 42, 5);
          }
          const kioskLayer = this.createPropLayer(610);
          this.drawBooth(kioskLayer, 1225, 545, 0x2cf8ff);
          this.drawFloorPlanter(kioskLayer, 380, 560, 0xff2bd6);
        }

        private drawMallDepthProps() {
          const signLayer = this.createPropLayer(360);
          signLayer.fillStyle(0x050711, 0.9);
          signLayer.fillRoundedRect(300, 368, 260, 86, 16);
          signLayer.lineStyle(3, 0xffae00, 0.4);
          signLayer.strokeRoundedRect(300, 368, 260, 86, 16);
          signLayer.fillStyle(0xffae00, 0.46);
          signLayer.fillRoundedRect(332, 394, 128, 10, 5);
          signLayer.fillRoundedRect(332, 418, 88, 8, 4);
          const loungeLayer = this.createPropLayer(650);
          this.drawBooth(loungeLayer, 210, 585, 0x2cf8ff);
          this.drawBooth(loungeLayer, 1330, 585, 0xff2bd6);
        }

        private drawParkDepthProps() {
          // Park rebuild is PNG-driven; add depth props here once source assets exist.
        }

        private drawLightBeams(g: any) {
          const floor = roomLayoutForRoom(QORTAL_LAND_DEFAULT_ROOM_ID).floor;
          g.fillStyle(0x2cf8ff, 0.032);
          g.fillTriangle(250, 75, 640, floor.bottomY, 860, floor.bottomY);
          g.fillStyle(0xff2bd6, 0.032);
          g.fillTriangle(1540, 80, 950, floor.bottomY, 1190, floor.bottomY);
          g.fillStyle(0xffae00, 0.024);
          g.fillTriangle(900, 40, 720, floor.bottomY, 1080, floor.bottomY);
        }

        private drawForeground(g: any) {
          const roomId = currentRoomRef.current;
          const range = roomFloorRange(roomId);
          const roomSize = roomSizeForRoom(roomId);
          g.fillStyle(0x050611, 0.82);
          g.fillRoundedRect(
            120,
            range.bottom + 6,
            roomSize.width - 240,
            46,
            18
          );
          const color =
            roomId === QORTAL_LAND_MALL_ROOM_ID
              ? 0x2cf8ff
              : roomId === QORTAL_LAND_PARK_ROOM_ID
                ? 0x78ff9a
                : 0xff2bd6;
          g.lineStyle(3, color, 0.2);
          g.lineBetween(
            150,
            range.bottom + 12,
            roomSize.width - 150,
            range.bottom + 12
          );
        }

        private animateRoom(time: number) {
          if (!this.lightSweep) return;
          this.lightSweep.clear();
          const roomId = currentRoomRef.current;
          if (roomId === QORTAL_LAND_SKYWALK_ROOM_ID) {
            const pulse = 0.5 + Math.sin(time / 260) * 0.5;
            this.lightSweep.fillStyle(0x2cf8ff, 0.035 + pulse * 0.025);
            this.lightSweep.fillEllipse(900, 260, 1180, 58);
            this.lightSweep.fillStyle(0xff2bd6, 0.025);
            this.lightSweep.fillTriangle(250, 46, 850, 666, 1020, 666);
            return;
          }
          if (roomId === QORTAL_LAND_MALL_ROOM_ID) {
            const pulse = 0.5 + Math.sin(time / 220) * 0.5;
            this.lightSweep.fillStyle(0xffae00, 0.035 + pulse * 0.018);
            this.lightSweep.fillEllipse(900, 356, 600, 80);
            this.lightSweep.fillStyle(0x2cf8ff, 0.028);
            this.lightSweep.fillTriangle(900, 310, 560, 700, 1240, 700);
            return;
          }
          if (roomId === QORTAL_LAND_PARK_ROOM_ID) {
            this.animateParkSearchlight(time);
            this.animateParkFountainAmbient(time);
            this.animateParkPortalAmbient(time);
            this.animateParkFireflies(time);
            const pulse = 0.5 + Math.sin(time / 360) * 0.5;
            this.lightSweep.fillStyle(0x78ff9a, 0.025 + pulse * 0.018);
            this.lightSweep.fillEllipse(1220, 560, 420, 120);
            this.lightSweep.fillStyle(0x2cf8ff, 0.022);
            this.lightSweep.fillTriangle(1388, 92, 1040, 704, 1420, 704);
            this.lightSweep.fillStyle(0xff2bd6, 0.018);
            this.lightSweep.fillEllipse(520, 470, 360, 70);
            return;
          }
          // Disco lighting belongs to the PNG room as well as the optional
          // procedural shell. Keep the animated lights when that legacy shell
          // is hidden.
          const layout = roomLayoutForRoom(QORTAL_LAND_DEFAULT_ROOM_ID);
          const sweepX = 260 + ((time / 18) % 1280);
          const pulse = 0.5 + Math.sin(time / 180) * 0.5;
          this.lightSweep.fillStyle(0x2cf8ff, 0.04);
          this.lightSweep.fillTriangle(
            sweepX - 90,
            90,
            sweepX + 60,
            layout.floor.bottomY,
            sweepX + 210,
            layout.floor.bottomY
          );
          this.lightSweep.fillStyle(0xff2bd6, 0.035);
          this.lightSweep.fillTriangle(
            layout.width - sweepX + 90,
            95,
            layout.width - sweepX - 90,
            layout.floor.bottomY,
            layout.width - sweepX - 260,
            layout.floor.bottomY
          );
          this.lightSweep.fillStyle(0xff2bd6, 0.04 + pulse * 0.035);
          this.lightSweep.fillEllipse(
            layout.width / 2,
            540,
            620 + pulse * 40,
            190 + pulse * 22
          );
          this.lightSweep.fillStyle(0x2cf8ff, 0.055);
          for (let index = 0; index < 5; index += 1) {
            const angle = time / 520 + index * 0.9;
            const x = layout.width / 2 + Math.cos(angle) * 330;
            const y = 520 + Math.sin(angle * 1.3) * 82;
            this.lightSweep.fillCircle(x, y, 12 + pulse * 8);
          }
        }

        private drawParkSearchlightBand(
          g: any,
          originX: number,
          originY: number,
          topX: number,
          topY: number,
          originWidth: number,
          topWidth: number,
          alpha: number
        ) {
          const dx = topX - originX;
          const dy = topY - originY;
          const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const normalX = -dy / length;
          const normalY = dx / length;
          const originHalfWidth = originWidth / 2;
          const topHalfWidth = topWidth / 2;
          g.fillStyle(0xbefbff, alpha);
          g.fillPoints(
            [
              new Phaser.Geom.Point(
                originX - normalX * originHalfWidth,
                originY - normalY * originHalfWidth
              ),
              new Phaser.Geom.Point(
                originX + normalX * originHalfWidth,
                originY + normalY * originHalfWidth
              ),
              new Phaser.Geom.Point(
                topX + normalX * topHalfWidth,
                topY + normalY * topHalfWidth
              ),
              new Phaser.Geom.Point(
                topX - normalX * topHalfWidth,
                topY - normalY * topHalfWidth
              ),
            ],
            true
          );
        }

        private animateParkSearchlight(time: number) {
          if (!this.parkSearchlight) return;
          this.parkSearchlight.clear();
          if (currentRoomRef.current !== QORTAL_LAND_PARK_ROOM_ID) return;
          const cycleMs = 25000;
          const activeMs = 11000;
          const sweepMs = 4700;
          const phase = time % cycleMs;
          const range = roomFloorRange(QORTAL_LAND_PARK_ROOM_ID);
          if (phase > activeMs) return;
          const fadeIn = Phaser.Math.Clamp(phase / 900, 0, 1);
          const fadeOut = Phaser.Math.Clamp((activeMs - phase) / 1300, 0, 1);
          const visibility = Math.min(fadeIn, fadeOut);
          const sweepProgress =
            phase <= sweepMs
              ? phase / sweepMs
              : phase <= sweepMs * 2
                ? 1 - (phase - sweepMs) / sweepMs
                : 0;
          const easedSweep = Phaser.Math.Easing.Sine.InOut(
            Phaser.Math.Clamp(sweepProgress, 0, 1)
          );
          const originX = 930;
          const originY = range.top + 72;
          const topX = Phaser.Math.Linear(690, 1160, easedSweep);
          const topY = -150;
          this.drawParkSearchlightBand(
            this.parkSearchlight,
            originX,
            originY,
            topX,
            topY,
            10,
            48,
            0.012 * visibility
          );
          this.drawParkSearchlightBand(
            this.parkSearchlight,
            originX,
            originY,
            topX,
            topY,
            5,
            22,
            0.034 * visibility
          );
          this.drawParkSearchlightBand(
            this.parkSearchlight,
            originX,
            originY,
            topX,
            topY,
            1.5,
            5,
            0.105 * visibility
          );
        }

        private animateParkFireflies(time: number) {
          if (!this.parkFireflies) return;
          this.parkFireflies.clear();
          if (currentRoomRef.current !== QORTAL_LAND_PARK_ROOM_ID) return;

          const fireflySpecs = [
            {
              x: 182,
              y: 486,
              rx: 36,
              ry: 44,
              phase: 0,
              cycle: 7600,
              color: 0xffe28a,
            },
            {
              x: 235,
              y: 570,
              rx: 42,
              ry: 34,
              phase: 2100,
              cycle: 9200,
              color: 0x95f7ff,
            },
            {
              x: 352,
              y: 304,
              rx: 38,
              ry: 28,
              phase: 3900,
              cycle: 8800,
              color: 0xffd782,
            },
            {
              x: 1468,
              y: 338,
              rx: 48,
              ry: 30,
              phase: 1100,
              cycle: 8400,
              color: 0x8ffaff,
            },
            {
              x: 1588,
              y: 472,
              rx: 38,
              ry: 42,
              phase: 5400,
              cycle: 9800,
              color: 0xffe6a0,
            },
            {
              x: 1484,
              y: 592,
              rx: 44,
              ry: 28,
              phase: 2800,
              cycle: 7900,
              color: 0x93faff,
            },
            {
              x: 826,
              y: 304,
              rx: 54,
              ry: 24,
              phase: 6600,
              cycle: 11000,
              color: 0xffe08c,
            },
            {
              x: 1218,
              y: 374,
              rx: 58,
              ry: 22,
              phase: 4700,
              cycle: 10500,
              color: 0x8ef8ff,
            },
          ];

          for (let index = 0; index < fireflySpecs.length; index += 1) {
            const spec = fireflySpecs[index];
            const local = ((time + spec.phase) % spec.cycle) / spec.cycle;
            if (local > 0.54) continue;
            const life = Math.sin((local / 0.54) * Math.PI);
            const twinkle = 0.65 + Math.sin(time / 360 + index * 1.7) * 0.35;
            const alpha = life * twinkle * 0.62;
            if (alpha <= 0.03) continue;
            const driftA = time / (1500 + index * 110) + index * 1.21;
            const driftB = time / (2200 + index * 160) + index * 0.77;
            const x =
              spec.x +
              Math.cos(driftA) * spec.rx +
              Math.sin(driftB) * spec.rx * 0.18;
            const y =
              spec.y +
              Math.sin(driftB) * spec.ry +
              Math.cos(driftA * 0.7) * spec.ry * 0.16;
            const radius = 1.2 + life * 0.9;

            this.parkFireflies.fillStyle(spec.color, alpha * 0.14);
            this.parkFireflies.fillCircle(x, y, radius * 5.2);
            this.parkFireflies.fillStyle(spec.color, alpha * 0.32);
            this.parkFireflies.fillCircle(x, y, radius * 2.3);
            this.parkFireflies.fillStyle(0xf4ffff, alpha);
            this.parkFireflies.fillCircle(x, y, radius);
          }
        }

        private animateParkPortalAmbient(time: number) {
          if (!this.parkPortalAmbient) return;
          this.parkPortalAmbient.clear();
          const door = this.parkPortalDoor;
          if (!door || currentRoomRef.current !== QORTAL_LAND_PARK_ROOM_ID)
            return;
          const openVisibility = Phaser.Math.Clamp(
            (door.progress - 0.08) / 0.5,
            0,
            1
          );
          if (openVisibility <= 0.001) return;
          const scaleX =
            (door.right - door.left) / QORTAL_LAND_PARK_PORTAL_SOURCE_WIDTH;
          const scaleY =
            (door.bottom - door.top) / QORTAL_LAND_PARK_PORTAL_SOURCE_HEIGHT;
          const innerLeft = door.left + 248 * scaleX;
          const innerRight = door.left + 506 * scaleX;
          const innerTop = door.top + 236 * scaleY;
          const innerBottom = door.top + 1004 * scaleY;
          const innerWidth = innerRight - innerLeft;
          const innerHeight = innerBottom - innerTop;

          for (let index = 0; index < 7; index += 1) {
            const sparkPhase = (time / (1700 + index * 190) + index * 0.21) % 1;
            const sparkAlpha =
              Math.sin(sparkPhase * Math.PI) * 0.34 * openVisibility;
            if (sparkAlpha <= 0.02) continue;
            const x =
              innerLeft +
              innerWidth * (0.32 + Math.sin(time / 1180 + index * 1.9) * 0.22);
            const y = Phaser.Math.Linear(
              innerBottom - innerHeight * 0.12,
              innerTop + innerHeight * 0.26,
              sparkPhase
            );
            const radius = 0.7 + sparkPhase * 0.85;
            this.parkPortalAmbient.fillStyle(0x8dfcff, sparkAlpha * 0.16);
            this.parkPortalAmbient.fillCircle(x, y, radius * 3.8);
            this.parkPortalAmbient.fillStyle(0xbefbff, sparkAlpha);
            this.parkPortalAmbient.fillCircle(x, y, radius);
          }
        }

        private animateParkFountainAmbient(time: number) {
          if (!this.parkFountainAmbient) return;
          this.parkFountainAmbient.clear();
          if (currentRoomRef.current !== QORTAL_LAND_PARK_ROOM_ID) return;
          const anchor = this.getParkFountainAmbientAnchor();
          if (!anchor) return;
          this.parkFountainAmbient.setDepth(anchor.depth);

          const rippleCycleMs = 3300;
          const visibleRippleWindow = 0.68;
          const maxRippleWidth = Math.max(
            88,
            anchor.sourceWidth * anchor.scaleX * 0.5
          );
          const maxRippleHeight = Math.max(
            18,
            anchor.sourceHeight * anchor.scaleY * 0.15
          );
          for (let index = 0; index < 3; index += 1) {
            const phase =
              ((time + index * (rippleCycleMs / 3)) % rippleCycleMs) /
              rippleCycleMs;
            if (phase > visibleRippleWindow) continue;
            const t = phase / visibleRippleWindow;
            const eased = Phaser.Math.Easing.Sine.Out(t);
            const alpha = 0.58 * (1 - eased);
            const width = Phaser.Math.Linear(22, maxRippleWidth, eased);
            const height = Phaser.Math.Linear(5, maxRippleHeight, eased);
            this.parkFountainAmbient.lineStyle(1.45, 0x8dfcff, alpha);
            this.parkFountainAmbient.strokeEllipse(
              anchor.centerX,
              anchor.centerY,
              width,
              height
            );
          }

          const pulse = 0.5 + Math.sin((time / 2100) * Math.PI * 2) * 0.5;
          const columnOpacity = 0.88 + pulse * 0.18;
          const columnHeight = Math.max(
            58,
            anchor.sourceHeight * anchor.scaleY * 0.52
          );
          this.parkFountainAmbient.lineStyle(
            2.2,
            0x9effff,
            0.13 * columnOpacity
          );
          this.parkFountainAmbient.lineBetween(
            anchor.centerX,
            anchor.centerY - columnHeight * 0.72,
            anchor.centerX,
            anchor.centerY + columnHeight * 0.08
          );
          this.parkFountainAmbient.lineStyle(
            1.15,
            0xd9ffff,
            0.16 * columnOpacity
          );
          this.parkFountainAmbient.lineBetween(
            anchor.centerX + 3,
            anchor.centerY - columnHeight * 0.52,
            anchor.centerX + 3,
            anchor.centerY - columnHeight * 0.04
          );

          const dropletCycleMs = 2300;
          const dropletTravel = Math.max(
            22,
            anchor.sourceHeight * anchor.scaleY * 0.16
          );
          for (let index = 0; index < 3; index += 1) {
            const phase =
              ((time + index * 760) % dropletCycleMs) / dropletCycleMs;
            if (phase > 0.42) continue;
            const t = phase / 0.42;
            const x =
              anchor.centerX +
              Math.sin(index * 1.7 + time / 1300) *
                Math.max(5, maxRippleWidth * 0.07);
            const y = anchor.centerY - 5 - dropletTravel * t;
            const alpha = 0.48 * (1 - Phaser.Math.Easing.Sine.In(t));
            this.parkFountainAmbient.fillStyle(0x8dfcff, alpha);
            this.parkFountainAmbient.fillCircle(x, y, 1.65 - t * 0.35);
          }
        }

        private drawChatBubble(background: any, width: number, height: number) {
          background.clear();
          background.fillStyle(0x070914, 0.88);
          background.fillRoundedRect(-width / 2, -height, width, height, 12);
          background.lineStyle(2, 0x2cf8ff, 0.68);
          background.strokeRoundedRect(-width / 2, -height, width, height, 12);
          background.fillStyle(0x070914, 0.88);
          background.fillTriangle(-9, 0, 9, 0, 0, 10);
          background.lineStyle(2, 0x2cf8ff, 0.42);
          background.lineBetween(-9, 0, 0, 10);
          background.lineBetween(9, 0, 0, 10);
        }

        private clearChatBubbleContent(bubbleObjects: { contentItems: any[] }) {
          bubbleObjects.contentItems.forEach((item) => {
            try {
              item.destroy();
            } catch {
              // Phaser may already have destroyed this as part of container cleanup.
            }
          });
          bubbleObjects.contentItems = [];
        }

        private rebuildChatBubbleContent(
          bubbleObjects: {
            container: any;
            background: any;
            contentItems: any[];
            signature: string;
            width: number;
            height: number;
            lineCount: number;
            popStarted: boolean;
          },
          text: string
        ) {
          this.clearChatBubbleContent(bubbleObjects);

          const maxContentWidth = 220;
          const lineHeight = 21;
          const spaceWidth = 4;
          const emojiSize = 18;
          const textStyle = {
            color: '#f8fbff',
            fontFamily: 'Inter, Arial, sans-serif',
            fontSize: '13px',
          };
          const lines: Array<{
            items: Array<{ item: any | null; width: number; yOffset: number }>;
            width: number;
          }> = [{ items: [], width: 0 }];
          let pendingSpace = false;

          const currentLine = () => lines[lines.length - 1];

          const startNewLine = () => {
            lines.push({ items: [], width: 0 });
            pendingSpace = false;
          };

          const addDisplayItem = (item: any, width: number, yOffset = 1) => {
            let line = currentLine();
            let gap = pendingSpace && line.width > 0 ? spaceWidth : 0;
            if (line.width > 0 && line.width + gap + width > maxContentWidth) {
              startNewLine();
              line = currentLine();
              gap = 0;
            }
            if (gap > 0) {
              line.items.push({ item: null, width: gap, yOffset: 0 });
              line.width += gap;
            }
            line.items.push({ item, width, yOffset });
            bubbleObjects.contentItems.push(item);
            bubbleObjects.container.add(item);
            pendingSpace = false;
            line.width += width;
          };

          splitLandChatEmojiText(text).forEach((part) => {
            if (part.type === 'emoji') {
              const textureKey = qortalLandChatEmojiTextureKey(part.emoji.key);
              if (this.textures.exists(textureKey)) {
                const emojiObject = this.add
                  .image(0, 0, textureKey)
                  .setOrigin(0, 0);
                const emojiFrame = this.textures.getFrame(textureKey);
                const sourceWidth = Number(emojiFrame?.width) || emojiSize;
                const sourceHeight = Number(emojiFrame?.height) || emojiSize;
                const emojiWidth = Math.max(
                  emojiSize,
                  Math.round(
                    (emojiSize * sourceWidth) / Math.max(1, sourceHeight)
                  )
                );
                emojiObject.setDisplaySize(emojiWidth, emojiSize);
                addDisplayItem(emojiObject, emojiWidth, 1);
                return;
              }
              const fallbackText = this.add
                .text(0, 0, part.shortcut, textStyle)
                .setOrigin(0, 0);
              addDisplayItem(fallbackText, Math.ceil(fallbackText.width), 2);
              return;
            }

            part.text.split(/(\s+)/).forEach((token) => {
              if (!token) return;
              if (/^\s+$/.test(token)) {
                pendingSpace = currentLine().width > 0;
                return;
              }
              const textObject = this.add
                .text(0, 0, token, textStyle)
                .setOrigin(0, 0);
              addDisplayItem(textObject, Math.ceil(textObject.width), 2);
            });
          });

          const usedLines = lines.filter((line) =>
            line.items.some((entry) => entry.item)
          );
          const lineCount = Math.max(1, usedLines.length);
          const contentWidth = Math.max(
            1,
            ...usedLines.map((line) => line.width)
          );
          const contentHeight = lineCount * lineHeight;
          const width = Math.min(
            250,
            Math.max(68, Math.ceil(contentWidth) + 28)
          );
          const height = Math.max(34, Math.ceil(contentHeight) + 18);
          const offsetY = -height + 9;
          usedLines.forEach((line, lineIndex) => {
            let cursorX = -line.width / 2;
            line.items.forEach((entry) => {
              if (entry.item) {
                entry.item.setPosition(
                  cursorX,
                  offsetY + lineIndex * lineHeight + entry.yOffset
                );
              }
              cursorX += entry.width;
            });
          });
          bubbleObjects.signature = text;
          bubbleObjects.width = width;
          bubbleObjects.height = height;
          bubbleObjects.lineCount = lineCount;
          this.drawChatBubble(bubbleObjects.background, width, height);
        }

        private createChatBubble(bubble: LandChatBubble) {
          const background = this.add.graphics();
          const container = this.add.container(0, 0, [background]);
          container.setDepth(9999);
          const bubbleObjects = {
            container,
            background,
            contentItems: [] as any[],
            signature: '',
            width: 78,
            height: 34,
            lineCount: 1,
            popStarted: false,
          };
          this.rebuildChatBubbleContent(bubbleObjects, bubble.text);
          return bubbleObjects;
        }

        private removeChatBubble(
          messageId: string,
          bubbleObjects = this.chatBubbles.get(messageId)
        ) {
          if (!bubbleObjects) return;
          this.chatBubbles.delete(messageId);
          try {
            if (typeof bubbleObjects.container?.removeAll === 'function') {
              bubbleObjects.container.removeAll(true);
            }
            if (bubbleObjects.container?.scene) {
              bubbleObjects.container.destroy();
            }
          } catch (error) {
            console.warn('[QortalLand] Failed to remove chat bubble', error);
          }
        }

        private updateChatBubbles() {
          const now = Date.now();
          for (const [
            messageId,
            bubble,
          ] of landChatBubblesRef.current.entries()) {
            if (bubble.expiresAt > now) continue;
            landChatBubblesRef.current.delete(messageId);
          }
          for (const [messageId, bubbleObjects] of this.chatBubbles.entries()) {
            if (landChatBubblesRef.current.has(messageId)) continue;
            this.removeChatBubble(messageId, bubbleObjects);
          }

          const bubbleGroups = new Map<
            string,
            Array<{
              messageId: string;
              bubble: LandChatBubble;
              bubbleObjects: {
                container: any;
                background: any;
                contentItems: any[];
                signature: string;
                width: number;
                height: number;
                lineCount: number;
                popStarted: boolean;
              };
              avatar: any;
            }>
          >();

          for (const [
            messageId,
            bubble,
          ] of landChatBubblesRef.current.entries()) {
            let avatar: any | undefined;
            const avatarKey = `${bubble.authorAddress}:${bubble.sessionId}`;
            if (
              bubble.authorAddress === myAddress &&
              bubble.sessionId === sessionId
            ) {
              avatar = this.localAvatar;
            } else {
              avatar = this.remotes.get(avatarKey);
              if (!avatar) {
                const authorAvatars = Array.from(this.remotes.entries())
                  .filter(([key]) => key.startsWith(`${bubble.authorAddress}:`))
                  .map(([, remoteAvatar]) => remoteAvatar);
                if (authorAvatars.length === 1) {
                  avatar = authorAvatars[0];
                }
              }
            }
            let bubbleObjects = this.chatBubbles.get(messageId);
            if (!bubbleObjects) {
              bubbleObjects = this.createChatBubble(bubble);
              this.chatBubbles.set(messageId, bubbleObjects);
            }
            if (!avatar) {
              bubbleObjects.container.setVisible(false);
              continue;
            }
            if (bubbleObjects.signature !== bubble.text) {
              this.rebuildChatBubbleContent(bubbleObjects, bubble.text);
            }
            const key =
              bubble.authorAddress === myAddress &&
              bubble.sessionId === sessionId
                ? 'local'
                : avatarKey;
            const group = bubbleGroups.get(key) || [];
            group.push({ messageId, bubble, bubbleObjects, avatar });
            bubbleGroups.set(key, group);
          }

          const visibleMessageIds = new Set<string>();
          const stackAlphas = [1, 0.7, 0.4, 0.2];
          for (const group of bubbleGroups.values()) {
            const newestFirst = group.sort(
              (a, b) => b.bubble.createdAt - a.bubble.createdAt
            );
            const visibleStack: typeof newestFirst = [];
            let remainingLineBudget = 4;

            for (const entry of newestFirst) {
              const lineCost = Math.max(
                1,
                Math.min(4, entry.bubbleObjects.lineCount || 1)
              );
              if (visibleStack.length > 0 && lineCost > remainingLineBudget)
                continue;
              visibleStack.push(entry);
              remainingLineBudget -= lineCost;
              if (visibleStack.length >= 4 || remainingLineBudget <= 0) break;
            }

            let tailY = 0;
            visibleStack.forEach((entry, stackIndex) => {
              const { avatar, bubble, bubbleObjects, messageId } = entry;
              visibleMessageIds.add(messageId);
              const remainingMs = bubble.expiresAt - now;
              const fadeAlpha = Math.max(0, Math.min(1, remainingMs / 2000));
              const ageMs = now - bubble.createdAt;
              const scale = Math.abs(avatar.scaleY || 1);
              if (stackIndex === 0) {
                tailY = avatar.y - LAND_CHARACTER_CHAT_BUBBLE_OFFSET * scale;
              } else {
                tailY -= visibleStack[stackIndex - 1].bubbleObjects.height + 8;
              }

              if (!bubbleObjects.popStarted) {
                bubbleObjects.popStarted = true;
                bubbleObjects.container.setScale(0.84);
                bubbleObjects.container.setPosition(avatar.x, tailY + 8);
              }

              const currentX = Number.isFinite(bubbleObjects.container.x)
                ? bubbleObjects.container.x
                : avatar.x;
              const currentY = Number.isFinite(bubbleObjects.container.y)
                ? bubbleObjects.container.y
                : tailY;
              bubbleObjects.container.setVisible(true);
              bubbleObjects.container.setPosition(
                Phaser.Math.Linear(currentX, avatar.x, 0.28),
                Phaser.Math.Linear(currentY, tailY, 0.28)
              );
              const popProgress = Math.max(0, Math.min(1, ageMs / 180));
              const targetScale = 0.84 + popProgress * 0.16;
              bubbleObjects.container.setScale(
                Phaser.Math.Linear(
                  bubbleObjects.container.scaleX || 1,
                  targetScale,
                  0.34
                )
              );
              bubbleObjects.container.setAlpha(
                (stackAlphas[stackIndex] || 0.16) * fadeAlpha
              );
              bubbleObjects.container.setDepth(
                avatar.depth + 120 + visibleStack.length - stackIndex
              );
            });
          }

          for (const [messageId, bubbleObjects] of this.chatBubbles.entries()) {
            if (visibleMessageIds.has(messageId)) continue;
            bubbleObjects.container.setVisible(false);
          }
        }

        private createLandActionAnimation(animation: LandActionAnimation) {
          const container = this.add.container(0, 0);
          const visual =
            animation.type === 'qort_received'
              ? {
                  color: 0xffd65c,
                  symbol: '◈',
                  particle: '●',
                  label: `+${formatQortAmount(animation.amount)} QORT`,
                }
              : animation.type === 'buzz'
                ? {
                    color: 0x67e8f9,
                    symbol: '⚡',
                    particle: 'ϟ',
                    label: 'BUZZ!',
                  }
                : animation.type === 'love'
                  ? {
                      color: 0xff6f9f,
                      symbol: '♥',
                      particle: '♥',
                      label: 'LOVE',
                    }
                  : animation.type === 'devil'
                    ? {
                        color: 0xff695e,
                        symbol: '😈',
                        particle: '▲',
                        label: 'DEVIL',
                      }
                    : animation.type === 'angel'
                      ? {
                          color: 0xffe48a,
                          symbol: '😇',
                          particle: '✦',
                          label: 'ANGEL',
                        }
                      : animation.type === 'rain'
                        ? {
                            color: 0x74b9ff,
                            symbol: '☁',
                            particle: '│',
                            label: 'RAIN',
                          }
                        : {
                            color: 0xffd45a,
                            symbol: '☀',
                            particle: '✦',
                            label: 'SUNSHINE',
                          };
          const isSelfMood =
            animation.type !== 'qort_received' &&
            animation.fromAddress === animation.toAddress &&
            animation.sourceSessionId === animation.targetSessionId;
          if (animation.type !== 'qort_received') {
            visual.label = isSelfMood
              ? ''
              : displayNameForAddress(
                  animation.fromAddress,
                  primaryNameCacheRef.current
                );
          }
          const aura = this.add.graphics();
          aura.fillStyle(visual.color, 0.15);
          aura.fillCircle(0, 0, animation.type === 'sunshine' ? 42 : 34);
          aura.lineStyle(2, visual.color, 0.55);
          aura.strokeCircle(0, 0, animation.type === 'angel' ? 29 : 25);
          if (animation.type === 'angel') {
            aura.lineStyle(3, 0xfff4bd, 0.82);
            aura.strokeEllipse(0, -25, 44, 12);
          }
          const symbol = this.add
            .text(0, -2, visual.symbol, {
              align: 'center',
              color: `#${visual.color.toString(16).padStart(6, '0')}`,
              fontFamily: 'Arial, sans-serif',
              fontSize: animation.type === 'qort_received' ? '28px' : '34px',
              fontStyle: 'bold',
              stroke: '#07101f',
              strokeThickness: 4,
            })
            .setOrigin(0.5);
          const text = this.add
            .text(
              0,
              animation.type === 'qort_received' ? 35 : -52,
              visual.label,
              {
                align: 'center',
                backgroundColor: 'rgba(4, 10, 23, 0.78)',
                color: '#ffffff',
                fontFamily: 'Inter, Arial, sans-serif',
                fontSize: animation.type === 'qort_received' ? '15px' : '12px',
                fontStyle: 'bold',
                padding: { x: 7, y: 3 },
                stroke: '#07101f',
                strokeThickness: 2,
              }
            )
            .setOrigin(0.5)
            .setVisible(Boolean(visual.label));
          const reducedMotion =
            window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ===
            true;
          const particles = Array.from(
            { length: reducedMotion ? 4 : 8 },
            (_, index) => {
              const particle = this.add
                .text(0, 0, visual.particle, {
                  color: `#${visual.color.toString(16).padStart(6, '0')}`,
                  fontFamily: 'Arial, sans-serif',
                  fontSize: `${10 + (index % 3) * 2}px`,
                  fontStyle: 'bold',
                  stroke: '#07101f',
                  strokeThickness: 2,
                })
                .setOrigin(0.5);
              return particle;
            }
          );
          container.add([aura, ...particles, symbol, text]);
          container.setDepth(12000);
          return { container, aura, particles, symbol, text };
        }

        private removeActionAnimation(
          actionId: string,
          animationObjects = this.actionAnimations.get(actionId)
        ) {
          if (!animationObjects) return;
          this.actionAnimations.delete(actionId);
          try {
            if (typeof animationObjects.container?.removeAll === 'function') {
              animationObjects.container.removeAll(true);
            }
            if (animationObjects.container?.scene) {
              animationObjects.container.destroy();
            }
          } catch (error) {
            console.warn(
              '[QortalLand] Failed to remove action animation',
              error
            );
          }
        }

        private updateActionAnimations() {
          const now = Date.now();
          for (const [
            actionId,
            animation,
          ] of landActionAnimationsRef.current.entries()) {
            if (animation.expiresAt > now) continue;
            landActionAnimationsRef.current.delete(actionId);
          }
          for (const [
            actionId,
            animationObjects,
          ] of this.actionAnimations.entries()) {
            if (landActionAnimationsRef.current.has(actionId)) continue;
            this.removeActionAnimation(actionId, animationObjects);
          }
          for (const [
            actionId,
            animation,
          ] of landActionAnimationsRef.current.entries()) {
            let avatar: any | undefined;
            if (
              animation.toAddress === myAddress &&
              animation.targetSessionId === sessionId
            ) {
              avatar = this.localAvatar;
            } else {
              avatar = this.remotes.get(
                `${animation.toAddress}:${animation.targetSessionId}`
              );
            }
            let animationObjects = this.actionAnimations.get(actionId);
            if (!animationObjects) {
              animationObjects = this.createLandActionAnimation(animation);
              this.actionAnimations.set(actionId, animationObjects);
            }
            if (
              !avatar ||
              (animation.roomId && animation.roomId !== currentRoomRef.current)
            ) {
              animationObjects.container.setVisible(false);
              continue;
            }
            const ageMs = now - animation.createdAt;
            const progress = Phaser.Math.Clamp(
              ageMs / LAND_ACTION_ANIMATION_TTL_MS,
              0,
              1
            );
            const fadeAlpha =
              progress > 0.76
                ? Phaser.Math.Clamp((1 - progress) / 0.24, 0, 1)
                : 1;
            const scale = Math.abs(avatar.scaleY || 1);
            const reducedMotion =
              window.matchMedia?.('(prefers-reduced-motion: reduce)')
                .matches === true;
            const rise = reducedMotion
              ? 16
              : 12 + Math.sin(progress * Math.PI) * 12;
            const seed =
              [...animation.actionId].reduce(
                (sum, char) => sum + char.charCodeAt(0),
                0
              ) % 360;
            animationObjects.container.setVisible(true);
            animationObjects.container.setAlpha(fadeAlpha);
            animationObjects.container.setPosition(
              avatar.x,
              avatar.y - LAND_CHARACTER_CHAT_BUBBLE_OFFSET * scale - rise
            );
            animationObjects.container.setDepth(avatar.depth + 180);
            const pulse = reducedMotion
              ? 1
              : 1 + Math.sin(progress * Math.PI * 5) * 0.08;
            animationObjects.symbol.setScale(pulse);
            animationObjects.aura.setScale(
              1 + Math.sin(progress * Math.PI) * 0.24
            );
            animationObjects.aura.setRotation(
              animation.type === 'sunshine' ? progress * Math.PI : 0
            );
            if (animation.type === 'buzz' && !reducedMotion) {
              animationObjects.container.x +=
                Math.sin(progress * Math.PI * 34) * 4;
            }
            animationObjects.particles.forEach((particle, index) => {
              const offset = (seed + index * 47) * (Math.PI / 180);
              if (animation.type === 'rain') {
                particle.setPosition(
                  -30 + index * 9,
                  -20 + ((progress * 150 + index * 17) % 82)
                );
              } else if (
                animation.type === 'love' ||
                animation.type === 'devil'
              ) {
                particle.setPosition(
                  Math.sin(offset + progress * Math.PI * 4) * (18 + index * 3),
                  24 - ((progress * 100 + index * 13) % 78)
                );
              } else {
                const angle =
                  offset +
                  progress * Math.PI * (animation.type === 'buzz' ? 5 : 2.4);
                const radius =
                  24 + index * 3 + Math.sin(progress * Math.PI) * 14;
                particle.setPosition(
                  Math.cos(angle) * radius,
                  Math.sin(angle) * radius * 0.68
                );
              }
              particle.setAlpha(fadeAlpha * (0.62 + (index % 3) * 0.16));
            });
          }
        }

        private createCallIndicator() {
          const container = this.add.container(0, 0);
          const badge = this.add.graphics();
          badge.fillStyle(0x020714, 0.82);
          badge.fillCircle(0, 0, 20);
          badge.fillStyle(0x2cf8ff, 0.95);
          badge.fillCircle(0, 0, 15);
          badge.lineStyle(2, 0xf8fbff, 0.86);
          badge.strokeCircle(0, 0, 15);
          badge.lineStyle(2, 0x2cf8ff, 0.28);
          badge.strokeCircle(0, 0, 22);
          const phone = this.add
            .text(0, -1, '☎', {
              align: 'center',
              color: '#06101d',
              fontFamily: 'Arial, sans-serif',
              fontSize: '20px',
              fontStyle: 'bold',
            })
            .setOrigin(0.5);
          container.add([badge, phone]);
          container.setDepth(13000);
          return { container, badge, phone };
        }

        private createProximityVoiceIndicator() {
          const container = this.add.container(0, 0);
          const glyph = this.add.graphics();
          const tooltip = this.add.container(24, -38).setVisible(false);
          const tooltipBackground = this.add.graphics();
          tooltipBackground.fillStyle(0x111827, 0.98);
          tooltipBackground.lineStyle(1, 0x566176, 0.9);
          tooltipBackground.fillRoundedRect(0, 0, 148, 34, 7);
          tooltipBackground.strokeRoundedRect(0, 0, 148, 34, 7);
          const tooltipTitle = this.add.text(12, 9, 'Proximity Voice On', {
            color: '#f5f8fd',
            fontFamily: 'Inter, Arial, sans-serif',
            fontSize: '12px',
            fontStyle: 'bold',
          });
          tooltip.add([tooltipBackground, tooltipTitle]);
          container.add([glyph, tooltip]);
          container.setSize(48, 48);
          container.setInteractive(
            new Phaser.Geom.Circle(0, 0, 24),
            Phaser.Geom.Circle.Contains
          );
          container.input.cursor = 'pointer';
          container.on('pointerover', () => tooltip.setVisible(true));
          container.on('pointerout', () => tooltip.setVisible(false));
          container.on(
            'pointerdown',
            (_pointer: any, _x: number, _y: number, event: any) => {
              event?.stopPropagation?.();
              setProximityVoicePanelTarget(
                String(container.getData('voiceAddress') || '')
              );
              proximityVoicePanelRequestRef.current += 1;
              setProximityVoicePanelRequest(
                proximityVoicePanelRequestRef.current
              );
            }
          );
          container.setDepth(12950);
          return {
            container,
            glyph,
            tooltip,
            tooltipBackground,
            tooltipTitle,
          };
        }

        private updateProximityVoiceIndicators() {
          const active = new Map<
            string,
            {
              address: string;
              avatar: any;
              label: any;
              muted: boolean;
              speaking: boolean;
            }
          >();
          if (this.localAvatar && localStateRef.current.voiceEnabled) {
            active.set(`local:${myAddress}`, {
              address: myAddress,
              avatar: this.localAvatar,
              label: this.localLabel,
              muted: localStateRef.current.voiceMuted,
              speaking:
                !localStateRef.current.voiceMuted &&
                proximitySpeakingAddressesRef.current.has(myAddress),
            });
          }
          for (const [key, player] of remotePlayersRef.current.entries()) {
            const avatar = this.remotes.get(key);
            if (
              avatar &&
              player.roomId === currentRoomRef.current &&
              player.voiceEnabled
            ) {
              active.set(`remote:${key}`, {
                address: player.authorAddress,
                avatar,
                label: this.remoteLabels.get(key),
                muted: player.voiceMuted,
                speaking:
                  !player.voiceMuted &&
                  proximitySpeakingAddressesRef.current.has(
                    player.authorAddress
                  ),
              });
            }
          }
          for (const [
            key,
            indicator,
          ] of this.proximityVoiceIndicators.entries()) {
            if (active.has(key)) continue;
            this.proximityVoiceIndicators.delete(key);
            indicator.container?.destroy(true);
          }
          for (const [key, voice] of active.entries()) {
            let indicator = this.proximityVoiceIndicators.get(key);
            if (!indicator) {
              indicator = this.createProximityVoiceIndicator();
              this.proximityVoiceIndicators.set(key, indicator);
            }
            const { address, avatar, label, muted, speaking } = voice;
            indicator.container.setData('voiceAddress', address);
            const scale = Math.abs(avatar.scaleY || 1);
            const reduceMotion =
              window.matchMedia?.('(prefers-reduced-motion: reduce)')
                .matches === true;
            const indicatorScale = Math.max(0.72, Math.min(1, scale));
            const labelWidth = Number(label?.width) || 42;
            indicator.container.setPosition(
              (label?.x ?? avatar.x) - labelWidth / 2 - 18,
              label?.y ?? avatar.y - LAND_CHARACTER_LABEL_OFFSET * scale
            );
            indicator.container.setScale(indicatorScale);
            indicator.tooltip.setScale(1 / indicatorScale);
            indicator.container.setDepth((label?.depth ?? avatar.depth) + 10);
            indicator.glyph.clear();
            const color = muted ? 0x8b96a8 : speaking ? 0x4dffb8 : 0x2cf8ff;
            const pulse =
              speaking && !reduceMotion
                ? 0.5 + ((Math.sin(this.time.now / 150) + 1) / 2) * 0.5
                : 0.55;
            indicator.glyph.fillStyle(0x03101c, 0.92);
            indicator.glyph.fillCircle(0, 0, 15);
            indicator.glyph.lineStyle(1.5, color, muted ? 0.55 : 0.92);
            indicator.glyph.strokeCircle(0, 0, 14);
            indicator.glyph.lineStyle(2, color, 0.95);
            if (muted) {
              indicator.glyph.strokeRoundedRect(-3.5, -7, 7, 12, 4);
              indicator.glyph.lineBetween(-8, -8, 8, 8);
            } else {
              indicator.glyph.strokeRoundedRect(-3.5, -7, 7, 12, 4);
              indicator.glyph.beginPath();
              indicator.glyph.arc(0, 1, 8, 0.18, Math.PI - 0.18, false);
              indicator.glyph.strokePath();
              indicator.glyph.lineBetween(0, 9, 0, 12);
              indicator.glyph.lineBetween(-5, 12, 5, 12);
              if (speaking) {
                indicator.glyph.lineStyle(1.4, color, pulse);
                indicator.glyph.strokeCircle(0, 0, 18);
                indicator.glyph.lineStyle(1.2, color, pulse * 0.55);
                indicator.glyph.strokeCircle(0, 0, 22);
              }
            }
            indicator.tooltipTitle.setText(
              muted ? 'Proximity Voice Muted' : 'Proximity Voice On'
            );
          }
        }

        private removeCallIndicator(
          indicatorKey: string,
          indicatorObjects = this.callIndicators.get(indicatorKey)
        ) {
          if (!indicatorObjects) return;
          this.callIndicators.delete(indicatorKey);
          try {
            if (typeof indicatorObjects.container?.removeAll === 'function') {
              indicatorObjects.container.removeAll(true);
            }
            if (indicatorObjects.container?.scene) {
              indicatorObjects.container.destroy();
            }
          } catch (error) {
            console.warn('[QortalLand] Failed to remove call indicator', error);
          }
        }

        private updateCallIndicators() {
          const now = Date.now();
          for (const [
            address,
            presence,
          ] of landCallPresenceRef.current.entries()) {
            if (presence.expiresAt > now) continue;
            landCallPresenceRef.current.delete(address);
          }

          const activeIndicators = new Map<
            string,
            { avatar: any; roomId: LandRoomId }
          >();
          const localPresence = landCallPresenceRef.current.get(myAddress);
          if (
            this.localAvatar &&
            localPresence &&
            localPresence.expiresAt > now &&
            localPresence.roomId === currentRoomRef.current
          ) {
            activeIndicators.set(`local:${myAddress}`, {
              avatar: this.localAvatar,
              roomId: localPresence.roomId,
            });
          }

          for (const [key, player] of remotePlayersRef.current.entries()) {
            const presence = landCallPresenceRef.current.get(
              player.authorAddress
            );
            const avatar = this.remotes.get(key);
            if (
              !presence ||
              presence.expiresAt <= now ||
              presence.roomId !== currentRoomRef.current ||
              player.roomId !== currentRoomRef.current ||
              !avatar
            ) {
              continue;
            }
            activeIndicators.set(`remote:${key}`, {
              avatar,
              roomId: presence.roomId,
            });
          }

          for (const [
            indicatorKey,
            indicatorObjects,
          ] of this.callIndicators.entries()) {
            if (activeIndicators.has(indicatorKey)) continue;
            this.removeCallIndicator(indicatorKey, indicatorObjects);
          }

          for (const [indicatorKey, { avatar }] of activeIndicators.entries()) {
            let indicatorObjects = this.callIndicators.get(indicatorKey);
            if (!indicatorObjects) {
              indicatorObjects = this.createCallIndicator();
              this.callIndicators.set(indicatorKey, indicatorObjects);
            }
            const scale = Math.abs(avatar.scaleY || 1);
            indicatorObjects.container.setVisible(true);
            indicatorObjects.container.setPosition(
              avatar.x + 36 * scale,
              avatar.y - (LAND_CHARACTER_LABEL_OFFSET + 28) * scale
            );
            indicatorObjects.container.setScale(
              Math.max(0.78, Math.min(1.04, scale * 0.9))
            );
            indicatorObjects.container.setAlpha(
              0.9 + Math.sin(this.time.now / 260) * 0.08
            );
            indicatorObjects.container.setDepth(avatar.depth + 220);
          }
        }

        private createGameIndicator() {
          const container = this.add.container(0, 0);
          const badge = this.add.graphics();
          badge.fillStyle(0x020714, 0.82);
          badge.fillCircle(0, 0, 20);
          badge.fillStyle(0x9d6cff, 0.95);
          badge.fillCircle(0, 0, 15);
          badge.lineStyle(2, 0xf8fbff, 0.86);
          badge.strokeCircle(0, 0, 15);
          badge.lineStyle(2, 0x9d6cff, 0.3);
          badge.strokeCircle(0, 0, 22);
          const gamepad = this.add
            .text(0, -1, '🎮', {
              align: 'center',
              color: '#ffffff',
              fontFamily: 'Arial, sans-serif',
              fontSize: '17px',
            })
            .setOrigin(0.5);
          container.add([badge, gamepad]);
          container.setDepth(13000);
          return { container, badge, gamepad };
        }

        private removeGameIndicator(
          indicatorKey: string,
          indicatorObjects = this.gameIndicators.get(indicatorKey)
        ) {
          if (!indicatorObjects) return;
          this.gameIndicators.delete(indicatorKey);
          try {
            if (typeof indicatorObjects.container?.removeAll === 'function') {
              indicatorObjects.container.removeAll(true);
            }
            if (indicatorObjects.container?.scene) {
              indicatorObjects.container.destroy();
            }
          } catch (error) {
            console.warn('[QortalLand] Failed to remove game indicator', error);
          }
        }

        private updateGameIndicators() {
          const now = Date.now();
          for (const [
            address,
            presence,
          ] of landGamePresenceRef.current.entries()) {
            if (presence.expiresAt > now) continue;
            landGamePresenceRef.current.delete(address);
          }

          const activeIndicators = new Map<string, { avatar: any }>();
          const localPresence = landGamePresenceRef.current.get(myAddress);
          if (
            this.localAvatar &&
            localPresence &&
            localPresence.expiresAt > now &&
            localPresence.roomId === currentRoomRef.current
          ) {
            activeIndicators.set(`local:${myAddress}`, {
              avatar: this.localAvatar,
            });
          }

          for (const [key, player] of remotePlayersRef.current.entries()) {
            const presence = landGamePresenceRef.current.get(
              player.authorAddress
            );
            const avatar = this.remotes.get(key);
            if (
              !presence ||
              presence.expiresAt <= now ||
              presence.roomId !== currentRoomRef.current ||
              player.roomId !== currentRoomRef.current ||
              !avatar
            ) {
              continue;
            }
            activeIndicators.set(`remote:${key}`, { avatar });
          }

          for (const [
            indicatorKey,
            indicatorObjects,
          ] of this.gameIndicators.entries()) {
            if (activeIndicators.has(indicatorKey)) continue;
            this.removeGameIndicator(indicatorKey, indicatorObjects);
          }

          for (const [indicatorKey, { avatar }] of activeIndicators.entries()) {
            let indicatorObjects = this.gameIndicators.get(indicatorKey);
            if (!indicatorObjects) {
              indicatorObjects = this.createGameIndicator();
              this.gameIndicators.set(indicatorKey, indicatorObjects);
            }
            const scale = Math.abs(avatar.scaleY || 1);
            indicatorObjects.container.setVisible(true);
            indicatorObjects.container.setPosition(
              avatar.x + 36 * scale,
              avatar.y - (LAND_CHARACTER_LABEL_OFFSET + 28) * scale
            );
            indicatorObjects.container.setScale(
              Math.max(0.78, Math.min(1.04, scale * 0.9))
            );
            indicatorObjects.container.setAlpha(
              0.9 + Math.sin(this.time.now / 260) * 0.08
            );
            indicatorObjects.container.setDepth(avatar.depth + 220);
          }
        }

        private createAvailabilityLabel() {
          return this.add
            .text(0, 0, '', {
              backgroundColor: '#222832',
              color: '#f8fbff',
              fontFamily: 'Inter, Arial, sans-serif',
              fontSize: '9px',
              fontStyle: 'bold',
              padding: { x: 4, y: 2 },
            })
            .setOrigin(0.5)
            .setVisible(false);
        }

        private updateAvailabilityLabel(
          label: any,
          afk: boolean,
          dnd: boolean,
          x: number,
          y: number,
          depth: number
        ) {
          if (!label) return;
          const text =
            afk && dnd ? 'AFK · DND' : dnd ? 'DND' : afk ? 'AFK' : '';
          label
            .setText(text)
            .setPosition(x, y)
            .setDepth(depth)
            .setVisible(Boolean(text));
          if (text) {
            label.setBackgroundColor(dnd ? '#71333c' : '#605126');
          }
        }

        private updateLocalPlayer(delta: number) {
          if (!this.localAvatar) return;
          if (this.pendingRoomTransition) {
            movementKeysRef.current.clear();
            this.animateAvatar(
              this.localAvatar,
              false,
              localStateRef.current.direction,
              localStateRef.current.skinId
            );
            localStateRef.current = {
              ...localStateRef.current,
              movement: 'idle',
            };
            return;
          }
          const step = (190 * delta) / 1000;
          const pressedKeys = movementKeysRef.current;
          const left = pressedKeys.has('arrowleft') || pressedKeys.has('a');
          const right = pressedKeys.has('arrowright') || pressedKeys.has('d');
          const up = pressedKeys.has('arrowup') || pressedKeys.has('w');
          const down = pressedKeys.has('arrowdown') || pressedKeys.has('s');
          let x = Number(this.localAvatar.getData('logicalX'));
          let y = Number(this.localAvatar.getData('logicalY'));
          if (!Number.isFinite(x)) x = localStateRef.current.x;
          if (!Number.isFinite(y)) y = localStateRef.current.y;
          const previousX = x;
          const previousY = y;
          let direction = localStateRef.current.direction;
          if (left) {
            x -= step;
            direction = 'l';
          }
          if (right) {
            x += step;
            direction = 'r';
          }
          if (up) {
            y -= step;
          }
          if (down) {
            y += step;
          }
          if (!left && !right) {
            if (up) {
              direction = 'u';
            } else if (down) {
              direction = 'd';
            }
          }
          let roomId = currentRoomRef.current;
          const desiredX = x;
          const desiredY = y;
          ({ x, y } = clampLandPosition(roomId, x, y));
          if (roomId === QORTAL_LAND_DEFAULT_ROOM_ID) {
            ({ x, y } = this.extendClubSkywalkDoorWalkThrough(
              desiredX,
              desiredY,
              x,
              y
            ));
          }
          ({ x, y } = resolveQortalLandPropCollisions(
            roomId,
            previousX,
            previousY,
            x,
            y
          ));
          const transition = this.getRoomTransition(roomId, x, y);
          if (transition) {
            this.requestRoomTransition(transition);
            if (this.pendingRoomTransition) {
              x = previousX;
              y = previousY;
            } else {
              roomId = transition.roomId;
              x = transition.x;
              y = transition.y;
              direction = transition.direction;
            }
          }
          const moving = Boolean(left || right || up || down);
          if (
            Math.abs(x - previousX) >= 0.25 ||
            Math.abs(y - previousY) >= 0.25 ||
            roomId !== currentRoomRef.current
          ) {
            recordLandActivityRef.current();
          }
          const scale = characterScaleForRoomY(roomId, y);
          const localLabelText = displayNameForAddress(
            myAddress,
            primaryNameCacheRef.current
          );
          if (this.localLabel?.text !== localLabelText) {
            this.localLabel?.setText(localLabelText);
          }
          const renderY = qortalLandAvatarRenderY(roomId, x, y);
          this.localAvatar.setData('logicalX', x);
          this.localAvatar.setData('logicalY', y);
          this.localAvatar.setPosition(x, renderY);
          this.localAvatar.setScale(
            avatarScaleXForDirection(direction, scale),
            scale
          );
          this.animateAvatar(
            this.localAvatar,
            moving,
            direction,
            localStateRef.current.skinId
          );
          this.localLabel?.setPosition(
            x,
            renderY - LAND_CHARACTER_LABEL_OFFSET * scale
          );
          this.localAvatar.setDepth(y + 20);
          this.localLabel?.setDepth(y + 90);
          this.updateAvailabilityLabel(
            this.localAvailabilityLabel,
            localStateRef.current.afk,
            localStateRef.current.dnd,
            x,
            renderY -
              (LAND_CHARACTER_LABEL_OFFSET +
                LAND_CHARACTER_AVAILABILITY_OFFSET) *
                scale,
            y + 91
          );
          localStateRef.current = {
            ...localStateRef.current,
            roomId,
            x,
            y,
            direction,
            movement: moving ? 'walk' : 'idle',
          };
        }

        private extendClubSkywalkDoorWalkThrough(
          desiredX: number,
          desiredY: number,
          clampedX: number,
          clampedY: number
        ): { x: number; y: number } {
          const door = this.clubSkywalkDoor;
          if (
            !door ||
            door.progress < QORTAL_LAND_CLUB_SKYWALK_DOOR_OPEN_THRESHOLD
          ) {
            return { x: clampedX, y: clampedY };
          }
          if (
            desiredY < door.passMinY ||
            desiredY > door.passMaxY ||
            desiredX <= clampedX
          ) {
            return { x: clampedX, y: clampedY };
          }
          return {
            x: Math.min(Math.max(clampedX, desiredX), door.passMaxX),
            y: clampedY,
          };
        }

        private getRoomTransition(
          roomId: LandRoomId,
          x: number,
          y: number
        ): {
          roomId: LandRoomId;
          x: number;
          y: number;
          direction: string;
        } | null {
          const clubLayout = roomLayoutForRoom(QORTAL_LAND_DEFAULT_ROOM_ID);
          const clubToSkywalk = clubLayout.transitions?.clubToSkywalk;
          if (
            roomId === QORTAL_LAND_DEFAULT_ROOM_ID &&
            clubToSkywalk &&
            this.isAtClubSkywalkDoorPassage(x, y)
          ) {
            return this.getParkPortalReturnTarget();
          }
          if (
            roomId === QORTAL_LAND_PARK_ROOM_ID &&
            this.isAtParkPortalPassage(x, y)
          ) {
            return this.getClubSkywalkDoorReturnTarget();
          }
          return null;
        }

        private isAtClubSkywalkDoorPassage(x: number, y: number): boolean {
          const doorProgress = this.clubSkywalkDoor?.progress ?? 0;
          if (doorProgress < QORTAL_LAND_CLUB_SKYWALK_DOOR_OPEN_THRESHOLD)
            return false;
          const passage = this.clubSkywalkDoor
            ? {
                passMinX: this.clubSkywalkDoor.passMinX,
                passMinY: this.clubSkywalkDoor.passMinY,
                passMaxY: this.clubSkywalkDoor.passMaxY,
              }
            : qortalLandClubSkywalkDoorHotspot();
          return (
            x >= passage.passMinX &&
            y >= passage.passMinY &&
            y <= passage.passMaxY
          );
        }

        private getClubSkywalkDoorReturnTarget(): QortalLandRoomTransitionTarget {
          const hotspot = qortalLandClubSkywalkDoorHotspot();
          return {
            roomId: QORTAL_LAND_DEFAULT_ROOM_ID,
            x: hotspot.returnX,
            y: hotspot.returnY,
            direction: 'l',
          };
        }

        private isAtParkPortalPassage(x: number, y: number): boolean {
          const doorProgress = this.parkPortalDoor?.progress ?? 0;
          if (doorProgress < QORTAL_LAND_PARK_PORTAL_OPEN_THRESHOLD)
            return false;
          const passage = this.parkPortalDoor
            ? {
                passMinX: this.parkPortalDoor.passMinX,
                passMaxX: this.parkPortalDoor.passMaxX,
                passMinY: this.parkPortalDoor.passMinY,
                passMaxY: this.parkPortalDoor.passMaxY,
              }
            : qortalLandParkPortalHotspot();
          return (
            x >= passage.passMinX &&
            x <= passage.passMaxX &&
            y >= passage.passMinY &&
            y <= passage.passMaxY
          );
        }

        private getParkPortalReturnTarget(): QortalLandRoomTransitionTarget {
          const hotspot = qortalLandParkPortalHotspot();
          return {
            roomId: QORTAL_LAND_PARK_ROOM_ID,
            x: hotspot.returnX,
            y: hotspot.returnY,
            direction: 'd',
          };
        }

        private updateRemotePlayers() {
          const now = Date.now();
          let presenceChanged = false;
          for (const [key, player] of remotePlayersRef.current.entries()) {
            if (now - player.lastSeenAt > LAND_REMOTE_TTL_MS) {
              remotePlayersRef.current.delete(key);
              presenceChanged = true;
            }
          }
          if (presenceChanged) {
            setLandAvailabilityVersion((value) => value + 1);
            publishLandPresenceSnapshot();
          }
          for (const [key, avatar] of this.remotes.entries()) {
            const player = remotePlayersRef.current.get(key);
            if (player && player.roomId === currentRoomRef.current) continue;
            avatar.destroy(true);
            this.remotes.delete(key);
            this.remoteLabels.get(key)?.destroy();
            this.remoteLabels.delete(key);
            this.remoteAvailabilityLabels.get(key)?.destroy();
            this.remoteAvailabilityLabels.delete(key);
          }
          let remoteIndex = 0;
          for (const [key, player] of remotePlayersRef.current.entries()) {
            if (player.roomId !== currentRoomRef.current) continue;
            let avatar = this.remotes.get(key);
            if (!avatar) {
              const scale = characterScaleForRoomY(player.roomId, player.y);
              const color = Phaser.Display.Color.HSLToColor(
                ((remoteHueBase + remoteIndex * 37) % 360) / 360,
                0.6,
                0.56
              ).color;
              avatar = this.createAvatar(
                player.x,
                player.y,
                color,
                false,
                player.skinId
              );
              avatar.setInteractive({
                alphaTolerance: 8,
                pixelPerfect: true,
                useHandCursor: true,
              });
              avatar.on(
                'pointerdown',
                (
                  pointer: any,
                  _localX: number,
                  _localY: number,
                  event: any
                ) => {
                  event?.stopPropagation?.();
                  const bounds = containerRef.current?.getBoundingClientRect();
                  if (!bounds) return;
                  const currentPlayer = remotePlayersRef.current.get(key);
                  if (!currentPlayer) return;
                  const pointerEvent = pointer?.event as
                    | PointerEvent
                    | undefined;
                  const menuX = clampNumber(
                    (pointerEvent?.clientX ?? bounds.left + bounds.width / 2) -
                      bounds.left,
                    12,
                    Math.max(12, bounds.width - 290)
                  );
                  const menuY = clampNumber(
                    (pointerEvent?.clientY ?? bounds.top + bounds.height / 2) -
                      bounds.top,
                    12,
                    Math.max(12, bounds.height - 24)
                  );
                  setActionTarget({
                    key,
                    authorAddress: currentPlayer.authorAddress,
                    sessionId: currentPlayer.sessionId,
                    destinationHash: currentPlayer.destinationHash,
                    roomId: currentPlayer.roomId,
                    anchorX: menuX,
                    anchorY: menuY,
                    menuX,
                    menuY,
                  });
                }
              );
              this.remotes.set(key, avatar);
              const label = this.add
                .text(
                  player.x,
                  player.y - LAND_CHARACTER_LABEL_OFFSET * scale,
                  displayNameForAddress(
                    player.authorAddress,
                    primaryNameCacheRef.current
                  ),
                  {
                    color: '#f8fbff',
                    fontFamily: 'Inter, Arial, sans-serif',
                    fontSize: '12px',
                    stroke: '#10151c',
                    strokeThickness: 4,
                  }
                )
                .setOrigin(0.5);
              this.remoteLabels.set(key, label);
              this.remoteAvailabilityLabels.set(
                key,
                this.createAvailabilityLabel()
              );
            }
            const elapsedSinceUpdate = now - player.receivedAt;
            const renderAt = now - LAND_REMOTE_INTERPOLATION_BUFFER_MS;
            const timelineSpan = Math.max(
              1,
              player.timelineAt - player.fromTimelineAt
            );
            const interpolationProgress = Phaser.Math.Clamp(
              (renderAt - player.fromTimelineAt) / timelineSpan,
              0,
              1
            );
            let nextX = Phaser.Math.Linear(
              player.fromX,
              player.x,
              interpolationProgress
            );
            let nextY = Phaser.Math.Linear(
              player.fromY,
              player.y,
              interpolationProgress
            );
            const afterTargetMs = Math.max(0, renderAt - player.timelineAt);
            const renderDirection =
              interpolationProgress < 1
                ? player.fromDirection
                : player.direction;
            const renderMovement =
              interpolationProgress < 1 ? player.fromMovement : player.movement;
            const shouldPredict =
              renderMovement === 'walk' &&
              afterTargetMs > 0 &&
              afterTargetMs <= LAND_REMOTE_EXTRAPOLATE_MS &&
              (Math.abs(player.velocityX) > 0.001 ||
                Math.abs(player.velocityY) > 0.001);
            if (shouldPredict) {
              const velocityLength = Math.hypot(
                player.velocityX,
                player.velocityY
              );
              const maxPredictionMs =
                velocityLength > 0
                  ? Math.min(
                      afterTargetMs,
                      LAND_REMOTE_MAX_EXTRAPOLATE_DISTANCE / velocityLength
                    )
                  : 0;
              const predicted = clampLandPosition(
                player.roomId,
                player.x + player.velocityX * maxPredictionMs,
                player.y + player.velocityY * maxPredictionMs
              );
              nextX = predicted.x;
              nextY = predicted.y;
            }
            player.displayX = nextX;
            player.displayY = nextY;
            const scale = characterScaleForRoomY(player.roomId, nextY);
            const renderY = qortalLandAvatarRenderY(
              player.roomId,
              nextX,
              nextY
            );
            const label = this.remoteLabels.get(key);
            const labelText = displayNameForAddress(
              player.authorAddress,
              primaryNameCacheRef.current
            );
            if (label?.text !== labelText) {
              label?.setText(labelText);
            }
            avatar.setData('logicalX', nextX);
            avatar.setData('logicalY', nextY);
            avatar.setPosition(nextX, renderY);
            avatar.setScale(
              avatarScaleXForDirection(renderDirection, scale),
              scale
            );
            this.animateAvatar(
              avatar,
              renderMovement === 'walk' &&
                elapsedSinceUpdate <= LAND_REMOTE_STOP_WALKING_AFTER_MS,
              renderDirection,
              player.skinId
            );
            avatar.setDepth(nextY + 20);
            label?.setPosition(
              nextX,
              renderY - LAND_CHARACTER_LABEL_OFFSET * scale
            );
            label?.setDepth(nextY + 90);
            this.updateAvailabilityLabel(
              this.remoteAvailabilityLabels.get(key),
              player.afk,
              player.dnd,
              nextX,
              renderY -
                (LAND_CHARACTER_LABEL_OFFSET +
                  LAND_CHARACTER_AVAILABILITY_OFFSET) *
                  scale,
              nextY + 91
            );
            remoteIndex += 1;
          }
        }
      }

      const width = Math.max(320, containerRef.current.clientWidth || 900);
      const height = Math.max(320, containerRef.current.clientHeight || 560);
      const game = new Phaser.Game({
        type: Phaser.CANVAS,
        parent: containerRef.current,
        backgroundColor: '#050811',
        audio: {
          noAudio: true,
        },
        scale: {
          mode: Phaser.Scale.RESIZE,
          width,
          height,
        },
        scene: QortalLandScene,
      });
      game.input.enabled = !landGameInputBlockedRef.current;
      gameRef.current = game;
      game.events.once(Phaser.Core.Events.READY, () => {
        if (!destroyed && !isActiveRef.current) game.loop.sleep();
      });

      const measureContainerSize = () => {
        if (!containerRef.current) return { width, height };
        const rect = containerRef.current.getBoundingClientRect();
        return {
          width: Math.max(
            320,
            Math.floor(rect.width || containerRef.current.clientWidth || width)
          ),
          height: Math.max(
            320,
            Math.floor(
              rect.height || containerRef.current.clientHeight || height
            )
          ),
        };
      };

      const resizeGameToContainer = () => {
        if (destroyed) return;
        const nextSize = measureContainerSize();
        if (
          game.scale.width !== nextSize.width ||
          game.scale.height !== nextSize.height
        ) {
          game.scale.resize(nextSize.width, nextSize.height);
        }
      };

      const scheduleGameResize = () => {
        if (destroyed) return;
        if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = 0;
          resizeGameToContainer();
          window.requestAnimationFrame(() => {
            resizeGameToContainer();
          });
        });
      };

      scheduleGameResize();
      window.addEventListener('resize', scheduleGameResize);
      removeWindowResizeListener = () =>
        window.removeEventListener('resize', scheduleGameResize);
      resizeObserver = new ResizeObserver(() => {
        scheduleGameResize();
      });
      resizeObserver.observe(containerRef.current);
    });

    return () => {
      destroyed = true;
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      removeWindowResizeListener?.();
      resizeObserver?.disconnect();
      const game = gameRef.current;
      if (game) {
        game.destroy(true);
        // Phaser finalizes destruction on its next frame. Ensure an inactive
        // Land instance is awake long enough to process that pending cleanup.
        game.loop.wake();
      }
      gameRef.current = null;
      remotePlayersRef.current.clear();
      landChatBubblesRef.current.clear();
      landActionAnimationsRef.current.clear();
      landCallPresenceRef.current.clear();
      landGamePresenceRef.current.clear();
    };
  }, [myAddress]);

  const actionTargetName = actionTarget
    ? displayNameForAddress(
        actionTarget.authorAddress,
        primaryNameCacheRef.current
      )
    : '';
  const actionTargetSkinId =
    actionTarget?.authorAddress === myAddress
      ? selectedSkinId
      : normalizeQortalLandSkinId(
          actionTarget
            ? remotePlayersRef.current.get(actionTarget.key)?.skinId
            : 1
        );
  const isSelfActionTarget = actionTarget?.authorAddress === myAddress;
  const sendQortTargetName = sendQortTarget
    ? displayNameForAddress(
        sendQortTarget.authorAddress,
        primaryNameCacheRef.current
      )
    : '';
  const sendQortAmountNumber = Number(sendQortAmount);
  const canSendQort =
    Boolean(sendQortTarget) &&
    Number.isFinite(sendQortAmountNumber) &&
    sendQortAmountNumber > 0 &&
    sendQortAmountNumber <= qortBalance &&
    reticulumReady === true &&
    !isSendingQort;
  void landCallPresenceVersion;
  void landGamePresenceVersion;
  void landAvailabilityVersion;
  const actionTargetInCall = actionTarget
    ? isAddressInLandCall(actionTarget.authorAddress)
    : false;
  const actionTargetInGame = actionTarget
    ? isAddressInLandGame(actionTarget.authorAddress)
    : false;
  const actionTargetDnd = actionTarget
    ? remotePlayersRef.current.get(actionTarget.key)?.dnd === true
    : false;
  const currentActionTarget = actionTarget
    ? resolveCurrentLandActionTarget(actionTarget)
    : null;
  const localLandCallActive = ['calling', 'ringing', 'connected'].includes(
    landVoiceCall.callState
  );
  const canStartLandCall =
    Boolean(actionTarget) &&
    reticulumReady === true &&
    landVoiceCall.callState === 'idle' &&
    !landGame.busy &&
    !actionTargetInCall &&
    !actionTargetInGame &&
    !actionTargetDnd &&
    Boolean(currentActionTarget?.destinationHash) &&
    actionTarget?.authorAddress !== myAddress;
  const canStartLandGame =
    Boolean(actionTarget) &&
    landGame.transportReady &&
    !landGame.busy &&
    reticulumReady === true &&
    !actionTargetInGame &&
    !actionTargetDnd &&
    Boolean(currentActionTarget?.destinationHash) &&
    actionTarget?.authorAddress !== myAddress;
  const activeLandCallPeerName = activeLandCallPeerAddress
    ? displayNameForAddress(
        activeLandCallPeerAddress,
        primaryNameCacheRef.current
      )
    : '';
  const incomingLandCallName = landVoiceCall.incomingCall
    ? displayNameForAddress(
        landVoiceCall.incomingCall.fromAddress,
        primaryNameCacheRef.current
      )
    : '';
  const activeLandCallSubtitle = (() => {
    if (landVoiceCall.callState === 'calling')
      return landVoiceCall.startupStatus.detail || 'Calling...';
    if (landVoiceCall.callState === 'ringing') return 'Incoming call';
    if (landVoiceCall.callState === 'connected') {
      const minutes = Math.floor(landVoiceCall.callDuration / 60)
        .toString()
        .padStart(2, '0');
      const seconds = Math.floor(landVoiceCall.callDuration % 60)
        .toString()
        .padStart(2, '0');
      return landVoiceCall.callMediaReady
        ? `Connected ${minutes}:${seconds}`
        : landVoiceCall.startupStatus.detail || 'Connecting audio...';
    }
    return '';
  })();
  const characterPreviewRowPercent =
    characterPreviewFacing === 'back'
      ? '100%'
      : characterPreviewFacing === 'front'
        ? '50%'
        : '0%';
  const characterPreviewScaleX =
    characterPreviewFacing === 'left' ? -0.96 : 0.96;
  const characterPreviewFacingLabel =
    characterPreviewFacing.charAt(0).toUpperCase() +
    characterPreviewFacing.slice(1);
  const landChatOpacity = isChatDimmed && !isChatFocused ? 0.5 : 0.9;

  return (
    <Box
      data-tour="hub-qortal-land-view"
      onPointerDown={recordLandActivity}
      sx={{
        backgroundColor: '#050811',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      {QORTAL_LAND_DEVELOPMENT_TOOLBAR_ENABLED ? (
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: 'rgba(9, 13, 18, 0.72)',
            borderBottom: `1px solid ${theme.palette.divider}`,
            display: 'flex',
            gap: 1.5,
            height: 42,
            justifyContent: 'space-between',
            padding: '0 14px',
            zIndex: 2,
          }}
        >
          <Typography
            sx={{
              color: theme.palette.text.primary,
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            QortalLand
          </Typography>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: 1.25,
              minWidth: 0,
            }}
          >
            <Typography
              sx={{ color: theme.palette.text.secondary, fontSize: 12 }}
            >
              {groupName}
            </Typography>
            <Button
              size="small"
              variant={isCharacterPanelOpen ? 'contained' : 'outlined'}
              onClick={() => setIsCharacterPanelOpen((open) => !open)}
              sx={{
                borderColor: 'rgba(255, 43, 214, 0.38)',
                borderRadius: '6px',
                color: isCharacterPanelOpen ? '#071018' : '#ff7ce8',
                fontSize: 11,
                fontWeight: 800,
                lineHeight: 1.1,
                minHeight: 28,
                minWidth: 92,
                padding: '5px 10px',
                textTransform: 'none',
              }}
            >
              Customize
            </Button>
            <Button
              size="small"
              variant={isAssetDevPanelOpen ? 'contained' : 'outlined'}
              onClick={() => setIsAssetDevPanelOpen((open) => !open)}
              sx={{
                borderColor: 'rgba(44, 248, 255, 0.38)',
                borderRadius: '6px',
                color: isAssetDevPanelOpen ? '#071018' : '#2cf8ff',
                fontSize: 11,
                fontWeight: 800,
                lineHeight: 1.1,
                minHeight: 28,
                minWidth: 86,
                padding: '5px 10px',
                textTransform: 'none',
              }}
            >
              Asset Dev
            </Button>
          </Box>
        </Box>
      ) : null}
      <Box
        ref={containerRef}
        sx={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          backgroundColor: '#050811',
          overflow: 'hidden',
          width: '100%',
          '& canvas': {
            display: 'block',
          },
        }}
      >
        {loadingRoomAssets !== null && (
          <Box
            role="status"
            aria-live="polite"
            sx={{
              alignItems: 'center',
              backgroundColor: 'rgba(5, 8, 17, 0.86)',
              border: '1px solid rgba(44, 248, 255, 0.38)',
              borderRadius: '10px',
              color: '#d9fdff',
              display: 'flex',
              left: '50%',
              padding: '10px 14px',
              pointerEvents: 'none',
              position: 'absolute',
              top: 18,
              transform: 'translateX(-50%)',
              zIndex: 5,
            }}
          >
            <Typography sx={{ fontSize: 12, fontWeight: 700 }}>
              Loading destination room…
            </Typography>
          </Box>
        )}
        {reticulumReady === true && (
          <ClickAwayListener
            onClickAway={() => {
              if (isChatFocused || chatText) cancelLandChatTyping();
            }}
          >
            <Box
              data-qortalland-chat-panel="true"
              onClick={wakeLandChatPanel}
              ref={chatPanelRef}
              sx={{
                background:
                  'linear-gradient(180deg, rgba(7, 12, 20, 0.96), rgba(5, 8, 15, 0.9))',
                border: '1px solid rgba(44, 248, 255, 0.52)',
                borderRadius: '14px',
                bottom: chatPanelGeometry ? 'auto' : { xs: 12, md: 18 },
                boxSizing: 'border-box',
                boxShadow:
                  '0 18px 42px rgba(0, 0, 0, 0.52), inset 0 0 0 1px rgba(255, 43, 214, 0.28), inset 0 0 28px rgba(44, 248, 255, 0.04)',
                color: '#f8fbff',
                display: 'flex',
                flexDirection: 'column',
                height: chatPanelGeometry ? chatPanelGeometry.height : 'auto',
                left: chatPanelGeometry
                  ? chatPanelGeometry.x
                  : { xs: 12, md: 22 },
                opacity: landChatOpacity,
                padding: '14px 14px 16px',
                pointerEvents: 'auto',
                position: 'absolute',
                top: chatPanelGeometry ? chatPanelGeometry.y : 'auto',
                transition:
                  'opacity 180ms ease, border-color 180ms ease, background 180ms ease',
                width: chatPanelGeometry
                  ? chatPanelGeometry.width
                  : 'min(468px, calc(100% - 24px))',
                zIndex: 4,
                '&:hover': {
                  opacity: 0.9,
                },
              }}
            >
              <Box
                aria-hidden="true"
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  beginChatPanelInteraction(
                    'resize-top-right',
                    event.pointerId,
                    event.clientX,
                    event.clientY
                  );
                }}
                sx={{
                  cursor: 'nesw-resize',
                  height: 18,
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  touchAction: 'none',
                  width: 18,
                  zIndex: 3,
                }}
              />
              <Box
                aria-hidden="true"
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  beginChatPanelInteraction(
                    'resize-bottom-right',
                    event.pointerId,
                    event.clientX,
                    event.clientY
                  );
                }}
                sx={{
                  bottom: 0,
                  cursor: 'nwse-resize',
                  height: 18,
                  position: 'absolute',
                  right: 0,
                  touchAction: 'none',
                  width: 18,
                  zIndex: 3,
                }}
              />
              <Box
                onPointerDown={(event) => {
                  if (
                    event.button !== 0 ||
                    (event.target instanceof Element &&
                      event.target.closest('[data-land-chat-no-drag="true"]'))
                  ) {
                    return;
                  }
                  beginChatPanelInteraction(
                    'drag',
                    event.pointerId,
                    event.clientX,
                    event.clientY
                  );
                }}
                sx={{
                  alignItems: 'center',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                  cursor: 'move',
                  display: 'flex',
                  gap: 0.75,
                  paddingBottom: 0.75,
                  touchAction: 'none',
                  userSelect: 'none',
                }}
              >
                {(
                  [
                    ['local', 'World'],
                    ['whispers', 'Whispers'],
                  ] as const
                ).map(([tab, label]) => {
                  const isActive = activeChatTab === tab;
                  return (
                    <Box
                      component="button"
                      key={tab}
                      onClick={() => {
                        setActiveChatTab(tab);
                        setIsEmojiPickerOpen(false);
                        wakeLandChatPanel();
                        if (tab === 'whispers') {
                          setChatText('');
                          setChatError('');
                          chatInputRef.current?.blur();
                        }
                      }}
                      sx={{
                        alignItems: 'center',
                        backgroundColor: isActive
                          ? 'rgba(7, 22, 28, 0.58)'
                          : 'rgba(255, 255, 255, 0.02)',
                        border: `1px solid ${isActive ? 'rgba(44, 248, 255, 0.34)' : 'rgba(255, 255, 255, 0.12)'}`,
                        borderRadius: '5px',
                        color: isActive
                          ? '#2cf8ff'
                          : 'rgba(220, 220, 226, 0.48)',
                        cursor: 'pointer',
                        // Keep Whispers implemented but out of the QortalLand UI
                        // until its transport is ready for users.
                        display: tab === 'whispers' ? 'none' : 'flex',
                        fontSize: 12,
                        fontWeight: isActive ? 900 : 800,
                        height: 31,
                        justifyContent: 'center',
                        minWidth: 96,
                        padding: '0 14px',
                        textShadow: isActive
                          ? '0 0 8px rgba(44, 248, 255, 0.34)'
                          : 'none',
                        '&:hover': {
                          borderColor: 'rgba(44, 248, 255, 0.28)',
                          color: isActive
                            ? '#2cf8ff'
                            : 'rgba(220, 220, 226, 0.68)',
                        },
                      }}
                    >
                      {label}
                    </Box>
                  );
                })}
                {(window.qortalLandRealtime || window.qortalLandGames) && (
                  <Box
                    data-land-chat-no-drag="true"
                    sx={{ marginLeft: 'auto' }}
                  >
                    <ProximityVoiceControl
                      state={proximityVoice.state}
                      mode={proximityVoice.mode}
                      pttKey={proximityVoice.pttKey}
                      transmitting={proximityVoice.transmitting}
                      peers={proximityVoice.peers}
                      error={proximityVoice.error}
                      devices={proximityVoice.devices}
                      inputDeviceId={proximityVoice.inputDeviceId}
                      outputDeviceId={proximityVoice.outputDeviceId}
                      masterVolume={proximityVoice.masterVolume}
                      resolveName={resolveLandPlayerName}
                      onEnable={proximityVoice.enable}
                      onDisable={proximityVoice.disable}
                      onMode={proximityVoice.setMode}
                      onPttKey={proximityVoice.setPttKey}
                      onInputDevice={proximityVoice.setInputDeviceId}
                      onOutputDevice={proximityVoice.setOutputDeviceId}
                      onMasterVolume={proximityVoice.setMasterVolume}
                      onPeerPolicy={proximityVoice.setPeerPolicy}
                      availableVoiceAddresses={availableProximityVoiceAddresses}
                      openRequest={proximityVoicePanelRequest}
                      focusAddress={proximityVoicePanelTarget}
                      onPresenceChange={setLocalProximityVoicePresence}
                    />
                  </Box>
                )}
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  flex: 1,
                  minHeight: chatPanelGeometry ? 0 : 118,
                }}
              >
                <Box
                  ref={chatMessagesViewportRef}
                  sx={{
                    flex: 1,
                    maxHeight: chatPanelGeometry ? 'none' : 116,
                    minHeight: chatPanelGeometry ? 0 : 108,
                    overflowY: 'auto',
                    padding: '12px 11px 5px 0',
                    width: '100%',
                    scrollbarColor: 'rgba(44, 248, 255, 0.7) transparent',
                    scrollbarWidth: 'thin',
                    '&::-webkit-scrollbar': {
                      width: 8,
                    },
                    '&::-webkit-scrollbar-track': {
                      background: 'transparent',
                    },
                    '&::-webkit-scrollbar-thumb': {
                      background:
                        'linear-gradient(180deg, rgba(44, 248, 255, 0.78), rgba(255, 43, 214, 0.62))',
                      borderRadius: 999,
                    },
                  }}
                >
                  {activeChatTab === 'local' &&
                    landChatMessages.map((message) => {
                      const authorName = displayNameForAddress(
                        message.authorAddress,
                        primaryNameCacheRef.current
                      );
                      const isYell = message.mode === 'yell';
                      const isEmote = message.mode === 'emote';
                      const authorColor = isYell
                        ? '#ff4d4d'
                        : message.authorAddress === myAddress
                          ? '#2cf8ff'
                          : '#ff4dde';
                      const sentAt = new Date(message.timestamp);
                      const sentTime = `${sentAt.getHours().toString().padStart(2, '0')}:${sentAt.getMinutes().toString().padStart(2, '0')}`;
                      return (
                        <Box
                          key={message.messageId}
                          sx={{
                            display: 'grid',
                            gap: 1.15,
                            gridTemplateColumns: '50px minmax(0, 1fr)',
                            marginBottom: 0.35,
                          }}
                        >
                          <Typography
                            component="span"
                            sx={{
                              color: 'rgba(220, 220, 226, 0.68)',
                              fontSize: 12,
                              lineHeight: 1.2,
                              textShadow: '0 1px 2px rgba(0, 0, 0, 0.85)',
                            }}
                          >
                            {sentTime}
                          </Typography>
                          <Typography
                            component="span"
                            sx={{
                              color: isYell
                                ? '#ff4d4d'
                                : isEmote
                                  ? '#ffd64a'
                                  : '#f8fbff',
                              fontSize: 12,
                              fontWeight: isYell || isEmote ? 900 : 500,
                              lineHeight: 1.2,
                              minWidth: 0,
                              textShadow: '0 1px 2px rgba(0, 0, 0, 0.85)',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {isYell ? (
                              <>
                                <Box
                                  component="span"
                                  sx={{ color: authorColor, fontWeight: 900 }}
                                >
                                  {authorName} yelled:
                                </Box>{' '}
                                {renderLandChatTextParts(message.text)}
                              </>
                            ) : isEmote ? (
                              `${authorName} ${message.text}`
                            ) : (
                              <>
                                <Box
                                  component="span"
                                  sx={{ color: authorColor, fontWeight: 900 }}
                                >
                                  {authorName}:
                                </Box>{' '}
                                {renderLandChatTextParts(message.text)}
                              </>
                            )}
                          </Typography>
                        </Box>
                      );
                    })}
                </Box>
              </Box>
              <Box
                sx={{
                  borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                  display: 'grid',
                  gap: 0.35,
                  paddingTop: 0.65,
                }}
              >
                {activeChatTab === 'local' && isEmojiPickerOpen && (
                  <Box
                    sx={{
                      background:
                        'linear-gradient(180deg, rgba(7, 12, 20, 0.98), rgba(4, 8, 14, 0.94))',
                      border: '1px solid rgba(44, 248, 255, 0.42)',
                      borderRadius: '8px',
                      bottom: 68,
                      boxShadow:
                        '0 14px 28px rgba(0, 0, 0, 0.44), inset 0 0 0 1px rgba(255, 43, 214, 0.16)',
                      display: 'grid',
                      gap: 0.35,
                      gridTemplateColumns: 'repeat(7, 28px)',
                      padding: '8px',
                      position: 'absolute',
                      right: 19,
                      zIndex: 2,
                    }}
                  >
                    {QORTAL_LAND_AVAILABLE_CHAT_EMOJIS.map((emoji) => {
                      const emojiUrl = qortalLandChatEmojiUrlByFileName.get(
                        emoji.fileName
                      );
                      if (!emojiUrl) return null;
                      return (
                        <IconButton
                          aria-label={`Insert ${emoji.label}`}
                          key={emoji.key}
                          onClick={() =>
                            insertLandChatEmojiShortcut(emoji.shortcuts[0])
                          }
                          onMouseDown={(event) => event.preventDefault()}
                          sx={{
                            border: '1px solid rgba(220, 220, 226, 0.08)',
                            borderRadius: '5px',
                            height: 28,
                            padding: 0,
                            width: 28,
                            '&:hover': {
                              backgroundColor: 'rgba(44, 248, 255, 0.1)',
                              borderColor: 'rgba(44, 248, 255, 0.35)',
                            },
                          }}
                        >
                          <Box
                            alt={emoji.label}
                            component="img"
                            src={emojiUrl}
                            sx={{ height: 20, objectFit: 'contain', width: 20 }}
                          />
                        </IconButton>
                      );
                    })}
                  </Box>
                )}
                <TextField
                  autoComplete="off"
                  disabled={activeChatTab !== 'local'}
                  error={Boolean(chatError)}
                  inputRef={chatInputRef}
                  placeholder={
                    activeChatTab === 'local' ? 'Say something...' : ''
                  }
                  size="small"
                  value={chatText}
                  variant="filled"
                  inputProps={{
                    'aria-label': 'QortalLand chat message',
                    maxLength: LAND_CHAT_MAX_INPUT_CHARS,
                  }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end" sx={{ gap: 0.25 }}>
                        <IconButton
                          aria-label="Open emoji picker"
                          disabled={activeChatTab !== 'local'}
                          onClick={() => {
                            setIsEmojiPickerOpen((open) => !open);
                            focusLandChatInput();
                          }}
                          onMouseDown={(event) => event.preventDefault()}
                          sx={{
                            color: isEmojiPickerOpen
                              ? '#2cf8ff'
                              : 'rgba(220, 220, 226, 0.6)',
                            height: 28,
                            padding: 0,
                            width: 28,
                            '&:hover': {
                              backgroundColor: 'rgba(44, 248, 255, 0.1)',
                              color: '#2cf8ff',
                            },
                          }}
                        >
                          <InsertEmoticonRoundedIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                        <IconButton
                          aria-label="Send chat message"
                          disabled={isSendingChat || activeChatTab !== 'local'}
                          onClick={submitLandChatFromInput}
                          onMouseDown={(event) => event.preventDefault()}
                          sx={{
                            color: 'rgba(220, 220, 226, 0.6)',
                            height: 28,
                            padding: 0,
                            width: 28,
                            '&:hover': {
                              backgroundColor: 'rgba(255, 43, 214, 0.1)',
                              color: '#ff4dde',
                            },
                          }}
                        >
                          <KeyboardReturnRoundedIcon sx={{ fontSize: 19 }} />
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                  onBlur={() => setIsChatFocused(false)}
                  onChange={(event) => {
                    recordLandActivity();
                    const next = event.target.value.slice(
                      0,
                      LAND_CHAT_MAX_INPUT_CHARS
                    );
                    setChatText(next);
                    if (chatError) setChatError('');
                    wakeLandChatPanel();
                  }}
                  onFocus={() => {
                    setIsChatFocused(true);
                    wakeLandChatPanel();
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      cancelLandChatTyping();
                      return;
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      submitLandChatFromInput();
                    }
                  }}
                  sx={{
                    '& .MuiFilledInput-root': {
                      backgroundColor: 'rgba(4, 8, 14, 0.72)',
                      border: `1px solid ${chatError ? alpha(theme.palette.error.light, 0.6) : 'rgba(220, 220, 226, 0.28)'}`,
                      borderRadius: '7px',
                      color: '#f8fbff',
                      fontSize: 14,
                      height: 48,
                      minHeight: 48,
                      overflow: 'hidden',
                      '&:before, &:after': { display: 'none' },
                    },
                    '& .MuiFilledInput-input': {
                      height: 16,
                      padding: '15px 0 14px 12px',
                      '&::placeholder': {
                        color: 'rgba(220, 220, 226, 0.62)',
                        opacity: 1,
                      },
                    },
                    '& .MuiInputAdornment-root': {
                      marginRight: 1,
                    },
                  }}
                />
              </Box>
            </Box>
          </ClickAwayListener>
        )}
      </Box>
      {isCharacterPanelOpen && (
        <Box
          sx={{
            background:
              'linear-gradient(135deg, rgba(4, 6, 15, 0.98), rgba(16, 9, 31, 0.96) 52%, rgba(5, 18, 28, 0.96)), radial-gradient(circle at 72% 22%, rgba(255, 43, 214, 0.18), transparent 34%), radial-gradient(circle at 26% 76%, rgba(44, 248, 255, 0.12), transparent 32%)',
            border: '1px solid rgba(255, 43, 214, 0.34)',
            borderRadius: '8px',
            boxShadow:
              '0 28px 80px rgba(0, 0, 0, 0.62), inset 0 0 0 1px rgba(44, 248, 255, 0.09)',
            color: '#f8fbff',
            display: 'grid',
            gap: { xs: 1.5, md: 2 },
            gridTemplateColumns: {
              xs: '1fr',
              md: 'minmax(275px, 0.9fr) minmax(290px, 1fr)',
            },
            left: '50%',
            maxHeight: 'min(520px, calc(100% - 76px))',
            overflowY: 'auto',
            padding: { xs: '14px', md: '18px 20px' },
            position: 'absolute',
            top: { xs: 54, md: 'clamp(136px, 19vh, 218px)' },
            transform: 'translateX(-50%)',
            width: 'min(790px, calc(100% - 32px))',
            zIndex: 5,
            '&:before': {
              background:
                'linear-gradient(90deg, transparent, rgba(44, 248, 255, 0.76), rgba(255, 43, 214, 0.58), transparent)',
              content: '""',
              height: 2,
              left: 34,
              position: 'absolute',
              right: 34,
              top: 9,
            },
            '&:after': {
              borderBottom: '1px solid rgba(44, 248, 255, 0.18)',
              borderTop: '1px solid rgba(255, 43, 214, 0.16)',
              content: '""',
              inset: '28px 18px 18px',
              pointerEvents: 'none',
              position: 'absolute',
            },
          }}
        >
          <Box
            sx={{ display: 'grid', gap: 1.35, position: 'relative', zIndex: 1 }}
          >
            <Box>
              <Typography
                sx={{ color: '#f8fbff', fontSize: 16, fontWeight: 900 }}
              >
                Character
              </Typography>
              <Typography
                sx={{
                  color: 'rgba(44, 248, 255, 0.64)',
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: 0,
                }}
              >
                Loadout Console
              </Typography>
            </Box>
            {(
              [
                [
                  'hair',
                  'Hair',
                  QORTAL_LAND_CHARACTER_CUSTOMIZATION_OPTIONS.hair,
                ],
                [
                  'face',
                  'Face',
                  QORTAL_LAND_CHARACTER_CUSTOMIZATION_OPTIONS.face,
                ],
                [
                  'clothes',
                  'Clothes',
                  QORTAL_LAND_CHARACTER_CUSTOMIZATION_OPTIONS.clothes,
                ],
              ] as const
            ).map(([field, label, options]) => (
              <Box
                key={field}
                sx={{
                  background: 'rgba(4, 7, 17, 0.74)',
                  border: '1px solid rgba(248, 251, 255, 0.1)',
                  borderRadius: '8px',
                  boxShadow: 'inset 0 0 18px rgba(44, 248, 255, 0.04)',
                  display: 'grid',
                  gap: 0.75,
                  padding: '9px 10px 10px',
                }}
              >
                <Typography
                  sx={{
                    color: 'rgba(248, 251, 255, 0.58)',
                    fontSize: 10,
                    fontWeight: 800,
                  }}
                >
                  {label}
                </Typography>
                <Box
                  sx={{
                    alignItems: 'center',
                    display: 'grid',
                    gap: 0.7,
                    gridTemplateColumns: '34px 1fr 34px',
                  }}
                >
                  <IconButton
                    aria-label={`Previous ${label}`}
                    size="small"
                    onClick={() => cycleCharacterCustomization(field, -1)}
                    sx={{
                      backgroundColor: 'rgba(255, 43, 214, 0.1)',
                      border: '1px solid rgba(255, 43, 214, 0.28)',
                      borderRadius: '6px',
                      color: '#ff7ce8',
                      height: 34,
                      width: 34,
                    }}
                  >
                    {'<'}
                  </IconButton>
                  <TextField
                    select
                    size="small"
                    value={characterCustomization[field]}
                    onChange={(event) =>
                      updateCharacterCustomization(field, event.target.value)
                    }
                    sx={{
                      '& .MuiInputBase-input': {
                        color: '#f8fbff',
                        fontSize: 12,
                        fontWeight: 800,
                        textAlign: 'center',
                      },
                      '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: 'rgba(44, 248, 255, 0.22)',
                      },
                      '& .MuiOutlinedInput-root': {
                        backgroundColor: 'rgba(7, 12, 28, 0.88)',
                        borderRadius: '6px',
                      },
                      '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline':
                        {
                          borderColor: 'rgba(44, 248, 255, 0.56)',
                        },
                      '& .MuiSvgIcon-root': {
                        color: 'rgba(248, 251, 255, 0.62)',
                      },
                    }}
                  >
                    {options.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <IconButton
                    aria-label={`Next ${label}`}
                    size="small"
                    onClick={() => cycleCharacterCustomization(field, 1)}
                    sx={{
                      backgroundColor: 'rgba(44, 248, 255, 0.1)',
                      border: '1px solid rgba(44, 248, 255, 0.3)',
                      borderRadius: '6px',
                      color: '#2cf8ff',
                      height: 34,
                      width: 34,
                    }}
                  >
                    {'>'}
                  </IconButton>
                </Box>
              </Box>
            ))}
            <Box
              sx={{
                display: 'grid',
                gap: 1,
                gridTemplateColumns: '1fr 1fr',
                marginTop: 0.5,
              }}
            >
              <Button
                size="small"
                variant="outlined"
                onClick={resetCharacterCustomization}
                sx={{
                  borderColor: 'rgba(248, 251, 255, 0.2)',
                  borderRadius: '6px',
                  color: 'rgba(248, 251, 255, 0.82)',
                  fontSize: 11,
                  minHeight: 42,
                  textTransform: 'none',
                }}
              >
                Reset
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={() => setIsCharacterPanelOpen(false)}
                sx={{
                  borderRadius: '6px',
                  color: '#071018',
                  fontSize: 11,
                  fontWeight: 900,
                  minHeight: 42,
                  textTransform: 'none',
                }}
              >
                Done
              </Button>
            </Box>
          </Box>
          <Box
            sx={{
              alignItems: 'center',
              background:
                'linear-gradient(180deg, rgba(4, 7, 17, 0.28), rgba(4, 7, 17, 0.74)), radial-gradient(circle at 50% 42%, rgba(44, 248, 255, 0.2), rgba(255, 43, 214, 0.1) 40%, rgba(5, 8, 17, 0) 72%)',
              border: '1px solid rgba(44, 248, 255, 0.14)',
              borderRadius: '8px',
              display: 'grid',
              justifyItems: 'center',
              minHeight: { xs: 300, md: 382 },
              overflow: 'hidden',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <Box
              sx={{
                background:
                  'linear-gradient(90deg, transparent, rgba(44, 248, 255, 0.38), rgba(255, 43, 214, 0.28), transparent)',
                height: 2,
                left: 38,
                position: 'absolute',
                right: 38,
                top: 26,
              }}
            />
            <Box
              sx={{
                backgroundImage: `url(${defaultCharacterSpritesheetUrl})`,
                backgroundPosition: `0% ${characterPreviewRowPercent}`,
                backgroundRepeat: 'no-repeat',
                backgroundSize: `${LAND_CHARACTER_FRAMES_PER_DIRECTION * 100}% 300%`,
                filter:
                  'drop-shadow(0 22px 24px rgba(0, 0, 0, 0.54)) drop-shadow(0 0 16px rgba(44, 248, 255, 0.14))',
                height: 320,
                marginTop: { xs: 1, md: 2 },
                transform: `scale(${characterPreviewScaleX}, 0.96)`,
                transformOrigin: 'center bottom',
                transition: 'transform 180ms ease, filter 180ms ease',
                width: 320,
                zIndex: 1,
              }}
            />
            <Box
              sx={{
                background: 'rgba(0, 0, 0, 0.42)',
                borderRadius: '50%',
                bottom: { xs: 54, md: 64 },
                filter: 'blur(3px)',
                height: 28,
                position: 'absolute',
                width: 150,
              }}
            />
            <Box
              sx={{
                alignItems: 'center',
                bottom: 16,
                display: 'grid',
                gap: 1,
                gridTemplateColumns: '36px minmax(100px, 1fr) 36px',
                left: 24,
                position: 'absolute',
                right: 24,
              }}
            >
              <IconButton
                aria-label="Rotate character left"
                size="small"
                onClick={() => rotateCharacterPreview(-1)}
                sx={{
                  backgroundColor: 'rgba(255, 43, 214, 0.1)',
                  border: '1px solid rgba(255, 43, 214, 0.28)',
                  borderRadius: '6px',
                  color: '#ff7ce8',
                  height: 36,
                  width: 36,
                }}
              >
                {'<'}
              </IconButton>
              <Typography
                sx={{
                  color: 'rgba(248, 251, 255, 0.76)',
                  fontSize: 11,
                  fontWeight: 900,
                  textAlign: 'center',
                }}
              >
                {characterPreviewFacingLabel}
              </Typography>
              <IconButton
                aria-label="Rotate character right"
                size="small"
                onClick={() => rotateCharacterPreview(1)}
                sx={{
                  backgroundColor: 'rgba(44, 248, 255, 0.1)',
                  border: '1px solid rgba(44, 248, 255, 0.3)',
                  borderRadius: '6px',
                  color: '#2cf8ff',
                  height: 36,
                  width: 36,
                }}
              >
                {'>'}
              </IconButton>
            </Box>
          </Box>
        </Box>
      )}
      {isAssetDevPanelOpen && (
        <Box
          sx={{
            backgroundColor: 'rgba(7, 9, 20, 0.94)',
            border: '1px solid rgba(44, 248, 255, 0.26)',
            borderRadius: '8px',
            boxShadow: '0 18px 45px rgba(0, 0, 0, 0.42)',
            color: '#f8fbff',
            display: 'grid',
            gap: 1.1,
            maxHeight: 'calc(100% - 78px)',
            overflowY: 'auto',
            padding: '12px',
            position: 'absolute',
            right: 16,
            top: 54,
            width: 336,
            zIndex: 4,
          }}
        >
          <Typography sx={{ color: '#f8fbff', fontSize: 13, fontWeight: 800 }}>
            Asset Dev
          </Typography>
          <TextField
            label="Room"
            select
            size="small"
            value={selectedDevRoomId}
            onChange={(event) =>
              selectDevelopmentRoom(event.target.value as LandRoomId)
            }
            sx={{
              '& .MuiInputLabel-root': {
                color: 'rgba(248, 251, 255, 0.58)',
                fontSize: 11,
              },
              '& .MuiInputBase-input': {
                color: '#f8fbff',
                fontSize: 12,
              },
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: 'rgba(248, 251, 255, 0.16)',
              },
              '& .MuiSvgIcon-root': {
                color: 'rgba(248, 251, 255, 0.72)',
              },
            }}
          >
            {QORTAL_LAND_DEVELOPMENT_DEV_ROOM_OPTIONS.map((room) => (
              <MenuItem key={room.id} value={room.id}>
                {room.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Asset"
            select
            size="small"
            value={selectedDevPlacementId}
            onChange={(event) => selectDevelopmentPlacement(event.target.value)}
            sx={{
              '& .MuiInputLabel-root': {
                color: 'rgba(248, 251, 255, 0.58)',
                fontSize: 11,
              },
              '& .MuiInputBase-input': {
                color: '#f8fbff',
                fontSize: 12,
              },
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: 'rgba(248, 251, 255, 0.16)',
              },
              '& .MuiSvgIcon-root': {
                color: 'rgba(248, 251, 255, 0.72)',
              },
            }}
          >
            {editableDevPlacementsForSelectedRoom.map((placement) => (
              <MenuItem
                key={placement.defaultPlacement.id}
                value={placement.defaultPlacement.id}
              >
                {placement.label}
              </MenuItem>
            ))}
          </TextField>
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1fr 1fr' }}>
            <Button
              size="small"
              variant={devPngPropsEnabled ? 'contained' : 'outlined'}
              onClick={() => setDevelopmentPngPropsEnabled(!devPngPropsEnabled)}
              sx={{
                borderColor: 'rgba(44, 248, 255, 0.38)',
                borderRadius: '6px',
                color: devPngPropsEnabled ? '#071018' : '#2cf8ff',
                fontSize: 11,
                fontWeight: 800,
                textTransform: 'none',
              }}
            >
              PNG Props {devPngPropsEnabled ? 'On' : 'Off'}
            </Button>
            <Button
              size="small"
              variant={proceduralClubShellEnabled ? 'outlined' : 'contained'}
              onClick={() =>
                setProceduralClubShellVisible(!proceduralClubShellEnabled)
              }
              sx={{
                borderColor: 'rgba(255, 43, 214, 0.38)',
                borderRadius: '6px',
                color: proceduralClubShellEnabled ? '#ff7ce8' : '#071018',
                fontSize: 11,
                fontWeight: 800,
                textTransform: 'none',
              }}
            >
              Phaser Old {proceduralClubShellEnabled ? 'On' : 'Off'}
            </Button>
          </Box>
          <Button
            size="small"
            variant={collisionDebugEnabled ? 'contained' : 'outlined'}
            onClick={() => setCollisionDebugVisible(!collisionDebugEnabled)}
            sx={{
              borderColor: 'rgba(255, 224, 102, 0.42)',
              borderRadius: '6px',
              color: collisionDebugEnabled ? '#17130a' : '#ffe066',
              fontSize: 11,
              fontWeight: 800,
              textTransform: 'none',
            }}
          >
            Collision Debug {collisionDebugEnabled ? 'On' : 'Off'}
          </Button>
          <Typography sx={{ color: '#f8fbff', fontSize: 12, fontWeight: 800 }}>
            Look Dev
          </Typography>
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1fr 1fr' }}>
            <Button
              size="small"
              variant={
                developmentLookSettings.enabled ? 'contained' : 'outlined'
              }
              onClick={() =>
                setDevelopmentLookEnabled(!developmentLookSettings.enabled)
              }
              sx={{
                borderColor: 'rgba(44, 248, 255, 0.38)',
                borderRadius: '6px',
                color: developmentLookSettings.enabled ? '#071018' : '#2cf8ff',
                fontSize: 11,
                fontWeight: 800,
                textTransform: 'none',
              }}
            >
              Look {developmentLookSettings.enabled ? 'On' : 'Off'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={resetDevelopmentLookSettings}
              sx={{
                borderColor: 'rgba(248, 251, 255, 0.2)',
                borderRadius: '6px',
                color: 'rgba(248, 251, 255, 0.82)',
                fontSize: 11,
                textTransform: 'none',
              }}
            >
              Reset Look
            </Button>
          </Box>
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1fr 1fr' }}>
            {(
              [
                ['brightness', 'Brightness', 0.01],
                ['contrast', 'Contrast', 0.01],
                ['saturation', 'Saturation', 0.01],
                ['shadow', 'Shadow', 0.01],
              ] as const
            ).map(([field, label, step]) => (
              <TextField
                key={field}
                label={label}
                size="small"
                type="number"
                value={developmentLookSettings[field]}
                onChange={(event) =>
                  updateDevelopmentLookSetting(field, event.target.value)
                }
                inputProps={{ step }}
                sx={{
                  '& .MuiInputLabel-root': {
                    color: 'rgba(248, 251, 255, 0.58)',
                    fontSize: 11,
                  },
                  '& .MuiInputBase-input': {
                    color: '#f8fbff',
                    fontSize: 12,
                    padding: '9px 10px',
                  },
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'rgba(248, 251, 255, 0.16)',
                  },
                  '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline':
                    {
                      borderColor: 'rgba(44, 248, 255, 0.38)',
                    },
                }}
              />
            ))}
          </Box>
          <Typography
            sx={{
              color: 'rgba(248, 251, 255, 0.62)',
              fontSize: 11,
              lineHeight: 1.35,
            }}
          >
            {qortalLandDevelopmentPngAssetById.has(
              selectedDevPlacementMeta.defaultPlacement.assetId
            )
              ? `Loaded: ${selectedDevPlacementMeta.sourceLabel}`
              : `Missing: ${selectedDevPlacementMeta.sourceLabel}`}
          </Typography>
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1fr 1fr' }}>
            {(
              [
                ['x', 'X', 1],
                ['y', 'Y', 1],
                ...(selectedDevPlacementMeta.allowSeparateScale
                  ? [
                      ['scaleX', 'Scale X', 0.01],
                      ['scaleY', 'Scale Y', 0.01],
                    ]
                  : [['scale', 'Scale', 0.01]]),
                ['depth', 'Depth', 1],
                ['originX', 'Origin X', 0.001],
                ['originY', 'Origin Y', 0.001],
                ['alpha', 'Alpha', 0.01],
                ['angle', 'Angle', 1],
              ] as const
            ).map(([field, label, step]) => (
              <TextField
                key={field}
                label={label}
                size="small"
                type="number"
                value={
                  field === 'scaleX'
                    ? (selectedDevPlacement.scaleX ??
                      selectedDevPlacement.scale ??
                      '')
                    : field === 'scaleY'
                      ? (selectedDevPlacement.scaleY ??
                        selectedDevPlacement.scale ??
                        '')
                      : (selectedDevPlacement[field] ??
                        (field === 'alpha' ? 1 : ''))
                }
                onChange={(event) =>
                  updateSelectedDevelopmentPlacement(field, event.target.value)
                }
                inputProps={{ step }}
                sx={{
                  '& .MuiInputLabel-root': {
                    color: 'rgba(248, 251, 255, 0.58)',
                    fontSize: 11,
                  },
                  '& .MuiInputBase-input': {
                    color: '#f8fbff',
                    fontSize: 12,
                    padding: '9px 10px',
                  },
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'rgba(248, 251, 255, 0.16)',
                  },
                  '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline':
                    {
                      borderColor: 'rgba(44, 248, 255, 0.38)',
                    },
                }}
              />
            ))}
          </Box>
          {selectedDevPlacementMeta.allowGroupControls && (
            <>
              <Typography
                sx={{ color: '#f8fbff', fontSize: 12, fontWeight: 800 }}
              >
                Group
              </Typography>
              <Box
                sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1fr 1fr' }}
              >
                {(
                  [
                    ['count', 'Count', 1],
                    ['spacing', 'Spacing', 1],
                  ] as const
                ).map(([field, label, step]) => (
                  <TextField
                    key={field}
                    label={label}
                    size="small"
                    type="number"
                    value={
                      selectedDevPlacement[field] ?? (field === 'count' ? 1 : 0)
                    }
                    onChange={(event) =>
                      updateSelectedDevelopmentPlacement(
                        field,
                        event.target.value
                      )
                    }
                    inputProps={{ step }}
                    sx={{
                      '& .MuiInputLabel-root': {
                        color: 'rgba(248, 251, 255, 0.58)',
                        fontSize: 11,
                      },
                      '& .MuiInputBase-input': {
                        color: '#f8fbff',
                        fontSize: 12,
                        padding: '9px 10px',
                      },
                      '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: 'rgba(248, 251, 255, 0.16)',
                      },
                      '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline':
                        {
                          borderColor: 'rgba(44, 248, 255, 0.38)',
                        },
                    }}
                  />
                ))}
              </Box>
            </>
          )}
          {selectedDevPlacementMeta.allowWarp && (
            <>
              <Typography
                sx={{ color: '#f8fbff', fontSize: 12, fontWeight: 800 }}
              >
                Warp
              </Typography>
              <Box
                sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1fr 1fr' }}
              >
                {(
                  [
                    ['tlX', 'TL X'],
                    ['tlY', 'TL Y'],
                    ['trX', 'TR X'],
                    ['trY', 'TR Y'],
                    ['brX', 'BR X'],
                    ['brY', 'BR Y'],
                    ['blX', 'BL X'],
                    ['blY', 'BL Y'],
                  ] as const
                ).map(([field, label]) => (
                  <TextField
                    key={field}
                    label={label}
                    size="small"
                    type="number"
                    value={selectedDevPlacement.warp?.[field] ?? 0}
                    onChange={(event) =>
                      updateSelectedDevelopmentWarp(field, event.target.value)
                    }
                    inputProps={{ step: 1 }}
                    sx={{
                      '& .MuiInputLabel-root': {
                        color: 'rgba(248, 251, 255, 0.58)',
                        fontSize: 11,
                      },
                      '& .MuiInputBase-input': {
                        color: '#f8fbff',
                        fontSize: 12,
                        padding: '9px 10px',
                      },
                      '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: 'rgba(248, 251, 255, 0.16)',
                      },
                      '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline':
                        {
                          borderColor: 'rgba(44, 248, 255, 0.38)',
                        },
                    }}
                  />
                ))}
              </Box>
            </>
          )}
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Button
              size="small"
              variant="outlined"
              onClick={resetSelectedDevelopmentPlacement}
              sx={{
                borderColor: 'rgba(248, 251, 255, 0.2)',
                borderRadius: '6px',
                color: 'rgba(248, 251, 255, 0.82)',
                fontSize: 11,
                textTransform: 'none',
              }}
            >
              Reset {selectedDevPlacementMeta.label}
            </Button>
          </Box>
        </Box>
      )}
      {actionTarget && !sendQortTarget && (
        <ClickAwayListener
          mouseEvent="onMouseDown"
          touchEvent="onTouchStart"
          onClickAway={() => setActionTarget(null)}
        >
          <Box
            onMouseDown={(event) => event.stopPropagation()}
            ref={actionMenuRef}
            sx={{
              background: alpha('#07111f', 0.985),
              border: `1px solid ${alpha('#2cf8ff', 0.42)}`,
              borderRadius: '14px',
              boxShadow: `0 18px 38px ${alpha('#000', 0.4)}`,
              boxSizing: 'border-box',
              left: actionTarget.menuX,
              maxHeight: 'calc(100% - 24px)',
              maxWidth: 'calc(100% - 24px)',
              overflowX: 'hidden',
              overflowY: 'auto',
              padding: '14px',
              position: 'absolute',
              top: actionTarget.menuY,
              width: 326,
              zIndex: 5,
            }}
          >
            <Box
              sx={{
                alignItems: 'flex-start',
                display: 'flex',
                gap: 1,
                justifyContent: 'space-between',
              }}
            >
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  gap: 1.5,
                  minWidth: 0,
                }}
              >
                <Box
                  aria-label={
                    actionTarget.authorAddress === myAddress
                      ? 'Change character skin'
                      : `${actionTargetName} character`
                  }
                  component={
                    actionTarget.authorAddress === myAddress ? 'button' : 'div'
                  }
                  onClick={
                    actionTarget.authorAddress === myAddress
                      ? () => {
                          setActionTarget(null);
                          openSkinSelector();
                        }
                      : undefined
                  }
                  sx={{
                    appearance: 'none',
                    background: alpha('#0a1324', 0.9),
                    border: `1.5px solid ${alpha('#2cf8ff', 0.82)}`,
                    borderRadius: '50%',
                    cursor:
                      actionTarget.authorAddress === myAddress
                        ? 'pointer'
                        : 'default',
                    flex: '0 0 auto',
                    height: 68,
                    overflow: 'visible',
                    padding: 0,
                    position: 'relative',
                    width: 68,
                    '&:hover': {
                      borderColor: '#79f8ff',
                    },
                    '&:hover .skin-edit-button': {
                      backgroundColor: alpha('#16283d', 1),
                      color: '#7df9ff',
                    },
                  }}
                >
                  <Box
                    alt={`${qortalLandSkinForId(actionTargetSkinId).label} character`}
                    component="img"
                    src={qortalLandSkinForId(actionTargetSkinId).faceUrl}
                    sx={{
                      borderRadius: '50%',
                      display: 'block',
                      height: '100%',
                      objectFit: 'cover',
                      width: '100%',
                    }}
                  />
                  {actionTarget.authorAddress === myAddress && (
                    <Box
                      className="skin-edit-button"
                      sx={{
                        alignItems: 'center',
                        backgroundColor: alpha('#0b1627', 0.98),
                        border: `1px solid ${alpha('#7ecbff', 0.38)}`,
                        borderRadius: '50%',
                        bottom: -3,
                        boxShadow: `0 2px 8px ${alpha('#000', 0.36)}`,
                        color: '#55dfff',
                        display: 'flex',
                        height: 24,
                        justifyContent: 'center',
                        position: 'absolute',
                        right: -3,
                        transition:
                          'background-color 140ms ease, color 140ms ease',
                        width: 24,
                      }}
                    >
                      <EditRoundedIcon sx={{ fontSize: 14 }} />
                    </Box>
                  )}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      color: theme.palette.text.primary,
                      fontSize: 19,
                      fontWeight: 800,
                      lineHeight: 1.2,
                      marginBottom: 0.65,
                    }}
                  >
                    {actionTargetName}
                  </Typography>
                  <Box
                    sx={{
                      alignItems: 'center',
                      color: alpha('#9bb8d8', 0.72),
                      display: 'flex',
                      fontSize: 12,
                      gap: 0.4,
                      marginBottom: 1,
                    }}
                  >
                    <Typography
                      component="span"
                      sx={{
                        color: 'inherit',
                        fontSize: 'inherit',
                        fontWeight: 600,
                      }}
                    >
                      {shortAddress(actionTarget.authorAddress)}
                    </Typography>
                    <IconButton
                      aria-label="Copy Qortal address"
                      onClick={(event) => {
                        event.stopPropagation();
                        void navigator.clipboard?.writeText(
                          actionTarget.authorAddress
                        );
                      }}
                      size="small"
                      sx={{
                        color: alpha('#79aef2', 0.78),
                        height: 22,
                        padding: 0,
                        width: 22,
                        '&:hover': {
                          backgroundColor: alpha('#79aef2', 0.1),
                          color: '#9ac4ff',
                        },
                      }}
                    >
                      <ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                </Box>
              </Box>
              <IconButton
                aria-label="Close player actions"
                onClick={() => setActionTarget(null)}
                size="small"
                sx={{
                  color: alpha(theme.palette.text.secondary, 0.85),
                  height: 24,
                  marginRight: -0.5,
                  marginTop: -0.5,
                  width: 24,
                  '&:hover': {
                    backgroundColor: alpha('#fff', 0.08),
                    color: theme.palette.text.primary,
                  },
                }}
              >
                <CloseRoundedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Box>
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: 1,
                mb: 1.1,
                mt: 2.75,
              }}
            >
              <Typography
                sx={{
                  color: alpha('#72aaff', 0.9),
                  flex: '0 0 auto',
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                }}
              >
                Mood
              </Typography>
              <Box
                sx={{
                  backgroundColor: alpha('#a8bdd6', 0.16),
                  height: '1px',
                  width: '100%',
                }}
              />
            </Box>
            <Box
              sx={{
                display: 'grid',
                gap: 0.9,
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                mb: isSelfActionTarget ? 0 : 1.25,
              }}
            >
              {LAND_SOCIAL_ACTIONS.map((socialAction) => {
                const busy = Boolean(sendingSocialAction);
                const coolingDown = socialActionCooldownUntil > Date.now();
                const moodCardColor =
                  LAND_SOCIAL_ACTION_CARD_COLORS[socialAction.type];
                const disabled = reticulumReady !== true || busy || coolingDown;
                return (
                  <Button
                    aria-label={`Send ${socialAction.label} effect`}
                    disabled={disabled}
                    key={socialAction.type}
                    onClick={() => void sendSocialAction(socialAction.type)}
                    sx={{
                      backgroundColor: alpha(moodCardColor, 0.075),
                      border: `1px solid ${alpha(moodCardColor, 0.44)}`,
                      borderRadius: '11px',
                      boxShadow: 'none',
                      color: '#f8fbff',
                      flexDirection: 'column',
                      fontSize: 11,
                      fontWeight: 700,
                      gap: 0.45,
                      minHeight: 72,
                      minWidth: 0,
                      padding: '8px 4px',
                      position: 'relative',
                      textTransform: 'none',
                      transition:
                        'background-color 140ms ease, border-color 140ms ease, transform 140ms ease',
                      '&:hover': {
                        backgroundColor: alpha(moodCardColor, 0.14),
                        borderColor: alpha(moodCardColor, 0.7),
                        transform: 'translateY(-1px)',
                      },
                      '&.Mui-disabled': {
                        borderColor: alpha('#fff', 0.08),
                        color: alpha('#fff', 0.3),
                      },
                    }}
                  >
                    <Box
                      component="span"
                      sx={{
                        color: socialAction.color,
                        fontSize: 25,
                        lineHeight: 1,
                      }}
                    >
                      {sendingSocialAction === socialAction.type
                        ? '· · ·'
                        : socialAction.symbol}
                    </Box>
                    {socialAction.label}
                  </Button>
                );
              })}
            </Box>
            {socialActionError && (
              <Typography
                role="alert"
                sx={{ color: theme.palette.error.light, fontSize: 10, mb: 1 }}
              >
                {socialActionError}
              </Typography>
            )}
            <Button
              fullWidth
              startIcon={<PaidRoundedIcon fontSize="small" />}
              onClick={() => openSendQortDialog(actionTarget)}
              sx={{
                backgroundColor: alpha('#ffcf5a', 0.15),
                border: `1px solid ${alpha('#ffcf5a', 0.34)}`,
                borderRadius: '8px',
                color: '#ffe59b',
                fontSize: 12,
                fontWeight: 800,
                justifyContent: 'flex-start',
                textTransform: 'none',
                display:
                  actionTarget.authorAddress === myAddress ? 'none' : 'flex',
                '&:hover': {
                  backgroundColor: alpha('#ffcf5a', 0.23),
                },
              }}
            >
              Send QORT
            </Button>
            <Button
              disabled={!canStartLandCall}
              fullWidth
              startIcon={<CallRoundedIcon fontSize="small" />}
              onClick={() => startLandCall(actionTarget)}
              sx={{
                backgroundColor:
                  actionTargetInCall || actionTargetInGame || actionTargetDnd
                    ? alpha('#fff', 0.05)
                    : alpha('#2cf8ff', 0.12),
                border: `1px solid ${actionTargetInCall || actionTargetInGame || actionTargetDnd ? alpha('#fff', 0.1) : alpha('#2cf8ff', 0.3)}`,
                borderRadius: '8px',
                color:
                  actionTargetInCall || actionTargetInGame || actionTargetDnd
                    ? alpha(theme.palette.text.secondary, 0.9)
                    : '#9ffcff',
                fontSize: 12,
                fontWeight: 800,
                justifyContent: 'flex-start',
                marginTop: 1,
                textTransform: 'none',
                display:
                  actionTarget.authorAddress === myAddress ? 'none' : 'flex',
                '&:hover': {
                  backgroundColor: alpha('#2cf8ff', 0.2),
                },
                '&.Mui-disabled': {
                  color:
                    actionTargetInCall || actionTargetInGame || actionTargetDnd
                      ? alpha('#ffcf5a', 0.72)
                      : alpha('#fff', 0.32),
                },
              }}
            >
              {actionTargetDnd
                ? 'Do Not Disturb'
                : actionTargetInCall
                  ? 'In a call'
                  : actionTargetInGame
                    ? 'In a game'
                    : `Call ${actionTargetName}`}
            </Button>
            <Button
              disabled={!canStartLandGame}
              fullWidth
              startIcon={<SportsEsportsRoundedIcon fontSize="small" />}
              onClick={() => setShowGamePicker((value) => !value)}
              sx={{
                backgroundColor: alpha('#9d6cff', 0.13),
                border: `1px solid ${alpha('#9d6cff', 0.32)}`,
                borderRadius: '8px',
                color: '#d8c7ff',
                fontSize: 12,
                fontWeight: 800,
                justifyContent: 'flex-start',
                marginTop: 1,
                textTransform: 'none',
                display:
                  actionTarget.authorAddress === myAddress ? 'none' : 'flex',
              }}
            >
              {actionTargetDnd
                ? 'Do Not Disturb'
                : actionTargetInGame
                  ? 'In a game'
                  : 'Play games'}
            </Button>
            {showGamePicker && actionTarget.authorAddress !== myAddress && (
              <Box sx={{ mt: 0.5 }}>
                {(['connect-four', 'checkers', 'chess'] as const).map(
                  (game) => (
                    <Button
                      disabled={!canStartLandGame}
                      fullWidth
                      key={game}
                      onClick={() => {
                        const target =
                          resolveCurrentLandActionTarget(actionTarget);
                        if (!target?.destinationHash) return;
                        setActionTarget(null);
                        setShowGamePicker(false);
                        void landGame.challenge(
                          {
                            address: target.authorAddress,
                            sessionId: target.sessionId,
                            destinationHash: target.destinationHash,
                            name: displayNameForAddress(
                              target.authorAddress,
                              primaryNameCacheRef.current
                            ),
                          },
                          game
                        );
                      }}
                      sx={{
                        color: '#f8fbff',
                        fontSize: 12,
                        justifyContent: 'flex-start',
                        textTransform: 'none',
                      }}
                    >
                      {game === 'connect-four'
                        ? 'Qonnect Four'
                        : game === 'checkers'
                          ? 'Checkers'
                          : 'Chess'}
                    </Button>
                  )
                )}
              </Box>
            )}
          </Box>
        </ClickAwayListener>
      )}
      <Dialog
        open={isSkinSelectorOpen}
        onClose={() => setIsSkinSelectorOpen(false)}
        PaperProps={{
          sx: {
            background: `linear-gradient(180deg, ${alpha('#10182a', 0.99)}, ${alpha('#070914', 0.99)})`,
            border: `1px solid ${alpha('#2cf8ff', 0.3)}`,
            borderRadius: '14px',
            color: '#f8fbff',
            maxWidth: 680,
            width: 'calc(100% - 32px)',
          },
        }}
      >
        <DialogTitle sx={{ fontSize: 22, fontWeight: 850, pb: 0.75 }}>
          Choose your character
        </DialogTitle>
        <DialogContent>
          <Typography
            sx={{ color: alpha('#f8fbff', 0.62), fontSize: 13, mb: 2 }}
          >
            Select the look other players will see in QortalLand.
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gap: 1.25,
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                sm: 'repeat(3, minmax(0, 1fr))',
              },
            }}
          >
            {QORTAL_LAND_CHARACTER_SKINS.map((skin) => {
              const selected = pendingSkinId === skin.id;
              return (
                <Box
                  aria-label={`Select ${skin.label} character`}
                  component="button"
                  key={skin.id}
                  onClick={() => setPendingSkinId(skin.id)}
                  sx={{
                    alignItems: 'center',
                    backgroundColor: selected
                      ? alpha('#2cf8ff', 0.13)
                      : alpha('#fff', 0.035),
                    border: `1px solid ${
                      selected ? alpha('#2cf8ff', 0.72) : alpha('#fff', 0.11)
                    }`,
                    borderRadius: '11px',
                    color: '#f8fbff',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.5,
                    minHeight: 190,
                    overflow: 'hidden',
                    padding: '8px 8px 10px',
                    position: 'relative',
                    transition:
                      'background-color 140ms ease, border-color 140ms ease, transform 140ms ease',
                    '&:hover': {
                      backgroundColor: alpha('#2cf8ff', 0.09),
                      borderColor: alpha('#2cf8ff', 0.46),
                      transform: 'translateY(-1px)',
                    },
                  }}
                >
                  <Box
                    sx={{
                      backgroundImage: `url(${skin.spritesheetUrl})`,
                      backgroundPosition: '0% 50%',
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: `${LAND_CHARACTER_FRAMES_PER_DIRECTION * 100}% 300%`,
                      height: 150,
                      width: 150,
                    }}
                  />
                  <Typography sx={{ fontSize: 12, fontWeight: 750 }}>
                    {skin.label}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            onClick={() => setIsSkinSelectorOpen(false)}
            sx={{ color: alpha('#f8fbff', 0.7), textTransform: 'none' }}
          >
            Cancel
          </Button>
          <Button
            onClick={applySelectedSkin}
            variant="contained"
            sx={{
              borderRadius: '8px',
              fontWeight: 750,
              minWidth: 112,
              textTransform: 'none',
            }}
          >
            Use character
          </Button>
        </DialogActions>
      </Dialog>
      {landGame.modal}
      {localLandCallActive && (
        <Box
          sx={{
            alignItems: 'center',
            background: `linear-gradient(135deg, ${alpha('#091425', 0.94)}, ${alpha('#070914', 0.9)})`,
            border: `1px solid ${alpha('#2cf8ff', 0.26)}`,
            borderRadius: '12px',
            boxShadow: `0 18px 42px ${alpha('#000', 0.42)}, 0 0 28px ${alpha('#2cf8ff', 0.08)}`,
            display: 'flex',
            gap: 1.25,
            left: 16,
            maxWidth: 'min(360px, calc(100% - 32px))',
            padding: '10px 12px',
            position: 'absolute',
            top: 56,
            zIndex: 4,
          }}
        >
          <Box
            sx={{
              alignItems: 'center',
              backgroundColor: alpha('#2cf8ff', 0.16),
              border: `1px solid ${alpha('#2cf8ff', 0.42)}`,
              borderRadius: '50%',
              color: '#9ffcff',
              display: 'flex',
              height: 38,
              justifyContent: 'center',
              width: 38,
            }}
          >
            <CallRoundedIcon fontSize="small" />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              {activeLandCallPeerName || 'QortalLand call'}
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.92),
                fontSize: 11,
              }}
            >
              {activeLandCallSubtitle}
            </Typography>
          </Box>
          <IconButton
            aria-label="End QortalLand call"
            onClick={() => {
              recordLandActivity();
              void landVoiceCall.hangUp();
            }}
            sx={{
              backgroundColor: alpha('#ff4f6d', 0.16),
              border: `1px solid ${alpha('#ff4f6d', 0.34)}`,
              color: '#ff9aaa',
              height: 34,
              marginLeft: 'auto',
              width: 34,
              '&:hover': {
                backgroundColor: alpha('#ff4f6d', 0.28),
              },
            }}
          >
            <CallEndRoundedIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
      <Dialog
        open={Boolean(sendQortTarget)}
        onClose={closeSendQortDialog}
        PaperProps={{
          sx: {
            background: `linear-gradient(180deg, ${alpha('#11182a', 0.98)}, ${alpha('#070914', 0.98)})`,
            border: `1px solid ${alpha('#ffcf5a', 0.24)}`,
            borderRadius: '12px',
            boxShadow: `0 24px 70px ${alpha('#000', 0.55)}, 0 0 34px ${alpha('#ffcf5a', 0.08)}`,
            color: theme.palette.text.primary,
            width: 'min(420px, calc(100vw - 36px))',
          },
        }}
      >
        <DialogTitle
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: 1,
            padding: '18px 20px 8px',
          }}
        >
          <PaidRoundedIcon sx={{ color: '#ffcf5a' }} />
          <Box>
            <Typography sx={{ fontSize: 17, fontWeight: 800 }}>
              Send QORT
            </Typography>
            <Typography
              sx={{ color: theme.palette.text.secondary, fontSize: 12 }}
            >
              To {sendQortTargetName || 'player'}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ padding: '10px 20px 4px' }}>
          <Box
            sx={{
              backgroundColor: alpha('#000', 0.18),
              border: `1px solid ${alpha('#fff', 0.08)}`,
              borderRadius: '9px',
              marginBottom: 1.5,
              padding: '10px 12px',
            }}
          >
            <Typography
              sx={{ color: theme.palette.text.secondary, fontSize: 11 }}
            >
              Recipient
            </Typography>
            <Typography sx={{ fontSize: 14, fontWeight: 800 }}>
              {sendQortTargetName || '-'}
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.secondary, 0.85),
                fontSize: 11,
              }}
            >
              {sendQortTarget?.authorAddress || ''}
            </Typography>
          </Box>
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: 12,
              marginBottom: 1,
            }}
          >
            Balance:{' '}
            <Box component="span" sx={{ color: '#ffe59b', fontWeight: 800 }}>
              {formatQortAmount(qortBalance)} QORT
            </Box>
          </Typography>
          <Stack direction="row" spacing={1} sx={{ marginBottom: 1.5 }}>
            {['1', '5', '10'].map((amount) => (
              <Button
                key={amount}
                onClick={() => {
                  setSendQortAmount(amount);
                  if (sendQortError) setSendQortError('');
                }}
                sx={{
                  backgroundColor:
                    sendQortAmount === amount
                      ? alpha('#ffcf5a', 0.24)
                      : alpha('#fff', 0.06),
                  border: `1px solid ${sendQortAmount === amount ? alpha('#ffcf5a', 0.52) : alpha('#fff', 0.1)}`,
                  borderRadius: '8px',
                  color:
                    sendQortAmount === amount
                      ? '#ffe59b'
                      : theme.palette.text.primary,
                  flex: 1,
                  fontWeight: 800,
                  minWidth: 0,
                  textTransform: 'none',
                  '&:hover': {
                    backgroundColor: alpha('#ffcf5a', 0.18),
                  },
                }}
              >
                {amount}
              </Button>
            ))}
            <Button
              onClick={() => {
                setSendQortAmount('');
                if (sendQortError) setSendQortError('');
              }}
              sx={{
                backgroundColor: !['1', '5', '10'].includes(sendQortAmount)
                  ? alpha('#2cf8ff', 0.12)
                  : alpha('#fff', 0.06),
                border: `1px solid ${!['1', '5', '10'].includes(sendQortAmount) ? alpha('#2cf8ff', 0.34) : alpha('#fff', 0.1)}`,
                borderRadius: '8px',
                color: theme.palette.text.primary,
                flex: 1,
                fontWeight: 800,
                minWidth: 0,
                textTransform: 'none',
              }}
            >
              Other
            </Button>
          </Stack>
          <TextField
            autoFocus
            error={Boolean(sendQortError)}
            fullWidth
            label="Amount"
            placeholder="0.00000000"
            size="small"
            type="number"
            value={sendQortAmount}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">QORT</InputAdornment>
              ),
            }}
            onChange={(event) => {
              setSendQortAmount(event.target.value);
              if (sendQortError) setSendQortError('');
            }}
            sx={{ marginBottom: 1.2 }}
          />
          <Typography
            sx={{
              color: sendQortError
                ? theme.palette.error.light
                : theme.palette.text.secondary,
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            {sendQortError ||
              'Click Send QORT to submit the payment. The room animation is sent after it succeeds.'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ padding: '12px 20px 18px' }}>
          <Button
            disabled={isSendingQort}
            onClick={closeSendQortDialog}
            sx={{ color: theme.palette.text.secondary, textTransform: 'none' }}
          >
            Cancel
          </Button>
          <Button
            disabled={!canSendQort}
            onClick={() => void handleSendQort()}
            sx={{
              backgroundColor: alpha('#ffcf5a', 0.18),
              border: `1px solid ${alpha('#ffcf5a', 0.38)}`,
              borderRadius: '8px',
              color: '#ffe59b',
              fontWeight: 800,
              minWidth: 118,
              textTransform: 'none',
              '&:hover': {
                backgroundColor: alpha('#ffcf5a', 0.26),
              },
              '&.Mui-disabled': {
                color: alpha('#fff', 0.32),
              },
            }}
          >
            {isSendingQort ? 'Sending...' : 'Send QORT'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        disableEscapeKeyDown
        open={Boolean(landVoiceCall.incomingCall)}
        PaperProps={{
          sx: {
            background: `linear-gradient(180deg, ${alpha('#10182a', 0.98)}, ${alpha('#070914', 0.98)})`,
            border: `1px solid ${alpha('#2cf8ff', 0.28)}`,
            borderRadius: '12px',
            boxShadow: `0 24px 70px ${alpha('#000', 0.55)}, 0 0 34px ${alpha('#2cf8ff', 0.08)}`,
            color: theme.palette.text.primary,
            width: 'min(390px, calc(100vw - 36px))',
          },
        }}
      >
        <DialogTitle
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: 1,
            padding: '18px 20px 8px',
          }}
        >
          <CallRoundedIcon sx={{ color: '#9ffcff' }} />
          <Box>
            <Typography sx={{ fontSize: 17, fontWeight: 800 }}>
              Incoming Call
            </Typography>
            <Typography
              sx={{ color: theme.palette.text.secondary, fontSize: 12 }}
            >
              {incomingLandCallName || 'QortalLand player'}
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ padding: '10px 20px 4px' }}>
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            Accept this QortalLand voice call?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ padding: '12px 20px 18px' }}>
          <Button
            onClick={() => {
              recordLandActivity();
              landVoiceCall.rejectCall();
            }}
            sx={{ color: theme.palette.text.secondary, textTransform: 'none' }}
          >
            Decline
          </Button>
          <Button
            onClick={() => {
              recordLandActivity();
              void landVoiceCall.acceptCall();
            }}
            startIcon={<CallRoundedIcon fontSize="small" />}
            sx={{
              backgroundColor: alpha('#2cf8ff', 0.16),
              border: `1px solid ${alpha('#2cf8ff', 0.38)}`,
              borderRadius: '8px',
              color: '#9ffcff',
              fontWeight: 800,
              minWidth: 108,
              textTransform: 'none',
              '&:hover': {
                backgroundColor: alpha('#2cf8ff', 0.26),
              },
            }}
          >
            Accept
          </Button>
        </DialogActions>
      </Dialog>
      {reticulumReady === false && (
        <Box
          sx={{
            alignItems: 'center',
            backgroundColor: 'rgba(9, 13, 18, 0.86)',
            bottom: 0,
            display: 'flex',
            justifyContent: 'center',
            left: 0,
            position: 'absolute',
            right: 0,
            top: 42,
            zIndex: 3,
          }}
        >
          <Typography
            sx={{ color: theme.palette.text.secondary, fontSize: 14 }}
          >
            Reticulum chat is disabled
          </Typography>
        </Box>
      )}
    </Box>
  );
}
