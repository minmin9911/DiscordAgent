import type { ModelCatalogItem } from "./modelCatalog.js";

export type AppLocale = "ja" | "en";

export type UsageLimitStatus = {
  planType: string | null;
  primaryUsedPercent: number | null;
  primaryWindowMinutes: number | null;
  primaryResetsAt: number | null;
  secondaryUsedPercent: number | null;
  secondaryWindowMinutes: number | null;
  secondaryResetsAt: number | null;
};

type LimitLeftInfo = {
  leftPercent: number;
  label: string;
  windowMinutes: number | null;
  resetsAt: number | null;
};

export function resolveAppLocale(explicitLocale: string | null | undefined): AppLocale {
  if (explicitLocale === "ja" || explicitLocale === "en") return explicitLocale;
  const runtimeLocale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
  return runtimeLocale.startsWith("en") ? "en" : "ja";
}

export function buildCommandReference(locale: AppLocale, build: string, appName: string): string {
  if (locale === "en") {
    return [
      `${appName} Command Reference`,
      `build: ${build}`,
      "",
      "## Basic",
      "- !help  Show this list",
      "- !help agent  Send DiscordAgent command guidance to the agent",
      "- !ask <prompt>  Send a prompt to Codex (a normal message also works)",
      "- !queue  Show running and queued work",
      "- !queue stopall  Emergency-stop all queues",
      "- !queue fix  Repair orphaned executions",
      "- !sync [on|off|reset]  Show or change external sync",
      "",
      "## Sessions",
      "- !session new [name]  Start a new session",
      "- !session current  Show current settings and queue",
      "- !session workdir set <absolute_path>  Override the working directory",
      "- !session workdir clear  Clear the override",
      "- !codex [query]  Search Codex threads",
      "- !codex pick <no>  Bind a search result by number",
      "- !codex session <UUID>  Bind by UUID",
      "- !model [no]  List or switch models (0 = Codex config)",
      "- !effort [no]  List or switch reasoning effort (0 = Codex config)",
      "",
      "## Permissions",
      "- !sandbox on|off  Toggle the sandbox",
      "- !sandbox dir add <absolute_path>  Allow an extra directory",
      "- !sandbox dir remove <absolute_path>  Remove an allowed directory",
      "- !sandbox dir list / !sandbox dir clear  List or remove all extra directories",
      "- !ok [minutes] [prompt]  Grant access once or for a duration",
      "- !ng  Cancel pending approval or temporary access",
      "",
      "## Triggers",
      "- !trigger add daily HH:mm <prompt>",
      "- !trigger add weekly Mon,Wed HH:mm <prompt>",
      "- !trigger add monthly <day(1-31)> HH:mm <prompt>",
      "- !trigger add monthly <1-4|last> <Mon|Tue|...> HH:mm <prompt>",
      "- !trigger add at YYYY-MM-DD HH:mm <prompt>",
      "- !trigger list [full]  List triggers",
      "- !trigger show <id>  Show details",
      "- !trigger edit <id> <prompt>  Change the prompt",
      "- !trigger stop <id> / !trigger delete <id>  Stop or delete",
      "- !trigger env show <id> / !trigger env clear <id>  Show or clear overrides",
      "- !trigger env set workdir <id> <absolute_path>",
      "- !trigger env set sandbox <id> <on|off>",
    ].join("\n");
  }

  return [
    `${appName} Command Reference`,
    `build: ${build}`,
    "",
    "## 基本",
    "- !help  この一覧",
    "- !help agent  AgentにDiscordAgent専用コマンドを教える",
    "- !ask <指示>  Codexへ送信（通常投稿でも可）",
    "- !queue  実行・待機状況",
    "- !queue stopall  全キューを緊急停止",
    "- !queue fix  孤児状態の実行を修復",
    "- !sync [on|off|reset]  外部同期の確認・変更",
    "",
    "## セッション",
    "- !session new [name]  新しいセッション",
    "- !session current  現在の設定とキュー",
    "- !session workdir set <絶対パス>  作業フォルダを上書き",
    "- !session workdir clear  上書きを解除",
    "- !codex [検索語]  Codexスレッドを検索",
    "- !codex pick <番号>  検索結果から割り当て",
    "- !codex session <UUID>  UUIDで割り当て",
    "- !model [番号]  モデル一覧・切替（0=Codex設定）",
    "- !effort [番号]  推論量一覧・切替（0=Codex設定）",
    "",
    "## 権限",
    "- !sandbox on|off  サンドボックスを切替",
    "- !sandbox dir add <絶対パス>  追加許可フォルダを登録",
    "- !sandbox dir remove <絶対パス>  登録を解除",
    "- !sandbox dir list / !sandbox dir clear  表示・全解除",
    "- !ok [分数] [指示]  1回または指定分数だけ権限を付与",
    "- !ng  承諾待ち・一時権限を取り消す",
    "",
    "## トリガー",
    "- !trigger add daily HH:mm <指示>",
    "- !trigger add weekly Mon,Wed HH:mm <指示>",
    "- !trigger add monthly <日(1-31)> HH:mm <指示>",
    "- !trigger add monthly <1-4|last> <Mon|Tue|...> HH:mm <指示>",
    "- !trigger add at YYYY-MM-DD HH:mm <指示>",
    "- !trigger list [full]  一覧",
    "- !trigger show <id>  詳細",
    "- !trigger edit <id> <指示>  指示を変更",
    "- !trigger stop <id> / !trigger delete <id>  停止・削除",
    "- !trigger env show <id> / !trigger env clear <id>  実行環境の表示・上書き解除",
    "- !trigger env set workdir <id> <絶対パス>",
    "- !trigger env set sandbox <id> <on|off>",
  ].join("\n");
}

