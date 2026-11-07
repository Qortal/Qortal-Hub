import { EventEmitter } from 'events';
import type {
  QAppReticulumNativeEvent,
  QAppReticulumTransport,
} from './qapp-reticulum-manager';

type Bridge = EventEmitter & {
  invokeQAppReticulum(
    action: any,
    payload: Record<string, unknown>
  ): ReturnType<QAppReticulumTransport['invoke']>;
};

/** Own the listeners as well as the bridge reference across process replacement. */
export class QAppReticulumBridgeTransport implements QAppReticulumTransport {
  private readonly events = new EventEmitter();
  private bridge: Bridge | null = null;
  private readonly forward = (event: QAppReticulumNativeEvent) =>
    this.events.emit('message', event);
  private readonly reset = () => this.events.emit('reset');

  constructor(private readonly readyBridge: () => Promise<Bridge>) {}

  async invoke(action: string, payload: Record<string, unknown>) {
    const bridge = await this.readyBridge();
    if (this.bridge !== bridge && this.events.listenerCount('message')) {
      if (this.bridge) this.reset();
      this.detachBridge();
      this.bridge = bridge;
      bridge.on('qapp-rns', this.forward);
      bridge.on('degraded', this.reset);
      bridge.on('stopped', this.reset);
    }
    return bridge.invokeQAppReticulum(action, payload);
  }

  onEvent(listener: (event: QAppReticulumNativeEvent) => void) {
    return this.listen('message', listener);
  }

  onReset(listener: () => void) {
    return this.listen('reset', listener);
  }

  private listen(event: string, listener: (...args: any[]) => void) {
    this.events.on(event, listener);
    return () => {
      this.events.off(event, listener);
      if (
        !this.events.listenerCount('message') &&
        !this.events.listenerCount('reset')
      )
        this.detachBridge();
    };
  }

  private detachBridge() {
    this.bridge?.off('qapp-rns', this.forward);
    this.bridge?.off('degraded', this.reset);
    this.bridge?.off('stopped', this.reset);
    this.bridge = null;
  }
}
