/**
 * Whether someone is using Hub right now, for Qortino on Home: he only talks
 * and looks around while they are. Idle is no mouse, keyboard or touch for
 * a while, or Hub's window in the background. Shown as `data-hub-ui-idle="on"`
 * on the document, the same mark GO's idle pause sets, so the Home code is
 * shared with GO.
 */
export const UI_IDLE_ATTR = 'data-hub-ui-idle';
export const UI_IDLE_AFTER_MS = 30_000;

let watchers = 0;
let idleTimer: number | null = null;
let stop: (() => void) | null = null;

function setIdle(idle: boolean): void {
  const root = document.documentElement;
  if (idle) root.setAttribute(UI_IDLE_ATTR, 'on');
  else if (root.hasAttribute(UI_IDLE_ATTR)) root.removeAttribute(UI_IDLE_ATTR);
}

function start(): () => void {
  const scheduleIdle = () => {
    if (idleTimer != null) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      idleTimer = null;
      setIdle(true);
    }, UI_IDLE_AFTER_MS);
  };
  const onActivity = () => {
    setIdle(false);
    scheduleIdle();
  };
  const onBlur = () => {
    if (idleTimer != null) window.clearTimeout(idleTimer);
    idleTimer = null;
    setIdle(true);
  };
  const events = ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const;
  for (const name of events) {
    window.addEventListener(name, onActivity, { passive: true });
  }
  window.addEventListener('focus', onActivity);
  window.addEventListener('blur', onBlur);
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) {
    setIdle(true);
  } else {
    onActivity();
  }
  return () => {
    for (const name of events) window.removeEventListener(name, onActivity);
    window.removeEventListener('focus', onActivity);
    window.removeEventListener('blur', onBlur);
    if (idleTimer != null) window.clearTimeout(idleTimer);
    idleTimer = null;
    setIdle(false);
  };
}

/** Start watching (counted, so several users share one watch); returns the stop. */
export function watchUiActivity(): () => void {
  watchers += 1;
  if (watchers === 1) stop = start();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    watchers -= 1;
    if (watchers === 0) {
      stop?.();
      stop = null;
    }
  };
}
