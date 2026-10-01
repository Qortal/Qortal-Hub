export type ReadinessState = 'idle' | 'starting' | 'ready' | 'failed';

export type ReadinessStatus = {
  state: ReadinessState;
  revision: number;
  error?: string;
};

type SingleFlightReadinessOptions = {
  isReady: () => boolean;
  onStatusChange?: (status: ReadinessStatus) => void;
  start: () => Promise<void>;
};

export class SingleFlightReadiness {
  private activeStart: Promise<void> | null = null;
  private generation = 0;
  private status: ReadinessStatus = { state: 'idle', revision: 0 };

  constructor(private readonly options: SingleFlightReadinessOptions) {}

  getStatus(): ReadinessStatus {
    if (this.options.isReady()) {
      return { state: 'ready', revision: this.status.revision };
    }
    return { ...this.status };
  }

  ensureReady(): Promise<void> {
    if (this.activeStart) {
      return this.activeStart;
    }

    // Callers use ensureReady() at request boundaries. Once the target exists,
    // another call is not a lifecycle transition and must not publish a false
    // `starting -> ready` cycle. Consumers treat that cycle as a reconnect and
    // may perform expensive recovery work.
    if (this.options.isReady()) {
      return Promise.resolve();
    }

    this.setStatus({ state: 'starting' });
    const generation = this.generation;
    const start = Promise.resolve()
      .then(() => this.options.start())
      .then(() => {
        if (generation !== this.generation) return;
        if (!this.options.isReady()) {
          throw new Error('Readiness target did not start');
        }
        this.setStatus({ state: 'ready' });
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) throw error;
        if (this.options.isReady()) {
          this.setStatus({ state: 'ready' });
        } else {
          this.setStatus({
            state: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
        throw error;
      })
      .finally(() => {
        if (this.activeStart === start) {
          this.activeStart = null;
        }
      });
    this.activeStart = start;
    return start;
  }

  reset(): void {
    this.generation += 1;
    this.activeStart = null;
    this.setStatus({ state: 'idle' });
  }

  private setStatus(status: Omit<ReadinessStatus, 'revision'>): void {
    this.status = {
      ...status,
      revision: this.status.revision + 1,
    };
    this.options.onStatusChange?.({ ...this.status });
  }
}