export function dmDisabledVerbose(locale: AppLocale): string {
  return locale === "en"
    ? "ERR_DM_DISABLED: This bot cannot be used in DMs."
    : "ERR_DM_DISABLED: このBotはDMでは使用できません。";
}

export function syntaxUnknownCommand(locale: AppLocale): string {
  return locale === "en"
    ? "Syntax Error: Unknown command. Use !help to see available commands."
    : "不明なコマンドです。コマンド一覧は !help を参照してください。";
}

export function sessionHelpRedirect(locale: AppLocale): string {
  return locale === "en"
    ? "Use !help to see the command list."
    : "コマンド一覧は !help を参照してください。";
}

export function queuedMessage(_locale: AppLocale, position: number, label: string): string {
  void _locale;
  return `queued (#${position}) codex_session: ${label}`;
}

export function runningElapsedMessage(
  _locale: AppLocale,
  elapsedSec: number,
  queueLength: number,
  label: string,
): string {
  void _locale;
  return `running... elapsed=${elapsedSec}s queue=${queueLength} codex_session: ${label}`;
}

export function runningPhaseMessage(
  _locale: AppLocale,
  phase: "turn.started" | "agent_message",
  label: string,
): string {
  void _locale;
  return `running... phase=${phase} codex_session: ${label}`;
}

function formatLimitLeft(
  locale: AppLocale,
  usedPercent: number | null,
  windowMinutes: number | null,
  resetsAt: number | null,
): LimitLeftInfo | null {
  if (usedPercent == null) return null;
  const leftPercent = Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
  if (windowMinutes === 300) {
    return {
      leftPercent,
      label: locale === "en" ? "5h" : "5時間",
      windowMinutes,
      resetsAt,
    };
  }
  if (windowMinutes === 10080) {
    return {
      leftPercent,
      label: locale === "en" ? "weekly" : "週間",
      windowMinutes,
      resetsAt,
    };
  }
  return {
    leftPercent,
    label: `window${windowMinutes ?? "?"}m`,
    windowMinutes,
    resetsAt,
  };
}

function buildLimitInfos(locale: AppLocale, status: UsageLimitStatus): LimitLeftInfo[] {
  const primary = formatLimitLeft(
    locale,
    status.primaryUsedPercent,
    status.primaryWindowMinutes,
    status.primaryResetsAt,
  );
  const secondary = formatLimitLeft(
    locale,
    status.secondaryUsedPercent,
    status.secondaryWindowMinutes,
    status.secondaryResetsAt,
  );
  return [primary, secondary].filter((value): value is LimitLeftInfo => Boolean(value));
}

export function codexUsageStatusLine(
  locale: AppLocale,
  status: UsageLimitStatus,
  previousStatus?: UsageLimitStatus | null,
): string {
  const limitInfos = buildLimitInfos(locale, status);
  const previousLimitInfos = previousStatus ? buildLimitInfos(locale, previousStatus) : [];
  const parts = limitInfos.map((current) => {
    const previous = previousLimitInfos.find(
      (candidate) => candidate.windowMinutes === current.windowMinutes
        && candidate.resetsAt === current.resetsAt,
    );
    const value = previous
      ? `${previous.leftPercent}%→${current.leftPercent}%`
      : `${current.leftPercent}%`;
    return `\`${current.label}=${value}\``;
  });
  const resetsAtEpochSec = status.secondaryResetsAt ?? status.primaryResetsAt;
  if (resetsAtEpochSec != null) {
    const resetAt = new Date(resetsAtEpochSec * 1000);
    const formatted = new Intl.DateTimeFormat(
      locale === "en" ? "en-US" : "ja-JP",
      {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      },
    ).format(resetAt);
    parts.push(locale === "en" ? `reset=${formatted} JST` : `リセット=${formatted} JST`);
  }
  if (status.planType) {
    parts.push(`plan=${status.planType}`);
  }
  const prefix = locale === "en" ? "**Usage:**" : "**利用状況:**";
  const plainLine = `${prefix} ${parts.join(" ")}`;

  const leftPercents = limitInfos.map((v) => v.leftPercent);
  if (leftPercents.length === 0) return plainLine;
  const minLeft = Math.min(...leftPercents);
  if (minLeft > 10) return plainLine;

  const color = minLeft <= 5 ? 31 : 33;
  const ansiLine = `\u001b[1;${color}m${plainLine}\u001b[0m`;
  return `\`\`\`ansi\n${ansiLine}\n\`\`\``;
}

export function completeHeader(
  _locale: AppLocale,
  label: string,
  switchBlock: string,
  approvalBlock: string,
  settingsBlock: string,
  usageBlock: string,
  historyBlock: string,
): string {
  void _locale;
  return `codex_session: ${label}\n${switchBlock}${historyBlock}${approvalBlock}complete: body is sent in next message(s)\n${settingsBlock}${usageBlock}`.trimEnd();
}

