import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { IncrementalJsonlReader } from "./incrementalJsonlReader.js";

interface SyncRecord { lineNo: number; text: string }

export interface ExternalSyncReadDiagnostics {
  skippedLineCount: number;
  firstSkippedLineNo: number | null;
  lastSkippedLineNo: number | null;
}

export interface ExternalSyncLineCursor extends ExternalSyncReadDiagnostics {
  sourceFound: boolean;
  latestLineNo: number;
}

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
  diagnostics?: ExternalSyncReadDiagnostics;
}

export interface CodexThreadFileFingerprint {
  path: string;
  size: number;
  mtimeMs: number;
}

const sessionFilePathCache = new Map<string, string>();

export function hasCodexThreadFileChanged(
  previous: CodexThreadFileFingerprint | undefined,
  current: CodexThreadFileFingerprint | null,
): boolean {
  if (!current) return previous !== undefined;
  if (!previous) return true;
  return previous.path !== current.path
    || previous.size !== current.size
    || previous.mtimeMs !== current.mtimeMs;
}

export function getCodexThreadFileFingerprint(
  codexThreadId: string,
): CodexThreadFileFingerprint | null {
  const sessionsRoot = join(homedir(), ".codex", "sessions");
  if (!existsSync(sessionsRoot)) return null;
  const sessionFile = findSessionFileByThreadId(sessionsRoot, codexThreadId);
  if (!sessionFile) return null;
  try {
    const stats = statSync(sessionFile);
    return {
      path: sessionFile,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  } catch {
    sessionFilePathCache.delete(codexThreadId);
    return null;
  }
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
  sourceReset?: boolean;
  sourceFound: boolean;
  latestLineNo: number;
  diagnostics?: ExternalSyncReadDiagnostics;
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
  localUserMessages?: string[];
  eventIds: string[];
}

export interface ExternalSyncStartedTurnReadResult {
  sourceFound: boolean;
  latestLineNo: number;
  turns: ExternalSyncStartedTurn[];
  diagnostics?: ExternalSyncReadDiagnostics;
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

function getLocalResponseUserText(obj: Record<string, unknown>): string | null {
  if (obj.type !== "response_item" || !obj.payload || typeof obj.payload !== "object") return null;
  const payload = obj.payload as Record<string, unknown>;
  if (payload.type !== "message" || payload.role !== "user" || !Array.isArray(payload.content)) return null;
  const text = payload.content.flatMap(part => {
    if (!part || typeof part !== "object") return [];
    const value = part as Record<string, unknown>;
    return value.type === "input_text" && typeof value.text === "string" ? [value.text] : [];
  }).join("\n");
  return text.trim() ? text : null;
}

export function localTurnMatchesPrompt(turn: ExternalSyncStartedTurn, expected: string): boolean {
  const normalized = normalizeForDedup(expected);
  return Boolean(normalized) && [turn.userMessage, ...(turn.localUserMessages ?? [])].some(text => {
    if (!text) return false;
    const actual = normalizeForDedup(text);
    return actual === normalized || actual.endsWith(normalized);
  });
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line.trim()) as unknown;
    return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
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
  return parseCompletedRecords(lines.map((text, index) => ({ text, lineNo: lineNoOffset + index + 1 })), afterLineNo);
}

function parseCompletedRecords(records: readonly SyncRecord[], afterLineNo: number): ExternalSyncTurn[] {
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

  for (const { text, lineNo } of records) {
    const obj = parseJsonObject(text);
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

    const event = parseExternalSyncEventLine(text, lineNo);
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

function findSafeTurnParseStartIndex(records: readonly SyncRecord[], afterLineNo: number): number {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index]!.lineNo > afterLineNo) continue;
    const obj = parseJsonObject(records[index]!.text);
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
  return parseStartedRecords(lines.map((text, index) => ({ text, lineNo: lineNoOffset + index + 1 })), afterLineNo);
}

function parseStartedRecords(records: readonly SyncRecord[], afterLineNo: number): ExternalSyncStartedTurn[] {
  const turns: ExternalSyncStartedTurn[] = [];
  let active: ExternalSyncStartedTurn | null = null;
  const flushActive = (): void => {
    if (active && active.startLineNo > afterLineNo) turns.push(active);
    active = null;
  };
  for (const { text, lineNo } of records) {
    const obj = parseJsonObject(text);
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
    const localInput = getLocalResponseUserText(obj);
    if (localInput) {
      (active.localUserMessages ??= []).push(localInput);
      active.eventIds.push(getLineEventId(obj, lineNo));
      continue;
    }
    const event = parseExternalSyncEventLine(text, lineNo);
    if (!event) continue;
    active.eventIds.push(event.eventId);
    if (event.itemType === "user_message" && !active.userMessage) {
      active.userMessage = event.text;
    }
  }
  flushActive();
  return turns;
}

// Cache only synchronization metadata, never image/tool payloads or the whole file.
export class CodexExternalSyncFileReader {
  private reader: IncrementalJsonlReader;
  private cursorReader: IncrementalJsonlReader;
  private records: SyncRecord[] = [];
  private latestLineNo = 0;
  private latestCursorLineNo = 0;
  private coveredAfter = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly path: string) {
    this.reader = new IncrementalJsonlReader(path);
    this.cursorReader = new IncrementalJsonlReader(path);
  }

  get lastReadBytes(): number { return this.reader.lastReadBytes; }

  latestLineNumber(): Promise<ExternalSyncLineCursor> {
    const work = this.queue.then(async () => {
      try {
        const summary = await this.cursorReader.read((_text, lineNo) => {
          this.latestCursorLineNo = lineNo;
        }, () => {
          this.latestCursorLineNo = 0;
        }, (lineNo) => {
          this.latestCursorLineNo = lineNo;
        });
        // Keep cursor scans independent so an older DB cursor does not rewind sync state.
        return {
          sourceFound: true,
          latestLineNo: this.latestCursorLineNo,
          skippedLineCount: summary.skippedLineCount,
          firstSkippedLineNo: summary.firstSkippedLineNo,
          lastSkippedLineNo: summary.lastSkippedLineNo,
        };
      } catch (error) {
        this.cursorReader = new IncrementalJsonlReader(this.path);
        this.latestCursorLineNo = 0;
        throw error;
      }
    });
    this.queue = work.catch(() => {});
    return work;
  }

  async completed(afterLineNo: number): Promise<ExternalSyncTurnReadResult> {
    const read = await this.read(afterLineNo);
    const candidates = read.records.slice(findSafeTurnParseStartIndex(read.records, afterLineNo));
    const turns = parseCompletedRecords(candidates, afterLineNo);
    return {
      sourceFound: true, latestLineNo: read.latestLineNo, sourceReset: read.sourceReset,
      diagnostics: read.diagnostics,
      latestCompleteLineNo: turns.at(-1)?.completeLineNo ?? afterLineNo,
      hasTaskBoundary: candidates.some(({ text }) => {
        const obj = parseJsonObject(text);
        return Boolean(obj && (getTaskTurnId(obj, "task_started") || getTaskTurnId(obj, "task_complete")));
      }), turns,
    };
  }

  read(afterLineNo: number): Promise<{
    records: SyncRecord[];
    latestLineNo: number;
    sourceReset: boolean;
    diagnostics: ExternalSyncReadDiagnostics;
  }> {
    const work = this.queue.then(async () => {
      let sourceReset = false;
      let diagnostics: ExternalSyncReadDiagnostics = {
        skippedLineCount: 0, firstSkippedLineNo: null, lastSkippedLineNo: null,
      };
      const reset = (): void => {
        this.records = [];
        this.latestLineNo = 0;
        this.coveredAfter = 0;
      };
      if (afterLineNo < this.coveredAfter) {
        this.reader = new IncrementalJsonlReader(this.path);
        reset();
      }
      try {
        const summary = await this.reader.read((text, lineNo) => {
          this.latestLineNo = lineNo;
          const obj = parseJsonObject(text);
          if (!obj) return;
          const record = compactSyncRecord(obj, lineNo, text);
          if (record) this.records.push({ lineNo, text: record });
          // Discard acknowledged history while bootstrapping, not just after a full scan.
          if (afterLineNo !== Number.MAX_SAFE_INTEGER && lineNo <= afterLineNo
            && (getTaskTurnId(obj, "task_started") || getTaskTurnId(obj, "task_complete"))) {
            const keep = getTaskTurnId(obj, "task_started") ? 1 : 0;
            this.records = keep ? this.records.slice(-keep) : [];
          }
        }, () => { reset(); sourceReset = true; }, (lineNo) => {
          this.latestLineNo = lineNo;
        });
        diagnostics = {
          skippedLineCount: summary.skippedLineCount,
          firstSkippedLineNo: summary.firstSkippedLineNo,
          lastSkippedLineNo: summary.lastSkippedLineNo,
        };
      } catch (error) {
        this.reader = new IncrementalJsonlReader(this.path);
        reset();
        throw error;
      }
      if (afterLineNo !== Number.MAX_SAFE_INTEGER) {
        let firstLine = afterLineNo + 1;
        for (let index = this.records.length - 1; index >= 0; index -= 1) {
          const record = this.records[index]!;
          if (record.lineNo > afterLineNo) continue;
          const obj = parseJsonObject(record.text);
          if (!obj) continue;
          if (getTaskTurnId(obj, "task_started")) { firstLine = record.lineNo; break; }
          if (getTaskTurnId(obj, "task_complete")) { firstLine = record.lineNo + 1; break; }
        }
        // Keep three adjacent physical lines for the older response_item identity fallback.
        this.records = this.records.filter((record) => record.lineNo >= firstLine - 3);
        this.coveredAfter = afterLineNo;
      }
      return { records: this.records.slice(), latestLineNo: this.latestLineNo, sourceReset, diagnostics };
    });
    this.queue = work.catch(() => {});
    return work;
  }
}

