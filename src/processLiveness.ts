import { queryWindowsProcesses, type ProcessIdentity } from "./processTermination.js";

export interface LivenessResult {
  state: "alive" | "dead" | "unknown";
  errors: string[];
}

/** Transient snapshot failures retain the lock, but do not immediately notify users. */
export class LivenessWarningGate {
  private failures = 0;
  private notified = false;

  observe(state: LivenessResult["state"]): { notify: boolean; retrySoon: boolean } {
    if (state !== "unknown") {
      this.failures = 0;
      return { notify: false, retrySoon: false };
    }
    this.failures += 1;
    const notify = this.failures >= 3 && !this.notified;
    if (notify) this.notified = true;
    return { notify, retrySoon: this.failures < 3 };
  }
}

function describeQueryError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!error || typeof error !== "object") return message;
  const details = error as { code?: unknown; signal?: unknown; killed?: unknown };
  const metadata = ["code", "signal", "killed"] as const;
  const values = metadata.flatMap(key => {
    const value = details[key];
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? [`${key}=${value}`] : [];
  });
  return values.length ? `${message.trim()} [${values.join(", ")}]` : message;
}

/** Read-only identity tracking: a missing wrapper does not mean its runtime has exited. */
export class ProcessLivenessTracker {
  private readonly known = new Map<number, string>();

  constructor(
    private readonly rootPid: number,
    private readonly isRuntime: (commandLine: string) => boolean,
    private readonly query: () => Promise<ProcessIdentity[]> = queryWindowsProcesses,
    private readonly startedAt = Date.now(),
  ) {}

  async check(rootExited: boolean, threadId?: string | null, closeReceived = false): Promise<LivenessResult> {
    try {
      const rows = await this.query();
      const root = rows.find(row => row.pid === this.rootPid);
      if (root && ((rootExited && !this.known.has(root.pid))
        || (this.known.has(root.pid) && this.known.get(root.pid) !== root.created))) {
        return { state: "unknown", errors: ["Root PID identity changed"] };
      }
      const seeds = new Set<number>([this.rootPid]);
      for (const row of rows) {
        if (this.known.get(row.pid) === row.created) seeds.add(row.pid);
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of rows) {
          if (!seeds.has(row.parentPid) || seeds.has(row.pid)) continue;
          seeds.add(row.pid);
          changed = true;
        }
      }
      const descendantIdentityChanged = rows.some(row => seeds.has(row.pid) && this.known.has(row.pid)
        && this.known.get(row.pid) !== row.created);
      if (threadId && rows.some(row => this.isRuntime(row.commandLine ?? "")
        && row.commandLine?.includes(threadId) && !seeds.has(row.pid)
        // A runtime already present before this spawn cannot be its orphaned child.
        && !(Date.parse(row.created) < this.startedAt))) {
        return { state: "unknown", errors: ["Unattributed runtime references the Codex thread"] };
      }
      if (descendantIdentityChanged) {
        // A recycled child PID does not invalidate an independently known live runtime.
        // Do not remember new identities through the ambiguous descendant tree.
        const knownAlive = rows.some(row => this.known.get(row.pid) === row.created
          && (row.pid === this.rootPid ? !rootExited : this.isRuntime(row.commandLine ?? "")));
        return knownAlive ? { state: "alive", errors: [] }
          : { state: "unknown", errors: ["Descendant PID identity changed"] };
      }
      // Remember intermediaries too, so an orphaned native runtime remains attributable.
      for (const row of rows) {
        if (seeds.has(row.pid)) this.known.set(row.pid, row.created);
      }
      const alive = rows.some(row => seeds.has(row.pid)
        && (row.pid === this.rootPid ? !rootExited : this.isRuntime(row.commandLine ?? "")));
      if (alive) return { state: "alive", errors: [] };
      if (rows.some(row => seeds.has(row.pid) && row.pid !== this.rootPid && !row.commandLine)) {
        return { state: "unknown", errors: ["Descendant command line is unavailable"] };
      }
      if (!this.known.size && !closeReceived) {
        return { state: "unknown", errors: ["Process identity was not observed before disappearance"] };
      }
      return { state: "dead", errors: [] };
    } catch (error) {
      return { state: "unknown", errors: [describeQueryError(error)] };
    }
  }
}
