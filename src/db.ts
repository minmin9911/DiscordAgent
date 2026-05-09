import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { ExecutionStatus, SessionRow } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class AppDb {
  private db: Database.Database;

  constructor(sqlitePath: string) {
    mkdirSync(dirname(sqlitePath), { recursive: true });
    this.db = new Database(sqlitePath);
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    const sql = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  codex_thread_id TEXT,
  model_override TEXT,
  preferred_working_directory TEXT,
  attach_instruction_sent_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'busy', 'error')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  summary TEXT,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS context_bindings (
  context_key TEXT PRIMARY KEY,
  active_session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(active_session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  discord_message_id TEXT NOT NULL,
  discord_channel_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  command_text_masked TEXT NOT NULL,
  result_status TEXT NOT NULL CHECK (result_status IN ('queued', 'running', 'success', 'error', 'timeout', 'cancelled')),
  error_code TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS list_context_cache (
  requester_id TEXT NOT NULL,
  context_key TEXT NOT NULL,
  listed_at TEXT NOT NULL,
  no INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY (requester_id, context_key, no),
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS context_cursors (
  context_key TEXT PRIMARY KEY,
  last_message_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_sync_cursors (
  codex_thread_id TEXT PRIMARY KEY,
  last_line_no INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_sync_seen_events (
  codex_thread_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (codex_thread_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_last_used_at ON sessions(last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_name ON sessions(name);
CREATE INDEX IF NOT EXISTS idx_sessions_codex_thread_id ON sessions(codex_thread_id);
CREATE INDEX IF NOT EXISTS idx_executions_session_created ON executions(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_created_at ON executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_context_cursors_updated_at ON context_cursors(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_external_sync_seen_events_seen_at ON external_sync_seen_events(seen_at DESC);
`;
    this.db.exec(sql);
    this.ensureColumns();
  }

  private ensureColumns(): void {
    const columns = this.db.prepare("PRAGMA table_info(sessions)").all() as Array<{
      name: string;
    }>;
    const hasCodexThreadId = columns.some((c) => c.name === "codex_thread_id");
    if (!hasCodexThreadId) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN codex_thread_id TEXT");
      this.db.exec(
        "CREATE INDEX IF NOT EXISTS idx_sessions_codex_thread_id ON sessions(codex_thread_id)",
      );
    }
    const hasPreferredWorkingDirectory = columns.some(
      (c) => c.name === "preferred_working_directory",
    );
    if (!hasPreferredWorkingDirectory) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN preferred_working_directory TEXT");
    }
    const hasAttachInstructionSentAt = columns.some(
      (c) => c.name === "attach_instruction_sent_at",
    );
    if (!hasAttachInstructionSentAt) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN attach_instruction_sent_at TEXT");
    }
    const hasModelOverride = columns.some((c) => c.name === "model_override");
    if (!hasModelOverride) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN model_override TEXT");
    }
  }

  createSession(input: {
    name: string;
    createdBy: string;
    summary?: string;
    preferredWorkingDirectory?: string;
  }): SessionRow {
    const id = randomUUID();
    const now = nowIso();
    this.db
      .prepare(
        `INSERT INTO sessions
         (id, name, status, created_by, created_at, last_used_at, summary, archived_at, attach_instruction_sent_at)
         VALUES (@id, @name, 'active', @created_by, @created_at, @last_used_at, @summary, NULL, NULL)`,
      )
      .run({
        id,
        name: input.name,
        created_by: input.createdBy,
        created_at: now,
        last_used_at: now,
        summary: input.summary ?? null,
      });
    if (input.preferredWorkingDirectory) {
      this.setSessionPreferredWorkingDirectory(id, input.preferredWorkingDirectory);
    }

    return this.getSessionById(id)!;
  }

  getSessionById(id: string): SessionRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM sessions WHERE id = ?")
        .get(id) as SessionRow | undefined) ?? null
    );
  }

  getSessionByCodexThreadId(codexThreadId: string): SessionRow | null {
    return (
      (this.db
        .prepare(
          "SELECT * FROM sessions WHERE codex_thread_id = ? AND status != 'archived' ORDER BY last_used_at DESC LIMIT 1",
        )
        .get(codexThreadId) as SessionRow | undefined) ?? null
    );
  }

  getSessionsByName(name: string): SessionRow[] {
    return this.db
      .prepare(
        "SELECT * FROM sessions WHERE name = ? AND status != 'archived' ORDER BY last_used_at DESC",
      )
      .all(name) as SessionRow[];
  }

  listSessions(query: string | undefined, limit: number): SessionRow[] {
    if (!query) {
      return this.db
        .prepare(
          "SELECT * FROM sessions WHERE status != 'archived' ORDER BY last_used_at DESC LIMIT ?",
        )
        .all(limit) as SessionRow[];
    }
    const like = `%${query}%`;
    return this.db
      .prepare(
        `SELECT * FROM sessions
         WHERE status != 'archived'
           AND (
             name LIKE @like
             OR IFNULL(summary, '') LIKE @like
             OR IFNULL(codex_thread_id, '') LIKE @like
             OR IFNULL(preferred_working_directory, '') LIKE @like
           )
         ORDER BY last_used_at DESC
         LIMIT @limit`,
      )
      .all({ like, limit }) as SessionRow[];
  }

  bindContext(contextKey: string, sessionId: string): void {
    this.db
      .prepare(
        `INSERT INTO context_bindings (context_key, active_session_id, updated_at)
         VALUES (@context_key, @active_session_id, @updated_at)
         ON CONFLICT(context_key) DO UPDATE SET
           active_session_id = excluded.active_session_id,
           updated_at = excluded.updated_at`,
      )
      .run({
        context_key: contextKey,
        active_session_id: sessionId,
        updated_at: nowIso(),
      });
  }

  getBoundSession(contextKey: string): SessionRow | null {
    const row = this.db
      .prepare(
        `SELECT s.* FROM context_bindings cb
         JOIN sessions s ON s.id = cb.active_session_id
         WHERE cb.context_key = ?`,
      )
      .get(contextKey) as SessionRow | undefined;
    return row ?? null;
  }

  touchSession(sessionId: string): void {
    this.db
      .prepare("UPDATE sessions SET last_used_at = ? WHERE id = ?")
      .run(nowIso(), sessionId);
  }

  setSessionCodexThreadId(sessionId: string, threadId: string): void {
    this.db
      .prepare("UPDATE sessions SET codex_thread_id = ? WHERE id = ?")
      .run(threadId, sessionId);
  }

  clearSessionCodexThreadId(sessionId: string): void {
    this.db
      .prepare("UPDATE sessions SET codex_thread_id = NULL WHERE id = ?")
      .run(sessionId);
  }

  setSessionModelOverride(sessionId: string, modelOverride: string | null): void {
    this.db
      .prepare("UPDATE sessions SET model_override = ? WHERE id = ?")
      .run(modelOverride, sessionId);
  }

  setSessionPreferredWorkingDirectory(sessionId: string, workingDirectory: string): void {
    this.db
      .prepare("UPDATE sessions SET preferred_working_directory = ? WHERE id = ?")
      .run(workingDirectory, sessionId);
  }

  setSessionSummary(sessionId: string, summary: string): void {
    this.db
      .prepare("UPDATE sessions SET summary = ? WHERE id = ?")
      .run(summary, sessionId);
  }

  markAttachInstructionSent(sessionId: string): void {
    this.db
      .prepare(
        "UPDATE sessions SET attach_instruction_sent_at = COALESCE(attach_instruction_sent_at, ?) WHERE id = ?",
      )
      .run(nowIso(), sessionId);
  }

  insertExecution(input: {
    sessionId: string;
    discordMessageId: string;
    discordChannelId: string;
    requestedBy: string;
    commandTextMasked: string;
  }): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO executions
         (id, session_id, discord_message_id, discord_channel_id, requested_by, command_text_masked, result_status, created_at)
         VALUES (@id, @session_id, @discord_message_id, @discord_channel_id, @requested_by, @command_text_masked, 'queued', @created_at)`,
      )
      .run({
        id,
        session_id: input.sessionId,
        discord_message_id: input.discordMessageId,
        discord_channel_id: input.discordChannelId,
        requested_by: input.requestedBy,
        command_text_masked: input.commandTextMasked,
        created_at: nowIso(),
      });
    return id;
  }

  updateExecutionStatus(
    id: string,
    status: ExecutionStatus,
    options?: { errorCode?: string; retryCount?: number; setStarted?: boolean },
  ): void {
    if (options?.setStarted) {
      this.db
        .prepare(
          "UPDATE executions SET result_status = ?, started_at = ?, error_code = ?, retry_count = ? WHERE id = ?",
        )
        .run(
          status,
          nowIso(),
          options.errorCode ?? null,
          options.retryCount ?? 0,
          id,
        );
      return;
    }
    if (
      status === "success" ||
      status === "error" ||
      status === "timeout" ||
      status === "cancelled"
    ) {
      this.db
        .prepare(
          "UPDATE executions SET result_status = ?, ended_at = ?, error_code = ?, retry_count = ? WHERE id = ?",
        )
        .run(
          status,
          nowIso(),
          options?.errorCode ?? null,
          options?.retryCount ?? 0,
          id,
        );
      return;
    }
    this.db
      .prepare(
        "UPDATE executions SET result_status = ?, error_code = ?, retry_count = ? WHERE id = ?",
      )
      .run(status, options?.errorCode ?? null, options?.retryCount ?? 0, id);
  }

  cacheListResult(
    requesterId: string,
    contextKey: string,
    sessions: SessionRow[],
  ): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM list_context_cache WHERE requester_id = ? AND context_key = ?",
        )
        .run(requesterId, contextKey);
      const stmt = this.db.prepare(
        `INSERT INTO list_context_cache (requester_id, context_key, listed_at, no, session_id)
         VALUES (@requester_id, @context_key, @listed_at, @no, @session_id)`,
      );
      const listedAt = nowIso();
      sessions.forEach((s, i) => {
        stmt.run({
          requester_id: requesterId,
          context_key: contextKey,
          listed_at: listedAt,
          no: i + 1,
          session_id: s.id,
        });
      });
    });
    tx();
  }

  findSessionIdByListNo(
    requesterId: string,
    contextKey: string,
    no: number,
  ): string | null {
    const row = this.db
      .prepare(
        `SELECT l.session_id
         FROM list_context_cache l
         WHERE l.requester_id = ? AND l.context_key = ? AND l.no = ?
           AND datetime(l.listed_at) >= datetime('now', '-24 hours')`,
      )
      .get(requesterId, contextKey, no) as { session_id: string } | undefined;
    return row?.session_id ?? null;
  }

  cleanupOldData(retentionDays: number): void {
    this.db
      .prepare(
        "DELETE FROM executions WHERE datetime(created_at) < datetime('now', printf('-%d days', ?))",
      )
      .run(retentionDays);
    this.db
      .prepare(
        "DELETE FROM list_context_cache WHERE datetime(listed_at) < datetime('now', '-24 hours')",
      )
      .run();
  }

  getContextCursor(contextKey: string): string | null {
    const row = this.db
      .prepare(
        "SELECT last_message_id FROM context_cursors WHERE context_key = ?",
      )
      .get(contextKey) as { last_message_id: string } | undefined;
    return row?.last_message_id ?? null;
  }

  setContextCursor(contextKey: string, messageId: string): void {
    this.db
      .prepare(
        `INSERT INTO context_cursors (context_key, last_message_id, updated_at)
         VALUES (@context_key, @last_message_id, @updated_at)
         ON CONFLICT(context_key) DO UPDATE SET
           last_message_id = excluded.last_message_id,
           updated_at = excluded.updated_at`,
      )
      .run({
        context_key: contextKey,
        last_message_id: messageId,
        updated_at: nowIso(),
      });
  }

  getAppState(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM app_state WHERE key = ?")
      .get(key) as { value: string | null } | undefined;
    return row?.value ?? null;
  }

  setAppState(key: string, value: string | null): void {
    this.db
      .prepare(
        `INSERT INTO app_state (key, value, updated_at)
         VALUES (@key, @value, @updated_at)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run({
        key,
        value,
        updated_at: nowIso(),
      });
  }

  getExternalSyncCursor(codexThreadId: string): number | null {
    const row = this.db
      .prepare(
        "SELECT last_line_no FROM external_sync_cursors WHERE codex_thread_id = ?",
      )
      .get(codexThreadId) as { last_line_no: number } | undefined;
    return row?.last_line_no ?? null;
  }

  setExternalSyncCursor(codexThreadId: string, lastLineNo: number): void {
    this.db
      .prepare(
        `INSERT INTO external_sync_cursors (codex_thread_id, last_line_no, updated_at)
         VALUES (@codex_thread_id, @last_line_no, @updated_at)
         ON CONFLICT(codex_thread_id) DO UPDATE SET
           last_line_no = excluded.last_line_no,
           updated_at = excluded.updated_at`,
      )
      .run({
        codex_thread_id: codexThreadId,
        last_line_no: Math.max(0, Math.trunc(lastLineNo)),
        updated_at: nowIso(),
      });
  }

  markExternalSyncEventSeen(codexThreadId: string, eventId: string): void {
    if (!eventId.trim()) return;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO external_sync_seen_events
         (codex_thread_id, event_id, seen_at)
         VALUES (?, ?, ?)`,
      )
      .run(codexThreadId, eventId, nowIso());
  }

  hasExternalSyncEventSeen(codexThreadId: string, eventId: string): boolean {
    if (!eventId.trim()) return false;
    const row = this.db
      .prepare(
        `SELECT 1 AS ok
         FROM external_sync_seen_events
         WHERE codex_thread_id = ? AND event_id = ?
         LIMIT 1`,
      )
      .get(codexThreadId, eventId) as { ok: number } | undefined;
    return !!row?.ok;
  }

  listActiveCodexThreadIds(): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT codex_thread_id
         FROM sessions
         WHERE status != 'archived'
           AND codex_thread_id IS NOT NULL
           AND codex_thread_id != ''`,
      )
      .all() as Array<{ codex_thread_id: string }>;
    return rows.map((v) => v.codex_thread_id);
  }

  listContextKeysByCodexThreadId(codexThreadId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT cb.context_key
         FROM context_bindings cb
         JOIN sessions s ON s.id = cb.active_session_id
         WHERE s.status != 'archived'
           AND s.codex_thread_id = ?`,
      )
      .all(codexThreadId) as Array<{ context_key: string }>;
    return rows.map((v) => v.context_key);
  }

  cancelInFlightExecutionsOnStartup(): number {
    const result = this.db
      .prepare(
        `UPDATE executions
         SET result_status = 'cancelled',
             error_code = 'ERR_BOT_RESTARTED',
             ended_at = ?
         WHERE result_status IN ('queued', 'running')`,
      )
      .run(nowIso());
    return result.changes;
  }

  cancelStaleRunningExecutions(timeoutSec: number): number {
    const result = this.db
      .prepare(
        `UPDATE executions
         SET result_status = 'timeout',
             error_code = 'ERR_STALE_RUNNING_TIMEOUT',
             ended_at = ?
         WHERE result_status = 'running'
           AND datetime(started_at) < datetime('now', printf('-%d seconds', ?))`,
      )
      .run(nowIso(), timeoutSec);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  listInFlightExecutions(limit = 100): Array<{
    id: string;
    session_id: string;
    session_name: string;
    codex_thread_id: string | null;
    preferred_working_directory: string | null;
    result_status: ExecutionStatus;
    created_at: string;
    started_at: string | null;
  }> {
    return this.db
      .prepare(
        `SELECT
           e.id,
           e.session_id,
           s.name AS session_name,
           s.codex_thread_id,
           s.preferred_working_directory,
           e.result_status,
           e.created_at,
           e.started_at
         FROM executions e
         JOIN sessions s ON s.id = e.session_id
         WHERE e.result_status IN ('queued', 'running')
         ORDER BY e.created_at ASC
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: string;
      session_id: string;
      session_name: string;
      codex_thread_id: string | null;
      preferred_working_directory: string | null;
      result_status: ExecutionStatus;
      created_at: string;
      started_at: string | null;
    }>;
  }

  cancelExecutionsByIds(ids: string[], errorCode: string): number {
    if (ids.length === 0) return 0;
    const tx = this.db.transaction((targetIds: string[]) => {
      let changed = 0;
      const stmt = this.db.prepare(
        `UPDATE executions
         SET result_status = 'cancelled',
             error_code = @error_code,
             ended_at = @ended_at
         WHERE id = @id
           AND result_status IN ('queued', 'running')`,
      );
      const endedAt = nowIso();
      for (const id of targetIds) {
        const result = stmt.run({
          id,
          error_code: errorCode,
          ended_at: endedAt,
        });
        changed += result.changes;
      }
      return changed;
    });
    return tx(ids);
  }

  cancelAllInFlightExecutions(errorCode: string): number {
    const result = this.db
      .prepare(
        `UPDATE executions
         SET result_status = 'cancelled',
             error_code = ?,
             ended_at = ?
         WHERE result_status IN ('queued', 'running')`,
      )
      .run(errorCode, nowIso());
    return result.changes;
  }
}
