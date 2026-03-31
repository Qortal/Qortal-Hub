/**
 * Reticulum hub-to-hub mesh (separate from TLS P2P in p2p-network.ts).
 * RNS transport is extended via managed rnsd config (TCPClientInterface / TCPServerInterface).
 */

/** Dedicated listen port for mesh TCPServerInterface (distinct from community hub 4242). */
export const DEFAULT_RETICULUM_MESH_LISTEN_PORT = 4243;

export const MAX_MESH_OUTBOUND_PEERS = 8;
export const MAX_MESH_STORED_ENDPOINTS = 256;
export const MAX_SHARED_PEERS_PER_MESSAGE = 20;
/** Per remote Reticulum identity (presence hash), rolling 60s window */
export const MAX_PEER_REQUESTS_PER_MINUTE = 12;

export const MIN_MESH_DAEMON_RESTART_INTERVAL_MS = 5 * 60 * 1000;
/** Flush pending mesh config immediately when this many apply requests stack up */
export const MAX_PENDING_MESH_CHANGES_BEFORE_RESTART = 32;

export const MESH_MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000;

/** Coalesce rapid presence-updated bursts before scanning fanout hashes. */
export const MESH_FANOUT_PRESENCE_DEBOUNCE_MS = 75;

/** Max immediate HUB_MESH_PEER_REQUEST probes per presence-updated event (rest deferred to maintenance). */
export const MAX_IMMEDIATE_MESH_PROBES_PER_EVENT = 8;
