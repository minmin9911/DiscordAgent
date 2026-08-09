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

export interface ExternalSyncTurn {
  turnId: string;
  startLineNo: number;
  completeLineNo: number;
  occurredAtMs: number | null;
  userMessage: string | null;
  finalAgentMessage: string | null;
  eventIds: string[];
}

export interface ExternalSyncTurnReadResult {
  sourceFound: boolean;
  latestLineNo: number;
  latestCompleteLineNo: number;
  hasTaskBoundary: boolean;
  turns: ExternalSyncTurn[];
}

export interface ExternalSyncStartedTurn {
  turnId: string;
  startLineNo: number;
  completeLineNo: number | null;
  occurredAtMs: number | null;
  userMessage: string | null;
  eventIds: string[];
}

export interface ExternalSyncStartedTurnReadResult {
  sourceFound: boolean;
  latestLineNo: number;
  turns: ExternalSyncStartedTurn[];
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

function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line.trim()) as unknown;
    return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function findLatestValidJsonLineNo(lines: readonly string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = (lines[index] ?? "").trim();
    if (!trimmed) continue;
    if (parseJsonObject(trimmed)) return index + 1;
  }
  return 0;
}

function getLineEventId(obj: Record<string, unknown>, lineNo: number): string {
  if (typeof obj.id === "string" && obj.id.trim()) return obj.id.trim();
  if (obj.item && typeof obj.item === "object") {
    const itemId = (obj.item as Record<string, unknown>).id;
    if (typeof itemId === "string" && itemId.trim()) return itemId.trim();
  }
  return `line:${lineNo}`;
}

function getTaskTurnId(obj: Record<string, unknown>, type: "task_started" | "task_complete"): string | null {
  if (obj.type !== "event_msg" || !obj.payload || typeof obj.payload !== "object") return null;
  const payload = obj.payload as Record<string, unknown>;
  if (payload.type !== type || typeof payload.turn_id !== "string") return null;
  const turnId = payload.turn_id.trim();
  return turnId || null;
}

function getCompletedAgentMessage(obj: Record<string, unknown>): string | null {
  if (obj.type !== "event_msg" || !obj.payload || typeof obj.payload !== "object") return null;
  const payload = obj.payload as Record<string, unknown>;
  if (payload.type !== "task_complete" || typeof payload.last_agent_message !== "string") return null;
  const message = payload.last_agent_message.trim();
  return message || null;
}

/**
 * Groups rollout JSONL records into completed Codex turns.
 * The parser deliberately returns no active turn, so a polling caller cannot
 * publish a partial response before task_complete has been written.
 */
export function parseCompletedExternalSyncTurns(
  lines: readonly string[],
  afterLineNo = 0,
  lineNoOffset = 0,
): ExternalSyncTurn[] {
  const completed: ExternalSyncTurn[] = [];
  let active: {
    turnId: string;
    startLineNo: number;
    occurredAtMs: number | null;
    eventIds: string[];
    userMessage: string | null;
    finalAgentMessage: string | null;
    seenUserMessages: Set<string>;
    seenAgentMessages: Set<string>;
  } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = lineNoOffset + index + 1;
    const obj = parseJsonObject(lines[index] ?? "");
    if (!obj) continue;

    const startedTurnId = getTaskTurnId(obj, "task_started");
    if (startedTurnId) {
      // A new start replaces an incomplete record; incomplete turns are never emitted.
      active = {
        turnId: startedTurnId,
        startLineNo: lineNo,
        occurredAtMs: typeof obj.timestamp === "string"
          ? Date.parse(obj.timestamp)
          : null,
        eventIds: [getLineEventId(obj, lineNo)],
        userMessage: null,
        finalAgentMessage: null,
        seenUserMessages: new Set<string>(),
        seenAgentMessages: new Set<string>(),
      };
      continue;
    }

    if (!active) continue;
    const completeTurnId = getTaskTurnId(obj, "task_complete");
    if (completeTurnId) {
      if (completeTurnId !== active.turnId) continue;
      active.eventIds.push(getLineEventId(obj, lineNo));
      const completedAgentMessage = getCompletedAgentMessage(obj);
      if (lineNo > afterLineNo) {
        completed.push({
          turnId: active.turnId,
          startLineNo: active.startLineNo,
          completeLineNo: lineNo,
          occurredAtMs: active.occurredAtMs !== null && Number.isFinite(active.occurredAtMs)
            ? active.occurredAtMs
            : null,
          userMessage: active.userMessage,
          finalAgentMessage: completedAgentMessage ?? active.finalAgentMessage,
          eventIds: [...new Set(active.eventIds)],
        });
      }
      active = null;
      continue;
    }

    const event = parseExternalSyncEventLine(lines[index] ?? "", lineNo);
    if (!event) continue;
    active.eventIds.push(event.eventId);
    const normalized = normalizeForDedup(event.text);
    if (!normalized) continue;
    if (event.itemType === "user_message") {
      if (!active.seenUserMessages.has(normalized)) {
        active.seenUserMessages.add(normalized);
        active.userMessage = event.text;
      }
      continue;
    }
    if (!active.seenAgentMessages.has(normalized)) {
      active.seenAgentMessages.add(normalized);
      active.finalAgentMessage = event.text;
    }
  }
  return completed;
}

