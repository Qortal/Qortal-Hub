import { describe, expect, it, vi } from 'vitest';
import { ReticulumResourceWorkerPool } from './reticulum-resource-worker-pool';

describe('ReticulumResourceWorkerPool', () => {
  it('bounds admitted work and applies backpressure before falling back', async () => {
    const pool = new ReticulumResourceWorkerPool();
    vi.spyOn(pool as any, 'pump').mockImplementation(() => undefined);

    const tasks = Array.from({ length: 513 }, (_, index) =>
      pool.run({ kind: 'delete_paths', paths: [`/tmp/resource-${index}`] })
    );

    await expect(tasks[512]).resolves.toBeNull();
    expect(pool.stats()).toMatchObject({
      queued: 256,
      waiting: 256,
      active: 0,
    });

    pool.stop();
    await expect(Promise.all(tasks)).resolves.toHaveLength(513);
  });
});
