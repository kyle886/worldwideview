/**
 * Tests for PollingManager.
 *
 * Uses vitest fake timers. The scheduler is setTimeout-based so we can
 * deterministically advance time and observe tick counts. Backoff math is
 * exercised with a callback that throws on demand.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPollingManager } from './PollingManager';

describe('PollingManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs the callback immediately on start, then on interval', async () => {
    const pm = createPollingManager();
    const cb = vi.fn(async () => {});
    pm.register('p', 1000, cb);
    pm.start('p');

    // The initial tick is scheduled with setTimeout(0); flush microtasks too.
    await vi.advanceTimersByTimeAsync(0);
    expect(cb).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).toHaveBeenCalledTimes(3);

    pm.stop('p');
  });

  it('stop() prevents further ticks', async () => {
    const pm = createPollingManager();
    const cb = vi.fn(async () => {});
    pm.register('p', 1000, cb);
    pm.start('p');
    await vi.advanceTimersByTimeAsync(0);
    pm.stop('p');
    await vi.advanceTimersByTimeAsync(5000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('exponential backoff after errors, capped at maxBackoff', async () => {
    const pm = createPollingManager({ maxBackoffMs: 8000 });
    let i = 0;
    const cb = vi.fn(async () => {
      i++;
      throw new Error(`fail ${i}`);
    });
    // Silence the warn line so the test output stays readable.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pm.register('p', 1000, cb);
    pm.start('p');
    await vi.advanceTimersByTimeAsync(0); // tick 1 (immediate) → error count 1

    // Next delay = 1000 * 2^1 = 2000
    await vi.advanceTimersByTimeAsync(2000); // tick 2 → error count 2
    expect(cb).toHaveBeenCalledTimes(2);

    // Next delay = 1000 * 2^2 = 4000
    await vi.advanceTimersByTimeAsync(4000); // tick 3
    expect(cb).toHaveBeenCalledTimes(3);

    // Next delay would be 8000 (capped)
    await vi.advanceTimersByTimeAsync(8000); // tick 4
    expect(cb).toHaveBeenCalledTimes(4);

    // Still 8000 (cap)
    await vi.advanceTimersByTimeAsync(8000); // tick 5
    expect(cb).toHaveBeenCalledTimes(5);

    pm.stop('p');
    warn.mockRestore();
  });

  it('resets the error count on success', async () => {
    const pm = createPollingManager();
    let willThrow = true;
    const cb = vi.fn(async () => {
      if (willThrow) throw new Error('boom');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pm.register('p', 1000, cb);
    pm.start('p');
    await vi.advanceTimersByTimeAsync(0); // error count → 1

    willThrow = false;
    await vi.advanceTimersByTimeAsync(2000); // success → count resets to 0

    // Next delay should be back to the base 1000ms.
    await vi.advanceTimersByTimeAsync(1000);
    expect(cb).toHaveBeenCalledTimes(3);
    pm.stop('p');
    warn.mockRestore();
  });

  it('pause() suppresses tick execution; resume() continues', async () => {
    const pm = createPollingManager();
    const cb = vi.fn(async () => {});
    pm.register('p', 1000, cb);
    pm.start('p');
    await vi.advanceTimersByTimeAsync(0);
    expect(cb).toHaveBeenCalledTimes(1);

    pm.pause('p');
    await vi.advanceTimersByTimeAsync(5000);
    expect(cb).toHaveBeenCalledTimes(1); // no new ticks

    pm.resume('p');
    await vi.advanceTimersByTimeAsync(0); // immediate tick on resume's start()
    expect(cb).toHaveBeenCalledTimes(2);
    pm.stop('p');
  });

  it('setInterval() reschedules the next tick at the new cadence', async () => {
    const pm = createPollingManager();
    const cb = vi.fn(async () => {});
    pm.register('p', 1000, cb);
    pm.start('p');
    await vi.advanceTimersByTimeAsync(0);
    expect(cb).toHaveBeenCalledTimes(1);

    pm.setInterval('p', 250);
    await vi.advanceTimersByTimeAsync(250);
    expect(cb).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(250);
    expect(cb).toHaveBeenCalledTimes(3);
    pm.stop('p');
  });

  it('does not run two ticks concurrently for the same plugin', async () => {
    const pm = createPollingManager();
    let inFlight = 0;
    let maxConcurrent = 0;
    const cb = vi.fn(async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      // Hold the tick "in flight" for 2 intervals.
      await new Promise<void>((r) => setTimeout(r, 2000));
      inFlight--;
    });
    pm.register('p', 500, cb);
    pm.start('p');

    // Drive forward; even though the interval is 500ms, the slow callback
    // takes 2000ms — ticks must not stack.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(maxConcurrent).toBe(1);
    pm.stop('p');
  });

  it('unregister stops and removes the task', async () => {
    const pm = createPollingManager();
    const cb = vi.fn(async () => {});
    pm.register('p', 1000, cb);
    pm.start('p');
    await vi.advanceTimersByTimeAsync(0);
    pm.unregister('p');
    expect(pm.isPolling('p')).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
