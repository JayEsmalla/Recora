export class BoundedWorkQueue {
  private activeCount = 0;
  private readonly pending: { start: () => void }[] = [];

  constructor(
    private readonly maxActive = 1,
    private readonly maxPending = 2,
  ) {
    if (!Number.isInteger(maxActive) || maxActive < 1 ||
        !Number.isInteger(maxPending) || maxPending < 0) {
      throw new Error('Work queue limits must be valid non-negative integers.');
    }
  }

  get active(): number {
    return this.activeCount;
  }

  get queued(): number {
    return this.pending.length;
  }

  run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(cancelledError());

    if (this.activeCount >= this.maxActive &&
        this.pending.length >= this.maxPending) {
      return Promise.reject(new Error(
        'Receipt recognition is busy. Please try again shortly.',
      ));
    }

    return new Promise<T>((resolve, reject) => {
      let started = false;
      let settled = false;

      const onAbort = () => {
        if (started || settled) return;
        settled = true;
        const index = this.pending.findIndex((item) => item.start === start);
        if (index >= 0) this.pending.splice(index, 1);
        signal?.removeEventListener('abort', onAbort);
        reject(cancelledError());
      };

      const start = () => {
        if (settled) return;
        if (signal?.aborted) {
          onAbort();
          return;
        }

        started = true;
        signal?.removeEventListener('abort', onAbort);
        this.activeCount += 1;

        Promise.resolve()
          .then(work)
          .then(
            (value) => {
              this.activeCount -= 1;
              this.drain();
              resolve(value);
            },
            (error: unknown) => {
              this.activeCount -= 1;
              this.drain();
              reject(error);
            },
          );
      };

      signal?.addEventListener('abort', onAbort, { once: true });
      if (this.activeCount < this.maxActive && this.pending.length === 0) {
        start();
      } else {
        this.pending.push({ start });
      }
    });
  }

  private drain(): void {
    while (this.activeCount < this.maxActive && this.pending.length > 0) {
      const next = this.pending.shift()!;
      next.start();
    }
  }
}

function cancelledError(): Error {
  const error = new Error('Receipt recognition was cancelled.');
  error.name = 'AbortError';
  return error;
}
