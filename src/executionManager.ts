import type pino from "pino";
import type { RuntimeSessionState } from "./types.js";

type TaskStatus = "success" | "error" | "timeout";

export interface ExecutionTask {
  executionId: string;
  sessionId: string;
  lockKey: string;
  text: string;
  maxRetries: number;
  onQueued: (position: number) => Promise<void>;
  onProgress: (elapsedSec: number, queueLength: number) => Promise<void>;
  run: () => Promise<{ status: TaskStatus; output: string; errorCode?: string }>;
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

  async enqueue(task: ExecutionTask): Promise<{ ok: true; position: number } | { ok: false; code: string }> {
    let queue = this.queues.get(task.lockKey);
    if (!queue) {
      queue = { running: false, runningSince: null, tasks: [] };
      this.queues.set(task.lockKey, queue);
    }

    if (queue.tasks.length >= this.queueLimitPerSession) {
      return { ok: false, code: "ERR_QUEUE_LIMIT_EXCEEDED" };
    }

    queue.tasks.push(task);
    const position = queue.tasks.length;
    await task.onQueued(position);

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

    let retries = 0;
    let progressTimer: NodeJS.Timeout | null = setInterval(() => {
      const q = this.queues.get(lockKey);
      const elapsedSec = q?.runningSince ? Math.floor((Date.now() - q.runningSince) / 1000) : 0;
      const queueLength = q?.tasks.length ?? 0;
      task.onProgress(elapsedSec, queueLength).catch((err) => {
        this.logger.warn({ err }, "progress callback failed");
      });
    }, this.progressIntervalSec * 1000);

    try {
      while (true) {
        const result = await this.runWithHardTimeout(task.run);
        if (result.status === "error" && retries < task.maxRetries) {
          retries += 1;
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        await task.onFinish({
          status: result.status,
          output: result.output,
          retries,
          errorCode: result.errorCode,
        });
        break;
      }
    } catch (err) {
      this.logger.error({ err }, "task run failed unexpectedly");
      await task.onFinish({
        status: "error",
        output: "unexpected error",
        retries,
        errorCode: "ERR_UNEXPECTED",
      });
    } finally {
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
      queue.running = false;
      queue.runningSince = null;
      if (queue.tasks.length > 0) {
        await this.startNext(lockKey);
      }
    }
  }

  private async runWithHardTimeout(
    run: () => Promise<{ status: TaskStatus; output: string; errorCode?: string }>,
  ): Promise<{ status: TaskStatus; output: string; errorCode?: string }> {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        run(),
        new Promise<{ status: TaskStatus; output: string; errorCode?: string }>(
          (resolve) => {
            timer = setTimeout(() => {
              resolve({
                status: "timeout",
                output: "Codex execution timed out by watchdog.",
                errorCode: "ERR_EXEC_WATCHDOG_TIMEOUT",
              });
            }, this.taskTimeoutMs);
          },
        ),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
