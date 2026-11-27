import type {
  ConnectFourMove,
  ConnectFourOutcome,
  ConnectFourSeat,
  ConnectFourState,
} from './connectFour';
import type { CheckersMove, CheckersOutcome, CheckersState } from './checkers';
import type { ChessMove, ChessOutcome, ChessState } from './chess';

export const QORTAL_LAND_GAME_PROTOCOL = 'qortalland-game' as const;
export const QORTAL_LAND_GAME_PROTOCOL_VERSION = 2 as const;

export type QortalLandGameBootstrap = {
  url: string;
  token: string;
  instanceId: string;
};

export type QortalLandGamePhase =
  | 'idle'
  | 'opening'
  | 'waiting'
  | 'incoming'
  | 'starting'
  | 'active'
  | 'finishing'
  | 'reconnecting'
  | 'finished';

export type QortalLandGameParticipant = {
  address: string;
  publicKey?: string;
  name?: string;
};

export type QortalLandGameMatch = {
  matchId: string;
  groupId: number;
  gameType: 'connect-four' | 'checkers' | 'chess';
  rulesVersion: 1;
  requester: QortalLandGameParticipant;
  recipient: QortalLandGameParticipant;
  requesterNonce: string;
  recipientNonce?: string;
  localSeat?: ConnectFourSeat;
  startingSeat?: ConnectFourSeat;
  phase: QortalLandGamePhase;
  state?: ConnectFourState | CheckersState | ChessState;
  stateHash?: string;
  moves: Array<ConnectFourMove | CheckersMove | ChessMove>;
  pendingMoveId?: string;
  expiresAt?: number;
  reconnectDeadline?: number;
  outcome?: ConnectFourOutcome | CheckersOutcome | ChessOutcome;
  error?: string;
};

export type GameSocketCommand = {
  id: string;
  type:
    | 'AUTH'
    | 'SET_LAND_CONTEXT'
    | 'CLEAR_LAND_CONTEXT'
    | 'OPEN_GAME_LINK'
    | 'SUBMIT_HANDSHAKE_SIGNATURE'
    | 'RESPOND_TO_INVITE'
    | 'SEND_GAME_MESSAGE'
    | 'RESIGN_GAME'
    | 'CLOSE_GAME_LINK'
    | 'GET_ACTIVE_MATCH';
  [key: string]: unknown;
};

export type GameSocketEvent = {
  type: string;
  [key: string]: unknown;
};

export type QortalLandGameWireMessage =
  | ({ type: 'MOVE' | 'SYNC_MOVE'; matchId: string } & (
      | ConnectFourMove
      | CheckersMove
      | ChessMove
    ))
  | {
      type: 'MOVE_ACK';
      matchId: string;
      messageId: string;
      ply: number;
      stateHash: string;
    }
  | {
      type: 'MATCH_PING' | 'MATCH_PONG' | 'RESIGN' | 'RESIGN_ACK';
      matchId: string;
      messageId: string;
    }
  | {
      type: 'GAME_OVER';
      matchId: string;
      messageId: string;
      ply: number;
      stateHash: string;
      outcome: ConnectFourOutcome | CheckersOutcome | ChessOutcome;
    }
  | {
      type: 'GAME_OVER_ACK';
      matchId: string;
      messageId: string;
      ply: number;
      stateHash: string;
    }
  | {
      type: 'SYNC_REQUEST';
      matchId: string;
      messageId: string;
      fromPly: number;
    }
  | {
      type: 'PROTOCOL_ERROR';
      matchId: string;
      messageId: string;
      reason: string;
    };

/** @deprecated Use QortalLandGameWireMessage for all supported games. */
export type ConnectFourWireMessage = QortalLandGameWireMessage;
