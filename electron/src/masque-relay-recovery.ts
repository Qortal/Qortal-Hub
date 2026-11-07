/** Try another route after network-path or relay-policy failure. Inner QUIC
 * failure may be a broken relay route even when outer QUIC is still healthy.
 * Local sidecar/IPC failures are not evidence against the network route.
 */
export function shouldExcludeMasqueRelay(code: string | undefined): boolean {
  return [
    'RELAY_CONNECT_FAILED',
    'RELAY_CONNECTION_CLOSED',
    'RELAY_TARGET_DENIED',
    'RELAY_FULL',
    'RELAY_AUTH_REQUIRED',
    'RELAY_ACCESS_DENIED',
    'RELAY_MEMBERSHIP_UNAVAILABLE',
    'MASQUE_TUNNEL_FAILED',
    'INNER_QUIC_FAILED',
    'TRANSPORT_CLOSED',
    'MOQ_TRANSPORT_CLOSED',
    'MOQ_QUIC_FAILED',
    'MOQ_SESSION_CLOSED',
    'MOQ_READ_FAILED',
    'MOQ_SEND_FAILED',
  ].includes(code ?? '');
}
