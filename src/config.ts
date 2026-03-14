import { config as dotenv } from "dotenv";
import { z } from "zod";

dotenv();

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  ALLOWED_CHANNEL_IDS: z.string().min(1),
  ALLOWED_USER_IDS: z.string().optional().default(""),
  SQLITE_PATH: z.string().default("./data/app.db"),
  LOG_LEVEL: z.string().default("info"),
  CODEX_EXEC_TEMPLATE: z
    .string()
    .default("echo [MOCK CODEX][{sessionId}] {input}"),
  CODEX_MODE: z.enum(["cli", "template"]).default("cli"),
  CODEX_TIMEOUT_SEC: z.coerce.number().int().positive().default(1800),
  INCOMING_ATTACH_DIR: z.string().default("./data/incoming_attachments"),
  INCOMING_ATTACH_TTL_HOURS: z.coerce.number().int().positive().default(72),
  INCOMING_ATTACH_MAX_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  INSTANCE_LOCK_PORT: z.coerce.number().int().min(1024).max(65535).default(45991),
  EXTERNAL_SYNC_ENABLED: z.coerce.boolean().default(true),
  EXTERNAL_SYNC_POLL_SEC: z.coerce.number().int().min(5).max(300).default(15),
  EXTERNAL_SYNC_MAX_BURST: z.coerce.number().int().min(1).max(300).default(30),
  EXTERNAL_SYNC_USER_MAX_CHARS: z.coerce.number().int().min(50).max(10000).default(300),
});

const parsed = schema.parse(process.env);

export const appConfig = {
  discordToken: parsed.DISCORD_TOKEN,
  allowedChannelIds: new Set(
    parsed.ALLOWED_CHANNEL_IDS.split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  ),
  allowedUserIds: new Set(
    parsed.ALLOWED_USER_IDS.split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  ),
  sqlitePath: parsed.SQLITE_PATH,
  logLevel: parsed.LOG_LEVEL,
  codexExecTemplate: parsed.CODEX_EXEC_TEMPLATE,
  codexMode: parsed.CODEX_MODE,
  codexTimeoutSec: Math.min(parsed.CODEX_TIMEOUT_SEC, 3600),
  incomingAttachDir: parsed.INCOMING_ATTACH_DIR,
  incomingAttachTtlHours: parsed.INCOMING_ATTACH_TTL_HOURS,
  incomingAttachMaxBytes: parsed.INCOMING_ATTACH_MAX_BYTES,
  instanceLockPort: parsed.INSTANCE_LOCK_PORT,
  externalSyncEnabled: parsed.EXTERNAL_SYNC_ENABLED,
  externalSyncPollSec: parsed.EXTERNAL_SYNC_POLL_SEC,
  externalSyncMaxBurst: parsed.EXTERNAL_SYNC_MAX_BURST,
  externalSyncUserMaxChars: parsed.EXTERNAL_SYNC_USER_MAX_CHARS,
  listDefaultLimit: 20,
  queueLimitPerSession: 20,
  progressIntervalSec: 30,
  messageChunkSize: 1800,
};