export function usageModel(locale: AppLocale): string {
  return locale === "en"
    ? "usage: !model [no]"
    : "使い方: !model [no]";
}

export function modelSetDone(locale: AppLocale, modelLabel: string): string {
  return locale === "en"
    ? `model switched: ${modelLabel}`
    : `モデルを切り替えました: ${modelLabel}`;
}

export function modelWarningLine(
  locale: AppLocale,
  modelLabel: string | null,
  reasoningEffort: string | null,
): string {
  const values = [
    modelLabel ? `model=${modelLabel}` : "",
    reasoningEffort ? `reasoning=${reasoningEffort}` : "",
  ].filter(Boolean);
  const label = modelLabel && reasoningEffort
    ? (locale === "en" ? "[MODEL / REASONING WARNING]" : "[モデル・推論設定警告]")
    : modelLabel
      ? (locale === "en" ? "[MODEL WARNING]" : "[モデル警告]")
      : (locale === "en" ? "[REASONING WARNING]" : "[推論設定警告]");
  const plain = `${label} ${values.join(" | ")}`;
  const ansi = `\u001b[1;31m${plain}\u001b[0m`;
  return `\`\`\`ansi\n${ansi}\n\`\`\``;
}

export function usageReasoningEffort(locale: AppLocale): string {
  return locale === "en" ? "usage: !effort [no]" : "使い方: !effort [no]";
}

export function reasoningEffortSetDone(locale: AppLocale, label: string): string {
  return locale === "en"
    ? `reasoning effort set: ${label}`
    : `reasoning effort を設定しました: ${label}`;
}

export function reasoningEffortDefaultLabel(locale: AppLocale): string {
  return locale === "en" ? "default (Codex config)" : "default（Codex設定）";
}

export function reasoningEffortModelConflict(
  locale: AppLocale,
  modelLabel: string,
  effort: string,
): string {
  return locale === "en"
    ? `Cannot switch to ${modelLabel}: the current reasoning effort \`${effort}\` is not supported by that model. Change or reset it with \`!effort\` first.`
    : `${modelLabel} には現在の reasoning effort \`${effort}\` を指定できないため、モデルを切り替えませんでした。先に \`!effort\` で変更またはdefaultに戻してください。`;
}

export function reasoningEffortUnsupported(
  locale: AppLocale,
  effort: string,
  modelLabel: string,
): string {
  return locale === "en"
    ? `\`${effort}\` is not supported by ${modelLabel}. No setting was changed.`
    : `${modelLabel} は \`${effort}\` に対応していません。設定は変更していません。`;
}

export function modelListSourceLine(locale: AppLocale, sourcePath: string): string {
  return locale === "en"
    ? `model list source: ${sourcePath}`
    : `モデル一覧の定義: ${sourcePath}`;
}

export function modelListTitle(locale: AppLocale): string {
  return locale === "en" ? "model list" : "モデル一覧";
}

export function modelListPriceHeader(locale: AppLocale): string {
  return locale === "en"
    ? "Codex credits / 1M tokens: input / cached input / output"
    : "Codexクレジット / 100万トークン: 入力 / キャッシュ入力 / 出力";
}

export function formatModelCatalogLine(
  locale: AppLocale,
  index: number,
  item: ModelCatalogItem,
  currentModel: string,
  label: string,
): string {
  const currentMark = item.id === currentModel
    ? (locale === "en" ? " <= current" : " <= 使用中")
    : "";
  const disabledMark = item.disabled
    ? (locale === "en" ? " [disabled]" : " [無効]")
    : "";
  const description = locale === "en"
    ? (item.descriptionEn || item.descriptionJa || item.description)
    : (item.descriptionJa || item.descriptionEn || item.description);
  const credits = item.creditsPerMillion?.join(" / ");
  const details = [description, credits].filter(Boolean).join(" | ");
  return `${index} | ${label}${disabledMark}${currentMark}${details ? ` | ${details}` : ""}`;
}

export function permissionRetryPrompt(
  locale: AppLocale,
  reason: "permission" | "runtime" | "mixed" = "permission",
): string {
  if (locale === "en") {
    if (reason === "runtime") {
      return "Execution runtime error occurred. Reply `!ok` to retry once with full access, `!ok 10` to allow full access for 10 minutes, or `!ng` to discard.";
    }
    if (reason === "mixed") {
      return "Permission or execution runtime may be insufficient. Reply `!ok` to retry once with full access, `!ok 10` to allow full access for 10 minutes, or `!ng` to discard.";
    }
    return "Permission may be insufficient. Reply `!ok` to retry once with full access, `!ok 10` to allow full access for 10 minutes, or `!ng` to discard.";
  }
  if (reason === "runtime") {
    return "実行基盤エラーの可能性があります。`!ok` で1回だけ full access で再実行、`!ok 10` で10分間 full access を許可、`!ng` で破棄します。";
  }
  if (reason === "mixed") {
    return "権限不足または実行基盤エラーの可能性があります。`!ok` で1回だけ full access で再実行、`!ok 10` で10分間 full access を許可、`!ng` で破棄します。";
  }
  return "権限不足の可能性があります。`!ok` で1回だけ full access で再実行、`!ok 10` で10分間 full access を許可、`!ng` で破棄します。";
}

