import type pino from "pino";
import type { RuntimeSessionState } from "./types.js";

type TaskStatus = "success" | "error" | "timeout";
type TaskRunResult = { status: TaskStatus; output: string; errorCode?: string };

export interface ExecutionTask {
  executionId: string;
  sessionId: string;
  lockKey: string;
  text: string;
  maxRetries: number;
  onQueued: (position: number) => Promise<void>;
  onProgress: (elapsedSec: number, queueLength: number) => Promise<void>;
  run: (signal: AbortSignal) => Promise<TaskRunResult>;
  onFinish: (result: {
    status: TaskStatus;
    output: string;
    retries: number;
    errorCode?: string;
  }) => Promise<void>;
}

interface SessionQueue {
  running: boolean;
  runningSince: number | null;
  tasks: ExecutionTask[];
  generation: number;
  runningExecutionId: string | null;
  runningAbortController: AbortController | null;
}

export interface QueueSnapshot {
  lockKey: string;
  running: boolean;
  runningSince: string | null;
  queued: number;
}

export class ExecutionManager {
  private readonly queues = new Map<string, SessionQueue>();
  private readonly lockAliases = new Map<string, string>();
  private paused = false;
  private readonly pausedLocks = new Set<string>();

  private resolveLockKey(lockKey: string): string {
    return this.lockAliases.get(lockKey) ?? lockKey;
  }

  bindLockKey(previousKey: string, nextKey: string): void {
    const previous = this.resolveLockKey(previousKey);
    const next = this.resolveLockKey(nextKey);
    if (previous === next) return;
    const source = this.queues.get(previous);
    const target = this.queues.get(next);
    if (target?.running) throw new Error("ERR_QUEUE_BIND_CONFLICT");
    if (source) {
      if (target) source.tasks.push(...target.tasks);
      this.queues.delete(previous);
      this.queues.set(next, source);
    }
    // Running callbacks retain their original key; resolve it until they finish.
    for (const [alias, key] of this.lockAliases) {
      if (key === previous) this.lockAliases.set(alias, next);
    }
    this.lockAliases.set(previous, next);
    if (this.pausedLocks.delete(previous)) this.pausedLocks.add(next);
  }

  constructor(
    private readonly queueLimitPerSession: number,
    private readonly progressIntervalSec: number,
    private readonly logger: pino.Logger,
  ) {}

  getRuntimeState(lockKey: string): RuntimeSessionState {
    const q = this.queues.get(this.resolveLockKey(lockKey));
    if (!q) return { queueLength: 0, runningSince: null };
    return {
      queueLength: q.tasks.length,
      runningSince: q.runningSince ? new Date(q.runningSince).toISOString() : null,
    };
  }

  getQueueSnapshots(): QueueSnapshot[] {
    const snapshots: QueueSnapshot[] = [];
    for (const [lockKey, q] of this.queues.entries()) {
      if (!q.running && q.tasks.length === 0) continue;
      snapshots.push({
        lockKey,
        running: q.running,
        runningSince: q.runningSince ? new Date(q.runningSince).toISOString() : null,
        queued: q.tasks.length,
      });
    }
    snapshots.sort((a, b) => {
      if (a.running !== b.running) return a.running ? -1 : 1;
      if (a.queued !== b.queued) return b.queued - a.queued;
      return a.lockKey.localeCompare(b.lockKey);
    });
    return snapshots;
  }

  drainPendingAll(): ExecutionTask[] {
    const drained: ExecutionTask[] = [];
    for (const queue of this.queues.values()) {
      if (queue.tasks.length === 0) continue;
      drained.push(...queue.tasks);
      queue.tasks = [];
    }
    return drained;
  }

  pauseLock(lockKey: string): void { this.pausedLocks.add(this.resolveLockKey(lockKey)); }

  isLockPaused(lockKey: string): boolean { return this.pausedLocks.has(this.resolveLockKey(lockKey)); }

  resumeLock(lockKey: string): void {
    this.pausedLocks.delete(this.resolveLockKey(lockKey));
    void this.startNext(lockKey).catch(err => this.logger.error({ err, lockKey }, "failed to resume queue"));
  }

  drainPending(lockKey: string): ExecutionTask[] {
    const queue = this.queues.get(this.resolveLockKey(lockKey));
    if (!queue) return [];
    return queue.tasks.splice(0);
  }

