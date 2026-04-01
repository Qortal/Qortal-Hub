/**
 * Reticulum hub-to-hub mesh (separate from TLS P2P in p2p-network.ts).
 * Managed rnsd config uses TCPClient hubs, mesh listen (BackboneInterface on Linux, TCPServer elsewhere), and AutoInterface.
 */

/** Dedicated listen port for mesh listen (distinct from community hub 4242). */
export const DEFAULT_RETICULUM_MESH_LISTEN_PORT = 4243;

/** Cap for autoconnect_discovered_interfaces (matches prior sparse outbound cap). */
export const MAX_MESH_OUTBOUND_PEERS = 8;
