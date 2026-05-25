import {
  ChannelType,
  Client,
  GatewayIntentBits,
  NewsChannel,
  type SendableChannels,
  TextChannel,
  ThreadChannel,
  type GuildMember,
  type Message,
} from "discord.js";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import pino from "pino";
import { AppDb } from "./db.js";
import { SessionService } from "./sessionService.js";
import { ExecutionManager } from "./executionManager.js";
import { maskSecrets } from "./mask.js";
import { CodexAdapter } from "./codexAdapter.js";
import { appConfig } from "./config.js";
import { APP_NAME, getBuildLabel } from "./buildInfo.js";
import {
  attachAbsolutePathRequired,
  attachInvalidPath,
  attachNotFile,
  attachNotFound,
  attachStatFailed,
  attachTooLarge,
  attachUploadFailed,
  approvalStatusLine,
  type ApprovalStatusView,
  buildCommandReference,
  codexSessionLine,
  codexSessionListEmpty,
  completeHeader,
  dmDisabledVerbose,
  noSummary,
  notLinkedYet,
  unknownValue,
  queuedMessage,
  resolveAppLocale,
  runningElapsedMessage,
  runningPhaseMessage,
  sessionCreated,
  sessionLinkedThread,
  sessionsListEmpty,
  sessionSwitchedThread,
  syntaxUnknownCommand,
  syncDisabled,
  syncEnabled,
  syncResetDone,
  syncStatus,
  unreadRecoveryLines,
  usageCodexSession,
  usageQueue,
  usageSessionConnect,
  usageSessionRoot,
  usageSessionSwitch,
  usageSync,
  workingDirectoryInherited,
  queueFixExecuted,
  queueStatusEmpty,
  queueStatusTitle,
  queueStopallExecuted,
  codexUsageStatusLine,
  modelSetDone,
  modelListSourceLine,
  modelWarningLine,
  permissionRequestDiscarded,
  permissionGrantedReexecutePrompt,
  permissionRequestNotFound,
  permissionRetryPrompt,
  sandboxMigrationNotice,
  sandboxModeSet,
  temporaryFullAccessDisabled,
  temporaryFullAccessEnabled,
  usageModel,
  usageOk,
  usageSandbox,
} from "./i18n.js";
import {
  readLatestCodexUsageStatusByThreadId,
  readLatestCodexResolvedModelByThreadId,
  resolveCodexSessionMetaByThreadId,
  resolveWorkingDirectoryFromThreadId,
  searchCodexSessions,
  type CodexSessionMeta,
} from "./codexSessionMeta.js";
import { readCodexThreadEventsSinceLine } from "./codexExternalSync.js";
import { ATTACH_MAX_BYTES, extractAttachPaths } from "./attachPolicy.js";
import {
  buildPromptWithIncomingAttachments,
  sanitizeAttachmentFileName,
} from "./incomingAttachmentPolicy.js";
import {
  buildInvalidThreadNotice,
  buildThreadSwitchNotice,
  detectThreadBindingChange,
  isMissingCodexThreadError,
} from "./threadBinding.js";
import type { SessionRow } from "./types.js";
import type { SandboxMode } from "./types.js";
import { truncateExternalUserMessage } from "./externalSyncText.js";
import { loadModelCatalog, type ModelCatalogItem } from "./modelCatalog.js";

const UNREAD_RECOVERY_LIMIT = 3;
const UNREAD_RECOVERY_POLL_MS = 3 * 60 * 1000;
const EXTERNAL_SYNC_PREVIEW_MAX = 1500;
const APP_STATE_LAST_RESOLVED_DEFAULT_MODEL = "last_resolved_default_model";
const APP_STATE_SANDBOX_NOTICE_STARTUP = "sandbox_notice_startup_once";
const APP_STATE_SANDBOX_NOTICE_FIRST_COMPLETION = "sandbox_notice_first_completion_once";
const TEMP_FULL_ACCESS_MAX_MINUTES = 60;
type RecoveryChannel = TextChannel | NewsChannel | ThreadChannel;

type PendingApproval = {
  content: string;
  prompt: string;
  sessionId: string;
  messageId: string;
  createdAtMs: number;
};

export function shouldProcessIncomingMessage(content: string, attachmentCount: number): boolean {
  return content.trim().length > 0 || attachmentCount > 0;
}