export function permissionRequestDiscarded(locale: AppLocale): string {
  return locale === "en"
    ? "permission request discarded"
    : "権限不足リクエストを破棄しました";
}

export function temporaryFullAccessDisabled(locale: AppLocale): string {
  return locale === "en"
    ? "temporary full access disabled"
    : "一時的な full access を解除しました";
}

export function permissionRequestNotFound(locale: AppLocale): string {
  return locale === "en"
    ? "no pending permission request"
    : "承認待ちのリクエストはありません";
}

export function permissionRequestBusy(locale: AppLocale): string {
  return locale === "en"
    ? "another execution is still running or queued for this session. wait until it finishes, then run !ok again."
    : "このセッションでは別の処理が実行中または待機中です。完了後に !ok を再実行してください。";
}

export function permissionGrantedReexecutePrompt(locale: AppLocale): string {
  return locale === "en"
    ? "Permission has been granted. Continue as needed."
    : "権限を付与しました。必要に応じて処理を続けてください。";
}

export function temporaryFullAccessEnabled(locale: AppLocale, minutes: number): string {
  return locale === "en"
    ? `temporary full access enabled for ${minutes} minute(s)`
    : `${minutes}分間 full access を許可しました`;
}

export function sandboxModeSet(locale: AppLocale, mode: "workspace-write" | "danger-full-access"): string {
  if (locale === "en") return `sandbox mode set: ${mode}`;
  return `sandbox mode を設定しました: ${mode}`;
}

export function usageSandbox(locale: AppLocale): string {
  if (locale === "en") {
    return [
      "usage:",
      "!sandbox on|off",
      "!sandbox dir add <absolute_path>",
      "!sandbox dir remove <absolute_path>",
      "!sandbox dir list",
      "!sandbox dir clear",
    ].join("\n");
  }
  return [
    "使い方:",
    "!sandbox on|off",
    "!sandbox dir add <absolute_path>",
    "!sandbox dir remove <absolute_path>",
    "!sandbox dir list",
    "!sandbox dir clear",
  ].join("\n");
}

export function sandboxDirListTitle(locale: AppLocale, codexThreadId: string): string {
  return locale === "en"
    ? `sandbox extra dirs | codex_thread_id=${codexThreadId}`
    : `sandbox 追加許可ディレクトリ | codex_thread_id=${codexThreadId}`;
}

export function sandboxDirListEmpty(locale: AppLocale): string {
  return locale === "en"
    ? "(no extra dirs)"
    : "（追加許可ディレクトリはありません）";
}

export function sandboxDirAdded(locale: AppLocale, path: string): string {
  return locale === "en"
    ? `sandbox dir added: ${path}`
    : `sandbox dir を追加しました: ${path}`;
}

export function sandboxDirRemoved(locale: AppLocale, path: string): string {
  return locale === "en"
    ? `sandbox dir removed: ${path}`
    : `sandbox dir を削除しました: ${path}`;
}

export function sandboxDirNotFound(locale: AppLocale, path: string): string {
  return locale === "en"
    ? `sandbox dir not found: ${path}`
    : `sandbox dir が見つかりません: ${path}`;
}

export function sandboxDirCleared(locale: AppLocale, count: number): string {
  return locale === "en"
    ? `sandbox dirs cleared: ${count}`
    : `sandbox dir を全削除しました: ${count}`;
}

export function sandboxDirPathMustBeAbsolute(locale: AppLocale): string {
  return locale === "en"
    ? "path must be absolute"
    : "絶対パスを指定してください";
}

export function sandboxDirPathNotFound(locale: AppLocale, path: string): string {
  return locale === "en"
    ? `path not found: ${path}`
    : `パスが存在しません: ${path}`;
}

export function sandboxDirPathNotDirectory(locale: AppLocale, path: string): string {
  return locale === "en"
    ? `path is not a directory: ${path}`
    : `ディレクトリではありません: ${path}`;
}

export function sandboxMigrationNotice(locale: AppLocale): string {
  if (locale === "en") {
    return [
      "[NOTICE] Sandbox default changed",
      "All sessions now run with workspace-write by default.",
      "If needed, use !ok <minutes> for temporary full access, or !sandbox off for persistent full access.",
      "To fully revert behavior, set FORCE_LEGACY_FULL_ACCESS=true in .env and restart.",
    ].join("\n");
  }
  return [
    "[注意] サンドボックス既定値が変更されました",
    "全セッションが既定で workspace-write で動作します。",
    "必要に応じて !ok <minutes> で一時的に full access、または !sandbox off で恒久的に full access にできます。",
    "挙動を完全に戻す場合は .env の FORCE_LEGACY_FULL_ACCESS=true を設定して再起動してください。",
  ].join("\n");
}