function findSafeTurnParseStartIndex(lines: readonly string[], afterLineNo: number): number {
  for (let index = Math.min(afterLineNo - 1, lines.length - 1); index >= 0; index -= 1) {
    const obj = parseJsonObject(lines[index] ?? "");
    if (!obj) continue;
    if (getTaskTurnId(obj, "task_started")) return index;
    if (getTaskTurnId(obj, "task_complete")) return index + 1;
  }
  return 0;
}

export function parseStartedExternalSyncTurns(
  lines: readonly string[],
  afterLineNo = 0,
  lineNoOffset = 0,
): ExternalSyncStartedTurn[] {
  const turns: ExternalSyncStartedTurn[] = [];
  let active: ExternalSyncStartedTurn | null = null;
  const flushActive = (): void => {
    if (active && active.startLineNo > afterLineNo) turns.push(active);
    active = null;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = lineNoOffset + index + 1;
    const obj = parseJsonObject(lines[index] ?? "");
    if (!obj) continue;
    const startedTurnId = getTaskTurnId(obj, "task_started");
    if (startedTurnId) {
      flushActive();
      const occurredAtMs = typeof obj.timestamp === "string" ? Date.parse(obj.timestamp) : NaN;
      active = {
        turnId: startedTurnId,
        startLineNo: lineNo,
        completeLineNo: null,
        occurredAtMs: Number.isFinite(occurredAtMs) ? occurredAtMs : null,
        userMessage: null,
        eventIds: [getLineEventId(obj, lineNo)],
      };
      continue;
    }
    if (!active) continue;
    const completeTurnId = getTaskTurnId(obj, "task_complete");
    if (completeTurnId === active.turnId) {
      active.completeLineNo = lineNo;
      active.eventIds.push(getLineEventId(obj, lineNo));
      flushActive();
      continue;
    }
    const event = parseExternalSyncEventLine(lines[index] ?? "", lineNo);
    if (!event) continue;
    active.eventIds.push(event.eventId);
    if (event.itemType === "user_message" && !active.userMessage) {
      active.userMessage = event.text;
    }
  }
  flushActive();
  return turns;
}

export function readCodexThreadCompletedTurnsSinceLine(
  codexThreadId: string,
  afterLineNo: number,
): ExternalSyncTurnReadResult {
  const sessionsRoot = join(homedir(), ".codex", "sessions");
  if (!existsSync(sessionsRoot)) {
    return {
      sourceFound: false,
      latestLineNo: 0,
      latestCompleteLineNo: afterLineNo,
      hasTaskBoundary: false,
      turns: [],
    };
  }
  const sessionFile = findSessionFileByThreadId(sessionsRoot, codexThreadId);
  if (!sessionFile) {
    return {
      sourceFound: false,
      latestLineNo: 0,
      latestCompleteLineNo: afterLineNo,
      hasTaskBoundary: false,
      turns: [],
    };
  }
  const text = readFileSync(sessionFile, "utf8");
  const lines = text.split(/\r?\n/);
  const safeLatestLineNo = findLatestValidJsonLineNo(lines);
  const safeLines = lines.slice(0, safeLatestLineNo);
  const parseStartIndex = findSafeTurnParseStartIndex(safeLines, afterLineNo);
  const candidateLines = safeLines.slice(parseStartIndex);
  const turns = parseCompletedExternalSyncTurns(
    candidateLines,
    afterLineNo,
    parseStartIndex,
  );
  let hasTaskBoundary = false;
  for (let index = 0; index < candidateLines.length; index += 1) {
    const obj = parseJsonObject(candidateLines[index] ?? "");
    if (!obj) continue;
    if (getTaskTurnId(obj, "task_started") || getTaskTurnId(obj, "task_complete")) {
      hasTaskBoundary = true;
      break;
    }
  }
  const latestCompleteLineNo = turns.length > 0
    ? turns[turns.length - 1]!.completeLineNo
    : afterLineNo;
  return {
    sourceFound: true,
    latestLineNo: safeLatestLineNo,
    latestCompleteLineNo,
    hasTaskBoundary,
    turns,
  };
}

export function readCodexThreadStartedTurnsSinceLine(
  codexThreadId: string,
  afterLineNo: number,
): ExternalSyncStartedTurnReadResult {
  const sessionsRoot = join(homedir(), ".codex", "sessions");
  if (!existsSync(sessionsRoot)) {
    return { sourceFound: false, latestLineNo: 0, turns: [] };
  }
  const sessionFile = findSessionFileByThreadId(sessionsRoot, codexThreadId);
  if (!sessionFile) {
    return { sourceFound: false, latestLineNo: 0, turns: [] };
  }
  const lines = readFileSync(sessionFile, "utf8").split(/\r?\n/);
  const latestLineNo = findLatestValidJsonLineNo(lines);
  const safeLines = lines.slice(0, latestLineNo);
  const parseStartIndex = findSafeTurnParseStartIndex(safeLines, afterLineNo);
  return {
    sourceFound: true,
    latestLineNo,
    turns: parseStartedExternalSyncTurns(
      safeLines.slice(parseStartIndex),
      afterLineNo,
      parseStartIndex,
    ),
  };
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
  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    if (lineNo <= afterLineNo) continue;
    const line = lines[i] ?? "";
    const trimmed = line.trim();
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
  const safeLatestLineNo = findLatestValidJsonLineNo(lines);
  return {
    sourceFound: true,
    latestLineNo: safeLatestLineNo,
    events,
  };
}