function compactSyncRecord(obj: Record<string, unknown>, lineNo: number, text: string): string | null {
  const type = obj.type;
  const payload = obj.payload as Record<string, unknown> | undefined;
  if (getTaskTurnId(obj, "task_started") || getTaskTurnId(obj, "task_complete")) {
    return JSON.stringify({ type, timestamp: obj.timestamp, id: obj.id,
      payload: { type: payload!.type, turn_id: payload!.turn_id,
        last_agent_message: payload!.last_agent_message } });
  }
  const localInput = getLocalResponseUserText(obj);
  if (localInput) {
    // Retain only text for local prompt matching, never expose these as External User events.
    return JSON.stringify({ type: "response_item", timestamp: obj.timestamp, id: obj.id,
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: localInput }] } });
  }
  const event = parseExternalSyncEventLine(text, lineNo);
  if (!event) return null;
  if (type === "event_msg") {
    return JSON.stringify({ type, timestamp: obj.timestamp,
      payload: { type: event.itemType, message: event.text } });
  }
  if (type === "item.completed") {
    return JSON.stringify({ type, timestamp: obj.timestamp,
      item: { id: event.eventId, type: event.itemType, text: event.text } });
  }
  return JSON.stringify({ type, timestamp: obj.timestamp,
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: event.text }] } });
}

