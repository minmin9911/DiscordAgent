import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ExternalSyncItemType = "user_message" | "agent_message";

export interface ExternalSyncEvent {
  lineNo: number;
  eventId: string;
  stableEventId?: string;
  itemType: ExternalSyncItemType;
  text: string;
  occurredAtMs: number | null;
  eventSignature?: string;
}

export interface ExternalSyncReadResult {
  sourceFound: boolean;
  latestLineNo: number;
  events: ExternalSyncEvent[];
}

export function buildExternalSyncEventSignature(input: {
  itemType: ExternalSyncItemType;
  timestamp: string;
  text: string;
}): string {
  return `${input.itemType}:${input.timestamp}:${input.text.length}`;
}

export function buildExternalSyncEventMsgId(input: {
  itemType: ExternalSyncItemType;
  timestamp: string;
  text: string;
}): string {
  return `event_msg:${buildExternalSyncEventSignature(input)}`;
}

export function tryBuildStableIdentityFromAdjacentEventMsg(
  lines: string[],
  currentIndex: number,
  itemType: ExternalSyncItemType,
  text: string,
): { stableEventId: string; eventSignature: string } | null {
  const lookbackStart = Math.max(0, currentIndex - 3);
  for (let i = currentIndex - 1; i >= lookbackStart; i -= 1) {
    const trimmed = (lines[i] ?? "").trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as {
        type?: unknown;
        timestamp?: unknown;
        payload?: { type?: unknown; message?: unknown };
      };
      if (
        obj.type === "event_msg"
        && typeof obj.timestamp === "string"
        && obj.payload
        && typeof obj.payload === "object"
        && obj.payload.type === itemType
        && obj.payload.message === text
      ) {
        const eventSignature = buildExternalSyncEventSignature({
          itemType,
          timestamp: obj.timestamp,
          text,
        });
        return {
          stableEventId: `event_msg:${eventSignature}`,
          eventSignature,
        };
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export function parseExternalSyncEventLine(
  line: string,
  lineNo: number,
): ExternalSyncEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as {
      type?: unknown;
      item?: { id?: unknown; type?: unknown; text?: unknown };
      payload?: {
        type?: unknown;
        message?: unknown;
        role?: unknown;
        content?: unknown;
      };
      timestamp?: unknown;
    };
    if (obj.type === "event_msg" && obj.payload && typeof obj.payload === "object") {
      const msgType = obj.payload.type;
      if (msgType !== "user_message" && msgType !== "agent_message") return null;
      const message = obj.payload.message;
      if (typeof message !== "string" || !message.trim()) return null;
      return {
        lineNo,
        eventId: `line:${lineNo}`,
        itemType: msgType,
        text: message,
        occurredAtMs: null,
      };
    }
    if (obj.type === "item.completed" && obj.item && typeof obj.item === "object") {
      const itemType = obj.item.type;
      if (itemType !== "user_message" && itemType !== "agent_message") return null;
      const itemText = obj.item.text;
      if (typeof itemText !== "string" || !itemText.trim()) return null;
      const itemIdRaw = typeof obj.item.id === "string" ? obj.item.id.trim() : "";
      const eventId = itemIdRaw || `line:${lineNo}`;
      return {
        lineNo,
        eventId,
        itemType,
        text: itemText,
        occurredAtMs: null,
      };
    }
    // Fallback for clients that only emit response_item assistant output.
    // We intentionally do not map response_item role=user because that may
    // include expanded prompt context rather than a user-typed message.
    if (
      obj.type === "response_item"
      && obj.payload
      && typeof obj.payload === "object"
      && obj.payload.type === "message"
      && obj.payload.role === "assistant"
    ) {
      const content = obj.payload.content;
      if (!Array.isArray(content)) return null;
      let text = "";
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const p = part as { type?: unknown; text?: unknown };
        if (p.type !== "output_text") continue;
        if (typeof p.text !== "string") continue;
        text += p.text;
      }
      if (!text.trim()) return null;
      return {
        lineNo,
        eventId: `line:${lineNo}`,
        itemType: "agent_message",
        text,
        occurredAtMs: null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeForDedup(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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

export function readCodexThreadEventsSinceLine(
  codexThreadId: string,
  afterLineNo: number,
): ExternalSyncReadResult {
  const sessionsRoot = join(homedir(), ".codex", "sessions");
  if (!existsSync(sessionsRoot)) {
    return { sourceFound: false, latestLineNo: 0, events: [] };
  }
  const sessionFile = findSessionFileByThreadId(sessionsRoot, codexThreadId);
  if (!sessionFile) {
    return { sourceFound: false, latestLineNo: 0, events: [] };
  }
  const text = readFileSync(sessionFile, "utf8");
  const lines = text.split(/\r?\n/);
  const events: ExternalSyncEvent[] = [];
  const recentBySignature = new Map<string, number>();
  let trailingInvalidJson = false;
  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    if (lineNo <= afterLineNo) continue;
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed) {
      try {
        JSON.parse(trimmed);
      } catch {
        if (lineNo === lines.length) trailingInvalidJson = true;
      }
    }
    const parsed = parseExternalSyncEventLine(line, lineNo);
    if (!parsed) continue;
    let occurredAtMs: number | null = null;
    if (trimmed) {
      try {
        const obj = JSON.parse(trimmed) as { timestamp?: unknown };
        if (typeof obj.timestamp === "string") {
          const ms = Date.parse(obj.timestamp);
          if (Number.isFinite(ms)) occurredAtMs = ms;
        }
      } catch {
        // ignore
      }
    }
    const normalized = normalizeForDedup(parsed.text);
    if (normalized) {
      const sig = `${parsed.itemType}:${normalized}`;
      const prevLineNo = recentBySignature.get(sig);
      if (typeof prevLineNo === "number" && parsed.lineNo - prevLineNo <= 3) {
        recentBySignature.set(sig, parsed.lineNo);
        continue;
      }
      recentBySignature.set(sig, parsed.lineNo);
    }
    let eventSignature: string | undefined;
    let stableEventId: string | undefined;
    if (trimmed) {
      try {
        const obj = JSON.parse(trimmed) as {
          type?: unknown;
          timestamp?: unknown;
          payload?: {
            type?: unknown;
            message?: unknown;
            role?: unknown;
            content?: unknown;
          };
        };
        if (
          obj.type === "event_msg"
          && typeof obj.timestamp === "string"
          && obj.payload
          && typeof obj.payload === "object"
          && (obj.payload.type === "user_message" || obj.payload.type === "agent_message")
          && typeof obj.payload.message === "string"
        ) {
          stableEventId = buildExternalSyncEventMsgId({
            itemType: obj.payload.type,
            timestamp: obj.timestamp,
            text: obj.payload.message,
          });
          eventSignature = buildExternalSyncEventSignature({
            itemType: obj.payload.type,
            timestamp: obj.timestamp,
            text: obj.payload.message,
          });
        }
        if (
          !stableEventId
          && obj.type === "response_item"
          && obj.payload
          && typeof obj.payload === "object"
          && obj.payload.type === "message"
          && obj.payload.role === "assistant"
        ) {
          const adjacent = tryBuildStableIdentityFromAdjacentEventMsg(
            lines,
            i,
            "agent_message",
            parsed.text,
          );
          if (adjacent) {
            stableEventId = adjacent.stableEventId;
            eventSignature = adjacent.eventSignature;
          }
        }
      } catch {
        // ignore
      }
    }
    events.push({ ...parsed, occurredAtMs, stableEventId, eventSignature });
  }
  const safeLatestLineNo = trailingInvalidJson
    ? Math.max(0, lines.length - 1)
    : lines.length;
  return {
    sourceFound: true,
    latestLineNo: safeLatestLineNo,
    events,
  };
}
