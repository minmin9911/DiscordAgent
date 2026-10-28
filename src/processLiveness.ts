import { processObservationTime, queryWindowsProcessSnapshot, type ProcessIdentity, type ProcessSnapshot } from "./processTermination.js";

export interface LivenessResult {
  state: "alive" | "dead" | "unknown";
  errors: string[];
  targets?: ProcessIdentity[];
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
  private readonly known = new Map<number, ProcessIdentity>();

  constructor(
    private readonly rootPid: number,
    private readonly isRuntime: (commandLine: string) => boolean,
    private readonly query: (notBefore?: number) => Promise<ProcessIdentity[] | ProcessSnapshot> = queryWindowsProcessSnapshot,
    private readonly startedAt = processObservationTime(),
  ) {}

  async check(
    rootExited: boolean | (() => boolean), threadId?: string | null,
    closeReceived: boolean | (() => boolean) = false,
    options: { includeDescendants?: boolean; notBefore?: number; forTermination?: boolean } = {},
  ): Promise<LivenessResult> {
    try {
      const { includeDescendants = false, notBefore = this.startedAt, forTermination = false } = options;
      const requestedAt = processObservationTime();
      const snapshot = await this.query(Math.max(this.startedAt, notBefore));
      const rows = Array.isArray(snapshot) ? snapshot : snapshot.rows;
      const snapshotStartedAt = Array.isArray(snapshot) ? requestedAt : snapshot.startedAt;
      if (snapshotStartedAt < Math.max(this.startedAt, notBefore)) {
        return { state: "unknown", errors: ["Snapshot predates the execution or termination request"] };
      }
      const exited = typeof rootExited === "function" ? rootExited() : rootExited;
      const closed = typeof closeReceived === "function" ? closeReceived() : closeReceived;
      const root = rows.find(row => row.pid === this.rootPid);
      const rootReused = Boolean(root && this.known.has(root.pid)
        && this.known.get(root.pid)?.created !== root.created);
      if (root && !this.known.has(root.pid)
        && (exited || Date.parse(root.created) < Math.floor(this.startedAt))) {
        return { state: "unknown", errors: ["Root PID identity changed"] };
      }
      const seeds = new Set<number>();
      if (root && !exited && !rootReused) seeds.add(root.pid);
      for (const row of rows) {
        if (this.known.get(row.pid)?.created === row.created) seeds.add(row.pid);
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of rows) {
          if (!seeds.has(row.parentPid) || seeds.has(row.pid)) continue;
          // A recycled PID proves the old identity ended, not that we own the new one.
          if (this.known.has(row.pid) && this.known.get(row.pid)?.created !== row.created) continue;
          const parent = rows.find(candidate => candidate.pid === row.parentPid);
          if (!parent || Date.parse(row.created) < Date.parse(parent.created)) continue;
          seeds.add(row.pid);
          changed = true;
        }
      }
      for (const row of rows) {
        if (seeds.has(row.pid)) this.known.set(row.pid, row);
      }
      const targets = rows.filter(row => seeds.has(row.pid)
        && (row.pid === this.rootPid ? !exited : includeDescendants || this.isRuntime(row.commandLine ?? "")));
      if (targets.length && !forTermination) return { state: "alive", errors: [], targets };
      // Follow uncertain ancestry separately, including unobserved intermediate shells.
      // These IDs are evidence against absence, never authority to terminate anything.
      const uncertainAncestors = new Set([...this.known.keys(), this.rootPid].filter(pid => !seeds.has(pid)));
      // A missing parent alone cannot connect another execution or shared daemon to ours.
      let uncertainChanged = true;
      while (uncertainChanged) {
        uncertainChanged = false;
        for (const row of rows) {
          if (seeds.has(row.pid) || uncertainAncestors.has(row.pid)
            || !uncertainAncestors.has(row.parentPid)
            || Date.parse(row.created) < Math.floor(this.startedAt)) continue;
          uncertainAncestors.add(row.pid);
          uncertainChanged = true;
        }
      }
      const unattributed = rows.some(row => !seeds.has(row.pid)
        && !(Date.parse(row.created) < Math.floor(this.startedAt))
        && ((threadId && this.isRuntime(row.commandLine ?? "") && row.commandLine?.includes(threadId))
          || (this.isRuntime(row.commandLine ?? "")
            && uncertainAncestors.has(row.parentPid))
          || (includeDescendants && uncertainAncestors.has(row.parentPid))));
      if (unattributed) {
        return { state: "unknown", errors: ["Unattributed runtime or descendant remains"] };
      }
      if (targets.length) return { state: "alive", errors: [], targets };
      if (rows.some(row => seeds.has(row.pid) && row.pid !== this.rootPid && !row.commandLine)) {
        return { state: "unknown", errors: ["Descendant command line is unavailable"] };
      }
      if ((!exited && !rootReused) || (!this.known.size && !closed)) {
        return { state: "unknown", errors: ["Process identity was not observed before disappearance"] };
      }
      return { state: "dead", errors: [] };
    } catch (error) {
      return { state: "unknown", errors: [describeQueryError(error)] };
    }
  }
}
