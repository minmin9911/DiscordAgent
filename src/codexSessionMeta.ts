import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const cwdCache = new Map<string, string | null>();

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
