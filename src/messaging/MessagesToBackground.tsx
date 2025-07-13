// Utility to generate unique request IDs
function generateRequestId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Map to store callbacks by requestId
const callbackMap = new Map();

// Global listener for handling message responses
window.addEventListener('message', (event) => {
  const { type, requestId, payload, error, message } = event.data;

  // Only process messages of type `backgroundMessageResponse`
  if (type !== 'backgroundMessageResponse') return;

  // Check if there’s a callback stored for this requestId
  if (callbackMap.has(requestId)) {
    const { resolve } = callbackMap.get(requestId);
    callbackMap.delete(requestId); // Remove callback after use

    resolve(event.data);
  }
});

export const sendMessageBackground = (
  action,
  data = {},
  timeout = 600000,
  isExtension?,
  appInfo?,
  skipAuth?
) => {
  return new Promise((resolve, reject) => {
    const requestId = generateRequestId(); // Unique ID for each request
    callbackMap.set(requestId, { resolve, reject }); // Store both resolve and reject callbacks
    const targetOrigin = window.location.origin;
    // Send the message with `backgroundMessage` type
    window.postMessage(
      {
        type: 'backgroundMessage',
        action,
        requestId,
        payload: data,
        isExtension,
        appInfo,
        skipAuth,
      },
      targetOrigin
    );

    // Set up a timeout to automatically reject if no response is received
    const timeoutId = setTimeout(() => {
      // Remove the callback to prevent memory leaks
      callbackMap.delete(requestId);
      reject({
        error: 'timeout',
        message: `Request timed out after ${timeout} ms`,
      });
    }, timeout);

    // Adjust resolve/reject to clear the timeout when a response arrives
    callbackMap.set(requestId, {
      resolve: (response) => {
        clearTimeout(timeoutId); // Clear the timeout if the response is received in time
        resolve(response);
      },
      reject: (error) => {
        clearTimeout(timeoutId); // Clear the timeout if an error occurs
        reject(error);
      },
    });
  }).then((response) => {
    console.log('response', response);
    // Return payload or error based on response content
    if (response?.payload !== null && response?.payload !== undefined) {
      return response.payload;
    } else if (response?.error) {
      return {
        error: response.error,
        message: response?.message || 'An error occurred',
      };
    }
  });
};

// Attach to window for global access
declare global {
  interface Window {
    sendMessage: typeof sendMessageBackground;
  }
}
window.sendMessage = sendMessageBackground;