export function buildAgentCommandReference(locale: AppLocale): string {
  if (locale === "en") {
    return [
      "Agent Operation Hints",
      "",
      "Command categories:",
      "- Shared (User / Agent-intended): `!trigger ...`, `!help agent`",
      "- Agent-only: `!attach <absolute_path>`",
      "- User-only: all other `!` commands",
      "",
      "Priority order:",
      "- 1) DiscordAgent dedicated commands (`!trigger`, `!attach`, `!help agent`)",
      "- 2) Skills",
      "- 3) Fallback reasoning",
      "",
      "Shared trigger commands:",
      "- !trigger add daily HH:mm <prompt>",
      "- !trigger add weekly Mon,Wed HH:mm <prompt>",
      "- !trigger add monthly <day(1-31)> HH:mm <prompt>",
      "- !trigger add monthly <1-4|last> <Mon|Tue|...> HH:mm <prompt>",
      "- !trigger add at YYYY-MM-DD HH:mm <prompt>",
      "- !trigger list",
      "- !trigger show <id>",
      "- !trigger edit <id> <prompt>",
      "- !trigger stop <id>",
      "- !trigger delete <id>",
      "- !help agent",
      "",
      "Agent-only attachment command:",
      "- Output only one standalone line: `!attach <absolute_path>`",
      "- Absolute path is required.",
      "- Do not ask the user to run `!attach`; user-side `!attach` is disabled.",
      "- File size limit: 8388608 bytes (8MB).",
      "- If the file is larger than 8MB, suggest splitting or compressing first.",
      "",
      "Safety warning:",
      "- Trigger commands execute when output as a standalone `!trigger ...` line.",
      "- `!trigger list` and `!trigger show` are read-only. `add` / `edit` / `stop` / `delete` mutate state.",
      "- Output at most one mutating `!trigger` command per reply.",
      "- Do not output the next mutating `!trigger` command until you receive the result of the previous one.",
      "- Even when multiple changes are needed, execute them one by one and wait for each result.",
      "- Do not print executable `!trigger ...` lines when only asking a question.",
      "",
      "For general commands, use `!help`.",
    ].join("\n");
  }

  return [
    "Agent向け操作ヒント",
    "",
    "コマンド分類:",
    "- 共有（ユーザー/Agent想定）: `!trigger ...` / `!help agent`",
    "- Agent専用: `!attach <absolute_path>`",
    "- ユーザー専用: 上記以外の `!` コマンド",
    "",
    "優先順位:",
    "- 1) DiscordAgent専用コマンド（`!trigger` / `!attach` / `!help agent`）",
    "- 2) Skill",
    "- 3) 自前推論",
    "",
    "共有 trigger コマンド:",
    "- !trigger add daily HH:mm <prompt>",
    "- !trigger add weekly Mon,Wed HH:mm <prompt>",
    "- !trigger add monthly <day(1-31)> HH:mm <prompt>",
    "- !trigger add monthly <1-4|last> <Mon|Tue|...> HH:mm <prompt>",
    "- !trigger add at YYYY-MM-DD HH:mm <prompt>",
    "- !trigger list",
    "- !trigger show <id>",
    "- !trigger edit <id> <prompt>",
    "- !trigger stop <id>",
    "- !trigger delete <id>",
    "- !help agent",
    "",
    "Agent専用 添付コマンド:",
    "- `!attach <absolute_path>` の1行だけを出力",
    "- 絶対パスが必須",
    "- ユーザーに `!attach` の実行を依頼しない（ユーザー側 `!attach` は無効）",
    "- ファイルサイズ上限は 8388608 bytes（8MB）",
    "- 8MBを超える場合は、分割または圧縮を提案",
    "",
    "注意:",
    "- `!trigger ...` を単独行で出力すると、そのまま実行されます。",
    "- `!trigger list` / `!trigger show` は参照系です。`add` / `edit` / `stop` / `delete` は状態変更です。",
    "- 状態変更系の `!trigger` は、1返答につき1件だけ出力してください。",
    "- 状態変更系の結果を受け取る前に、次の状態変更系 `!trigger` を出力しないでください。",
    "- 複数の状態変更が必要でも、必ず result を待ってから1件ずつ実行してください。",
    "- 質問や確認だけをしたい場面では、実行形式の `!trigger ...` 行を出力しないでください。",
    "",
    "通常のコマンド一覧は `!help` を参照してください。",
  ].join("\n");
}

export type ApprovalStatusView =
  | { kind: "none"; sandboxMode: "workspace-write" }
  | { kind: "pending"; sandboxMode: "workspace-write" }
  | { kind: "one_shot" }
  | { kind: "temporary"; untilIso: string }
  | { kind: "always_on" };

function formatJst(iso: string, locale: AppLocale): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(
    locale === "en" ? "en-US" : "ja-JP",
    {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    },
  ).format(date);
}

