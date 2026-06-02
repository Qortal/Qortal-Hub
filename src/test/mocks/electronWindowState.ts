export default function windowStateKeeper() {
  return {
    x: undefined,
    y: undefined,
    width: 1280,
    height: 720,
    isMaximized: false,
    manage: () => undefined,
  };
}

