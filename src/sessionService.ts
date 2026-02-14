import { PermissionFlagsBits, type GuildMember } from "discord.js";
import { AppDb } from "./db.js";
import type { SessionRow } from "./types.js";

export class SessionService {
  constructor(private readonly db: AppDb) {}

  buildContextKey(guildId: string, channelId: string): string {
    return `${guildId}:${channelId}`;
  }

  canSwitchSession(member: GuildMember | null, session: SessionRow, userId: string): boolean {
    if (session.created_by === userId) return true;
    if (!member) return false;
    return member.permissions.has(PermissionFlagsBits.Administrator);
  }

  resolveOrCreateActiveSession(input: {
    contextKey: string;
    requesterId: string;
    initialMessage: string;
  }): SessionRow {
    const bound = this.db.getBoundSession(input.contextKey);
    if (bound) {
      return bound;
    }
    const created = this.db.createSession({
      name: this.generateSessionName(input.initialMessage),
      createdBy: input.requesterId,
      summary: this.buildSummary(input.initialMessage),
    });
    this.db.bindContext(input.contextKey, created.id);
    return created;
  }

  createAndBindSession(input: {
    contextKey: string;
    requesterId: string;
    name?: string;
    firstMessageHint?: string;
    preferredWorkingDirectory?: string;
  }): SessionRow {
    const source = input.name?.trim() || input.firstMessageHint || "";
    const name = input.name?.trim() || this.generateSessionName(source);
    const created = this.db.createSession({
      name,
      createdBy: input.requesterId,
      summary: this.buildSummary(source),
      preferredWorkingDirectory: input.preferredWorkingDirectory,
    });
    this.db.bindContext(input.contextKey, created.id);
    return created;
  }

  listSessions(query: string | undefined, limit: number): SessionRow[] {
    return this.db.listSessions(query, limit);
  }

  cacheListResult(requesterId: string, contextKey: string, sessions: SessionRow[]): void {
    this.db.cacheListResult(requesterId, contextKey, sessions);
  }

  switchById(input: {
    contextKey: string;
    sessionId: string;
    requesterId: string;
    member: GuildMember | null;
  }): { ok: true; session: SessionRow } | { ok: false; code: string } {
    const session = this.db.getSessionById(input.sessionId);
    if (!session) return { ok: false, code: "ERR_SESSION_NOT_FOUND" };
    if (!this.canSwitchSession(input.member, session, input.requesterId)) {
      return { ok: false, code: "ERR_SWITCH_PERMISSION_DENIED" };
    }
    this.db.bindContext(input.contextKey, session.id);
    return { ok: true, session };
  }

  switchByName(input: {
    contextKey: string;
    sessionName: string;
    requesterId: string;
    member: GuildMember | null;
  }):
    | { ok: true; session: SessionRow }
    | { ok: false; code: string; candidates?: SessionRow[] } {
    const sessions = this.db.getSessionsByName(input.sessionName);
    if (sessions.length === 0) return { ok: false, code: "ERR_SESSION_NOT_FOUND" };
    if (sessions.length > 1) {
      return { ok: false, code: "ERR_SESSION_NAME_AMBIGUOUS", candidates: sessions };
    }
    const session = sessions[0];
    if (!this.canSwitchSession(input.member, session, input.requesterId)) {
      return { ok: false, code: "ERR_SWITCH_PERMISSION_DENIED" };
    }
    this.db.bindContext(input.contextKey, session.id);
    return { ok: true, session };
  }

  switchByListNo(input: {
    contextKey: string;
    requesterId: string;
    no: number;
    member: GuildMember | null;
  }): { ok: true; session: SessionRow } | { ok: false; code: string } {
    const sessionId = this.db.findSessionIdByListNo(
      input.requesterId,
      input.contextKey,
      input.no,
    );
    if (!sessionId) return { ok: false, code: "ERR_LIST_CACHE_EXPIRED" };
    return this.switchById({
      contextKey: input.contextKey,
      sessionId,
      requesterId: input.requesterId,
      member: input.member,
    });
  }

  getCurrentSession(contextKey: string): SessionRow | null {
    return this.db.getBoundSession(contextKey);
  }

  connectCodexThread(input: {
    contextKey: string;
    requesterId: string;
    member: GuildMember | null;
    codexThreadId: string;
  }): { ok: true; session: SessionRow; created: boolean } | { ok: false; code: string } {
    const existing = this.db.getSessionByCodexThreadId(input.codexThreadId);
    if (existing) {
      if (!this.canSwitchSession(input.member, existing, input.requesterId)) {
        return { ok: false, code: "ERR_SWITCH_PERMISSION_DENIED" };
      }
      this.db.bindContext(input.contextKey, existing.id);
      return { ok: true, session: existing, created: false };
    }

    const created = this.db.createSession({
      name: `codex-${input.codexThreadId.slice(0, 8)}`,
      createdBy: input.requesterId,
      summary: `linked codex thread: ${input.codexThreadId}`,
    });
    this.db.setSessionCodexThreadId(created.id, input.codexThreadId);
    const withThread = this.db.getSessionById(created.id);
    if (!withThread) {
      return { ok: false, code: "ERR_DB_READ_FAILED" };
    }
    this.db.bindContext(input.contextKey, withThread.id);
    return { ok: true, session: withThread, created: true };
  }

  touchSession(sessionId: string): void {
    this.db.touchSession(sessionId);
  }

  private buildSummary(text: string): string | undefined {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    return trimmed.length <= 120 ? trimmed : `${trimmed.slice(0, 120)}...`;
  }

  private generateSessionName(seed: string): string {
    const trimmed = seed.trim();
    if (trimmed) {
      const s = trimmed.replace(/\s+/g, " ").slice(0, 40);
      return s.length > 0 ? s : this.fallbackDateName();
    }
    return this.fallbackDateName();
  }

  private fallbackDateName(): string {
    const d = new Date();
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `session-${y}${mo}${da}-${h}${mi}`;
  }
}
