import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LivenessResult } from "./processLiveness.js";

const runFile = promisify(execFile);
export const processObservationTime = (): number => performance.timeOrigin + performance.now();
export interface ProcessIdentity { pid: number; parentPid: number; created: string; commandLine?: string }
export interface ProcessSnapshot { rows: ProcessIdentity[]; startedAt: number }
export interface StopResult { stopped: boolean; pids: number[]; errors: string[] }

export async function queryWindowsProcesses(): Promise<ProcessIdentity[]> {
  const { stdout } = await runFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference='Stop'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); "
    + "$rows = @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ "
    + "pid=$_.ProcessId; parentPid=$_.ParentProcessId; created=$_.CreationDate.ToUniversalTime().ToString('o'); "
    + "commandLine=$_.CommandLine } }); ConvertTo-Json -InputObject $rows -Compress"],
  { windowsHide: true, encoding: "utf8", timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  const data: unknown = JSON.parse(stdout);
  if (!Array.isArray(data)) throw new Error("Invalid process snapshot");
  return data.map((row: ProcessIdentity) => {
    if (!row || !Number.isInteger(row.pid) || !Number.isInteger(row.parentPid)
      || typeof row.created !== "string" || !Number.isFinite(Date.parse(row.created))
      || (row.commandLine != null && typeof row.commandLine !== "string")) {
      throw new Error("Invalid process snapshot");
    }
    return row;
  });
}

/** Share only an in-flight query, never a completed/cached absence observation. */
export class ProcessSnapshotMonitor {
  private pending: Promise<ProcessSnapshot> | null = null;
  private pendingStartedAt = -Infinity;

  constructor(private readonly query = queryWindowsProcesses, private readonly now = processObservationTime) {}

  get(notBefore = -Infinity): Promise<ProcessSnapshot> {
    if (this.pending && this.pendingStartedAt < notBefore) {
      // Do not race a second CIM process against an older in-flight observation.
      return this.pending.then(() => this.get(notBefore), () => this.get(notBefore));
    }
    if (!this.pending) {
      const startedAt = this.now();
      this.pendingStartedAt = startedAt;
      this.pending = Promise.resolve().then(this.query).then(rows => ({ rows, startedAt }))
        .finally(() => { this.pending = null; });
    }
    return this.pending;
  }
}

const monitor = new ProcessSnapshotMonitor();
export const queryWindowsProcessSnapshot = (notBefore?: number): Promise<ProcessSnapshot> => monitor.get(notBefore);

// Keep the handle open between identity verification and termination. A second PID
// lookup (including taskkill /PID) would reintroduce the PID reuse race.
export const WINDOWS_IDENTITY_STOP_SCRIPT = `
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class IdentityStop {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle, out long birth, out long exit, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr handle, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static void Stop(uint pid, long expected) {
    IntPtr handle = OpenProcess(0x1001, false, pid);
    if (handle == IntPtr.Zero) {
      int error = Marshal.GetLastWin32Error();
      if (error == 87) return;
      throw new Win32Exception(error);
    }
    try {
      long birth, exit, kernel, user;
      if (!GetProcessTimes(handle, out birth, out exit, out kernel, out user))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      // Win32_Process CreationDate has microsecond, not FILETIME, precision.
      if (birth / 10 != expected / 10) throw new InvalidOperationException("Process identity changed");
      if (exit != 0) return;
      if (!TerminateProcess(handle, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally { CloseHandle(handle); }
  }
}
'@
$failed = $false
foreach ($identity in $identities) {
  try {
    $birth = [DateTimeOffset]::Parse($identity.created).UtcDateTime.ToFileTimeUtc()
    [IdentityStop]::Stop([uint32]$identity.pid, $birth)
  } catch { $failed = $true; [Console]::Error.WriteLine($_.Exception.Message) }
}
if ($failed) { exit 1 }
`;

export async function killWindowsProcessIdentities(identities: ProcessIdentity[]): Promise<void> {
  if (!identities.length) return;
  if (identities.some(row => row.pid <= 0 || !Number.isInteger(row.pid)
    || !Number.isFinite(Date.parse(row.created)))) throw new Error("Invalid termination identity");
  const encoded = Buffer.from(JSON.stringify(identities.map(({ pid, created }) => ({ pid, created }))), "utf8")
    .toString("base64");
  await runFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `$identities = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json;`
    + WINDOWS_IDENTITY_STOP_SCRIPT], { windowsHide: true, encoding: "utf8", timeout: 15000 });
}

export interface StopOptions {
  observe: (notBefore: number) => Promise<LivenessResult>;
  kill?: (identities: ProcessIdentity[]) => Promise<void>;
}

/** The observer owns the execution's history, including previously seen orphans. */
export async function stopWindowsProcessTree({ observe, kill = killWindowsProcessIdentities }: StopOptions): Promise<StopResult> {
  const pids = new Set<number>();
  const errors: string[] = [];
  let notBefore = processObservationTime();
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const status = await observe(notBefore);
      if (status.state === "dead") return { stopped: true, pids: [...pids], errors };
      if (status.state === "unknown" || !status.targets?.length) {
        return { stopped: false, pids: [...pids], errors: [...errors, ...status.errors] };
      }
      status.targets.forEach(row => pids.add(row.pid));
      try { await kill(status.targets); }
      catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
      notBefore = processObservationTime();
    }
    const status = await observe(notBefore);
    return { stopped: status.state === "dead", pids: [...pids], errors: [...errors, ...status.errors] };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { stopped: false, pids: [...pids], errors };
  }
}
