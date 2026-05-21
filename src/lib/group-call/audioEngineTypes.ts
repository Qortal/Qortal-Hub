import type { GroupCallAudioQualityProfile } from './groupCallAudioProfile';
import type { GroupCallLocalConnectionHint } from './groupCallLocalConnectionHint';
import type { GroupCallMetricsSnapshot } from './router';

export type AudioEngineRoomState = 'idle' | 'joining' | 'connected' | 'ended';

export type AudioEngineRole =
  | 'participant'
  | 'cluster-forwarder'
  | 'root-forwarder'
  | 'standby-forwarder';

export type AudioEngineTopologyLabel = 'Reticulum';

export type AudioEngineSelectableStatus =
  | 'online'
  | 'busy'
  | 'offline';

export interface AudioEngineParticipant {
  address: string;
  publicKey: string;
  speaking: boolean;
  role: AudioEngineRole;
}

export interface AudioEngineJoinOptions {
  memberGateGroupId?: number;
  memberGateGroupName?: string;
  memberGateAddresses?: string[];
}

export type GroupCallStartupStage =
  | 'idle'
  | 'joining-call'
  | 'syncing-participants'
  | 'securing-audio'
  | 'starting-audio'
  | 'connected'
  | 'degraded';

export interface GroupCallStartupStatus {
  stage: GroupCallStartupStage;
  headline: string;
  detail: string | null;
  tone: 'neutral' | 'info' | 'warning';
  showProgress: boolean;
  delayed: boolean;
}

export interface AudioEngineUserIdentity {
  address: string;
  publicKey: string;
  name?: string;
}

export interface GroupCallControllerSnapshot {
  roomState: AudioEngineRoomState;
  participants: AudioEngineParticipant[];
  myRole: AudioEngineRole;
  activeSpeakers: string[];
  metrics: GroupCallMetricsSnapshot;
  mediaViable: boolean;
  localConnectionHint: GroupCallLocalConnectionHint | null;
  topologyLabel: AudioEngineTopologyLabel;
  gcallJoinError: string | null;
  muted: boolean;
  hearCall: boolean;
  roomId: string;
  memberPrimaryNames: Record<string, string>;
  memberGateGroupName: string;
  audioQualityProfile: GroupCallAudioQualityProfile;
  startupStatus: GroupCallStartupStatus;
}

export interface GroupCallControllerApi extends GroupCallControllerSnapshot {
  joinGroupCall: (
    roomId: string,
    chatId: string,
    options?: AudioEngineJoinOptions
  ) => Promise<void>;
  leaveGroupCall: () => Promise<void>;
  clearGcallJoinError: () => void;
  exportGroupCallDiagnostics: (options?: {
    download?: boolean;
    clipboard?: boolean;
  }) => Promise<unknown>;
  setMuted: (muted: boolean) => void;
  setHearCall: (hearCall: boolean) => void;
  toggleHearCall: () => void;
}
