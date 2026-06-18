import { config as dotenv } from "dotenv";
import { z } from "zod";
import { resolve } from "node:path";

dotenv();

function envBoolean(defaultValue: boolean) {
  return z.string().optional().transform((value, ctx) => {
    if (value == null || value.trim() === "") return defaultValue;
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expected boolean value: true/false, 1/0, yes/no, or on/off",
    });
    return z.NEVER;
  });
}

const schema = z.object({
  APP_LOCALE: z.enum(["ja", "en"]).optional(),
  DISCORD_TOKEN: z.string().min(1),
  ALLOWED_CHANNEL_IDS: z.string().min(1),
  ALLOWED_USER_IDS: z.string().optional().default(""),
  SQLITE_PATH: z.string().default("./data/app.db"),
  DEFAULT_AGENT_WORKDIR_ROOT: z.string().default("./workspaces"),
  LOG_LEVEL: z.string().default("info"),
  CODEX_EXEC_TEMPLATE: z
    .string()
    .default("echo [MOCK CODEX][{sessionId}] {input}"),
  CODEX_MODE: z.enum(["cli", "template"]).default("cli"),
  CODEX_TIMEOUT_SEC: z.coerce.number().int().positive().default(1800),
  CODEX_CLOSE_GRACE_SEC: z.coerce.number().int().min(0).max(300).default(10),
  INCOMING_ATTACH_DIR: z.string().default("./data/incoming_attachments"),
  ATTACH_READ_DIRS: z.string().optional().default(""),
  INCOMING_ATTACH_TTL_HOURS: z.coerce.number().int().positive().default(72),
  INCOMING_ATTACH_MAX_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
  INSTANCE_LOCK_PORT: z.coerce.number().int().min(1024).max(65535).default(45991),
  EXTERNAL_SYNC_ENABLED: envBoolean(true),
  EXTERNAL_SYNC_POLL_SEC: z.coerce.number().int().min(5).max(300).default(15),
  EXTERNAL_SYNC_MAX_BURST: z.coerce.number().int().min(1).max(300).default(30),
  EXTERNAL_SYNC_USER_MAX_CHARS: z.coerce.number().int().min(50).max(10000).default(300),
  SHOW_FINAL_STREAM_LOG: envBoolean(true),
  FORCE_LEGACY_FULL_ACCESS: envBoolean(false),
});

const parsed = schema.parse(process.env);

function parseAttachReadDirs(raw: string, incomingAttachDir: string): string[] {
  const values = raw
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean);
  values.push(incomingAttachDir);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const v of values) {
    const normalized = resolve(v);
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
  }
  // Prefer shorter (parent) paths first; skip descendants if parent is already present.
  unique.sort((a, b) => a.length - b.length);
  const kept: string[] = [];
  for (const candidate of unique) {
    const c = candidate.toLowerCase();
    const covered = kept.some((parent) => {
      const p = parent.toLowerCase();
      return c === p || c.startsWith(`${p}\\`) || c.startsWith(`${p}/`);
    });
    if (!covered) kept.push(candidate);
  }
  return kept;
}

export const appConfig = {
  appLocale: parsed.APP_LOCALE,
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
  defaultAgentWorkdirRoot: parsed.DEFAULT_AGENT_WORKDIR_ROOT,
  logLevel: parsed.LOG_LEVEL,
  codexExecTemplate: parsed.CODEX_EXEC_TEMPLATE,
  codexMode: parsed.CODEX_MODE,
  codexTimeoutSec: Math.min(parsed.CODEX_TIMEOUT_SEC, 3600),
  codexCloseGraceSec: parsed.CODEX_CLOSE_GRACE_SEC,
  incomingAttachDir: parsed.INCOMING_ATTACH_DIR,
  attachReadDirs: parseAttachReadDirs(parsed.ATTACH_READ_DIRS, parsed.INCOMING_ATTACH_DIR),
  incomingAttachTtlHours: parsed.INCOMING_ATTACH_TTL_HOURS,
  incomingAttachMaxBytes: parsed.INCOMING_ATTACH_MAX_BYTES,
  instanceLockPort: parsed.INSTANCE_LOCK_PORT,
  externalSyncEnabled: parsed.EXTERNAL_SYNC_ENABLED,
  externalSyncPollSec: parsed.EXTERNAL_SYNC_POLL_SEC,
  externalSyncMaxBurst: parsed.EXTERNAL_SYNC_MAX_BURST,
  externalSyncUserMaxChars: parsed.EXTERNAL_SYNC_USER_MAX_CHARS,
  showFinalStreamLog: parsed.SHOW_FINAL_STREAM_LOG,
  forceLegacyFullAccess: parsed.FORCE_LEGACY_FULL_ACCESS,
  listDefaultLimit: 20,
  queueLimitPerSession: 20,
  progressIntervalSec: 30,
  messageChunkSize: 1800,
};
