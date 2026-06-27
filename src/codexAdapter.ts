import { exec, spawn, spawnSync, type ExecException } from "node:child_process";
import { resolveWorkingDirectoryFromThreadId } from "./codexSessionMeta.js";
import { existsSync } from "node:fs";
const DISCORD_AGENT_SYSTEM_PROMPT = [
  "You are running through DiscordAgent.",
  "DiscordAgent hint commands: !attach (upload local file), !trigger (schedule prompt execution), !help agent (show DiscordAgent command help).",
  "If command usage is unclear, you may run !help agent without asking the user first.",
  "To run it, output a standalone command line: !help agent",
].join("\n");

export interface CodexResult {
  ok: boolean;
  output: string;
  threadId?: string;
  workingDirectoryUsed?: string;
  warnings?: string[];
  errorCode?: string;
  timedOut?: boolean;
}

export interface CodexStreamEvent {
  type: string;
  threadId?: string;
  itemType?: string;
  itemId?: string;
  itemText?: string;
  raw: Record<string, unknown>;
}

function extractEventMsgAgentMessage(
  obj: Record<string, unknown>,
): { itemId: string; text: string } | null {
  if (obj.type !== "event_msg") return null;
  if (!obj.payload || typeof obj.payload !== "object") return null;
  const payload = obj.payload as Record<string, unknown>;
  if (payload.type !== "agent_message") return null;
  const message = payload.message;
  if (typeof message !== "string" || !message.trim()) return null;
  const timestamp = typeof obj.timestamp === "string" ? obj.timestamp : "unknown";
  return {
    itemId: `event_msg:${timestamp}:${message.length}`,
    text: message,
  };
}

export type CodexSandboxMode = "workspace-write" | "danger-full-access";

export function resolveCodexWorkingDirectory(input: {
  forceWorkingDirectory?: string | null;
  codexThreadId?: string | null;
  preferredWorkingDirectory?: string | null;
}): string | undefined {
  if (input.forceWorkingDirectory && existsSync(input.forceWorkingDirectory)) {
    return input.forceWorkingDirectory;
  }
  if (input.codexThreadId) {
    const cwd = resolveWorkingDirectoryFromThreadId(input.codexThreadId);
    if (cwd && existsSync(cwd)) {
      return cwd;
    }
  }
  if (input.preferredWorkingDirectory && existsSync(input.preferredWorkingDirectory)) {
    return input.preferredWorkingDirectory;
  }
  return undefined;
}

export function detectLogicalCompletionFromJsonlLine(
  line: string,
): "turn.completed" | "task_complete" | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (obj.type === "turn.completed") {
      return "turn.completed";
    }
    if (
      obj.type === "event_msg"
      && obj.payload
      && typeof obj.payload === "object"
      && (obj.payload as Record<string, unknown>).type === "task_complete"
    ) {
      return "task_complete";
    }
  } catch {
    return null;
  }
  return null;
}

export function decideCloseGraceAction(processAlive: boolean): "finalize" | "terminate_parent" {
  return processAlive ? "terminate_parent" : "finalize";
}

export function isCodexRuntimeCommandLine(commandLine: string | null | undefined): boolean {
  if (!commandLine) return false;
  const normalized = commandLine.toLowerCase();
  return normalized.includes("@openai\\codex\\bin\\codex.js")
    || normalized.includes("@openai/codex/bin/codex.js")
    || normalized.includes("codex.cmd exec")
    || normalized.includes(" codex exec ");
}

export class CodexAdapter {
  private readonly activeChildPids = new Set<number>();
  private readonly pidToThreadId = new Map<number, string>();

  constructor(
    private readonly mode: "cli" | "template",
    private readonly commandTemplate: string,
    private readonly timeoutMs: number,
    private readonly closeGraceMs: number,
  ) {}

