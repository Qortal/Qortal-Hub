/**
 * Safe logger for Electron build/dev scripts. Uses console when available;
 * no-ops if console is missing or throws (e.g. in some packaged contexts).
 */
const noop = () => {};
function bind(fn) {
  try {
    return typeof console !== 'undefined' && typeof console[fn] === 'function'
      ? console[fn].bind(console)
      : noop;
  } catch {
    return noop;
  }
}

module.exports = {
  log: bind('log'),
  error: bind('error'),
  warn: bind('warn'),
  debug: bind('debug'),
  info: bind('info'),
};
