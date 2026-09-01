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
  run: () => Promise<TaskRunResult>;
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
}

export interface QueueSnapshot {
  lockKey: string;
  running: boolean;
  runningSince: string | null;
  queued: number;
}

export class ExecutionManager {
  private readonly queues = new Map<string, SessionQueue>();

  constructor(
    private readonly queueLimitPerSession: number,
    private readonly progressIntervalSec: number,
    private readonly taskTimeoutMs: number,
    private readonly logger: pino.Logger,
  ) {}

  getRuntimeState(lockKey: string): RuntimeSessionState {
    const q = this.queues.get(lockKey);
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
      const queue = this.queues.get(lockKey);
      if (!queue) continue;
      if (!queue.running && queue.tasks.length === 0) continue;
      this.resetQueue(lockKey, queue);
      released += 1;
    }
    return released;
  }

  async enqueue(task: ExecutionTask): Promise<{ ok: true; position: number } | { ok: false; code: string }> {
    let queue = this.queues.get(task.lockKey);
    if (!queue) {
      queue = { running: false, runningSince: null, tasks: [], generation: 0, runningExecutionId: null };
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
    const queue = this.queues.get(lockKey);
    if (!queue || queue.running) return;

    const task = queue.tasks.shift();
    if (!task) return;

    queue.running = true;
    queue.runningSince = Date.now();
    queue.runningExecutionId = task.executionId;
    const generationAtStart = queue.generation;

    let retries = 0;
    let finishStarted = false;
    let waitForUnderlyingCompletion: Promise<void> | null = null;
    let progressTimer: NodeJS.Timeout | null = setInterval(() => {
      const q = this.queues.get(lockKey);
      const elapsedSec = q?.runningSince ? Math.floor((Date.now() - q.runningSince) / 1000) : 0;
      const queueLength = q?.tasks.length ?? 0;
      task.onProgress(elapsedSec, queueLength).catch((err) => {
        this.logger.warn({ err }, "progress callback failed");
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
        const timedRun = await this.runWithHardTimeout(task.run);
        const result = timedRun.result;
        waitForUnderlyingCompletion = timedRun.waitForCompletion;
        if (this.isTaskStale(lockKey, generationAtStart, task.executionId)) {
          this.logger.warn(
            { lockKey, executionId: task.executionId },
            "ignoring stale task completion after queue reset",
          );
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
        if (waitForUnderlyingCompletion) {
          clearProgressTimer();
          this.logger.warn(
            { lockKey, executionId: task.executionId },
            "watchdog expired; retaining queue lock until the task actually settles",
          );
        }
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
      if (waitForUnderlyingCompletion) {
        await waitForUnderlyingCompletion;
      }
      const current = this.queues.get(lockKey);
      if (!current) return;
      if (current.generation !== generationAtStart || current.runningExecutionId !== task.executionId) {
        return;
      }
      current.running = false;
      current.runningSince = null;
      current.runningExecutionId = null;
      if (current.tasks.length > 0) {
        await this.startNext(lockKey);
      }
    }
  }

  private resetQueue(lockKey: string, queue: SessionQueue): void {
    queue.running = false;
    queue.runningSince = null;
    queue.tasks = [];
    queue.runningExecutionId = null;
    queue.generation += 1;
    this.logger.warn({ lockKey, generation: queue.generation }, "queue forcibly reset");
  }

  private isTaskStale(lockKey: string, generation: number, executionId: string): boolean {
    const queue = this.queues.get(lockKey);
    if (!queue) return true;
    return queue.generation !== generation || queue.runningExecutionId !== executionId;
  }

  private async runWithHardTimeout(
    run: () => Promise<TaskRunResult>,
  ): Promise<{ result: TaskRunResult; waitForCompletion: Promise<void> | null }> {
    let timer: NodeJS.Timeout | null = null;
    let watchdogExpired = false;
    const runPromise = Promise.resolve().then(run);
    try {
      const result = await Promise.race([
        runPromise,
        new Promise<TaskRunResult>(
          (resolve) => {
            timer = setTimeout(() => {
              watchdogExpired = true;
              resolve({
                status: "timeout",
                output: "Codex execution timed out by watchdog.",
                errorCode: "ERR_EXEC_WATCHDOG_TIMEOUT",
              });
            }, this.taskTimeoutMs);
          },
        ),
      ]);
      return {
        result,
        waitForCompletion: watchdogExpired
          ? runPromise.then(() => undefined, () => undefined)
          : null,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
