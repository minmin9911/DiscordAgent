import {
  ChannelType,
  Client,
  GatewayIntentBits,
  type GuildMember,
  type Message,
} from "discord.js";
import pino from "pino";
import { AppDb } from "./db.js";
import { SessionService } from "./sessionService.js";
import { ExecutionManager } from "./executionManager.js";
import { maskSecrets } from "./mask.js";
import { CodexAdapter } from "./codexAdapter.js";
import { appConfig } from "./config.js";
import { APP_NAME, getBuildLabel } from "./buildInfo.js";
import { resolveWorkingDirectoryFromThreadId } from "./codexSessionMeta.js";

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
    `${APP_NAME} コマンドリファレンス`,
    `build: ${build}`,
    "",
    "[基本]",
    "- 通常メッセージ: 現在セッションに実行",
    "- !ask <指示>: 明示的に実行",
    "- !help: このリファレンスを表示",
    "",
    "[セッション]",
    "- !session new [name]",
    "  新規セッションを作成して現在チャンネルに紐付けます。",
    "- !session list [query]",
    "  セッション一覧を表示します（No.付き）。queryは name+summary を検索します。",
    "- !session switch <id|name|no>",
    "  別セッションへ切替します。name重複時は候補から id/no で再指定します。",
    "- !session connect <codex_thread_id>",
    "  既存のCodex thread IDを現在チャンネルへ紐付けます。",
    "- !session <codex_thread_id>",
    "  connect の短縮記法です。",
    "- !session current",
    "  現在アクティブなセッション状態を表示します。",
    "- !session help",
    "  セッション関連のヘルプを表示します（!help と同内容）。",
    "",
    "[注意]",
    "- Botはホワイトリストに登録されたチャンネルのみ反応します。",
    "- 返信には session: <id> (<name>) を含みます。",
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
      const first = this.processedMessageIds.values().next().value as string | undefined;
      if (first) this.processedMessageIds.delete(first);
    }
    if (!msg.guildId) {
      await msg.reply("ERR_DM_DISABLED: 初期リリースではDMは無効です。");
      return;
    }
    if (!this.isAllowedChannel(msg)) return;
    if (msg.channel.type === ChannelType.DM) {
      await msg.reply("ERR_DM_DISABLED");
      return;
    }

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
    if (content.startsWith("!session ")) {
      await this.handleSessionCommand(msg, content.slice("!session ".length).trim());
      return;
    }
    if (content.startsWith("!ask ")) {
      await this.handleExecutionMessage(msg, content.slice("!ask ".length).trim());
      return;
    }
    if (content.startsWith("!")) {
      await msg.reply("不明なコマンドです。コマンド一覧と使い方は !help を確認してください。");
      return;
    }
    await this.handleExecutionMessage(msg, content);
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
      const created = this.sessionService.createAndBindSession({
        contextKey,
        requesterId: msg.author.id,
        name: arg || undefined,
      });
      await msg.reply(`session created: ${created.id} (${created.name})`);
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
      // UUIDっぽい値は id 扱い、それ以外は name 扱いにする。
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
        ? (resolveWorkingDirectoryFromThreadId(current.codex_thread_id) ?? "(unknown)")
        : "(not linked yet)";
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

        const chunks = splitIntoChunks(output, appConfig.messageChunkSize);
        await sendChannel.send(`session: ${session.id} (${session.name})`);
        for (let i = 0; i < chunks.length; i += 1) {
          await sendChannel.send(`(${i + 1}/${chunks.length}) ${chunks[i]}`);
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
}
