import { spawnSync } from "node:child_process";

export interface ScheduledTaskDeletionResult { ok: boolean; missing: boolean; detail?: string }

// Task Scheduler exposes Win32 HRESULTs; do not infer absence from localized text.
export const DELETE_SCHEDULED_TASK_SCRIPT = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$stage = 'connect'
try {
  $service = New-Object -ComObject Schedule.Service
  $service.Connect()
  $separator = $taskName.LastIndexOf('\\')
  $folderPath = if ($separator -eq 0) { '\\' } else { $taskName.Substring(0, $separator) }
  $leaf = $taskName.Substring($separator + 1)
  $stage = 'folder'
  $folder = $service.GetFolder($folderPath)
  $stage = 'delete'
  $folder.DeleteTask($leaf, 0)
  @{ ok=$true; missing=$false } | ConvertTo-Json -Compress
} catch {
  $errorObject = $_.Exception
  while ($errorObject.InnerException) { $errorObject = $errorObject.InnerException }
  $code = $errorObject.HResult.ToString('X8')
  $missing = ($stage -eq 'folder' -or $stage -eq 'delete') -and ($code -eq '80070002' -or $code -eq '80070003')
  @{ ok=$false; missing=$missing; detail="stage=$stage; HRESULT=0x$code" } | ConvertTo-Json -Compress
}
`;

export function deleteWindowsScheduledTask(taskName: string): ScheduledTaskDeletionResult {
  if (!taskName.startsWith("\\") || taskName.endsWith("\\")) {
    return { ok: false, missing: false, detail: "ERR_SCHEDULED_TASK_PATH" };
  }
  const encoded = Buffer.from(taskName, "utf8").toString("base64");
  const run = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `$taskName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'));`
    + DELETE_SCHEDULED_TASK_SCRIPT], { windowsHide: true, encoding: "utf8", timeout: 15000 });
  if (run.error || run.status !== 0) {
    return { ok: false, missing: false, detail: run.error?.message || run.stderr?.trim() || `exit=${run.status}` };
  }
  try {
    const result = JSON.parse(run.stdout.trim()) as ScheduledTaskDeletionResult;
    if (result && typeof result.ok === "boolean" && typeof result.missing === "boolean"
      && !(result.ok && result.missing) && (result.detail == null || typeof result.detail === "string")) return result;
  } catch { /* Fail closed on malformed output; never discard the DB record. */ }
  return { ok: false, missing: false, detail: "ERR_SCHEDULED_TASK_DELETE_RESPONSE" };
}