const fileReaders = new Map<string, CodexExternalSyncFileReader>();

export function retainCodexExternalSyncReaders(threadIds: ReadonlySet<string>): void {
  for (const id of fileReaders.keys()) {
    if (!threadIds.has(id)) { fileReaders.delete(id); sessionFilePathCache.delete(id); }
  }
}

function threadFileReader(codexThreadId: string): CodexExternalSyncFileReader | null {
  const sessionsRoot = join(homedir(), ".codex", "sessions");
  if (!existsSync(sessionsRoot)) return null;
  const sessionFile = findSessionFileByThreadId(sessionsRoot, codexThreadId);
  if (!sessionFile) { fileReaders.delete(codexThreadId); return null; }
  let reader = fileReaders.get(codexThreadId);
  if (!reader || reader.path !== sessionFile) {
    reader = new CodexExternalSyncFileReader(sessionFile);
    fileReaders.set(codexThreadId, reader);
  }
  return reader;
}

export async function readCodexThreadCompletedTurnsSinceLine(
  codexThreadId: string, afterLineNo: number,
): Promise<ExternalSyncTurnReadResult> {
  const reader = threadFileReader(codexThreadId);
  if (!reader) return { sourceFound: false, latestLineNo: 0,
    latestCompleteLineNo: afterLineNo, hasTaskBoundary: false, turns: [], diagnostics: emptyReadDiagnostics() };
  return reader.completed(afterLineNo);
}