export function approvalStatusLine(locale: AppLocale, view: ApprovalStatusView): string {
  if (locale === "en") {
    if (view.kind === "none") return "approval: sandbox=workspace-write | status=none";
    if (view.kind === "pending") {
      return "approval: sandbox=workspace-write | status=pending (!ok / !ok <minutes> / !ng)";
    }
    if (view.kind === "one_shot") {
      return "approval: sandbox=workspace-write | status=full-access for this run only";
    }
    if (view.kind === "temporary") {
      return `⚠ approval: sandbox=workspace-write | status=temporary full-access (until ${formatJst(view.untilIso, locale)} JST)`;
    }
    return "approval: sandbox=danger-full-access | status=always-on";
  }
  if (view.kind === "none") return "承諾状態: sandbox=workspace-write | 承諾=なし";
  if (view.kind === "pending") {
    return "承諾状態: sandbox=workspace-write | 承諾=待機中 (!ok / !ok <minutes> / !ng)";
  }
  if (view.kind === "one_shot") {
    return "承諾状態: sandbox=workspace-write | 承諾=今回のみfull-access";
  }
  if (view.kind === "temporary") {
    return `⚠ 承諾状態: sandbox=workspace-write | 承諾=一時full-access（有効期限: ${formatJst(view.untilIso, locale)} JST）`;
  }
  return "承諾状態: sandbox=danger-full-access | 承諾=恒久";
}

export function usageOk(locale: AppLocale, maxMinutes: number): string {
  return locale === "en"
    ? `usage: !ok [1-${maxMinutes}] [prompt] | !ok [prompt]`
    : `使い方: !ok [1-${maxMinutes}] [prompt] | !ok [prompt]`;
}

export function usageCodexSession(locale: AppLocale): string {
  return locale === "en"
    ? "usage: !codex session <codex_thread_id>"
    : "使い方: !codex session <codex_thread_id>";
}

export function codexSessionListEmpty(locale: AppLocale): string {
  return locale === "en"
    ? "codex sessions (max 20)\n(no matches)"
    : "codex sessions (max 20)\n（一致する候補はありません）";
}

export function sessionSwitchedThread(locale: AppLocale, threadId: string): string {
  return locale === "en"
    ? `session switched: codex_thread_id=${threadId}`
    : `セッションの codex_thread_id を切り替えました: ${threadId}`;
}

export function sessionLinkedThread(locale: AppLocale, threadId: string): string {
  return locale === "en"
    ? `session linked: codex_thread_id=${threadId}`
    : `セッションを codex_thread_id に紐付けました: ${threadId}`;
}

export function codexSessionLine(_locale: AppLocale, label: string): string {
  void _locale;
  return `codex_session: ${label}`;
}

export function usageSessionConnect(locale: AppLocale): string {
  return locale === "en"
    ? "usage: !session connect <codex_thread_id>"
    : "使い方: !session connect <codex_thread_id>";
}

export function sessionCreated(locale: AppLocale): string {
  return locale === "en" ? "session created" : "セッションを作成しました";
}

export function workingDirectoryInherited(locale: AppLocale, path: string): string {
  return locale === "en"
    ? `working_directory inherited: ${path}`
    : `working_directory を引き継ぎました: ${path}`;
}

export function sessionsListEmpty(locale: AppLocale): string {
  return locale === "en"
    ? "sessions (max 20)\n(no sessions)"
    : "sessions (max 20)\n（セッションはありません）";
}

export function usageSessionSwitch(locale: AppLocale): string {
  return locale === "en"
    ? "usage: !session switch <id|name|no>"
    : "使い方: !session switch <id|name|no>";
}

export function usageSessionRoot(locale: AppLocale): string {
  return locale === "en"
    ? "usage: !session <new|current|workdir> ...\nSee !help for the command list."
    : "使い方: !session <new|current|workdir> ...\nコマンド一覧は !help を参照してください。";
}

export function usageSessionWorkdir(locale: AppLocale): string {
  return locale === "en"
    ? "usage: !session workdir set <absolute_path> | !session workdir clear"
    : "使い方: !session workdir set <absolute_path> | !session workdir clear";
}

export function sessionWorkdirSet(locale: AppLocale, path: string): string {
  return locale === "en"
    ? `working_directory override set: ${path}`
    : `working_directory override を設定しました: ${path}`;
}

export function sessionWorkdirCleared(locale: AppLocale): string {
  return locale === "en"
    ? "working_directory override cleared"
    : "working_directory override を解除しました";
}

export function sessionWorkdirPathMustBeAbsolute(locale: AppLocale): string {
  return locale === "en"
    ? "working_directory path must be absolute"
    : "working_directory には絶対パスを指定してください";
}

export function sessionWorkdirPathNotFound(locale: AppLocale, path: string): string {
  return locale === "en"
    ? `working_directory path not found: ${path}`
    : `working_directory のパスが存在しません: ${path}`;
}

export function sessionWorkdirPathNotDirectory(locale: AppLocale, path: string): string {
  return locale === "en"
    ? `working_directory path is not a directory: ${path}`
    : `working_directory のパスはディレクトリではありません: ${path}`;
}

export function queueStopallExecuted(
  locale: AppLocale,
  canceled: number,
  killed: number,
  resetLocks: number,
  droppedPending: number,
): string {
  return [
    locale === "en" ? "queue stopall executed" : "queue stopall を実行しました",
    `cancelled_inflight: ${canceled}`,
    `killed_running_processes: ${killed}`,
    `reset_locks: ${resetLocks}`,
    `dropped_pending_queue: ${droppedPending}`,
  ].join("\n");
}