function splitIntoChunks(text: string, size: number): string[] {
  if (!text) return ["(empty)"];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

export class DiscordCodexBot {
  private readonly logger: pino.Logger;
  private readonly client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  private readonly db: AppDb;
  private readonly sessionService: SessionService;
  private readonly codex: CodexAdapter;
  private readonly manager: ExecutionManager;
  private readonly locale = resolveAppLocale(appConfig.appLocale);
  private readonly processedMessageIds = new Set<string>();
  private readonly codexSearchCache = new Map<string, CodexSessionMeta[]>();
  private readonly pendingApprovals = new Map<string, PendingApproval>();
  private readonly localSyncSuppress = new Map<
    string,
    { userTexts: Set<string>; agentTexts: Set<string>; expiresAtMs: number }
  >();
  private externalSyncEnabled = appConfig.externalSyncEnabled;
  private externalSyncRunning = false;
  private recoveringUnread = false;

  constructor(params: { db: AppDb; logger: pino.Logger }) {
    this.db = params.db;
    this.logger = params.logger;
    this.sessionService = new SessionService(this.db);
    this.codex = new CodexAdapter(
      appConfig.codexMode,
      appConfig.codexExecTemplate,
      appConfig.codexTimeoutSec * 1000,
      appConfig.codexCloseGraceSec * 1000,
    );
    this.manager = new ExecutionManager(
      appConfig.queueLimitPerSession,
      appConfig.progressIntervalSec,
      appConfig.codexTimeoutSec * 1000,
      this.logger,
    );
  }

  async start(): Promise<void> {
    this.client.once("clientReady", () => {
      this.logger.info({ user: this.client.user?.tag }, "bot ready");
      this.cleanupIncomingAttachments("startup");
      this.recoverUnreadForAllContexts("client_ready").catch((err) => {
        this.logger.error({ err }, "unread recovery on ready failed");
      });
      setInterval(() => {
        this.cleanupIncomingAttachments("periodic");
      }, 60 * 60 * 1000);
      setInterval(() => {
        this.recoverUnreadForAllContexts("polling").catch((err) => {
          this.logger.warn({ err }, "unread recovery by polling failed");
        });
      }, UNREAD_RECOVERY_POLL_MS);
      setInterval(() => {
        this.runExternalSyncCycle("polling").catch((err) => {
          this.logger.warn({ err }, "external sync by polling failed");
        });
      }, appConfig.externalSyncPollSec * 1000);
      this.runExternalSyncCycle("startup").catch((err) => {
        this.logger.warn({ err }, "external sync on startup failed");
      });
      this.sendSandboxStartupNoticeOnce().catch((err) => {
        this.logger.warn({ err }, "sandbox startup notice failed");
      });
    });
    this.client.on("shardResume", () => {
      this.recoverUnreadForAllContexts("shard_resume").catch((err) => {
        this.logger.warn({ err }, "unread recovery on resume failed");
      });
    });
    this.client.on("messageCreate", (msg) => {
      this.handleMessage(msg).catch((err) => {
        this.logger.error({ err }, "message handling failed");
      });
    });
    await this.client.login(appConfig.discordToken);
  }

  private isAllowedChannel(msg: Message): boolean {
    if (appConfig.allowedChannelIds.has(msg.channelId)) return true;
    if (msg.channel.isThread()) {
      const parentId = msg.channel.parentId;
      if (parentId && appConfig.allowedChannelIds.has(parentId)) return true;
    }
    return false;
  }

  private isAllowedUser(msg: Message): boolean {
    if (appConfig.allowedUserIds.size === 0) return true;
    return appConfig.allowedUserIds.has(msg.author.id);
  }

  private async handleMessage(msg: Message): Promise<void> {
    if (msg.author.bot) return;
    if (msg.system) return;
    if (this.processedMessageIds.has(msg.id)) {
      this.logger.warn({ messageId: msg.id }, "duplicate message ignored");
      return;
    }
    this.processedMessageIds.add(msg.id);
    if (this.processedMessageIds.size > 5000) {
      const first = this.processedMessageIds.values().next().value as
        | string
        | undefined;
      if (first) this.processedMessageIds.delete(first);
    }
    if (!msg.guildId) {
      await msg.reply(dmDisabledVerbose(this.locale));
      return;
    }
    if (!this.isAllowedChannel(msg)) return;
    if (msg.channel.type === ChannelType.DM) {
      await msg.reply("ERR_DM_DISABLED");
      return;
    }

    const contextKey = this.sessionService.buildContextKey(msg.guildId, msg.channelId);
    try {
      if (!this.isAllowedUser(msg)) {
        this.logger.warn(
          { userId: msg.author.id, channelId: msg.channelId, guildId: msg.guildId },
          "user rejected by allowlist",
        );
        await msg.reply("ERR_USER_NOT_ALLOWED");
        return;
      }
      const content = msg.content.trim();
      if (!shouldProcessIncomingMessage(content, msg.attachments.size)) return;
      this.logger.info(
        {
          guildId: msg.guildId,
          channelId: msg.channelId,
          messageId: msg.id,
          userId: msg.author.id,
          attachmentCount: msg.attachments.size,
        },
        "message received",
      );
      if (!content && msg.attachments.size > 0) {
        this.discardPendingApprovalForNewPrompt(contextKey);
        await this.handleExecutionMessage(msg, "");
        return;
      }
      if (content === "!help") {
        await msg.reply(buildCommandReference(this.locale, getBuildLabel(), APP_NAME));
        return;
      }
      if (content === "!codex") {
        await this.handleCodexCommand(msg, "");
        return;
      }
      if (content.startsWith("!codex ")) {
        await this.handleCodexCommand(msg, content.slice("!codex ".length).trim());
        return;
      }
      if (content.startsWith("!session ")) {
        await this.handleSessionCommand(msg, content.slice("!session ".length).trim());
        return;
      }
      if (content.startsWith("!ask ")) {
        this.discardPendingApprovalForNewPrompt(contextKey);
        await this.handleExecutionMessage(msg, content.slice("!ask ".length).trim());
        return;
      }
      if (content === "!queue") {
        await this.handleQueueCommand(msg, "");
        return;
      }
      if (content.startsWith("!queue ")) {
        await this.handleQueueCommand(msg, content.slice("!queue ".length).trim());
        return;
      }
      if (content === "!sync") {
        await this.handleSyncCommand(msg, "");
        return;
      }
      if (content.startsWith("!sync ")) {
        await this.handleSyncCommand(msg, content.slice("!sync ".length).trim());
        return;
      }
      if (content === "!sandbox" || content.startsWith("!sandbox ")) {
        await this.handleSandboxCommand(msg, content === "!sandbox" ? "" : content.slice("!sandbox ".length).trim());
        return;
      }
      if (content === "!ok" || content.startsWith("!ok ")) {
        await this.handleOkCommand(msg, contextKey, content === "!ok" ? "" : content.slice("!ok ".length).trim());
        return;
      }
      if (content === "!ng") {
        await this.handleNgCommand(msg, contextKey);
        return;
      }
      if (content === "!model") {
        await this.handleModelCommand(msg, "");
        return;
      }
      if (content.startsWith("!model ")) {
        await this.handleModelCommand(msg, content.slice("!model ".length).trim());
        return;
      }
      if (content.startsWith("!attach ")) {
        await msg.reply("ERR_ATTACH_DISABLED_FOR_USER");
        return;
      }
      if (content.startsWith("!")) {
        await msg.reply(
          syntaxUnknownCommand(
            this.locale,
            buildCommandReference(this.locale, getBuildLabel(), APP_NAME),
          ),
        );
        return;
      }
      this.discardPendingApprovalForNewPrompt(contextKey);
      await this.handleExecutionMessage(msg, content);
    } finally {
      this.db.setContextCursor(contextKey, msg.id);
    }
  }

  private async recoverUnreadForAllContexts(reason: string): Promise<void> {
    if (this.recoveringUnread) {
      this.logger.info({ reason }, "skip unread recovery: already running");
      return;
    }
    this.recoveringUnread = true;
    try {
      const contexts = await this.resolveRecoveryContexts();
      for (const context of contexts) {
        await this.recoverUnreadForContext(context.contextKey, context.channel, reason);
      }
    } finally {
      this.recoveringUnread = false;
    }
  }

  private async resolveRecoveryContexts(): Promise<
    Array<{ contextKey: string; channel: RecoveryChannel }>
  > {
    const contexts = new Map<string, RecoveryChannel>();
    for (const allowedChannelId of appConfig.allowedChannelIds) {
      const fetched = await this.client.channels.fetch(allowedChannelId);
      if (!fetched) continue;

      if (fetched instanceof TextChannel || fetched instanceof NewsChannel) {
        const contextKey = this.sessionService.buildContextKey(
          fetched.guildId,
          fetched.id,
        );
        contexts.set(contextKey, fetched);
      } else if (fetched instanceof ThreadChannel) {
        const contextKey = this.sessionService.buildContextKey(
          fetched.guildId,
          fetched.id,
        );
        contexts.set(contextKey, fetched);
      } else {
        continue;
      }

      if (!(fetched instanceof TextChannel)) continue;
      const activeThreads = await fetched.threads.fetchActive();
      for (const thread of activeThreads.threads.values()) {
        const contextKey = this.sessionService.buildContextKey(
          thread.guildId,
          thread.id,
        );
        contexts.set(contextKey, thread);
      }
    }
    return [...contexts.entries()].map(([contextKey, channel]) => ({
      contextKey,
      channel,
    }));
  }

  private async recoverUnreadForContext(
    contextKey: string,
    channel: RecoveryChannel,
    reason: string,
  ): Promise<void> {
    const cursor = this.db.getContextCursor(contextKey);
    if (!cursor) {
      const latest = await channel.messages.fetch({ limit: 1 });
      const latestMessage = latest.first();
      if (latestMessage) {
        this.db.setContextCursor(contextKey, latestMessage.id);
      }
      this.logger.info(
        { reason, contextKey, channelId: channel.id },
        "unread recovery anchored with latest message",
      );
      return;
    }

    const fetched = await channel.messages.fetch({ limit: 100, after: cursor });
    if (fetched.size === 0) return;
    const sorted = [...fetched.values()].sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp,
    );
    const candidates = sorted.filter((m) => !m.author.bot && !m.system);
    const toProcess = candidates.slice(0, UNREAD_RECOVERY_LIMIT);
    const dropped = Math.max(0, candidates.length - toProcess.length);

    for (const message of toProcess) {
      await this.handleMessage(message);
    }

    const latestMessage = sorted[sorted.length - 1];
    if (latestMessage) {
      this.db.setContextCursor(contextKey, latestMessage.id);
    }

    if (toProcess.length === 0 && dropped === 0) return;
    const lines = unreadRecoveryLines(this.locale, toProcess.length, dropped, UNREAD_RECOVERY_LIMIT);
    await channel.send(lines.join("\n"));
    this.logger.info(
      {
        reason,
        contextKey,
        channelId: channel.id,
        processed: toProcess.length,
        dropped,
      },
      "unread recovery completed",
    );
  }

  private buildCodexSearchCacheKey(userId: string, contextKey: string): string {
    return `${userId}:${contextKey}`;
  }

  private formatDateTime(ms: number): string {
    return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
  }

  private getExecutionLockKey(session: SessionRow): string {
    return session.codex_thread_id ? `codex:${session.codex_thread_id}` : `session:${session.id}`;
  }

  private async handleCodexCommand(msg: Message, body: string): Promise<void> {
    const arg = body.trim();
    const contextKey = this.sessionService.buildContextKey(msg.guildId!, msg.channelId);
    const cacheKey = this.buildCodexSearchCacheKey(msg.author.id, contextKey);
    if (/^session$/i.test(arg)) {
      await msg.reply(usageCodexSession(this.locale));
      return;
    }
    const sessionMatch = arg.match(/^session\s+(.+)$/i);
    if (sessionMatch) {
      const codexThreadId = sessionMatch[1].trim();
      if (!isUuidLike(codexThreadId)) {
        await msg.reply(usageCodexSession(this.locale));
        return;
      }
      const res = this.sessionService.rebindCurrentSessionCodexThread({
        contextKey,
        requesterId: msg.author.id,
        codexThreadId,
        summary: this.getCodexSummaryHint(codexThreadId) ?? undefined,
        preferredWorkingDirectory: resolveWorkingDirectoryFromThreadId(codexThreadId) ?? undefined,
      });
      if (!res.ok) {
        await msg.reply(res.code);
        return;
      }
      await msg.reply(sessionSwitchedThread(this.locale, codexThreadId));
      await msg.reply(codexSessionLine(this.locale, this.getUserFacingCodexSessionLabel(res.session)));
      return;
    }
    const pickMatch = arg.match(/^pick\s+(\d+)$/i);
    if (pickMatch) {
      const no = Number(pickMatch[1]);
      const cached = this.codexSearchCache.get(cacheKey) ?? [];
      if (!Number.isInteger(no) || no <= 0 || no > cached.length) {
        await msg.reply("ERR_CODEX_PICK_NOT_FOUND");
        return;
      }
      const selected = cached[no - 1];
      const rebindRes = this.sessionService.rebindCurrentSessionCodexThread({
        contextKey,
        requesterId: msg.author.id,
        codexThreadId: selected.threadId,
        summary: selected.summary ?? undefined,
        preferredWorkingDirectory: selected.cwd ?? undefined,
      });
      if (!rebindRes.ok) {
        await msg.reply(rebindRes.code);
        return;
      }
      await msg.reply(sessionSwitchedThread(this.locale, selected.threadId));
      await msg.reply(codexSessionLine(this.locale, this.getUserFacingCodexSessionLabel(rebindRes.session)));
      return;
    }

    const results = searchCodexSessions(arg, appConfig.listDefaultLimit);
    this.codexSearchCache.set(cacheKey, results);
    if (results.length === 0) {
      await msg.reply(codexSessionListEmpty(this.locale));
      return;
    }
    const lines = results.map((s, i) => {
      const cwd = s.cwd ?? unknownValue(this.locale);
      const summary = s.summary?.replace(/\s+/g, " ").slice(0, 60) ?? noSummary(this.locale);
      return `${i + 1} | ${s.threadId} | ${this.formatDateTime(s.updatedAtMs)} | ${cwd} | ${summary}`;
    });
    await this.sendMultilineReply(
      msg,
      "codex sessions (max 20)",
      lines,
      "pick: !codex pick <no>",
    );
  }
  private async handleSessionCommand(msg: Message, body: string): Promise<void> {
    const [subRaw, ...rest] = body.split(" ");
    const sub = (subRaw || "").toLowerCase();
    const arg = rest.join(" ").trim();
    const member = msg.member as GuildMember | null;
    const contextKey = this.sessionService.buildContextKey(msg.guildId!, msg.channelId);
    const shorthandId = subRaw?.trim() ?? "";

    if (sub === "help") {
      await msg.reply(buildCommandReference(this.locale, getBuildLabel(), APP_NAME));
      return;
    }

    if (isUuidLike(shorthandId) && !arg) {
      const localRes = this.sessionService.switchById({
        contextKey,
        sessionId: shorthandId,
        requesterId: msg.author.id,
        member,
      });
      if (localRes.ok) {
        await msg.reply(
          codexSessionLine(this.locale, this.getUserFacingCodexSessionLabel(localRes.session)),
        );
        await msg.reply(
          codexSessionLine(this.locale, this.getUserFacingCodexSessionLabel(localRes.session)),
        );
        return;
      }
      const connectRes = this.sessionService.connectCodexThread({
        contextKey,
        requesterId: msg.author.id,
        member,
        codexThreadId: shorthandId,
        summary: this.getCodexSummaryHint(shorthandId) ?? undefined,
        preferredWorkingDirectory:
          resolveWorkingDirectoryFromThreadId(shorthandId) ?? undefined,
      });
      if (!connectRes.ok) {
        await msg.reply(connectRes.code);
        return;
      }
      if (connectRes.created) {
        await msg.reply(sessionLinkedThread(this.locale, shorthandId));
      } else {
        await msg.reply(sessionSwitchedThread(this.locale, shorthandId));
      }
      await msg.reply(codexSessionLine(this.locale, this.getUserFacingCodexSessionLabel(connectRes.session)));
      return;
    }

    if (sub === "connect") {
      if (!arg || !isUuidLike(arg)) {
        await msg.reply(usageSessionConnect(this.locale));
        return;
      }
      const connectRes = this.sessionService.connectCodexThread({
        contextKey,
        requesterId: msg.author.id,
        member,
        codexThreadId: arg,
        summary: this.getCodexSummaryHint(arg) ?? undefined,
        preferredWorkingDirectory: resolveWorkingDirectoryFromThreadId(arg) ?? undefined,
      });
      if (!connectRes.ok) {
        await msg.reply(connectRes.code);
        return;
      }
      if (connectRes.created) {
        await msg.reply(sessionLinkedThread(this.locale, arg));
      } else {
        await msg.reply(sessionSwitchedThread(this.locale, arg));
      }
      await msg.reply(codexSessionLine(this.locale, this.getUserFacingCodexSessionLabel(connectRes.session)));
      return;
    }

    if (sub === "new") {
      const previous = this.sessionService.getCurrentSession(contextKey);
      const inheritedWorkingDirectory = previous?.preferred_working_directory
        ?? (previous?.codex_thread_id
          ? resolveWorkingDirectoryFromThreadId(previous.codex_thread_id)
          : null);
      const created = this.sessionService.createAndBindSession({
        contextKey,
        requesterId: msg.author.id,
        name: arg || undefined,
        preferredWorkingDirectory: inheritedWorkingDirectory ?? undefined,
      });
      await msg.reply(sessionCreated(this.locale));
      if (inheritedWorkingDirectory) {
        await msg.reply(workingDirectoryInherited(this.locale, inheritedWorkingDirectory));
      }
      await msg.reply(codexSessionLine(this.locale, this.getUserFacingCodexSessionLabel(created)));
      return;
    }

    if (sub === "list") {
      const sessions = this.sessionService.listSessions(
        arg || undefined,
        appConfig.listDefaultLimit,
      );
      this.sessionService.cacheListResult(msg.author.id, contextKey, sessions);
      if (sessions.length === 0) {
        await msg.reply(sessionsListEmpty(this.locale));
        return;
      }
      const lines = sessions.map(
        (s, i) =>
          `${i + 1} | ${this.getUserFacingCodexSessionLabel(s)} | ${s.status} | ${s.last_used_at}`,
      );
      await msg.reply(
        `${this.locale === "en" ? "sessions (max 20)" : "sessions (max 20)"}\n${lines.join("\n")}`,
      );
      return;
    }

    if (sub === "switch") {
      if (!arg) {
        await msg.reply(usageSessionSwitch(this.locale));
        return;
      }
      const isNo = /^\d+$/.test(arg);
      if (isNo) {
        const res = this.sessionService.switchByListNo({
          contextKey,
          requesterId: msg.author.id,
          member,
          no: Number(arg),
        });
        if (!res.ok) {
          await msg.reply(res.code);
          return;
        }
        await msg.reply(
          codexSessionLine(this.locale, this.getUserFacingCodexSessionLabel(res.session)),
        );
        await msg.reply(codexSessionLine(this.locale, this.getUserFacingCodexSessionLabel(res.session)));
        return;
      }
      const looksLikeId = isUuidLike(arg);
      if (looksLikeId) {
        const res = this.sessionService.switchById({
          contextKey,
          sessionId: arg,
          requesterId: msg.author.id,
          member,
        });
        if (res.ok) {
          await msg.reply(
            codexSessionLine(this.locale, this.getUserFacingCodexSessionLabel(res.session)),
          );
          await msg.reply(codexSessionLine(this.locale, this.getUserFacingCodexSessionLabel(res.session)));
          return;
        }
        const connectRes = this.sessionService.connectCodexThread({
          contextKey,
          requesterId: msg.author.id,
          member,
          codexThreadId: arg,
          summary: this.getCodexSummaryHint(arg) ?? undefined,
          preferredWorkingDirectory: resolveWorkingDirectoryFromThreadId(arg) ?? undefined,
        });
        if (!connectRes.ok) {
          await msg.reply(connectRes.code);
          return;
        }
        await msg.reply(
          codexSessionLine(this.locale, this.getUserFacingCodexSessionLabel(connectRes.session)),
        );
        await msg.reply(codexSessionLine(this.locale, this.getUserFacingCodexSessionLabel(connectRes.session)));
        return;
      }
      const res = this.sessionService.switchByName({
        contextKey,
        sessionName: arg,
        requesterId: msg.author.id,
        member,
      });
      if (!res.ok) {
        if (res.code === "ERR_SESSION_NAME_AMBIGUOUS" && res.candidates) {
          const lines = res.candidates
            .slice(0, appConfig.listDefaultLimit)
            .map((s, i) => `${i + 1} | ${s.id} | ${s.name} | ${s.last_used_at}`);
          this.sessionService.cacheListResult(msg.author.id, contextKey, res.candidates);
          await msg.reply(
            this.locale === "en"
              ? `ERR_SESSION_NAME_AMBIGUOUS\nCandidates:\n${lines.join("\n")}\nRetry: !session switch <id|no>`
              : `ERR_SESSION_NAME_AMBIGUOUS\n候補:\n${lines.join("\n")}\n再指定: !session switch <id|no>`,
          );
          return;
        }
        await msg.reply(res.code);
        return;
      }
      await msg.reply(
        codexSessionLine(this.locale, this.getUserFacingCodexSessionLabel(res.session)),
      );
      await msg.reply(codexSessionLine(this.locale, this.getUserFacingCodexSessionLabel(res.session)));
      return;
    }

    if (sub === "current") {
      const current = this.sessionService.getCurrentSession(contextKey);
      if (!current) {
        await msg.reply("ERR_ACTIVE_SESSION_NOT_FOUND");
        return;
      }
      const lockKey = this.getExecutionLockKey(current);
      const runtime = this.manager.getRuntimeState(lockKey);
      const workingDirectory = current.codex_thread_id
        ? (
            resolveWorkingDirectoryFromThreadId(current.codex_thread_id)
            ?? current.preferred_working_directory
            ?? unknownValue(this.locale)
          )
        : (current.preferred_working_directory ?? notLinkedYet(this.locale));
      const lines = [
        `codex_thread_id: ${current.codex_thread_id ?? notLinkedYet(this.locale)}`,
        `model: ${current.model_override ?? "default"}`,
        `sandbox: ${current.sandbox_mode ?? "workspace-write"}`,
        `danger_full_access_until: ${current.danger_full_access_until ?? "-"}`,
        `working_directory: ${workingDirectory}`,
        `queue_lock_key: ${lockKey}`,
        `status: ${current.status}`,
        `queue_length: ${runtime.queueLength}`,
        `last_used_at: ${current.last_used_at}`,
      ];
      if (runtime.runningSince) lines.push(`running_since: ${runtime.runningSince}`);
      await msg.reply(lines.join("\n"));
      return;
    }

    await msg.reply(usageSessionRoot(this.locale));
  }

  private async handleExecutionMessage(
    msg: Message,
    content: string,
    options?: {
      promptOverride?: string;
      sandboxOverride?: SandboxMode;
      approvalStatusOverride?: "one_shot";
    },
  ): Promise<void> {
    const stale = this.db.cancelStaleRunningExecutions(appConfig.codexTimeoutSec + 60);
    if (stale > 0) {
      this.logger.warn({ stale }, "stale running executions were timed out");
    }

    const contextKey = this.sessionService.buildContextKey(msg.guildId!, msg.channelId);
    const session = this.sessionService.resolveOrCreateActiveSession({
      contextKey,
      requesterId: msg.author.id,
      initialMessage: content,
    });

    const executionId = this.db.insertExecution({
      sessionId: session.id,
      discordMessageId: msg.id,
      discordChannelId: msg.channelId,
      requestedBy: msg.author.id,
      commandTextMasked: maskSecrets(content),
    });

    if (!msg.channel.isSendable()) {
      await msg.reply("ERR_CHANNEL_NOT_SENDABLE");
      return;
    }
    const sendChannel = msg.channel;
    let progressMessageId: string | null = null;
    let finalized = false;
    let lastProgressEditAtMs = 0;
    const seenAgentItemIds = new Set<string>();
    const streamAgentMessages: string[] = [];
    const streamHistory: string[] = [];
    const STREAM_HISTORY_MAX = 8;
    const MAX_PROGRESS_LEN = 1800;
    const normalizeStreamPreview = (text: string): string => text
      .replace(/\r?\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    const addStreamHistory = (entry: string): void => {
      if (!entry) return;
      const prev = streamHistory[streamHistory.length - 1];
      if (prev === entry) return;
      streamHistory.push(entry);
      if (streamHistory.length > STREAM_HISTORY_MAX) {
        streamHistory.splice(0, streamHistory.length - STREAM_HISTORY_MAX);
      }
    };
    const composeStatusText = (statusLine: string): string => {
      const lines = [statusLine];
      if (streamHistory.length > 0) {
        lines.push("stream_log:");
        for (let i = 0; i < streamHistory.length; i += 1) {
          lines.push(`${i + 1}. ${streamHistory[i]}`);
        }
      }
      const merged = lines.join("\n");
      if (merged.length <= MAX_PROGRESS_LEN) return merged;
      return `${merged.slice(0, MAX_PROGRESS_LEN - 30)}\n...(truncated)`;
    };
    const editProgressMessage = async (text: string): Promise<void> => {
      if (finalized) return;
      const now = Date.now();
      if (now - lastProgressEditAtMs < 1000) return;
      lastProgressEditAtMs = now;
      if (!progressMessageId) {
        const sent = await sendChannel.send(text);
        progressMessageId = sent.id;
        return;
      }
      try {
        const prev = await sendChannel.messages.fetch(progressMessageId);
        await prev.edit(text);
      } catch {
        const sent = await sendChannel.send(text);
        progressMessageId = sent.id;
      }
    };
    const sendOrEditFinal = async (text: string): Promise<void> => {
      finalized = true;
      if (!progressMessageId) {
        const sent = await sendChannel.send(text);
        progressMessageId = sent.id;
        return;
      }
      try {
        const prev = await sendChannel.messages.fetch(progressMessageId);
        await prev.edit(text);
      } catch {
        await sendChannel.send(text);
      }
    };
    const incomingPaths = options?.promptOverride
      ? []
      : await this.saveIncomingAttachments(msg, session.id);
    const prompt = options?.promptOverride
      ?? buildPromptWithIncomingAttachments(content, incomingPaths);
    const sandboxMode = options?.sandboxOverride ?? this.resolveSandboxMode(session);
    let permissionFailureDetected = false;
    let retryableSandboxFailureDetected = false;
    const executionLockKey = this.getExecutionLockKey(session);
    const storedThreadIdAtStart = session.codex_thread_id ?? null;
    let observedThreadId: string | null = storedThreadIdAtStart;
    let threadSwitchNotice: string | null = null;
    let threadSwitchAnnounced = false;
    const applyObservedThreadId = async (
      nextThreadId: string | null | undefined,
      source: "event" | "result",
    ): Promise<void> => {
      if (!nextThreadId) return;
      observedThreadId = nextThreadId;
      const change = detectThreadBindingChange(session.codex_thread_id, nextThreadId);
      if (change.kind === "none") return;
      this.db.setSessionCodexThreadId(session.id, change.nextThreadId);
      session.codex_thread_id = change.nextThreadId;
      this.addLocalSyncSuppressionText(change.nextThreadId, "user_message", content);
      if (change.kind === "bound") {
        this.logger.info(
          { executionId, sessionId: session.id, threadId: change.nextThreadId, source },
          "codex thread bound",
        );
        return;
      }
      threadSwitchNotice ??= buildThreadSwitchNotice(
        change.previousThreadId,
        change.nextThreadId,
        this.locale,
      );
      this.logger.warn(
        {
          executionId,
          sessionId: session.id,
          source,
          storedThreadId: change.previousThreadId,
          observedThreadId: change.nextThreadId,
        },
        "codex thread id switched",
      );
      if (threadSwitchAnnounced) return;
      threadSwitchAnnounced = true;
      try {
        await sendChannel.send(threadSwitchNotice);
      } catch {
        // ユーザー通知失敗は本体処理を止めない。
      }
    };
    if (observedThreadId) {
      this.addLocalSyncSuppressionText(observedThreadId, "user_message", content);
    }
    this.logger.info(
      {
        executionId,
        sessionId: session.id,
        lockKey: executionLockKey,
        channelId: msg.channelId,
        userId: msg.author.id,
      },
      "execution queued",
    );

    const result = await this.manager.enqueue({
      executionId,
      sessionId: session.id,
      lockKey: executionLockKey,
      text: content,
      maxRetries: 1,
      onQueued: async (position) => {
        const text = queuedMessage(
          this.locale,
          position,
          this.getUserFacingCodexSessionLabel(session),
        );
        try {
          await msg.reply(text);
        } catch {
          await sendChannel.send(text);
        }
      },
      onProgress: async (elapsedSec, queueLength) => {
        if (finalized) return;
        const progressText = composeStatusText(
          runningElapsedMessage(
            this.locale,
            elapsedSec,
            queueLength,
            this.getUserFacingCodexSessionLabel(session),
          ),
        );
        await editProgressMessage(progressText);
      },
      run: async () => {
        this.db.updateExecutionStatus(executionId, "running", { setStarted: true });
        const shouldInjectAttachInstruction = !session.attach_instruction_sent_at;
        if (shouldInjectAttachInstruction) {
          this.db.markAttachInstructionSent(session.id);
          session.attach_instruction_sent_at = new Date().toISOString();
        }
        this.logger.info(
          {
            executionId,
            sessionId: session.id,
            codexThreadId: session.codex_thread_id,
            sandboxMode,
          },
          "execution started",
        );
        const runResult = await this.codex.run({
          prompt,
          sessionId: session.id,
          codexThreadId: session.codex_thread_id,
          modelOverride: session.model_override,
          sandboxMode,
          preferredWorkingDirectory: session.preferred_working_directory,
          includeDiscordAgentSystemPrompt: shouldInjectAttachInstruction,
          onEvent: async (event) => {
            if (finalized) return;
            if (event.threadId) {
              await applyObservedThreadId(event.threadId, "event");
            }
            if (
              event.type === "turn.started"
              || event.type === "turn.completed"
              || (event.type === "item.completed" && event.itemType === "agent_message")
            ) {
              this.logger.info(
                {
                  executionId,
                  sessionId: session.id,
                  eventType: event.type,
                  itemType: event.itemType ?? null,
                  itemId: event.itemId ?? null,
                  codexThreadId: observedThreadId ?? session.codex_thread_id ?? null,
                },
                "codex json milestone",
              );
            }
            if (this.isPermissionDeniedCommandFailure(event.raw)) {
              permissionFailureDetected = true;
              this.logger.warn(
                {
                  executionId,
                  sessionId: session.id,
                  itemId: event.itemId ?? null,
                  sandboxMode,
                },
                "codex command failed with permission denied",
              );
            }
            if (this.isRetryableSandboxSetupFailure(event.raw)) {
              retryableSandboxFailureDetected = true;
              this.logger.warn(
                {
                  executionId,
                  sessionId: session.id,
                  itemId: event.itemId ?? null,
                  sandboxMode,
                },
                "codex command failed with retryable sandbox setup error",
              );
            }
            if (
              event.type === "item.completed"
              && (event.itemType === "user_message" || event.itemType === "agent_message")
              && event.itemId
              && observedThreadId
            ) {
              this.db.markExternalSyncEventSeen(observedThreadId, event.itemId);
            }
            if (event.type === "turn.started") {
              await editProgressMessage(
                composeStatusText(
                  runningPhaseMessage(
                    this.locale,
                    "turn.started",
                    this.getUserFacingCodexSessionLabel(session),
                  ),
                ),
              );
            }
          },
          onAgentMessage: async ({ itemId, text }) => {
            if (finalized) return;
            if (seenAgentItemIds.has(itemId)) return;
            seenAgentItemIds.add(itemId);
            if (observedThreadId) {
              this.addLocalSyncSuppressionText(observedThreadId, "agent_message", text);
            }
            streamAgentMessages.push(text);
            const preview = normalizeStreamPreview(text);
            const previewText = preview.length > 0
              ? `${preview}${text.length > preview.length ? " ..." : ""}`
              : "(empty)";
            addStreamHistory(previewText);
            await editProgressMessage(
              composeStatusText(
                runningPhaseMessage(
                  this.locale,
                  "agent_message",
                  this.getUserFacingCodexSessionLabel(session),
                ),
              ),
            );
          },
          onStdErrLine: async (line) => {
            this.logger.debug(
              { executionId, sessionId: session.id, line },
              "codex stderr stream line",
            );
          },
          onClose: async ({ code, signal }) => {
            this.logger.info(
              {
                executionId,
                sessionId: session.id,
                codexThreadId: observedThreadId ?? session.codex_thread_id ?? null,
                code,
                signal,
              },
              "codex process closed",
            );
          },
          onLifecycle: async ({ type, source, graceMs }) => {
            this.logger.info(
              {
                executionId,
                sessionId: session.id,
                codexThreadId: observedThreadId ?? session.codex_thread_id ?? null,
                type,
                source: source ?? null,
                graceMs: graceMs ?? null,
              },
              "codex lifecycle event",
            );
          },
        });
        this.logger.info(
          {
            executionId,
            sessionId: session.id,
            workingDirectoryUsed: runResult.workingDirectoryUsed ?? "(default)",
          },
          "codex execution cwd",
        );
        if (runResult.warnings && runResult.warnings.length > 0) {
          this.logger.warn(
            {
              executionId,
              sessionId: session.id,
              warnings: runResult.warnings,
            },
            "codex warnings",
          );
        }
        await applyObservedThreadId(runResult.threadId, "result");
        if (
          storedThreadIdAtStart
          && !runResult.threadId
          && observedThreadId === storedThreadIdAtStart
          && isMissingCodexThreadError(runResult.output)
        ) {
          const invalidThreadNotice = buildInvalidThreadNotice(storedThreadIdAtStart, this.locale);
          this.logger.warn(
            {
              executionId,
              sessionId: session.id,
              codexThreadId: storedThreadIdAtStart,
              errorCode: runResult.errorCode ?? null,
            },
            "stored codex thread id is invalid",
          );
          return {
            status: "error" as const,
            output: invalidThreadNotice,
            errorCode: "ERR_CODEX_THREAD_NOT_FOUND",
          };
        }
        if (!runResult.ok) {
          this.logger.warn(
            {
              executionId,
              sessionId: session.id,
              errorCode: runResult.errorCode,
              timedOut: runResult.timedOut,
            },
            "execution failed",
          );
          return {
            status: runResult.timedOut ? ("timeout" as const) : ("error" as const),
            output: runResult.output,
            errorCode: runResult.errorCode,
          };
        }
        if (this.containsRetryableSandboxSetupFailureText(runResult.output)) {
          retryableSandboxFailureDetected = true;
        }
        return { status: "success" as const, output: runResult.output };
      },
      onFinish: async ({ status, output, retries, errorCode }) => {
        if (finalized) return;
        this.db.updateExecutionStatus(executionId, status, {
          errorCode,
          retryCount: retries,
        });
        this.sessionService.touchSession(session.id);
        this.logger.info(
          { executionId, sessionId: session.id, status, retries, errorCode },
          "execution finished",
        );

        const parsed = extractAttachPaths(output);
        const streamBody = streamAgentMessages.join("\n").trim();
        const body = streamBody || parsed.cleanedOutput || "(no output)";
        const chunks = splitIntoChunks(body, appConfig.messageChunkSize);
        const sessionLabel = this.getUserFacingCodexSessionLabel(session);
        const usageStatus = observedThreadId
          ? readLatestCodexUsageStatusByThreadId(observedThreadId)
          : null;
        if (observedThreadId && !session.model_override) {
          const resolvedDefaultModel = readLatestCodexResolvedModelByThreadId(observedThreadId);
          if (resolvedDefaultModel) {
            this.db.setAppState(APP_STATE_LAST_RESOLVED_DEFAULT_MODEL, resolvedDefaultModel);
          }
        }
        const modelBlock = session.model_override
          ? `${modelWarningLine(this.locale, session.model_override)}\n`
          : "";
        const usageBlock = usageStatus ? `${codexUsageStatusLine(this.locale, usageStatus)}\n` : "";
        if (usageStatus) {
          this.logger.info(
            {
              executionId,
              sessionId: session.id,
              codexThreadId: observedThreadId,
              planType: usageStatus.planType,
              primaryUsedPercent: usageStatus.primaryUsedPercent,
              primaryWindowMinutes: usageStatus.primaryWindowMinutes,
              primaryResetsAt: usageStatus.primaryResetsAt,
              secondaryUsedPercent: usageStatus.secondaryUsedPercent,
              secondaryWindowMinutes: usageStatus.secondaryWindowMinutes,
              secondaryResetsAt: usageStatus.secondaryResetsAt,
            },
            "codex usage status read from session jsonl",
          );
        }
        const historyLines = streamHistory.map((v, i) => `${i + 1}. ${v}`);
        const historyBlock = appConfig.showFinalStreamLog && historyLines.length > 0
          ? `stream_log:\n${historyLines.join("\n")}\n`
          : "";
        const switchBlock = threadSwitchNotice ? `${threadSwitchNotice}\n` : "";
        const needsApprovalRetry = permissionFailureDetected || retryableSandboxFailureDetected;
        const approvalView = this.resolveApprovalStatusView(
          session,
          sandboxMode,
          needsApprovalRetry,
          options?.approvalStatusOverride,
        );
        const approvalBlock = approvalView
          ? `${approvalStatusLine(this.locale, approvalView)}\n`
          : "";
        await sendOrEditFinal(
          completeHeader(
            this.locale,
            sessionLabel,
            switchBlock,
            approvalBlock,
            modelBlock,
            usageBlock,
            historyBlock,
          ),
        );
        for (let i = 0; i < chunks.length; i += 1) {
          await sendChannel.send(`(${i + 1}/${chunks.length}) ${chunks[i]}`);
        }
        await this.sendSandboxFirstCompletionNoticeOnce(sendChannel);
        if (needsApprovalRetry && sandboxMode === "workspace-write") {
          this.pendingApprovals.set(contextKey, {
            content,
            prompt,
            sessionId: session.id,
            messageId: msg.id,
            createdAtMs: Date.now(),
          });
          await sendChannel.send(permissionRetryPrompt(this.locale));
        }
        if (parsed.paths.length > 0) {
          await this.handleAttachCommands(sendChannel, parsed.paths);
        }
      },
    });

    if (!result.ok) {
      this.db.updateExecutionStatus(executionId, "cancelled", {
        errorCode: result.code,
      });
      await msg.reply(result.code);
    }
  }

  private async handleQueueCommand(msg: Message, body: string): Promise<void> {
    const sub = body.trim().toLowerCase();
    if (sub === "stopall" || sub === "allstop") {
      const reset = this.manager.forceResetAll();
      const killed = this.codex.emergencyStopAllRunning();
      const canceled = this.db.cancelAllInFlightExecutions("ERR_EMERGENCY_STOP");
      this.logger.warn(
        {
          by: msg.author.id,
          canceled,
          killed,
          reset,
        },
        "queue emergency stopall requested",
      );
      await msg.reply(
        queueStopallExecuted(
          this.locale,
          canceled,
          killed,
          reset.clearedLocks,
          reset.droppedQueued,
        ),
      );
      return;
    }
    if (sub === "fix") {
      const inFlight = this.db.listInFlightExecutions(1000);
      const running = inFlight.filter((v) => v.result_status === "running");
      const activeThreadIds = new Set(this.codex.getActiveCodexThreadIds());
      const orphanIds = running
        .filter((v) => v.codex_thread_id && !activeThreadIds.has(v.codex_thread_id))
        .map((v) => v.id);
      const fixed = this.db.cancelExecutionsByIds(
        orphanIds,
        "ERR_QUEUE_FIXED_ORPHAN_RUNNING",
      );
      const dbLockKeys = new Set(
        inFlight.map((e) => (
          e.codex_thread_id
            ? `codex:${e.codex_thread_id}`
            : `session:${e.session_id}`
        )),
      );
      const staleLockKeys = this.manager
        .getQueueSnapshots()
        .map((v) => v.lockKey)
        .filter((lockKey) => !dbLockKeys.has(lockKey));
      const releasedLocks = this.manager.forceReleaseLocks(staleLockKeys);
      this.logger.warn(
        {
          by: msg.author.id,
          checkedRunning: running.length,
          fixed,
          activeThreads: [...activeThreadIds],
          staleLockKeys,
          releasedLocks,
        },
        "queue fix requested",
      );
      await msg.reply(
        queueFixExecuted(
          this.locale,
          running.length,
          fixed,
          releasedLocks,
          activeThreadIds.size,
        ),
      );
      return;
    }

    if (sub.length > 0 && sub !== "status") {
      await msg.reply(usageQueue(this.locale));
      return;
    }

    const snapshots = this.manager.getQueueSnapshots();
    const inFlight = this.db.listInFlightExecutions(100);
    if (snapshots.length === 0 && inFlight.length === 0) {
      await msg.reply(queueStatusEmpty(this.locale));
      return;
    }

    const lines: string[] = [];
    for (const s of snapshots) {
      lines.push(
        [
          `${s.lockKey}`,
          `running=${s.running ? "yes" : "no"}`,
          `queued=${s.queued}`,
          `running_since=${s.runningSince ?? "-"}`,
        ].join(" | "),
      );
    }
    lines.push("---");
    for (const e of inFlight) {
      const lockKey = e.codex_thread_id
        ? `codex:${e.codex_thread_id}`
        : `session:${e.session_id}`;
      const workingDirectory = e.codex_thread_id
        ? (
            resolveWorkingDirectoryFromThreadId(e.codex_thread_id)
            ?? e.preferred_working_directory
            ?? unknownValue(this.locale)
          )
        : (e.preferred_working_directory ?? notLinkedYet(this.locale));
      lines.push(
        [
          e.result_status,
          e.id,
          lockKey,
          `session=${e.session_name}`,
          `working_directory=${workingDirectory}`,
          `created=${e.created_at}`,
          `started=${e.started_at ?? "-"}`,
        ].join(" | "),
      );
    }
    await this.sendMultilineReply(msg, queueStatusTitle(this.locale), lines);
  }

  private async handleSyncCommand(msg: Message, body: string): Promise<void> {
    const arg = body.trim().toLowerCase();
    if (!arg || arg === "status") {
      await msg.reply(
        syncStatus(
          this.locale,
          this.externalSyncEnabled,
          appConfig.externalSyncPollSec,
          appConfig.externalSyncMaxBurst,
        ),
      );
      return;
    }
    if (arg === "on") {
      this.externalSyncEnabled = true;
      await msg.reply(syncEnabled(this.locale));
      return;
    }
    if (arg === "off") {
      this.externalSyncEnabled = false;
      await msg.reply(syncDisabled(this.locale));
      return;
    }
    if (arg === "reset") {
      const anchored = this.resetExternalSyncCursorsToLatest();
      await msg.reply(syncResetDone(this.locale, anchored));
      return;
    }
    await msg.reply(usageSync(this.locale));
  }

  private discardPendingApprovalForNewPrompt(contextKey: string): void {
    this.pendingApprovals.delete(contextKey);
  }

  private resolveSandboxMode(session: SessionRow): SandboxMode {
    if (appConfig.forceLegacyFullAccess) return "danger-full-access";
    if (session.sandbox_mode === "danger-full-access") return "danger-full-access";
    if (session.danger_full_access_until) {
      const untilMs = Date.parse(session.danger_full_access_until);
      if (Number.isFinite(untilMs) && untilMs > Date.now()) return "danger-full-access";
    }
    return "workspace-write";
  }

  private isPermissionDeniedCommandFailure(raw: Record<string, unknown>): boolean {
    if (raw.type !== "item.completed") return false;
    const item = raw.item;
    if (!item || typeof item !== "object") return false;
    const itemObj = item as Record<string, unknown>;
    if (itemObj.type !== "command_execution") return false;
    if (itemObj.status !== "failed") return false;
    const text = String(itemObj.aggregated_output ?? "").toLowerCase();
    return [
      "access denied",
      "permission denied",
      "unauthorizedaccessexception",
      "アクセスが拒否されました",
      "permissiondenied",
    ].some((pattern) => text.includes(pattern.toLowerCase()));
  }

  private isRetryableSandboxSetupFailure(raw: Record<string, unknown>): boolean {
    if (raw.type !== "item.completed") return false;
    const item = raw.item;
    if (!item || typeof item !== "object") return false;
    const itemObj = item as Record<string, unknown>;
    if (itemObj.type !== "command_execution") return false;
    if (itemObj.status !== "failed") return false;
    const text = String(itemObj.aggregated_output ?? "").toLowerCase();
    return this.containsRetryableSandboxSetupFailureText(text);
  }

  private containsRetryableSandboxSetupFailureText(text: string): boolean {
    const normalized = String(text ?? "").toLowerCase();
    return normalized.includes("windows sandbox: spawn setup refresh");
  }

  private async handleSandboxCommand(msg: Message, body: string): Promise<void> {
    const arg = body.trim().toLowerCase();
    if (arg !== "on" && arg !== "off") {
      await msg.reply(usageSandbox(this.locale));
      return;
    }
    const contextKey = this.sessionService.buildContextKey(msg.guildId!, msg.channelId);
    const session = this.sessionService.resolveOrCreateActiveSession({
      contextKey,
      requesterId: msg.author.id,
      initialMessage: "sandbox",
    });
    const mode: SandboxMode = arg === "off" ? "danger-full-access" : "workspace-write";
    this.db.setSessionSandboxMode(session.id, mode);
    session.sandbox_mode = mode;
    session.danger_full_access_until = null;
    this.pendingApprovals.delete(contextKey);
    await msg.reply(sandboxModeSet(this.locale, mode));
  }

  private async handleOkCommand(msg: Message, contextKey: string, body: string): Promise<void> {
    const arg = body.trim();
    if (arg) {
      const minutes = Number(arg);
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes > TEMP_FULL_ACCESS_MAX_MINUTES) {
        await msg.reply(usageOk(this.locale, TEMP_FULL_ACCESS_MAX_MINUTES));
        return;
      }
      const session = this.sessionService.resolveOrCreateActiveSession({
        contextKey,
        requesterId: msg.author.id,
        initialMessage: "ok",
      });
      const untilIso = new Date(Date.now() + minutes * 60 * 1000).toISOString();
      this.db.setSessionDangerFullAccessUntil(session.id, untilIso);
      session.danger_full_access_until = untilIso;
      const pending = this.pendingApprovals.get(contextKey);
      if (pending && pending.sessionId !== session.id) {
        this.pendingApprovals.delete(contextKey);
        await msg.reply(permissionRequestNotFound(this.locale));
        return;
      }
      if (pending) {
        this.pendingApprovals.delete(contextKey);
        await msg.reply(temporaryFullAccessEnabled(this.locale, minutes));
        await this.handleExecutionMessage(msg, pending.content, {
          promptOverride: permissionGrantedReexecutePrompt(this.locale),
          sandboxOverride: "danger-full-access",
        });
        return;
      }
      await msg.reply(temporaryFullAccessEnabled(this.locale, minutes));
      return;
    }

    const pending = this.pendingApprovals.get(contextKey);
    if (!pending) {
      await msg.reply(permissionRequestNotFound(this.locale));
      return;
    }
    const session = this.sessionService.resolveOrCreateActiveSession({
      contextKey,
      requesterId: msg.author.id,
      initialMessage: "ok",
    });
    if (session.id !== pending.sessionId) {
      this.pendingApprovals.delete(contextKey);
      await msg.reply(permissionRequestNotFound(this.locale));
      return;
    }
    this.pendingApprovals.delete(contextKey);
    await this.handleExecutionMessage(msg, pending.content, {
      promptOverride: permissionGrantedReexecutePrompt(this.locale),
      sandboxOverride: "danger-full-access",
      approvalStatusOverride: "one_shot",
    });
  }

  private async handleNgCommand(msg: Message, contextKey: string): Promise<void> {
    const session = this.sessionService.resolveOrCreateActiveSession({
      contextKey,
      requesterId: msg.author.id,
      initialMessage: "ng",
    });
    const hadPending = this.pendingApprovals.delete(contextKey);
    const hadTemporaryFullAccess = Boolean(session.danger_full_access_until);
    if (hadTemporaryFullAccess) {
      this.db.setSessionDangerFullAccessUntil(session.id, null);
      session.danger_full_access_until = null;
    }

    if (!hadPending && !hadTemporaryFullAccess) {
      await msg.reply(permissionRequestNotFound(this.locale));
      return;
    }

    const replies: string[] = [];
    if (hadPending) replies.push(permissionRequestDiscarded(this.locale));
    if (hadTemporaryFullAccess) replies.push(temporaryFullAccessDisabled(this.locale));
    await msg.reply(replies.join("\n"));
  }

  private async sendSandboxStartupNoticeOnce(): Promise<void> {
    if (this.db.getAppState(APP_STATE_SANDBOX_NOTICE_STARTUP) === "done") return;
    const contextKey = this.db.getMostRecentContextKey();
    if (!contextKey) return;
    const channel = await this.resolveSendableChannelByContextKey(contextKey);
    if (!channel) return;
    await channel.send(sandboxMigrationNotice(this.locale));
    this.db.setAppState(APP_STATE_SANDBOX_NOTICE_STARTUP, "done");
  }

  private async sendSandboxFirstCompletionNoticeOnce(
    sendChannel: SendableChannels,
  ): Promise<void> {
    if (this.db.getAppState(APP_STATE_SANDBOX_NOTICE_FIRST_COMPLETION) === "done") return;
    await sendChannel.send(sandboxMigrationNotice(this.locale));
    this.db.setAppState(APP_STATE_SANDBOX_NOTICE_FIRST_COMPLETION, "done");
  }

  private resolveApprovalStatusView(
    session: SessionRow,
    sandboxMode: SandboxMode,
    permissionFailureDetected: boolean,
    approvalStatusOverride?: "one_shot",
  ): ApprovalStatusView | null {
    if (appConfig.forceLegacyFullAccess) return null;
    if (approvalStatusOverride === "one_shot") {
      return { kind: "one_shot" };
    }
    if (sandboxMode === "workspace-write") {
      if (permissionFailureDetected) return { kind: "pending", sandboxMode };
      return { kind: "none", sandboxMode };
    }
    if (session.sandbox_mode === "danger-full-access") {
      return { kind: "always_on" };
    }
    if (session.danger_full_access_until) {
      return { kind: "temporary", untilIso: session.danger_full_access_until };
    }
    return { kind: "always_on" };
  }

  private modelOptionLabel(value: string): string {
    if (value !== "default") return value;
    const resolved = this.db.getAppState(APP_STATE_LAST_RESOLVED_DEFAULT_MODEL);
    return resolved ? `default (${resolved})` : "default";
  }

  private formatModelLine(index: number, item: ModelCatalogItem, currentModel: string): string {
    const currentMark = item.id === currentModel ? " <= current" : "";
    const disabledMark = item.disabled ? " [disabled]" : "";
    const label = this.modelOptionLabel(item.id);
    const description = item.description ? ` | ${item.description}` : "";
    return `${index} | ${label}${disabledMark}${currentMark}${description}`;
  }

  private async handleModelCommand(msg: Message, body: string): Promise<void> {
    const contextKey = this.sessionService.buildContextKey(msg.guildId!, msg.channelId);
    const session = this.sessionService.resolveOrCreateActiveSession({
      contextKey,
      requesterId: msg.author.id,
      initialMessage: "model",
    });
    const arg = body.trim();
    const catalog = loadModelCatalog();
    const currentModel = session.model_override ?? "default";
    if (!arg) {
      const lines = catalog.items.map((item, index) => (
        this.formatModelLine(index, item, currentModel)
      ));
      lines.push("---");
      lines.push(modelListSourceLine(this.locale, "data/models.yaml"));
      await msg.reply(`model list\n${lines.join("\n")}`);
      return;
    }
    const index = Number(arg);
    if (!Number.isInteger(index) || index < 0 || index >= catalog.items.length) {
      await msg.reply(usageModel(this.locale));
      return;
    }
    const selected = catalog.items[index]!;
    if (selected.disabled) {
      await msg.reply("ERR_MODEL_DISABLED");
      return;
    }
    const override = selected.id === "default" ? null : selected.id;
    this.db.setSessionModelOverride(session.id, override);
    session.model_override = override;
    const label = override ?? "default";
    await msg.reply(modelSetDone(this.locale, label));
  }

  private resetExternalSyncCursorsToLatest(): number {
    const threadIds = this.db.listActiveCodexThreadIds();
    let anchored = 0;
    for (const threadId of threadIds) {
      const read = readCodexThreadEventsSinceLine(threadId, 0);
      if (!read.sourceFound) continue;
      this.db.setExternalSyncCursor(threadId, read.latestLineNo);
      anchored += 1;
    }
    return anchored;
  }

  private normalizeSuppressionText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  private addLocalSyncSuppressionText(
    codexThreadId: string,
    itemType: "user_message" | "agent_message",
    text: string,
  ): void {
    const normalized = this.normalizeSuppressionText(text);
    if (!normalized) return;
    const now = Date.now();
    const expiresAtMs = now + (5 * 60 * 1000);
    const current = this.localSyncSuppress.get(codexThreadId) ?? {
      userTexts: new Set<string>(),
      agentTexts: new Set<string>(),
      expiresAtMs,
    };
    current.expiresAtMs = Math.max(current.expiresAtMs, expiresAtMs);
    if (itemType === "user_message") {
      current.userTexts.add(normalized);
    } else {
      current.agentTexts.add(normalized);
    }
    this.localSyncSuppress.set(codexThreadId, current);
  }

  private shouldSuppressLocalSyncEvent(
    codexThreadId: string,
    itemType: "user_message" | "agent_message",
    text: string,
  ): boolean {
    const entry = this.localSyncSuppress.get(codexThreadId);
    if (!entry) return false;
    const now = Date.now();
    if (entry.expiresAtMs <= now) {
      this.localSyncSuppress.delete(codexThreadId);
      return false;
    }
    const normalized = this.normalizeSuppressionText(text);
    if (!normalized) return false;
    if (itemType === "user_message") return entry.userTexts.has(normalized);
    return entry.agentTexts.has(normalized);
  }

  private async runExternalSyncCycle(reason: string): Promise<void> {
    if (!this.externalSyncEnabled) return;
    if (this.externalSyncRunning) return;
    this.externalSyncRunning = true;
    try {
      const threadIds = this.db.listActiveCodexThreadIds();
      const collected: Array<{
        codexThreadId: string;
        contextKeys: string[];
        latestLineNo: number;
        event: { eventId: string; itemType: "user_message" | "agent_message"; text: string; lineNo: number; occurredAtMs: number | null };
      }> = [];

      for (const threadId of threadIds) {
        const chunk = this.collectExternalEventsForThread(reason, threadId);
        if (!chunk) continue;
        collected.push(...chunk.events.map((event) => ({
          codexThreadId: chunk.codexThreadId,
          contextKeys: chunk.contextKeys,
          latestLineNo: chunk.latestLineNo,
          event: {
            ...event,
            text: event.itemType === "user_message"
              ? truncateExternalUserMessage(event.text, appConfig.externalSyncUserMaxChars)
              : event.text,
          },
        })));
      }

      if (collected.length > 0) {
        collected.sort((a, b) => {
          const at = a.event.occurredAtMs ?? 0;
          const bt = b.event.occurredAtMs ?? 0;
          if (at !== bt) return at - bt;
          return a.event.lineNo - b.event.lineNo;
        });
      }

      const cap = appConfig.externalSyncMaxBurst;
      const dropCount = Math.max(0, collected.length - cap);
      if (dropCount > 0) {
        for (let i = 0; i < dropCount; i += 1) {
          const dropped = collected[i]!;
          this.db.markExternalSyncEventSeen(dropped.codexThreadId, dropped.event.eventId);
        }
        this.logger.info(
          { reason, dropped: dropCount, sent: cap },
          "external sync global cap applied",
        );
      }
      const target = dropCount > 0 ? collected.slice(dropCount) : collected;
      for (const row of target) {
        await this.broadcastExternalEventToContexts(
          row.codexThreadId,
          row.contextKeys,
          row.event.itemType,
          row.event.text,
        );
        this.db.markExternalSyncEventSeen(row.codexThreadId, row.event.eventId);
      }

      const latestByThread = new Map<string, number>();
      for (const row of collected) {
        const prev = latestByThread.get(row.codexThreadId) ?? 0;
        if (row.latestLineNo > prev) latestByThread.set(row.codexThreadId, row.latestLineNo);
      }
      for (const [threadId, latestLineNo] of latestByThread.entries()) {
        this.db.setExternalSyncCursor(threadId, latestLineNo);
      }
    } finally {
      this.externalSyncRunning = false;
    }
  }

  private collectExternalEventsForThread(
    reason: string,
    codexThreadId: string,
  ): {
    codexThreadId: string;
    contextKeys: string[];
    latestLineNo: number;
    events: Array<{
      eventId: string;
      itemType: "user_message" | "agent_message";
      text: string;
      lineNo: number;
      occurredAtMs: number | null;
    }>;
  } | null {
    const cursor = this.db.getExternalSyncCursor(codexThreadId);
    const read = readCodexThreadEventsSinceLine(codexThreadId, cursor ?? 0);
    if (!read.sourceFound) return null;

    if (cursor === null) {
      this.db.setExternalSyncCursor(codexThreadId, read.latestLineNo);
      this.logger.info(
        { reason, codexThreadId, latestLineNo: read.latestLineNo },
        "external sync anchored thread (future-only)",
      );
      return null;
    }

    if (read.latestLineNo < cursor) {
      this.db.setExternalSyncCursor(codexThreadId, read.latestLineNo);
      this.logger.warn(
        { reason, codexThreadId, prevLineNo: cursor, latestLineNo: read.latestLineNo },
        "external sync cursor moved backward; re-anchored to latest",
      );
      return null;
    }

    if (read.events.length === 0) {
      if (read.latestLineNo !== cursor) {
        this.db.setExternalSyncCursor(codexThreadId, read.latestLineNo);
      }
      return null;
    }

    const contextKeys = this.db.listContextKeysByCodexThreadId(codexThreadId);
    if (contextKeys.length === 0) {
      this.db.setExternalSyncCursor(codexThreadId, read.latestLineNo);
      return null;
    }

    const pendingEvents = read.events.filter((event) => {
      if (this.db.hasExternalSyncEventSeen(codexThreadId, event.eventId)) return false;
      if (this.shouldSuppressLocalSyncEvent(codexThreadId, event.itemType, event.text)) {
        this.db.markExternalSyncEventSeen(codexThreadId, event.eventId);
        return false;
      }
      return true;
    });
    if (pendingEvents.length === 0) {
      this.db.setExternalSyncCursor(codexThreadId, read.latestLineNo);
      return null;
    }
    return {
      codexThreadId,
      contextKeys,
      latestLineNo: read.latestLineNo,
      events: pendingEvents,
    };
  }

  private async broadcastExternalEventToContexts(
    codexThreadId: string,
    contextKeys: string[],
    itemType: "user_message" | "agent_message",
    text: string,
  ): Promise<void> {
    const role = itemType === "user_message" ? "User" : "Codex";
    const chunks = splitIntoChunks(text, EXTERNAL_SYNC_PREVIEW_MAX);
    for (const contextKey of contextKeys) {
      const channel = await this.resolveSendableChannelByContextKey(contextKey);
      if (!channel) continue;
      const header = `[External ${role}] codex_session: ${codexThreadId}`;
      for (let i = 0; i < chunks.length; i += 1) {
        const body = chunks[i];
        if (i === 0) {
          await channel.send(`${header}\n${body}`);
          continue;
        }
        await channel.send(`[External ${role} cont.${i + 1}]\n${body}`);
      }
    }
  }

  private async resolveSendableChannelByContextKey(
    contextKey: string,
  ): Promise<SendableChannels | null> {
    const parts = contextKey.split(":");
    if (parts.length !== 2) return null;
    const channelId = parts[1];
    if (!channelId) return null;
    const fetched = await this.client.channels.fetch(channelId);
    if (!fetched || !fetched.isSendable()) return null;
    return fetched;
  }

  private async saveIncomingAttachments(msg: Message, sessionId: string): Promise<string[]> {
    if (msg.attachments.size === 0) return [];
    const root = resolve(appConfig.incomingAttachDir);
    const sessionDir = join(root, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    const saved: string[] = [];
    for (const attachment of msg.attachments.values()) {
      if (attachment.size > appConfig.incomingAttachMaxBytes) {
        this.logger.warn(
          {
            sessionId,
            name: attachment.name,
            size: attachment.size,
            limit: appConfig.incomingAttachMaxBytes,
          },
          "incoming attachment skipped: too large",
        );
        continue;
      }
      const safeName = sanitizeAttachmentFileName(
        attachment.name ?? `${attachment.id}.bin`,
      );
      const targetPath = resolve(
        join(sessionDir, `${Date.now()}_${attachment.id}_${safeName}`),
      );
      try {
        const res = await fetch(attachment.url);
        if (!res.ok) {
          this.logger.warn(
            {
              sessionId,
              name: attachment.name,
              status: res.status,
            },
            "incoming attachment download failed",
          );
          continue;
        }
        const ab = await res.arrayBuffer();
        const bytes = Buffer.from(ab);
        if (bytes.byteLength > appConfig.incomingAttachMaxBytes) {
          this.logger.warn(
            {
              sessionId,
              name: attachment.name,
              size: bytes.byteLength,
              limit: appConfig.incomingAttachMaxBytes,
            },
            "incoming attachment skipped after download: too large",
          );
          continue;
        }
        await writeFile(targetPath, bytes);
        saved.push(targetPath);
      } catch (err) {
        this.logger.warn(
          { err, sessionId, name: attachment.name },
          "incoming attachment save failed",
        );
      }
    }
    if (saved.length > 0) {
      this.logger.info(
        { sessionId, count: saved.length, paths: saved },
        "incoming attachments saved",
      );
    }
    return saved;
  }

  private cleanupIncomingAttachments(reason: string): void {
    const root = resolve(appConfig.incomingAttachDir);
    if (!existsSync(root)) return;
    const ttlMs = appConfig.incomingAttachTtlHours * 60 * 60 * 1000;
    const now = Date.now();
    let removed = 0;
    try {
      for (const sessionDir of readdirSync(root, { withFileTypes: true })) {
        if (!sessionDir.isDirectory()) continue;
        const sessionPath = join(root, sessionDir.name);
        for (const file of readdirSync(sessionPath, { withFileTypes: true })) {
          if (!file.isFile()) continue;
          const filePath = join(sessionPath, file.name);
          try {
            const st = statSync(filePath);
            if (now - st.mtimeMs < ttlMs) continue;
            rmSync(filePath, { force: true });
            removed += 1;
          } catch {
            // best effort cleanup
          }
        }
      }
    } catch (err) {
      this.logger.warn({ err, reason }, "incoming attachment cleanup failed");
      return;
    }
    if (removed > 0) {
      this.logger.info({ reason, removed }, "incoming attachment cleanup completed");
    }
  }

  private async handleAttachCommands(
    sendChannel: SendableChannels,
    paths: string[],
  ): Promise<void> {
    for (const rawPath of paths) {
      const filePath = rawPath.trim();
      if (!filePath) {
        await sendChannel.send(attachInvalidPath(this.locale));
        continue;
      }
      if (!isAbsolute(filePath)) {
        await sendChannel.send(attachAbsolutePathRequired(this.locale, filePath));
        continue;
      }
      if (!existsSync(filePath)) {
        await sendChannel.send(attachNotFound(this.locale, filePath));
        continue;
      }
      let size = 0;
      try {
        const st = statSync(filePath);
        if (!st.isFile()) {
          await sendChannel.send(attachNotFile(this.locale, filePath));
          continue;
        }
        size = st.size;
      } catch {
        await sendChannel.send(attachStatFailed(this.locale, filePath));
        continue;
      }
      if (size > ATTACH_MAX_BYTES) {
        await sendChannel.send(attachTooLarge(this.locale, filePath, size, ATTACH_MAX_BYTES));
        continue;
      }
      try {
        await sendChannel.send({ files: [filePath] });
      } catch {
        await sendChannel.send(attachUploadFailed(this.locale, filePath));
      }
    }
  }

  private getCodexSummaryHint(codexThreadId: string): string | null {
    const meta = resolveCodexSessionMetaByThreadId(codexThreadId);
    const summary = meta?.summary?.trim();
    if (!summary) return null;
    return summary.slice(0, 120);
  }

  private getUserFacingCodexSessionLabel(session: SessionRow): string {
    return session.codex_thread_id ?? notLinkedYet(this.locale);
  }

  private async sendMultilineReply(
    msg: Message,
    header: string,
    lines: string[],
    footer?: string,
  ): Promise<void> {
    const MAX = 1800;
    const blocks: string[] = [];
    let current = `${header}\n`;
    for (const line of lines) {
      const next = `${current}${line}\n`;
      if (next.length > MAX && current !== `${header}\n`) {
        blocks.push(current.trimEnd());
        current = `${header}\n${line}\n`;
      } else {
        current = next;
      }
    }
    if (footer) {
      const withFooter = `${current}${footer}`;
      if (withFooter.length <= MAX) {
        current = withFooter;
      } else {
        blocks.push(current.trimEnd());
        current = `${header}\n${footer}`;
      }
    }
    blocks.push(current.trimEnd());
    for (const block of blocks) {
      await msg.reply(block);
    }
  }
}
