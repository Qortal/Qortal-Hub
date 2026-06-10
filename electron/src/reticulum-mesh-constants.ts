/**
 * Reticulum hub-to-hub mesh (separate from TLS P2P in p2p-network.ts).
 * Managed rnsd config uses TCPClient hubs and mesh listen
 * (BackboneInterface on Linux, TCPServer elsewhere).
 */

/** Dedicated listen port for mesh listen (distinct from community hub 4242). */
export const DEFAULT_RETICULUM_MESH_LISTEN_PORT = 4243;