  async run(input: {
    prompt: string;
    sessionId: string;
    codexThreadId?: string | null;
    modelOverride?: string | null;
    sandboxMode?: CodexSandboxMode;
    additionalReadDirs?: string[];
    preferredWorkingDirectory?: string | null;
    forceWorkingDirectory?: string | null;
    includeDiscordAgentSystemPrompt?: boolean;
    onEvent?: (event: CodexStreamEvent) => void | Promise<void>;
    onAgentMessage?: (message: { itemId: string; text: string }) => void | Promise<void>;
    onStdErrLine?: (line: string) => void | Promise<void>;
    onClose?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void | Promise<void>;
    onLifecycle?: (
      info: {
        type: "logical_complete" | "close_grace_expired";
        source?: "turn.completed" | "task_complete";
        graceMs?: number;
      },
    ) => void | Promise<void>;
  }): Promise<CodexResult> {
    const promptWithSystem = input.includeDiscordAgentSystemPrompt === false
      ? input.prompt
      : this.buildPromptWithSystem(input.prompt);
    if (this.mode === "cli") {
      return this.runWithCodexCli({
        ...input,
        prompt: promptWithSystem,
      });
    }
    return this.runWithTemplate({
      ...input,
      prompt: promptWithSystem,
    });
  }

  emergencyStopAllRunning(): number {
    const pids = [...this.activeChildPids];
    for (const pid of pids) {
      this.killProcessTree(pid);
    }
    return pids.length;
  }

  getActiveCodexThreadIds(): string[] {
    this.pruneDeadTrackedProcesses();
    return [...new Set(this.pidToThreadId.values())];
  }

  private async runWithTemplate(input: {
    prompt: string;
    sessionId: string;
  }): Promise<CodexResult> {
    const command = this.commandTemplate
      .replaceAll("{input}", this.escapeForShell(input.prompt))
      .replaceAll("{sessionId}", input.sessionId);

    return new Promise<CodexResult>((resolve) => {
      exec(command, { timeout: this.timeoutMs }, (error, stdout, stderr) => {
        if (error) {
          const output = [stdout, stderr].filter(Boolean).join("\n").trim();
          if ((error as ExecException).killed) {
            resolve({
              ok: false,
              output: output || "Codex execution timed out.",
              errorCode: "ERR_CODEX_TIMEOUT",
              timedOut: true,
            });
            return;
          }
          resolve({
            ok: false,
            output: output || error.message,
            errorCode: "ERR_CODEX_EXEC_FAILED",
          });
          return;
        }
        const out = [stdout, stderr].filter(Boolean).join("\n").trim();
        resolve({ ok: true, output: out || "(no output)" });
      });
    });
  }