  cancelRunning(lockKey: string): string | null {
    const queue = this.queues.get(this.resolveLockKey(lockKey));
    if (!queue?.runningExecutionId || !queue.runningAbortController) return null;
    queue.runningAbortController.abort();
    return queue.runningExecutionId;
  }

  pauseAll(): void {
    this.paused = true;
  }

  resumeAll(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const lockKey of this.queues.keys()) {
      this.startNext(lockKey).catch((err) => {
        this.logger.error({ err, lockKey }, "failed to resume queue");
      });
    }
  }

  cancelRunningAll(): number {
    let cancelled = 0;
    for (const queue of this.queues.values()) {
      const controller = queue.runningAbortController;
      const executionId = queue.runningExecutionId;
      if (!queue.running || !controller || !executionId || controller.signal.aborted) continue;
      controller.abort();
      cancelled += 1;
    }
    return cancelled;
  }

  getActiveExecutionIds(): Set<string> {
    const active = new Set<string>();
    for (const queue of this.queues.values()) {
      if (queue.runningExecutionId) active.add(queue.runningExecutionId);
    }
    return active;
  }

  forceResetAll(): { clearedLocks: number; droppedQueued: number; resetRunning: number } {
    let clearedLocks = 0;
    let droppedQueued = 0;
    let resetRunning = 0;
    for (const [lockKey, queue] of this.queues.entries()) {
      if (!queue.running && queue.tasks.length === 0) continue;
      clearedLocks += 1;
      droppedQueued += queue.tasks.length;
      if (queue.running) resetRunning += 1;
      this.resetQueue(lockKey, queue);
    }
    return { clearedLocks, droppedQueued, resetRunning };
  }

  forceReleaseLocks(lockKeys: string[]): number {
    let released = 0;
    for (const lockKey of lockKeys) {
      const queue = this.queues.get(this.resolveLockKey(lockKey));
      if (!queue) continue;
      if (queue.running) continue;
      if (!queue.running && queue.tasks.length === 0) continue;
      this.resetQueue(lockKey, queue);
      released += 1;
    }
    return released;
  }

  async enqueue(task: ExecutionTask): Promise<{ ok: true; position: number } | { ok: false; code: string }> {
    if (this.paused || this.pausedLocks.has(this.resolveLockKey(task.lockKey))) {
      return { ok: false, code: "ERR_QUEUE_STOPPING" };
    }
    task.lockKey = this.resolveLockKey(task.lockKey);
    let queue = this.queues.get(task.lockKey);
    if (!queue) {
      queue = {
        running: false,
        runningSince: null,
        tasks: [],
        generation: 0,
        runningExecutionId: null,
        runningAbortController: null,
      };
      this.queues.set(task.lockKey, queue);
    }

    if (queue.tasks.length >= this.queueLimitPerSession) {
      return { ok: false, code: "ERR_QUEUE_LIMIT_EXCEEDED" };
    }

    queue.tasks.push(task);
    const position = queue.tasks.length;
    try {
      await task.onQueued(position);
    } catch (err) {
      // A transient Discord failure must not strand an accepted task in memory.
      this.logger.warn(
        { err, lockKey: task.lockKey, executionId: task.executionId, position },
        "queued notification failed; continuing execution",
      );
    }

    if (!queue.running) {
      this.startNext(task.lockKey).catch((err) => {
        this.logger.error({ err, lockKey: task.lockKey }, "failed to start queue");
      });
    }
    return { ok: true, position };
  }

  private async startNext(lockKey: string): Promise<void> {
    if (this.paused || this.pausedLocks.has(this.resolveLockKey(lockKey))) return;
    const queue = this.queues.get(this.resolveLockKey(lockKey));
    if (!queue || queue.running) return;

    const task = queue.tasks.shift();
    if (!task) return;

    queue.running = true;
    queue.runningSince = Date.now();
    queue.runningExecutionId = task.executionId;
    const abortController = new AbortController();
    queue.runningAbortController = abortController;
    const generationAtStart = queue.generation;

    let retries = 0;
    let finishStarted = false;
    let progressCallbackRunning = false;
    let progressTimer: NodeJS.Timeout | null = setInterval(() => {
      if (progressCallbackRunning) return;
      const q = this.queues.get(this.resolveLockKey(lockKey));
      const elapsedSec = q?.runningSince ? Math.floor((Date.now() - q.runningSince) / 1000) : 0;
      const queueLength = q?.tasks.length ?? 0;
      progressCallbackRunning = true;
      Promise.resolve()
        .then(() => task.onProgress(elapsedSec, queueLength))
        .catch((err) => {
          this.logger.warn({ err }, "progress callback failed");
        })
        .finally(() => {
          progressCallbackRunning = false;
        });
    }, this.progressIntervalSec * 1000);

    const clearProgressTimer = (): void => {
      if (!progressTimer) return;
      clearInterval(progressTimer);
      progressTimer = null;
    };
    const finishOnce = async (result: {
      status: TaskStatus;
      output: string;
      retries: number;
      errorCode?: string;
    }): Promise<void> => {
      if (finishStarted) return;
      finishStarted = true;
      await task.onFinish(result);
    };

    try {
      while (true) {
        if (this.isTaskStale(lockKey, generationAtStart, task.executionId)) {
          this.logger.warn(
            { lockKey, executionId: task.executionId },
            "ignoring stale task after queue reset",
          );
          break;
        }
        if (abortController.signal.aborted) {
          await finishOnce({
            status: "error",
            output: "Execution stopped.",
            retries,
            errorCode: "ERR_EMERGENCY_STOP",
          });
          break;
        }
        // The adapter owns process lifetime. Elapsed time must not release a live execution.
        const result = await task.run(abortController.signal);
        if (this.isTaskStale(lockKey, generationAtStart, task.executionId)) {
          this.logger.warn(
            { lockKey, executionId: task.executionId },
            "ignoring stale task completion after queue reset",
          );
          break;
        }
        if (abortController.signal.aborted) {
          await finishOnce({
            status: "error",
            output: "Execution stopped.",
            retries,
            errorCode: "ERR_EMERGENCY_STOP",
          });
          break;
        }
        if (result.status === "error" && retries < task.maxRetries) {
          retries += 1;
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        await finishOnce({
          status: result.status,
          output: result.output,
          retries,
          errorCode: result.errorCode,
        });
        break;
      }
    } catch (err) {
      if (finishStarted) {
        this.logger.error(
          { err, lockKey, executionId: task.executionId },
          "task finish callback failed",
        );
        return;
      }
      this.logger.error({ err, lockKey, executionId: task.executionId }, "task run failed unexpectedly");
      if (this.isTaskStale(lockKey, generationAtStart, task.executionId)) {
        this.logger.warn(
          { lockKey, executionId: task.executionId },
          "ignoring stale unexpected failure after queue reset",
        );
        return;
      }
      if (abortController.signal.aborted) {
        try {
          await finishOnce({
            status: "error",
            output: "Execution stopped.",
            retries,
            errorCode: "ERR_EMERGENCY_STOP",
          });
        } catch (finishError) {
          this.logger.error(
            { err: finishError, lockKey, executionId: task.executionId },
            "task finish callback failed",
          );
        }
        return;
      }
      try {
        await finishOnce({
          status: "error",
          output: "unexpected error",
          retries,
          errorCode: "ERR_UNEXPECTED",
        });
      } catch (finishError) {
        this.logger.error(
          { err: finishError, lockKey, executionId: task.executionId },
          "task finish callback failed",
        );
      }
    } finally {
      clearProgressTimer();
      const current = this.queues.get(this.resolveLockKey(lockKey));
      if (!current) return;
      if (current.generation !== generationAtStart || current.runningExecutionId !== task.executionId) {
        return;
      }
      current.running = false;
      current.runningSince = null;
      current.runningExecutionId = null;
      current.runningAbortController = null;
      if (current.tasks.length > 0) {
        await this.startNext(lockKey);
      }
    }
  }

  private resetQueue(lockKey: string, queue: SessionQueue): void {
    queue.runningAbortController?.abort();
    queue.running = false;
    queue.runningSince = null;
    queue.tasks = [];
    queue.runningExecutionId = null;
    queue.runningAbortController = null;
    queue.generation += 1;
    this.logger.warn({ lockKey, generation: queue.generation }, "queue forcibly reset");
  }

  private isTaskStale(lockKey: string, generation: number, executionId: string): boolean {
    const queue = this.queues.get(this.resolveLockKey(lockKey));
    if (!queue) return true;
    return queue.generation !== generation || queue.runningExecutionId !== executionId;
  }

}
