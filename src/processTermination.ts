import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);
export interface ProcessIdentity { pid: number; parentPid: number; created: string; commandLine?: string }
export interface StopResult { stopped: boolean; pids: number[]; errors: string[] }

export async function queryWindowsProcesses(): Promise<ProcessIdentity[]> {
  const { stdout } = await runFile("powershell.exe", ["-NoProfile", "-Command",
    // execFile's encoding decodes bytes; the producer must use the same encoding.
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; "
    + "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; parentPid=$_.ParentProcessId; created=$_.CreationDate.ToString('o'); commandLine=$_.CommandLine } } | ConvertTo-Json -Compress"],
  { windowsHide: true, encoding: "utf8", timeout: 3000, maxBuffer: 2 * 1024 * 1024 });
  const data: unknown = JSON.parse(stdout);
  const rows = Array.isArray(data) ? data : [data];
  return rows.map((row: ProcessIdentity) => {
    if (!Number.isInteger(row.pid) || !Number.isInteger(row.parentPid) || typeof row.created !== "string") {
      throw new Error("Invalid process snapshot");
    }
    return row;
  });
}

/** Confirm absence, not just taskkill success; creation times protect against PID reuse. */
export async function stopWindowsProcessTree(
  rootPid: number,
  rootExited: boolean,
  query = queryWindowsProcesses,
  kill = async (pid: number): Promise<void> => {
    await runFile("taskkill", ["/PID", String(pid), "/F"],
      { windowsHide: true, timeout: 3000 });
  },
  include: (row: ProcessIdentity) => boolean = () => true,
  threadId?: string | null,
): Promise<StopResult> {
  const known = new Map<number, string>();
  const errors: string[] = [];
  const deadline = Date.now() + 10000;
  try {
    for (let attempt = 0; attempt < 4 && Date.now() < deadline; attempt += 1) {
      const rows = await query();
      const root = rows.find(row => row.pid === rootPid);
      const reusedRoot = root && ((rootExited && !known.has(rootPid))
        || (known.has(rootPid) && known.get(rootPid) !== root.created));
      if (reusedRoot) {
        return { stopped: false, pids: [...known.keys()], errors: [...errors, "Root PID identity changed"] };
      }
      const seeds = new Set<number>(reusedRoot ? [] : [rootPid]);
      for (const row of rows) {
        if (known.get(row.pid) === row.created) seeds.add(row.pid);
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
      if (threadId && rows.some(row => row.commandLine?.includes(threadId) && !seeds.has(row.pid))) {
        return { stopped: false, pids: [...known.keys()],
          errors: [...errors, "Unattributed process still references the Codex thread"] };
      }
      const alive = rows.filter(row => seeds.has(row.pid)
        && !(row.pid === rootPid && rootExited) && (row.pid === rootPid || include(row)));
      if (alive.some(row => known.has(row.pid) && known.get(row.pid) !== row.created)) {
        return { stopped: false, pids: [...known.keys()], errors: [...errors, "Descendant PID identity changed"] };
      }
      for (const row of alive) known.set(row.pid, row.created);
      if (!alive.length) return { stopped: true, pids: [...known.keys()], errors };
      await Promise.all(alive.map(async row => {
        try { await kill(row.pid); }
        catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
      }));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return { stopped: false, pids: [...known.keys()], errors };
}