export async function readCodexThreadStartedTurnsSinceLine(
  codexThreadId: string, afterLineNo: number,
): Promise<ExternalSyncStartedTurnReadResult> {
  const reader = threadFileReader(codexThreadId);
  if (!reader) return { sourceFound: false, latestLineNo: 0, turns: [], diagnostics: emptyReadDiagnostics() };
  const read = await reader.read(afterLineNo);
  return { sourceFound: true, latestLineNo: read.latestLineNo,
    turns: parseStartedRecords(read.records, afterLineNo), diagnostics: read.diagnostics };
}

function findSessionFileByThreadId(rootDir: string, threadId: string): string | null {
  const cached = sessionFilePathCache.get(threadId);
  if (cached && existsSync(cached)) return cached;
  sessionFilePathCache.delete(threadId);

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
        sessionFilePathCache.set(threadId, full);
        return full;
      }
    }
  }
  return null;
}

export async function readCodexThreadEventsSinceLine(
  codexThreadId: string, afterLineNo: number,
): Promise<ExternalSyncReadResult> {
  const reader = threadFileReader(codexThreadId);
  if (!reader) return { sourceFound: false, latestLineNo: 0, events: [], diagnostics: emptyReadDiagnostics() };
  const read = await reader.read(afterLineNo);
  return { sourceFound: true, latestLineNo: read.latestLineNo,
    events: parseRecordEvents(read.records, afterLineNo), diagnostics: read.diagnostics };
}

export async function readCodexThreadLatestLineNumber(
  codexThreadId: string,
): Promise<ExternalSyncLineCursor> {
  const reader = threadFileReader(codexThreadId);
  if (!reader) return { sourceFound: false, latestLineNo: 0, ...emptyReadDiagnostics() };
  return reader.latestLineNumber();
}

function emptyReadDiagnostics(): ExternalSyncReadDiagnostics {
  return { skippedLineCount: 0, firstSkippedLineNo: null, lastSkippedLineNo: null };
}

export function parseRecordEvents(records: readonly SyncRecord[], afterLineNo: number): ExternalSyncEvent[] {
  const events: ExternalSyncEvent[] = [];
  const recentBySignature = new Map<string, number>();
  const adjacentLines = new Map(records.map((record) => [record.lineNo, record.text]));
  for (const { text, lineNo } of records) {
    if (lineNo <= afterLineNo) continue;
    const parsed = parseExternalSyncEventLine(text, lineNo);
    const obj = parseJsonObject(text);
    if (!parsed || !obj) continue;
    const ms = typeof obj.timestamp === "string" ? Date.parse(obj.timestamp) : NaN;
    const sig = parsed.itemType + ":" + normalizeForDedup(parsed.text);
    const previous = recentBySignature.get(sig);
    recentBySignature.set(sig, lineNo);
    if (previous !== undefined && lineNo - previous <= 3) continue;
    const payload = obj.payload as Record<string, unknown> | undefined;
    let stableEventId: string | undefined;
    let eventSignature: string | undefined;
    if (obj.type === "event_msg" && typeof obj.timestamp === "string" && payload) {
      const identity = { itemType: parsed.itemType, timestamp: obj.timestamp, text: parsed.text };
      stableEventId = buildExternalSyncEventMsgId(identity);
      eventSignature = buildExternalSyncEventSignature(identity);
    } else if (obj.type === "response_item") {
      const lines = [lineNo - 3, lineNo - 2, lineNo - 1].map((n) => adjacentLines.get(n) ?? "");
      const adjacent = tryBuildStableIdentityFromAdjacentEventMsg([...lines, text], 3, parsed.itemType, parsed.text);
      stableEventId = adjacent?.stableEventId;
      eventSignature = adjacent?.eventSignature;
    }
    events.push({ ...parsed, occurredAtMs: Number.isFinite(ms) ? ms : null, stableEventId, eventSignature });
  }
  return events;
}