export function queueFixExecuted(
  locale: AppLocale,
  checkedRunning: number,
  fixed: number,
  releasedLocks: number,
  activeThreads: number,
): string {
  return [
    locale === "en" ? "queue fix executed" : "queue fix を実行しました",
    `checked_running: ${checkedRunning}`,
    `fixed_orphan_running: ${fixed}`,
    `released_stale_locks: ${releasedLocks}`,
    `active_codex_threads: ${activeThreads}`,
  ].join("\n");
}

export function usageQueue(locale: AppLocale): string {
  return locale === "en"
    ? "usage: !queue [status|stopall|fix]"
    : "使い方: !queue [status|stopall|fix]";
}

export function queueStatusEmpty(locale: AppLocale): string {
  return locale === "en"
    ? "queue status\n(no queued/running tasks)"
    : "queue status\n（queued/running のタスクはありません）";
}

export function queueStatusTitle(_locale: AppLocale): string {
  void _locale;
  return "queue status";
}

export function syncEnabled(locale: AppLocale): string {
  return locale === "en" ? "sync enabled" : "同期を有効にしました";
}

export function syncDisabled(locale: AppLocale): string {
  return locale === "en" ? "sync disabled" : "同期を無効にしました";
}

export function syncResetDone(locale: AppLocale, anchored: number): string {
  return locale === "en"
    ? `sync reset done: anchored_threads=${anchored}\nmode=future-only`
    : `同期をリセットしました: anchored_threads=${anchored}\nmode=future-only`;
}

export function usageSync(locale: AppLocale): string {
  return locale === "en"
    ? "usage: !sync [status|on|off|reset]"
    : "使い方: !sync [status|on|off|reset]";
}

export function usageTrigger(locale: AppLocale): string {
  return locale === "en"
    ? "usage: !trigger add daily HH:mm <prompt> | !trigger add weekly Mon,Wed HH:mm <prompt> | !trigger add monthly <day(1-31)> HH:mm <prompt> | !trigger add monthly <1-4|last> <Mon|Tue|...> HH:mm <prompt> | !trigger add at YYYY-MM-DD HH:mm <prompt> | !trigger list | !trigger show <id> | !trigger edit <id> <prompt> | !trigger stop <id> | !trigger delete <id> | !trigger env ..."
    : "使い方: !trigger add daily HH:mm <prompt> | !trigger add weekly Mon,Wed HH:mm <prompt> | !trigger add monthly <day(1-31)> HH:mm <prompt> | !trigger add monthly <1-4|last> <Mon|Tue|...> HH:mm <prompt> | !trigger add at YYYY-MM-DD HH:mm <prompt> | !trigger list | !trigger show <id> | !trigger edit <id> <prompt> | !trigger stop <id> | !trigger delete <id> | !trigger env ...";
}

export function usageTriggerEnv(locale: AppLocale): string {
  return locale === "en"
    ? "usage: !trigger env show <id> | !trigger env set workdir <id> <absolute_path> | !trigger env set sandbox <id> <on|off> | !trigger env clear <id>"
    : "使い方: !trigger env show <id> | !trigger env set workdir <id> <absolute_path> | !trigger env set sandbox <id> <on|off> | !trigger env clear <id>";
}

export function triggerAdded(locale: AppLocale, id: string, name: string): string {
  return locale === "en"
    ? `trigger added: ${id} (${name})`
    : `triggerを追加しました: ${id} (${name})`;
}

export function triggerNotFound(locale: AppLocale, id: string): string {
  return locale === "en" ? `trigger not found: ${id}` : `triggerが見つかりません: ${id}`;
}

export function triggerStopped(locale: AppLocale, id: string): string {
  return locale === "en" ? `trigger stopped: ${id}` : `triggerを停止しました: ${id}`;
}

export function triggerDeleted(locale: AppLocale, id: string): string {
  return locale === "en" ? `trigger deleted: ${id}` : `triggerを削除しました: ${id}`;
}

export function triggerEdited(locale: AppLocale, id: string): string {
  return locale === "en" ? `trigger prompt updated: ${id}` : `triggerのpromptを更新しました: ${id}`;
}

export function triggerListTitle(locale: AppLocale): string {
  return locale === "en" ? "triggers:" : "トリガー一覧:";
}

export function triggerShowTitle(locale: AppLocale, id: string): string {
  return locale === "en" ? `trigger detail: ${id}` : `トリガー詳細: ${id}`;
}

export function triggerEnvShowTitle(locale: AppLocale, id: string): string {
  return locale === "en" ? `trigger env: ${id}` : `トリガー実行環境: ${id}`;
}

export function triggerListEmpty(locale: AppLocale): string {
  return locale === "en" ? "no triggers" : "トリガーはありません";
}

export function triggerEnvSetWorkdir(locale: AppLocale, id: string, path: string): string {
  return locale === "en"
    ? `trigger env workdir set: ${id} -> ${path}`
    : `trigger env の working_directory を設定しました: ${id} -> ${path}`;
}

export function triggerEnvSetSandbox(locale: AppLocale, id: string, mode: "on" | "off"): string {
  return locale === "en"
    ? `trigger env sandbox set: ${id} -> ${mode}`
    : `trigger env の sandbox_mode を設定しました: ${id} -> ${mode}`;
}

export function triggerEnvCleared(locale: AppLocale, id: string): string {
  return locale === "en"
    ? `trigger env cleared: ${id}`
    : `trigger env を解除しました: ${id}`;
}

