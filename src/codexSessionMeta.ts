import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const cwdCache = new Map<string, string | null>();
const THREAD_ID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export interface CodexSessionMeta {
  threadId: string;
  cwd: string | null;
  summary: string | null;
  searchText: string | null;
  updatedAtMs: number;
}

export interface CodexUsageStatus {
  planType: string | null;
  primaryUsedPercent: number | null;
  primaryWindowMinutes: number | null;
  primaryResetsAt: number | null;
  secondaryUsedPercent: number | null;
  secondaryWindowMinutes: number | null;
  secondaryResetsAt: number | null;
}

function readNullableModelString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

function readNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseUsageStatusFromTokenCountLine(line: string): CodexUsageStatus | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (obj.type !== "event_msg") return null;
    const payload = obj.payload;
    if (!payload || typeof payload !== "object") return null;
    const payloadObj = payload as Record<string, unknown>;
    if (payloadObj.type !== "token_count") return null;
    const rateLimits = payloadObj.rate_limits;
    if (!rateLimits || typeof rateLimits !== "object") return null;
    const rateLimitsObj = rateLimits as Record<string, unknown>;
    const primary = rateLimitsObj.primary && typeof rateLimitsObj.primary === "object"
      ? rateLimitsObj.primary as Record<string, unknown>
      : null;
    const secondary = rateLimitsObj.secondary && typeof rateLimitsObj.secondary === "object"
      ? rateLimitsObj.secondary as Record<string, unknown>
      : null;
    return {
      planType: readNullableString(rateLimitsObj.plan_type),
      primaryUsedPercent: readNullableNumber(primary?.used_percent),
      primaryWindowMinutes: readNullableNumber(primary?.window_minutes),
      primaryResetsAt: readNullableNumber(primary?.resets_at),
      secondaryUsedPercent: readNullableNumber(secondary?.used_percent),
      secondaryWindowMinutes: readNullableNumber(secondary?.window_minutes),
      secondaryResetsAt: readNullableNumber(secondary?.resets_at),
    };
  } catch {
    return null;
  }
}

export function readLatestCodexUsageStatusFromSessionFile(
  sessionFile: string,
): CodexUsageStatus | null {
  const tailSizes = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024];
  const fd = openSync(sessionFile, "r");
  try {
    const fileSize = fstatSync(fd).size;
    for (const tailSize of tailSizes) {
      const length = Math.min(fileSize, tailSize);
      const start = Math.max(0, fileSize - length);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, start);
      const text = buffer.toString("utf8");
      const lines = text.split(/\r?\n/);
      if (start > 0) lines.shift();
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i]?.trim();
        if (!line || !line.includes('"token_count"')) continue;
        const parsed = parseUsageStatusFromTokenCountLine(line);
        if (parsed) return parsed;
      }
      if (length === fileSize) break;
    }
  } finally {
    closeSync(fd);
  }
  return null;
}

export function readLatestCodexUsageStatusByThreadId(
  threadId: string,
): CodexUsageStatus | null {
  const sessionsRoot = join(homedir(), ".codex", "sessions");
  if (!existsSync(sessionsRoot)) return null;
  const sessionFile = findSessionFileByThreadId(sessionsRoot, threadId);
  if (!sessionFile) return null;
  return readLatestCodexUsageStatusFromSessionFile(sessionFile);
}

export function readLatestCodexResolvedModelFromSessionFile(
  sessionFile: string,
): string | null {
  const tailSizes = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024];
  const fd = openSync(sessionFile, "r");
  try {
    const fileSize = fstatSync(fd).size;
    for (const tailSize of tailSizes) {
      const length = Math.min(fileSize, tailSize);
      const start = Math.max(0, fileSize - length);
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, start);
      const text = buffer.toString("utf8");
      const lines = text.split(/\r?\n/);
      if (start > 0) lines.shift();
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i]?.trim();
        if (!line || !line.includes('"turn_context"')) continue;
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          if (obj.type !== "turn_context") continue;
          const payload = obj.payload;
          if (!payload || typeof payload !== "object") continue;
          const payloadObj = payload as Record<string, unknown>;
          const directModel = readNullableModelString(payloadObj.model);
          if (directModel) return directModel;
          const collaborationMode = payloadObj.collaboration_mode;
          if (!collaborationMode || typeof collaborationMode !== "object") continue;
          const settings = (collaborationMode as Record<string, unknown>).settings;
          if (!settings || typeof settings !== "object") continue;
          const nestedModel = readNullableModelString((settings as Record<string, unknown>).model);
          if (nestedModel) return nestedModel;
        } catch {
          // ignore non-json lines
        }
      }
      if (length === fileSize) break;
    }
  } finally {
    closeSync(fd);
  }
  return null;
}

