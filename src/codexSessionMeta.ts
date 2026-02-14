import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const cwdCache = new Map<string, string | null>();
const THREAD_ID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export interface CodexSessionMeta {
  threadId: string;
  cwd: string | null;
  summary: string | null;
  updatedAtMs: number;
}

function findSessionFileByThreadId(rootDir: string, threadId: string): string | null {
  const stack: string[] = [rootDir];
  const suffix = `${threadId}.jsonl`;

  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(suffix)) {
        return full;
      }
    }
  }
  return null;
}

function parseCwdFromSessionMeta(sessionFile: string): string | null {
  const text = readFileSync(sessionFile, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines.slice(0, 30)) {
    try {
      const obj = JSON.parse(line) as {
        type?: string;
        payload?: { cwd?: string };
      };
      if (obj.type === "session_meta" && typeof obj.payload?.cwd === "string") {
        return obj.payload.cwd;
      }
    } catch {
      // 非JSON行は無視
    }
  }
  return null;
}

function parseSessionMeta(sessionFile: string): CodexSessionMeta | null {
  const text = readFileSync(sessionFile, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);

  let threadId: string | null = null;
  let cwd: string | null = null;
  let summary: string | null = null;

  for (const line of lines.slice(0, 250)) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (
        obj.type === "thread.started" &&
        typeof obj.thread_id === "string" &&
        !threadId
      ) {
        threadId = obj.thread_id;
        continue;
      }
      if (obj.type === "session_meta" && obj.payload && typeof obj.payload === "object") {
        const payload = obj.payload as { cwd?: unknown };
        if (typeof payload.cwd === "string" && !cwd) {
          cwd = payload.cwd;
        }
        continue;
      }
      if (obj.type === "item.completed" && obj.item && typeof obj.item === "object") {
        const item = obj.item as { type?: unknown; text?: unknown; message?: unknown };
        if (!summary && item.type === "agent_message" && typeof item.text === "string") {
          summary = item.text.trim().slice(0, 120);
          continue;
        }
        if (!summary && item.type === "user_message" && typeof item.text === "string") {
          summary = item.text.trim().slice(0, 120);
          continue;
        }
      }
    } catch {
      // ignore non-json lines
    }
  }

  if (!threadId) {
    const fileName = basename(sessionFile);
    const m = fileName.match(THREAD_ID_RE);
    if (m) threadId = m[0];
  }

  if (!threadId) return null;
  return {
    threadId,
    cwd,
    summary,
    updatedAtMs: statSync(sessionFile).mtimeMs,
  };
}

function collectSessionFiles(rootDir: string): string[] {
  const files: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(full);
      }
    }
  }
  return files;
}

export function searchCodexSessions(query: string, limit = 20): CodexSessionMeta[] {
  const sessionsRoot = join(homedir(), ".codex", "sessions");
  if (!existsSync(sessionsRoot)) return [];

  const q = query.trim().toLowerCase();
  const results: CodexSessionMeta[] = [];
  for (const file of collectSessionFiles(sessionsRoot)) {
    const parsed = parseSessionMeta(file);
    if (!parsed) continue;
    const haystack = `${parsed.threadId} ${parsed.cwd ?? ""} ${parsed.summary ?? ""}`.toLowerCase();
    if (!q || haystack.includes(q)) {
      results.push(parsed);
    }
  }

  return results
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, Math.max(1, limit));
}

export function resolveWorkingDirectoryFromThreadId(
  threadId: string,
): string | null {
  const cached = cwdCache.get(threadId);
  if (cached !== undefined) return cached;

  const sessionsRoot = join(homedir(), ".codex", "sessions");
  if (!existsSync(sessionsRoot)) {
    cwdCache.set(threadId, null);
    return null;
  }

  const sessionFile = findSessionFileByThreadId(sessionsRoot, threadId);
  if (!sessionFile) {
    cwdCache.set(threadId, null);
    return null;
  }
  const cwd = parseCwdFromSessionMeta(sessionFile);
  cwdCache.set(threadId, cwd);
  return cwd;
}
