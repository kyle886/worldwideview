/**
 * PollingManager — per-plugin interval scheduler with exponential backoff.
 *
 * Adapted from WWV's src/core/data/PollingManager.ts. Two differences:
 *  1. No Zustand subscription. Intervals are updated at runtime via
 *     `setInterval(pluginId, ms)` instead of reading from a store slice.
 *  2. Backoff semantics are preserved verbatim: `intervalMs * 2^errorCount`,
 *     capped at `maxBackoff` (default 60s). Reset on first success.
 *
 * Lifecycle:
 *   manager.register(id, intervalMs, async () => { ... });  // declare a task
 *   manager.start(id);                                       // begin polling
 *   manager.pause(id) / manager.resume(id);                  // tab visibility, etc.
 *   manager.setInterval(id, newMs);                          // live tuning
 *   manager.stop(id) / manager.unregister(id);
 *
 * Errors thrown by the callback are caught, counted, and used to back off
 * the next tick. The current tick is always awaited so two ticks never run
 * concurrently for the same plugin.
 */

interface PollingTask {
  pluginId: string;
  intervalMs: number;
  callback: () => Promise<void>;
  timerId: ReturnType<typeof setTimeout> | null;
  isPaused: boolean;
  inFlight: boolean;
  errorCount: number;
  maxBackoff: number;
}

export interface PollingManagerOptions {
  /** Cap on exponential backoff between retries. Default 60_000ms. */
  maxBackoffMs?: number;
}

class PollingManager {
  private tasks: Map<string, PollingTask> = new Map();
  private defaultMaxBackoff: number;

  constructor(opts: PollingManagerOptions = {}) {
    this.defaultMaxBackoff = opts.maxBackoffMs ?? 60_000;
  }

  register(pluginId: string, intervalMs: number, callback: () => Promise<void>): void {
    if (this.tasks.has(pluginId)) {
      console.warn(`[PollingManager] "${pluginId}" already registered; replacing`);
      this.stop(pluginId);
    }
    this.tasks.set(pluginId, {
      pluginId,
      intervalMs,
      callback,
      timerId: null,
      isPaused: false,
      inFlight: false,
      errorCount: 0,
      maxBackoff: this.defaultMaxBackoff,
    });
  }

  /** Update a registered task's base interval. Takes effect on the next tick. */
  setInterval(pluginId: string, intervalMs: number): void {
    const task = this.tasks.get(pluginId);
    if (!task) return;
    if (task.intervalMs === intervalMs) return;
    task.intervalMs = intervalMs;
    if (task.timerId != null) {
      // Reschedule with the new interval.
      this.stop(pluginId);
      this.start(pluginId);
    }
  }

  start(pluginId: string): void {
    const task = this.tasks.get(pluginId);
    if (!task || task.timerId != null) return;
    this.scheduleNext(task, /* runNow */ true);
  }

  stop(pluginId: string): void {
    const task = this.tasks.get(pluginId);
    if (!task || task.timerId == null) return;
    clearTimeout(task.timerId);
    task.timerId = null;
    task.errorCount = 0;
  }

  pause(pluginId: string): void {
    const task = this.tasks.get(pluginId);
    if (task) task.isPaused = true;
  }

  resume(pluginId: string): void {
    const task = this.tasks.get(pluginId);
    if (!task) return;
    task.isPaused = false;
    if (task.timerId == null) this.start(pluginId);
  }

  stopAll(): void {
    this.tasks.forEach((_, id) => this.stop(id));
  }

  unregister(pluginId: string): void {
    this.stop(pluginId);
    this.tasks.delete(pluginId);
  }

  isPolling(pluginId: string): boolean {
    return this.tasks.get(pluginId)?.timerId != null;
  }

  /**
   * Internal: schedule the next tick. Uses setTimeout (not setInterval) so
   * the scheduled delay can vary per-tick (backoff) and so a slow callback
   * never causes ticks to stack.
   */
  private scheduleNext(task: PollingTask, runNow: boolean): void {
    const tick = async () => {
      task.timerId = null;
      if (task.isPaused) {
        // Re-arm at the base interval; don't run while paused.
        this.scheduleNext(task, /* runNow */ false);
        return;
      }
      if (task.inFlight) {
        // The previous tick is still running — skip and re-arm.
        this.scheduleNext(task, /* runNow */ false);
        return;
      }
      task.inFlight = true;
      try {
        await task.callback();
        task.errorCount = 0;
      } catch (err) {
        task.errorCount++;
        console.warn(
          `[PollingManager] error in "${task.pluginId}" (attempt ${task.errorCount}):`,
          err,
        );
      } finally {
        task.inFlight = false;
      }
      this.scheduleNext(task, /* runNow */ false);
    };

    if (runNow) {
      // Fire immediately on start; schedule subsequent ticks from the tick handler.
      task.timerId = setTimeout(tick, 0);
    } else {
      const delay = this.getEffectiveInterval(task);
      task.timerId = setTimeout(tick, delay);
    }
  }

  private getEffectiveInterval(task: PollingTask): number {
    if (task.errorCount === 0) return task.intervalMs;
    return Math.min(
      task.intervalMs * Math.pow(2, task.errorCount),
      task.maxBackoff,
    );
  }
}

export function createPollingManager(opts?: PollingManagerOptions): PollingManager {
  return new PollingManager(opts);
}

export const pollingManager = new PollingManager();
export type { PollingManager };