export function readLatestCodexResolvedModelByThreadId(
  threadId: string,
): string | null {
  const sessionsRoot = join(homedir(), ".codex", "sessions");
  if (!existsSync(sessionsRoot)) return null;
  const sessionFile = findSessionFileByThreadId(sessionsRoot, threadId);
  if (!sessionFile) return null;
  return readLatestCodexResolvedModelFromSessionFile(sessionFile);
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

function parseWorkspaceRootFromEnvironmentContext(sessionFile: string): string | null {
  const text = readFileSync(sessionFile, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rootRe = /<workspace_roots>\s*<root>(.*?)<\/root>[\s\S]*?<\/workspace_roots>/i;

  for (const line of lines.slice(0, 80)) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.type !== "response_item") continue;
      if (!obj.payload || typeof obj.payload !== "object") continue;
      const payload = obj.payload as Record<string, unknown>;
      if (payload.type !== "message" || payload.role !== "user") continue;
      if (!Array.isArray(payload.content)) continue;
      for (const item of payload.content) {
        if (!item || typeof item !== "object") continue;
        const part = item as Record<string, unknown>;
        if (typeof part.text !== "string") continue;
        const match = part.text.match(rootRe);
        if (match?.[1]?.trim()) {
          return match[1].trim();
        }
      }
    } catch {
      // ignore non-json lines
    }
  }
  return null;
}

export function resolveWorkingDirectoryFromSessionFile(sessionFile: string): string | null {
  return (
    parseWorkspaceRootFromEnvironmentContext(sessionFile)
    ?? parseCwdFromSessionMeta(sessionFile)
  );
}

function parseSessionMeta(sessionFile: string): CodexSessionMeta | null {
  const text = readFileSync(sessionFile, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);

  let threadId: string | null = null;
  let cwd = resolveWorkingDirectoryFromSessionFile(sessionFile);
  let summary: string | null = null;
  const searchPieces: string[] = [];

  const pushSearchText = (value: string): void => {
    const t = value.trim();
    if (!t) return;
    if (searchPieces.length < 6) {
      searchPieces.push(t.slice(0, 1000));
    }
    if (!summary) {
      summary = t.slice(0, 120);
    }
  };

  for (const line of lines.slice(0, 400)) {
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
        if (!summary && item.type === "user_message" && typeof item.text === "string") {
          pushSearchText(item.text);
          continue;
        }
        if (!summary && item.type === "agent_message" && typeof item.text === "string") {
          pushSearchText(item.text);
          continue;
        }
      }
      if (
        obj.type === "response_item"
        && obj.payload
        && typeof obj.payload === "object"
      ) {
        const payload = obj.payload as {
          type?: unknown;
          role?: unknown;
          content?: unknown;
        };
        if (
          payload.type === "message"
          && Array.isArray(payload.content)
          && (payload.role === "user" || payload.role === "assistant")
        ) {
          for (const c of payload.content) {
            if (!c || typeof c !== "object") continue;
            const part = c as { type?: unknown; text?: unknown };
            if (
              (part.type === "input_text" || part.type === "output_text")
              && typeof part.text === "string"
            ) {
              pushSearchText(part.text);
            }
          }
        }
      }
      if (
        obj.type === "event_msg"
        && obj.payload
        && typeof obj.payload === "object"
      ) {
        const payload = obj.payload as { type?: unknown; message?: unknown };
        if (payload.type === "agent_message" && typeof payload.message === "string") {
          pushSearchText(payload.message);
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
    searchText: searchPieces.length > 0 ? searchPieces.join("\n") : null,
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
    const haystack =
      `${parsed.threadId} ${parsed.cwd ?? ""} ${parsed.summary ?? ""} ${parsed.searchText ?? ""}`
        .toLowerCase();
    if (!q || haystack.includes(q)) {
      results.push(parsed);
    }
  }

  return results
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, Math.max(1, limit));
}

export function resolveCodexSessionMetaByThreadId(
  threadId: string,
): CodexSessionMeta | null {
  const sessionsRoot = join(homedir(), ".codex", "sessions");
  if (!existsSync(sessionsRoot)) return null;
  const sessionFile = findSessionFileByThreadId(sessionsRoot, threadId);
  if (!sessionFile) return null;
  return parseSessionMeta(sessionFile);
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
  const cwd = resolveWorkingDirectoryFromSessionFile(sessionFile);
  cwdCache.set(threadId, cwd);
  return cwd;
}
