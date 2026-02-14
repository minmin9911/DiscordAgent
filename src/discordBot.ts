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
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import pino from "pino";
import { AppDb } from "./db.js";
import { SessionService } from "./sessionService.js";
import { ExecutionManager } from "./executionManager.js";
import { maskSecrets } from "./mask.js";
import { CodexAdapter } from "./codexAdapter.js";
import { appConfig } from "./config.js";
import { APP_NAME, getBuildLabel } from "./buildInfo.js";
import {
  resolveWorkingDirectoryFromThreadId,
  searchCodexSessions,
  type CodexSessionMeta,
} from "./codexSessionMeta.js";
import { ATTACH_MAX_BYTES, extractAttachPaths } from "./attachPolicy.js";

const UNREAD_RECOVERY_LIMIT = 3;
const UNREAD_RECOVERY_POLL_MS = 3 * 60 * 1000;
type RecoveryChannel = TextChannel | NewsChannel | ThreadChannel;

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

function buildCommandReference(): string {
  const build = getBuildLabel();
  return [
    `${APP_NAME} Command Reference`,
    `build: ${build}`,
    "",
    "[Basic]",
    "- Normal message: run on current session",
    "- !ask <instruction>: run instruction",
    "- !help: show this reference",
    "",
    "[Codex Search]",
    "- !codex <query>",
    "  Search ~/.codex/sessions and show candidates",
    "- !codex pick <no>",
    "  Select one candidate from the last search result",
    "",
    "[Session]",
    "- !session new [name]",
    "- !session connect <codex_thread_id>",
    "- !session <codex_thread_id>",
    "- !session list [query]",
    "- !session switch <id|name|no>",
    "- !session current",
    "- !session help",
    "",
    "[Notes]",
    "- Replies include: session: <id> (<name>)",
    "- !attach is reserved for AI output and blocked for user direct input",
  ].join("\n");
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
  private readonly processedMessageIds = new Set<string>();
  private readonly codexSearchCache = new Map<string, CodexSessionMeta[]>();
  private recoveringUnread = false;

  constructor(params: { db: AppDb; logger: pino.Logger }) {
    this.db = params.db;
    this.logger = params.logger;
    this.sessionService = new SessionService(this.db);
    this.codex = new CodexAdapter(
      appConfig.codexMode,
      appConfig.codexExecTemplate,
      appConfig.codexTimeoutSec * 1000,
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
      this.recoverUnreadForAllContexts("client_ready").catch((err) => {
        this.logger.error({ err }, "unread recovery on ready failed");
      });
      setInterval(() => {
        this.recoverUnreadForAllContexts("polling").catch((err) => {
          this.logger.warn({ err }, "unread recovery by polling failed");
        });
      }, UNREAD_RECOVERY_POLL_MS);
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
      await msg.reply("ERR_DM_DISABLED: このBotはDMでは使用できません。");
      return;
    }
    if (!this.isAllowedChannel(msg)) return;
    if (msg.channel.type === ChannelType.DM) {
      await msg.reply("ERR_DM_DISABLED");
      return;
    }

    const contextKey = this.sessionService.buildContextKey(msg.guildId, msg.channelId);
    try {
      const content = msg.content.trim();
      if (!content) return;
      this.logger.info(
        {
          guildId: msg.guildId,
          channelId: msg.channelId,
          messageId: msg.id,
          userId: msg.author.id,
        },
        "message received",
      );
      if (content === "!help") {
        await msg.reply(buildCommandReference());
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
        await this.handleExecutionMessage(msg, content.slice("!ask ".length).trim());
        return;
      }
      if (content.startsWith("!attach ")) {
        await msg.reply("ERR_ATTACH_DISABLED_FOR_USER");
        return;
      }
      if (content.startsWith("!")) {
        await msg.reply(
          `Syntax Error: 不明なコマンドです。\n\n${buildCommandReference()}`,
        );
        return;
      }
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
    const lines = [`未読回収: ${toProcess.length}件を処理しました。`];
    if (dropped > 0) {
      lines.push(
        `キュー上限(${UNREAD_RECOVERY_LIMIT}件)超過により ${dropped}件を破棄しました。`,
      );
    }
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

  private async handleCodexCommand(msg: Message, body: string): Promise<void> {
    const arg = body.trim();
    if (!arg) {
      await msg.reply("usage: !codex <query> | !codex pick <no>");
      return;
    }

    const contextKey = this.sessionService.buildContextKey(msg.guildId!, msg.channelId);
    const cacheKey = this.buildCodexSearchCacheKey(msg.author.id, contextKey);
    const pickMatch = arg.match(/^pick\s+(\d+)$/i);
    if (pickMatch) {
      const no = Number(pickMatch[1]);
      const cached = this.codexSearchCache.get(cacheKey) ?? [];
      if (!Number.isInteger(no) || no <= 0 || no > cached.length) {
        await msg.reply("ERR_CODEX_PICK_NOT_FOUND");
        return;
      }
      const selected = cached[no - 1];
      const member = msg.member as GuildMember | null;
      const connectRes = this.sessionService.connectCodexThread({
        contextKey,
        requesterId: msg.author.id,
        member,
        codexThreadId: selected.threadId,
      });
      if (!connectRes.ok) {
        await msg.reply(connectRes.code);
        return;
      }
      const action = connectRes.created ? "session linked" : "session switched";
      await msg.reply(
        `${action}: ${connectRes.session.id} (${connectRes.session.name}) thread=${selected.threadId}`,
      );
      await msg.reply(`session: ${connectRes.session.id} (${connectRes.session.name})`);
      return;
    }

    const results = searchCodexSessions(arg, appConfig.listDefaultLimit);
    this.codexSearchCache.set(cacheKey, results);
    if (results.length === 0) {
      await msg.reply("codex sessions (max 20)\n(no matches)");
      return;
    }
    const lines = results.map((s, i) => {
      const cwd = s.cwd ?? "(unknown)";
      const summary = s.summary?.replace(/\s+/g, " ").slice(0, 60) ?? "(no summary)";
      return `${i + 1} | ${s.threadId} | ${this.formatDateTime(s.updatedAtMs)} | ${cwd} | ${summary}`;
    });
    await msg.reply(
      `codex sessions (max 20)\n${lines.join("\n")}\npick: !codex pick <no>`,
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
      await msg.reply(buildCommandReference());
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
        await msg.reply(`session switched: ${localRes.session.id} (${localRes.session.name})`);
        await msg.reply(`session: ${localRes.session.id} (${localRes.session.name})`);
        return;
      }
      const connectRes = this.sessionService.connectCodexThread({
        contextKey,
        requesterId: msg.author.id,
        member,
        codexThreadId: shorthandId,
      });
      if (!connectRes.ok) {
        await msg.reply(connectRes.code);
        return;
      }
      if (connectRes.created) {
        await msg.reply(
          `session linked: ${connectRes.session.id} (${connectRes.session.name}) thread=${shorthandId}`,
        );
      } else {
        await msg.reply(
          `session switched: ${connectRes.session.id} (${connectRes.session.name}) thread=${shorthandId}`,
        );
      }
      await msg.reply(
        `session: ${connectRes.session.id} (${connectRes.session.name})`,
      );
      return;
    }

    if (sub === "connect") {
      if (!arg || !isUuidLike(arg)) {
        await msg.reply("usage: !session connect <codex_thread_id>");
        return;
      }
      const connectRes = this.sessionService.connectCodexThread({
        contextKey,
        requesterId: msg.author.id,
        member,
        codexThreadId: arg,
      });
      if (!connectRes.ok) {
        await msg.reply(connectRes.code);
        return;
      }
      if (connectRes.created) {
        await msg.reply(
          `session linked: ${connectRes.session.id} (${connectRes.session.name}) thread=${arg}`,
        );
      } else {
        await msg.reply(
          `session switched: ${connectRes.session.id} (${connectRes.session.name}) thread=${arg}`,
        );
      }
      await msg.reply(`session: ${connectRes.session.id} (${connectRes.session.name})`);
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
      await msg.reply(`session created: ${created.id} (${created.name})`);
      if (inheritedWorkingDirectory) {
        await msg.reply(`working_directory inherited: ${inheritedWorkingDirectory}`);
      }
      await msg.reply(`session: ${created.id} (${created.name})`);
      return;
    }

    if (sub === "list") {
      const sessions = this.sessionService.listSessions(
        arg || undefined,
        appConfig.listDefaultLimit,
      );
      this.sessionService.cacheListResult(msg.author.id, contextKey, sessions);
      if (sessions.length === 0) {
        await msg.reply("sessions (max 20)\n(no sessions)");
        return;
      }
      const lines = sessions.map(
        (s, i) =>
          `${i + 1} | ${s.id} | ${s.name} | ${s.status} | ${s.last_used_at}`,
      );
      await msg.reply(`sessions (max 20)\n${lines.join("\n")}`);
      return;
    }

    if (sub === "switch") {
      if (!arg) {
        await msg.reply("usage: !session switch <id|name|no>");
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
        await msg.reply(`session switched: ${res.session.id} (${res.session.name})`);
        await msg.reply(`session: ${res.session.id} (${res.session.name})`);
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
        if (!res.ok) {
          await msg.reply(res.code);
          return;
        }
        await msg.reply(`session switched: ${res.session.id} (${res.session.name})`);
        await msg.reply(`session: ${res.session.id} (${res.session.name})`);
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
            `ERR_SESSION_NAME_AMBIGUOUS\n候補:\n${lines.join("\n")}\n再指定: !session switch <id|no>`,
          );
          return;
        }
        await msg.reply(res.code);
        return;
      }
      await msg.reply(`session switched: ${res.session.id} (${res.session.name})`);
      await msg.reply(`session: ${res.session.id} (${res.session.name})`);
      return;
    }

    if (sub === "current") {
      const current = this.sessionService.getCurrentSession(contextKey);
      if (!current) {
        await msg.reply("ERR_ACTIVE_SESSION_NOT_FOUND");
        return;
      }
      const runtime = this.manager.getRuntimeState(current.id);
      const workingDirectory = current.codex_thread_id
        ? (
            resolveWorkingDirectoryFromThreadId(current.codex_thread_id)
            ?? current.preferred_working_directory
            ?? "(unknown)"
          )
        : (current.preferred_working_directory ?? "(not linked yet)");
      const lines = [
        `session_id: ${current.id}`,
        `codex_thread_id: ${current.codex_thread_id ?? "(not linked yet)"}`,
        `working_directory: ${workingDirectory}`,
        `name: ${current.name}`,
        `status: ${current.status}`,
        `queue_length: ${runtime.queueLength}`,
        `last_used_at: ${current.last_used_at}`,
      ];
      if (runtime.runningSince) lines.push(`running_since: ${runtime.runningSince}`);
      await msg.reply(lines.join("\n"));
      return;
    }

    await msg.reply("usage: !session <new|list|switch|connect|current|help|<codex_thread_id>> ...");
  }

  private async handleExecutionMessage(msg: Message, content: string): Promise<void> {
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
    this.logger.info(
      {
        executionId,
        sessionId: session.id,
        channelId: msg.channelId,
        userId: msg.author.id,
      },
      "execution queued",
    );

    const result = await this.manager.enqueue({
      executionId,
      sessionId: session.id,
      text: content,
      maxRetries: 1,
      onQueued: async (position) => {
        const text = `queued (#${position}) session: ${session.id} (${session.name})`;
        try {
          await msg.reply(text);
        } catch {
          await sendChannel.send(text);
        }
      },
      onProgress: async (elapsedSec, queueLength) => {
        const progressText = `running... elapsed=${elapsedSec}s queue=${queueLength} session: ${session.id} (${session.name})`;
        if (!progressMessageId) {
          const sent = await sendChannel.send(progressText);
          progressMessageId = sent.id;
          return;
        }
        try {
          const prev = await sendChannel.messages.fetch(progressMessageId);
          await prev.edit(progressText);
        } catch {
          const sent = await sendChannel.send(progressText);
          progressMessageId = sent.id;
        }
      },
      run: async () => {
        this.db.updateExecutionStatus(executionId, "running", { setStarted: true });
        this.logger.info(
          { executionId, sessionId: session.id, codexThreadId: session.codex_thread_id },
          "execution started",
        );
        const runResult = await this.codex.run({
          prompt: content,
          sessionId: session.id,
          codexThreadId: session.codex_thread_id,
          preferredWorkingDirectory: session.preferred_working_directory,
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
        if (runResult.threadId && !session.codex_thread_id) {
          this.db.setSessionCodexThreadId(session.id, runResult.threadId);
          session.codex_thread_id = runResult.threadId;
          this.logger.info(
            { executionId, sessionId: session.id, threadId: runResult.threadId },
            "codex thread bound",
          );
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
        return { status: "success" as const, output: runResult.output };
      },
      onFinish: async ({ status, output, retries, errorCode }) => {
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
        const body = parsed.cleanedOutput || "(no output)";
        const chunks = splitIntoChunks(body, appConfig.messageChunkSize);
        await sendChannel.send(`session: ${session.id} (${session.name})`);
        for (let i = 0; i < chunks.length; i += 1) {
          await sendChannel.send(`(${i + 1}/${chunks.length}) ${chunks[i]}`);
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

  private async handleAttachCommands(
    sendChannel: SendableChannels,
    paths: string[],
  ): Promise<void> {
    for (const rawPath of paths) {
      const filePath = rawPath.trim();
      if (!filePath) {
        await sendChannel.send("ERR_ATTACH_INVALID_PATH: empty");
        continue;
      }
      if (!isAbsolute(filePath)) {
        await sendChannel.send(`ERR_ATTACH_ABSOLUTE_PATH_REQUIRED: ${filePath}`);
        continue;
      }
      if (!existsSync(filePath)) {
        await sendChannel.send(`ERR_ATTACH_NOT_FOUND: ${filePath}`);
        continue;
      }
      let size = 0;
      try {
        const st = statSync(filePath);
        if (!st.isFile()) {
          await sendChannel.send(`ERR_ATTACH_NOT_FILE: ${filePath}`);
          continue;
        }
        size = st.size;
      } catch {
        await sendChannel.send(`ERR_ATTACH_STAT_FAILED: ${filePath}`);
        continue;
      }
      if (size > ATTACH_MAX_BYTES) {
        await sendChannel.send(
          `ERR_ATTACH_TOO_LARGE: ${filePath} (${size} bytes > ${ATTACH_MAX_BYTES} bytes)`,
        );
        continue;
      }
      try {
        await sendChannel.send({ files: [filePath] });
      } catch {
        await sendChannel.send(`ERR_ATTACH_UPLOAD_FAILED: ${filePath}`);
      }
    }
  }
}
