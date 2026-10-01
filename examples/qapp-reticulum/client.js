/* global qortalRequest */
const destination = 'REPLACE_WITH_32_CHARACTER_DESTINATION_HASH';

window.addEventListener('message', (event) => {
  if (event.data?.action === 'RNS_MESSAGE') {
    console.log(
      'Reticulum message',
      event.data.connectionId,
      event.data.payload
    );
  }
  if (event.data?.action === 'RNS_CONNECTION_STATE') {
    console.log('Reticulum state', event.data.connectionId, event.data.state);
  }
});

const profile = await qortalRequest({
  action: 'RNS_REQUEST',
  destination,
  path: '/hello',
  payload: { name: 'Alice' },
  requestId: crypto.randomUUID(),
});

const connection = await qortalRequest({
  action: 'RNS_CONNECT',
  destination,
});

await qortalRequest({
  action: 'RNS_SEND',
  connectionId: connection.connectionId,
  payload: { type: 'hello', text: profile.message },
});

// Later:
// await qortalRequest({ action: 'RNS_CLOSE', connectionId: connection.connectionId });
