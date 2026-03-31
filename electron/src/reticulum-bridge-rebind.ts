/**
 * After the Reticulum bridge process is replaced (e.g. mesh-driven rnsd restart),
 * rebinding consumers avoids stale bridge references without tearing down P2P rooms.
 */
import { getCallManager } from './call';
import { getGroupCallManager } from './group-call';
import { log as loggerLog, warn as loggerWarn } from './logger';
import { getPresenceManager, setPresenceManagerTransports } from './presence';
import { getReticulumBridge } from './reticulum-bridge';

export function rebindReticulumBridgeConsumers(): void {
  const bridge = getReticulumBridge();
  if (!bridge || bridge.getState() !== 'ready') {
    loggerWarn(
      '[Reticulum] rebindReticulumBridgeConsumers: bridge missing or not ready'
    );
    return;
  }
  const pm = getPresenceManager();
  if (pm) {
    setPresenceManagerTransports([bridge]);
    loggerLog('[Reticulum] Rebound presence transport after bridge restart');
  }
  getCallManager()?.setReticulumBridge(bridge);
  getGroupCallManager()?.setReticulumBridge(bridge);
  loggerLog('[Reticulum] Rebound call + group-call managers after bridge restart');
}