export function triggerEnvWorkdirCleared(locale: AppLocale, id: string): string {
  return locale === "en"
    ? `trigger env workdir cleared: ${id}`
    : `trigger env の working_directory を解除しました: ${id}`;
}

export function triggerEnvSandboxCleared(locale: AppLocale, id: string): string {
  return locale === "en"
    ? `trigger env sandbox cleared: ${id}`
    : `trigger env の sandbox_mode を解除しました: ${id}`;
}

export function triggerEnvUserOnly(locale: AppLocale): string {
  return locale === "en"
    ? "trigger env is a user-only command"
    : "trigger env はユーザ専用コマンドです";
}

export function triggerEnvPathMustBeAbsolute(locale: AppLocale): string {
  return locale === "en"
    ? "working_directory must be an absolute path"
    : "working_directory には絶対パスを指定してください";
}

export function triggerEnvPathNotFound(locale: AppLocale, path: string): string {
  return locale === "en"
    ? `working_directory not found: ${path}`
    : `working_directory のパスが存在しません: ${path}`;
}

export function triggerEnvPathNotDirectory(locale: AppLocale, path: string): string {
  return locale === "en"
    ? `working_directory is not a directory: ${path}`
    : `working_directory はディレクトリではありません: ${path}`;
}

export function triggerEnvInvalidSandboxMode(locale: AppLocale): string {
  return locale === "en"
    ? "sandbox mode must be on or off"
    : "sandbox_mode は on または off を指定してください";
}

export function helpAgentLoopDetected(locale: AppLocale): string {
  return locale === "en"
    ? "ERR_HELP_AGENT_LOOP: consecutive !help agent detected. Aborted and waiting for normal user input."
    : "ERR_HELP_AGENT_LOOP: !help agent の連続実行を検出したため中断しました。通常のユーザー入力を待機します。";
}

export function syncStatus(locale: AppLocale, enabled: boolean, pollSec: number, maxBurst: number): string {
  return [
    locale === "en" ? undefined : "同期状態",
    `sync_enabled: ${enabled ? "yes" : "no"}`,
    `sync_poll_sec: ${pollSec}`,
    `sync_max_burst_global: ${maxBurst}`,
    "mode: future-only",
  ].filter(Boolean).join("\n");
}

export function unreadRecoveryLines(locale: AppLocale, processed: number, dropped: number, limit: number): string[] {
  const lines = locale === "en"
    ? [`Unread recovery: processed ${processed} message(s).`]
    : [`未読回収: ${processed}件を処理しました。`];
  if (dropped > 0) {
    lines.push(
      locale === "en"
        ? `Dropped ${dropped} message(s) because the recovery cap (${limit}) was exceeded.`
        : `キュー上限(${limit}件)超過により ${dropped}件を破棄しました。`,
    );
  }
  return lines;
}

export function notLinkedYet(locale: AppLocale): string {
  return locale === "en" ? "(not linked yet)" : "(not linked yet)";
}

export function unknownValue(locale: AppLocale): string {
  return locale === "en" ? "(unknown)" : "(unknown)";
}

export function noSummary(locale: AppLocale): string {
  return locale === "en" ? "(no summary)" : "(no summary)";
}

export function attachInvalidPath(locale: AppLocale): string {
  return locale === "en"
    ? "ERR_ATTACH_INVALID_PATH: empty"
    : "ERR_ATTACH_INVALID_PATH: empty";
}

export function attachAbsolutePathRequired(locale: AppLocale, filePath: string): string {
  return locale === "en"
    ? `ERR_ATTACH_ABSOLUTE_PATH_REQUIRED: ${filePath}`
    : `ERR_ATTACH_ABSOLUTE_PATH_REQUIRED: ${filePath}`;
}

export function attachNotFound(locale: AppLocale, filePath: string): string {
  return locale === "en"
    ? `ERR_ATTACH_NOT_FOUND: ${filePath}`
    : `ERR_ATTACH_NOT_FOUND: ${filePath}`;
}

export function attachNotFile(locale: AppLocale, filePath: string): string {
  return locale === "en"
    ? `ERR_ATTACH_NOT_FILE: ${filePath}`
    : `ERR_ATTACH_NOT_FILE: ${filePath}`;
}

export function attachStatFailed(locale: AppLocale, filePath: string): string {
  return locale === "en"
    ? `ERR_ATTACH_STAT_FAILED: ${filePath}`
    : `ERR_ATTACH_STAT_FAILED: ${filePath}`;
}

export function attachTooLarge(locale: AppLocale, filePath: string, size: number, maxBytes: number): string {
  return locale === "en"
    ? `ERR_ATTACH_TOO_LARGE: ${filePath} (${size} bytes > ${maxBytes} bytes)`
    : `ERR_ATTACH_TOO_LARGE: ${filePath} (${size} bytes > ${maxBytes} bytes)`;
}

export function attachUploadFailed(locale: AppLocale, filePath: string): string {
  return locale === "en"
    ? `ERR_ATTACH_UPLOAD_FAILED: ${filePath}`
    : `ERR_ATTACH_UPLOAD_FAILED: ${filePath}`;
}
