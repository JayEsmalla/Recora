import { describe, expect, it } from 'vitest';
import { BoundedWorkQueue } from '../src/ocr/BoundedWorkQueue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('BoundedWorkQueue', () => {
  it('runs only one expensive job at a time and preserves FIFO order', async () => {
    const queue = new BoundedWorkQueue(1, 2);
    const gate = deferred<string>();
    const started: string[] = [];
    const first = queue.run(async () => {
      started.push('first');
      return gate.promise;
    });
    const second = queue.run(async () => {
      started.push('second');
      return 'two';
    });
    const third = queue.run(async () => {
      started.push('third');
      return 'three';
    });

    await Promise.resolve();
    expect(started).toEqual(['first']);
    expect(queue.active).toBe(1);
    expect(queue.queued).toBe(2);

    gate.resolve('one');
    expect(await first).toBe('one');
    expect(await second).toBe('two');
    expect(await third).toBe('three');
    expect(started).toEqual(['first', 'second', 'third']);
    expect(queue.active).toBe(0);
  });

  it('rejects excessive waiting work without starting it', async () => {
    const queue = new BoundedWorkQueue(1, 0);
    const gate = deferred<void>();
    const first = queue.run(() => gate.promise);
    await expect(queue.run(async () => 99)).rejects.toThrow('busy');
    gate.resolve();
    await first;
  });

  it('removes cancelled queued jobs while preserving active work', async () => {
    const queue = new BoundedWorkQueue(1, 2);
    const gate = deferred<void>();
    const active = queue.run(() => gate.promise);
    const controller = new AbortController();
    let launched = false;
    const queued = queue.run(async () => {
      launched = true;
      return 1;
    }, controller.signal);
    expect(queue.queued).toBe(1);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(queue.queued).toBe(0);
    expect(launched).toBe(false);
    gate.resolve();
    await active;
  });

  it('releases capacity when a job fails', async () => {
    const queue = new BoundedWorkQueue(1, 1);
    const failed = queue.run(async () => { throw new Error('native failure'); });
    const recovered = queue.run(async () => 5);
    await expect(failed).rejects.toThrow('native failure');
    expect(await recovered).toBe(5);
  });
});
