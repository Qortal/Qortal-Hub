export const executeEvent = (eventName: string, data: any) => {
  const event = new CustomEvent(eventName, { detail: data });
  document.dispatchEvent(event);
};

export const subscribeToEvent = (eventName: string, listener: any) => {
  document.addEventListener(eventName, listener);
};

export const unsubscribeFromEvent = (eventName: string, listener: any) => {
  document.removeEventListener(eventName, listener);
};
