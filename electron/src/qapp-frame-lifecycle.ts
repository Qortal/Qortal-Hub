import type { QAppReticulumOwner } from './qapp-reticulum-manager';

/** Shell-owned iframe registrations. Cleanup starts before new document scripts. */
export class QAppFrameLifecycle {
  private readonly owners = new Map<string, QAppReticulumOwner>();

  constructor(
    private readonly cleanup: (owner: QAppReticulumOwner) => Promise<void>
  ) {}

  register(frameName: string, owner: QAppReticulumOwner): void {
    if (this.owners.has(frameName))
      throw new Error('QAPP_FRAME_ALREADY_REGISTERED');
    if (this.owners.size >= 128) throw new Error('QAPP_FRAME_LIMIT');
    this.owners.set(frameName, { ...owner });
  }

  navigate(frameName: string, inPlace: boolean): void {
    if (inPlace) return; // SPA routes and hash changes retain their connections.
    const owner = this.owners.get(frameName);
    if (owner) this.release(owner);
  }

  unregister(frameName: string): void {
    const owner = this.owners.get(frameName);
    this.owners.delete(frameName);
    if (owner) this.release(owner);
  }

  clear(): void {
    const owners = [...this.owners.values()];
    this.owners.clear();
    owners.forEach((owner) => this.release(owner));
  }

  private release(owner: QAppReticulumOwner): void {
    // Invoke synchronously: managers must snapshot old resources now, not after
    // an unrelated transport's asynchronous shutdown finishes.
    void this.cleanup(owner).catch(() => undefined);
  }
}
