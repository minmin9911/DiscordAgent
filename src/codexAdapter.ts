import { exec, spawn, type ExecException } from "node:child_process";
import { resolveWorkingDirectoryFromThreadId } from "./codexSessionMeta.js";
import { existsSync } from "node:fs";
import { ATTACH_MAX_BYTES } from "./attachPolicy.js";
const DISCORD_AGENT_SYSTEM_PROMPT = [
  "You are running through DiscordAgent.",
  "DiscordAgent can upload local files to Discord on your behalf.",
  "Do not ask the user to run !attach. User-side !attach is disabled.",
  "When file upload is needed, output a standalone command line: !attach <absolute_path>.",
  "absolute_path is required for reliable path resolution.",
  `The file size limit is ${ATTACH_MAX_BYTES} bytes (8MB).`,
  "If a file is larger than 8MB, suggest splitting or compressing first.",
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

export class CodexAdapter {
  private readonly activeChildPids = new Set<number>();
  private readonly pidToThreadId = new Map<number, string>();

  constructor(
    private readonly mode: "cli" | "template",
    private readonly commandTemplate: string,
    private readonly timeoutMs: number,
  ) {}

  async run(input: {
    prompt: string;
    sessionId: string;
    codexThreadId?: string | null;
    preferredWorkingDirectory?: string | null;
    includeDiscordAgentSystemPrompt?: boolean;
    onEvent?: (event: CodexStreamEvent) => void | Promise<void>;
    onAgentMessage?: (message: { itemId: string; text: string }) => void | Promise<void>;
    onStdErrLine?: (line: string) => void | Promise<void>;
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
    preferredWorkingDirectory?: string | null;
    onEvent?: (event: CodexStreamEvent) => void | Promise<void>;
    onAgentMessage?: (message: { itemId: string; text: string }) => void | Promise<void>;
    onStdErrLine?: (line: string) => void | Promise<void>;
  }): Promise<CodexResult> {
    const args: string[] = [];
    let resolvedCwd: string | undefined;
    if (input.codexThreadId) {
      const cwd = resolveWorkingDirectoryFromThreadId(input.codexThreadId);
      if (cwd && existsSync(cwd)) {
        resolvedCwd = cwd;
      }
    }
    if (!resolvedCwd && input.preferredWorkingDirectory && existsSync(input.preferredWorkingDirectory)) {
      resolvedCwd = input.preferredWorkingDirectory;
    }
    if (input.codexThreadId) {
      args.push(
        "exec",
        "resume",
        input.codexThreadId,
        "-",
        "--dangerously-bypass-approvals-and-sandbox",
        "-c",
        "suppress_unstable_features_warning=true",
        "--json",
        "--skip-git-repo-check",
      );
    } else {
      args.push(
        "exec",
        "-",
        "--dangerously-bypass-approvals-and-sandbox",
        "-c",
        "suppress_unstable_features_warning=true",
        "--json",
        "--skip-git-repo-check",
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
      const timer = setTimeout(() => {
        timedOut = true;
        this.killProcessTree(child.pid);
      }, this.timeoutMs);

      child.stdout.on("data", (buf: Buffer) => {
        const chunk = buf.toString("utf8");
        stdout += chunk;
        stdoutLineBuffer += chunk;
        const lines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = lines.pop() ?? "";
        for (const line of lines) {
          this.handleStdoutJsonlLine(line, input.onEvent, input.onAgentMessage);
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
        clearTimeout(timer);
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
      child.on("close", (code) => {
        clearTimeout(timer);
        if (child.pid) {
          this.activeChildPids.delete(child.pid);
          this.pidToThreadId.delete(child.pid);
        }
        const lastStdoutLine = stdoutLineBuffer.trim();
        if (lastStdoutLine) {
          this.handleStdoutJsonlLine(lastStdoutLine, input.onEvent, input.onAgentMessage);
        }
        const lastStderrLine = stderrLineBuffer.trim();
        if (lastStderrLine && input.onStdErrLine) {
          void Promise.resolve(input.onStdErrLine(lastStderrLine)).catch(() => {});
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
        const outputWithCode = code && code !== 0
          ? `${output}\n\n[warning] codex exited with code ${code}, but a response was received.`
          : output;
        resolve({
          ok: true,
          output: outputWithCode,
          threadId: parsed.threadId,
          workingDirectoryUsed: resolvedCwd,
          warnings: mergedWarnings,
        });
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