  private async runWithCodexCli(input: {
    prompt: string;
    codexThreadId?: string | null;
    modelOverride?: string | null;
    sandboxMode?: CodexSandboxMode;
    additionalReadDirs?: string[];
    preferredWorkingDirectory?: string | null;
    onEvent?: (event: CodexStreamEvent) => void | Promise<void>;
    onAgentMessage?: (message: { itemId: string; text: string }) => void | Promise<void>;
    onStdErrLine?: (line: string) => void | Promise<void>;
    onClose?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void | Promise<void>;
    onLifecycle?: (
      info: {
        type: "logical_complete" | "close_grace_expired";
        source?: "turn.completed" | "task_complete";
        graceMs?: number;
      },
    ) => void | Promise<void>;
  }): Promise<CodexResult> {
    const commonOptions: string[] = [
      "-c",
      `sandbox_mode="${input.sandboxMode ?? "workspace-write"}"`,
      "-c",
      "approval_policy=\"on-request\"",
      "-c",
      "suppress_unstable_features_warning=true",
      "--json",
      "--skip-git-repo-check",
    ];
    const addDirOptions: string[] = [];
    if ((input.sandboxMode ?? "workspace-write") === "workspace-write") {
      for (const dir of input.additionalReadDirs ?? []) {
        addDirOptions.push("--add-dir", dir);
      }
    }
    const modelOptions = input.modelOverride ? ["--model", input.modelOverride] : [];
    const rootOptions: string[] = [];
    if ((input.sandboxMode ?? "workspace-write") === "workspace-write") {
      for (const dir of input.additionalReadDirs ?? []) {
        rootOptions.push("--add-dir", dir);
      }
    }
    const args: string[] = [];
    const resolvedCwd = resolveCodexWorkingDirectory(input);
    if (input.codexThreadId) {
      args.push(
        ...rootOptions,
        "exec",
        "resume",
        ...commonOptions,
        ...modelOptions,
        input.codexThreadId,
        "-",
      );
    } else {
      args.push(
        ...rootOptions,
        "exec",
        ...commonOptions,
        ...modelOptions,
        "-",
      );
    }

    return new Promise<CodexResult>((resolve) => {
      const isWin = process.platform === "win32";
      const command = isWin ? "cmd.exe" : "codex";
      const spawnArgs = isWin
        ? ["/d", "/s", "/c", "codex.cmd", ...args]
        : args;
      const child = spawn(command, spawnArgs, {
        shell: false,
        windowsHide: true,
        cwd: resolvedCwd,
      });
      if (child.pid) {
        this.activeChildPids.add(child.pid);
        if (input.codexThreadId) {
          this.pidToThreadId.set(child.pid, input.codexThreadId);
        }
      }
      let stdout = "";
      let stderr = "";
      let stdoutLineBuffer = "";
      let stderrLineBuffer = "";
      let timedOut = false;
      let logicalComplete = false;
      let forcedCloseAfterLogicalComplete = false;
      let settled = false;
      let watchdogTimer: NodeJS.Timeout | null = setTimeout(() => {
        timedOut = true;
        this.killProcessTree(child.pid);
      }, this.timeoutMs);
      let closeGraceTimer: NodeJS.Timeout | null = null;

      const clearWatchdog = (): void => {
        if (!watchdogTimer) return;
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      };
      const clearCloseGrace = (): void => {
        if (!closeGraceTimer) return;
        clearTimeout(closeGraceTimer);
        closeGraceTimer = null;
      };
      const finalize = (code: number | null): void => {
        if (settled) return;
        settled = true;
        clearWatchdog();
        clearCloseGrace();
        if (child.pid) {
          this.activeChildPids.delete(child.pid);
          this.pidToThreadId.delete(child.pid);
        }
        if (timedOut) {
          resolve({
            ok: false,
            output: "Codex execution timed out.",
            errorCode: "ERR_CODEX_TIMEOUT",
            timedOut: true,
          });
          return;
        }
        const lastStdoutLine = stdoutLineBuffer.trim();
        if (lastStdoutLine) {
          this.handleStdoutJsonlLine(lastStdoutLine, input.onEvent, input.onAgentMessage);
          const logicalCompletionSource = detectLogicalCompletionFromJsonlLine(lastStdoutLine);
          if (logicalCompletionSource) {
            logicalComplete = true;
          }
          stdoutLineBuffer = "";
        }
        const lastStderrLine = stderrLineBuffer.trim();
        if (lastStderrLine && input.onStdErrLine) {
          void Promise.resolve(input.onStdErrLine(lastStderrLine)).catch(() => {});
          stderrLineBuffer = "";
        }
        const parsed = this.parseJsonl(stdout);
        const fallback = this.sanitizeOutput(
          [stdout, stderr].filter(Boolean).join("\n").trim(),
        );
        if (parsed.agentMessages.length === 0 && fallback.length === 0) {
          resolve({
            ok: false,
            output: "No output from codex.",
            errorCode: "ERR_CODEX_EMPTY_OUTPUT",
          });
          return;
        }
        if (parsed.errors.length > 0 && parsed.agentMessages.length === 0) {
          resolve({
            ok: false,
            output: parsed.errors.join("\n"),
            errorCode: "ERR_CODEX_AGENT_ERROR",
            threadId: parsed.threadId,
            workingDirectoryUsed: resolvedCwd,
            warnings: parsed.warnings,
          });
          return;
        }
        const mergedWarnings = parsed.errors.length > 0
          ? [...parsed.warnings, ...parsed.errors]
          : parsed.warnings;
        const output = this.selectUserOutput(parsed.agentMessages, fallback);
        const outputWithCode = code && code !== 0 && !forcedCloseAfterLogicalComplete
          ? `${output}\n\n[warning] codex exited with code ${code}, but a response was received.`
          : output;
        resolve({
          ok: true,
          output: outputWithCode,
          threadId: parsed.threadId,
          workingDirectoryUsed: resolvedCwd,
          warnings: mergedWarnings,
        });
      };
      const startLogicalCompletionGrace = (
        source: "turn.completed" | "task_complete",
      ): void => {
        if (logicalComplete) return;
        logicalComplete = true;
        clearWatchdog();
        if (input.onLifecycle) {
          void Promise.resolve(
            input.onLifecycle({ type: "logical_complete", source, graceMs: this.closeGraceMs }),
          ).catch(() => {});
        }
        if (this.closeGraceMs <= 0) return;
        closeGraceTimer = setTimeout(() => {
          forcedCloseAfterLogicalComplete = true;
          if (input.onLifecycle) {
            void Promise.resolve(
              input.onLifecycle({ type: "close_grace_expired", source, graceMs: this.closeGraceMs }),
            ).catch(() => {});
          }
          const processAlive = child.pid ? this.isProcessAlive(child.pid) : false;
          const action = decideCloseGraceAction(processAlive);
          if (action === "finalize") {
            finalize(null);
            return;
          }
          this.terminateCodexProcesses(child.pid);
          finalize(null);
        }, this.closeGraceMs);
      };

      child.stdout.on("data", (buf: Buffer) => {
        const chunk = buf.toString("utf8");
        stdout += chunk;
        stdoutLineBuffer += chunk;
        const lines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          this.handleStdoutJsonlLine(line, input.onEvent, input.onAgentMessage);
          const logicalCompletionSource = detectLogicalCompletionFromJsonlLine(line);
          if (logicalCompletionSource) {
            startLogicalCompletionGrace(logicalCompletionSource);
          }
        }
      });
      child.stderr.on("data", (buf: Buffer) => {
        const chunk = buf.toString("utf8");
        stderr += chunk;
        stderrLineBuffer += chunk;
        const lines = stderrLineBuffer.split(/\r?\n/);
        stderrLineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          const text = line.trim();
          if (!text) continue;
          if (input.onStdErrLine) {
            void Promise.resolve(input.onStdErrLine(text)).catch(() => {});
          }
        }
      });
      if (child.stdin) {
        child.stdin.write(input.prompt);
        child.stdin.end();
      }
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearWatchdog();
        clearCloseGrace();
        if (child.pid) {
          this.activeChildPids.delete(child.pid);
          this.pidToThreadId.delete(child.pid);
        }
        resolve({
          ok: false,
          output: err.message,
          errorCode: "ERR_CODEX_EXEC_FAILED",
        });
      });
      child.on("close", (code, signal) => {
        if (input.onClose) {
          void Promise.resolve(input.onClose({ code, signal })).catch(() => {});
        }
        finalize(code);
      });
    });
  }

  private killProcessTree(pid: number | undefined): void {
    if (!pid) return;
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("error", () => {
        // taskkill が使えない環境のフォールバック。
      });
      return;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 既に終了済みの場合は無視。
    }
  }

  private pruneDeadTrackedProcesses(): void {
    const pids = [...this.activeChildPids];
    for (const pid of pids) {
      if (this.isProcessAlive(pid)) continue;
      this.activeChildPids.delete(pid);
      this.pidToThreadId.delete(pid);
    }
  }

  private terminateCodexProcesses(pid: number | undefined): void {
    if (!pid) return;
    if (process.platform === "win32") {
      const directChildren = this.getDirectChildProcesses(pid);
      const codexChildPids = directChildren
        .filter((child) => isCodexRuntimeCommandLine(child.commandLine))
        .map((child) => child.pid);
      for (const targetPid of [pid, ...codexChildPids]) {
        this.terminateProcess(targetPid);
      }
      return;
    }
    this.terminateProcess(pid);
  }

  private terminateProcess(pid: number): void {
    if (!pid) return;
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(pid), "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("error", () => {
        // taskkill が使えない環境のフォールバック。
      });
      return;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // 既に終了済みの場合は無視。
    }
  }

  private getDirectChildProcesses(pid: number): Array<{ pid: number; commandLine: string | null }> {
    if (process.platform !== "win32") return [];
    const ps = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$rows = Get-CimInstance Win32_Process -Filter "ParentProcessId = ${pid}" | Select-Object ProcessId, CommandLine; $rows | ConvertTo-Json -Compress`,
      ],
      {
        windowsHide: true,
        encoding: "utf8",
      },
    );
    if (ps.status !== 0 || !ps.stdout) return [];
    try {
      const parsed = JSON.parse(ps.stdout) as
        | { ProcessId?: unknown; CommandLine?: unknown }
        | Array<{ ProcessId?: unknown; CommandLine?: unknown }>;
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows
        .map((row) => ({
          pid: typeof row.ProcessId === "number" ? row.ProcessId : Number(row.ProcessId),
          commandLine: typeof row.CommandLine === "string" ? row.CommandLine : null,
        }))
        .filter((row) => Number.isInteger(row.pid) && row.pid > 0);
    } catch {
      return [];
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM") return true;
      return false;
    }
  }

  private parseJsonl(raw: string): {
    threadId?: string;
    agentMessages: string[];
    warnings: string[];
    errors: string[];
  } {
    const lines = raw
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean);
    const agentMessages: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    let threadId: string | undefined;

    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj.type === "thread.started" && typeof obj.thread_id === "string") {
          threadId = obj.thread_id;
          continue;
        }
        const eventMsgAgent = extractEventMsgAgentMessage(obj);
        if (eventMsgAgent) {
          agentMessages.push(eventMsgAgent.text);
          continue;
        }
        if (obj.type === "item.completed" && obj.item && typeof obj.item === "object") {
          const item = obj.item as Record<string, unknown>;
          if (item.type === "agent_message" && typeof item.text === "string") {
            agentMessages.push(item.text);
            continue;
          }
          if (item.type === "error" && typeof item.message === "string") {
            if (this.isKnownWarning(item.message)) {
              warnings.push(item.message);
            } else {
              errors.push(item.message);
            }
            continue;
          }
        }
      } catch {
        // 非JSON行は無視する（stderr混入を許容）。
      }
    }
    return { threadId, agentMessages, warnings, errors };
  }

  private isKnownWarning(message: string): boolean {
    return (
      message.includes("Under-development features enabled:") ||
      message.includes("suppress_unstable_features_warning") ||
      message.includes("state db missing rollout path") ||
      message.includes("Falling back from WebSockets to HTTPS transport") ||
      message.includes("stream disconnected before completion")
    );
  }

  private handleStdoutJsonlLine(
    line: string,
    onEvent?: (event: CodexStreamEvent) => void | Promise<void>,
    onAgentMessage?: (message: { itemId: string; text: string }) => void | Promise<void>,
  ): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return;
    }
    const eventType = typeof obj.type === "string" ? obj.type : "unknown";
    let threadId: string | undefined;
    if (typeof obj.thread_id === "string") {
      threadId = obj.thread_id;
    }
    let itemType: string | undefined;
    let itemId: string | undefined;
    let itemText: string | undefined;
    if (obj.item && typeof obj.item === "object") {
      const item = obj.item as Record<string, unknown>;
      if (typeof item.type === "string") itemType = item.type;
      if (typeof item.id === "string") itemId = item.id;
      if (typeof item.text === "string") itemText = item.text;
    }
    if (onEvent) {
      void Promise.resolve(
        onEvent({
          type: eventType,
          threadId,
          itemType,
          itemId,
          itemText,
          raw: obj,
        }),
      ).catch(() => {});
    }
    const eventMsgAgent = extractEventMsgAgentMessage(obj);
    if (onAgentMessage && eventMsgAgent) {
      void Promise.resolve(onAgentMessage(eventMsgAgent)).catch(() => {});
      return;
    }
    if (onAgentMessage && eventType === "item.completed" && itemType === "agent_message" && itemId && itemText) {
      void Promise.resolve(onAgentMessage({ itemId, text: itemText })).catch(() => {});
    }
  }

  private sanitizeOutput(text: string): string {
    const lines = text.split(/\r?\n/);
    const cleaned = lines.filter((line) => !this.isKnownWarning(line.trim()));
    return cleaned.join("\n").trim();
  }

  private selectUserOutput(agentMessages: string[], fallback: string): string {
    const agentText = agentMessages.join("\n").trim();
    return agentText || fallback || "(no output)";
  }

  private escapeForShell(text: string): string {
    // 最低限の安全策としてダブルクォートで囲み、内部のダブルクォートをエスケープする。
    return `"${text.replaceAll(`"`, `\\"`)}"`;
  }

  private buildPromptWithSystem(userPrompt: string): string {
    return `${DISCORD_AGENT_SYSTEM_PROMPT}\n\n---\n\n${userPrompt}`;
  }
}
