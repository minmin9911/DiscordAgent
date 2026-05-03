export type AppLocale = "ja" | "en";

type UsageLimitStatus = {
  planType: string | null;
  primaryUsedPercent: number | null;
  primaryWindowMinutes: number | null;
  primaryResetsAt: number | null;
  secondaryUsedPercent: number | null;
  secondaryWindowMinutes: number | null;
  secondaryResetsAt: number | null;
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
      "## Basic Commands",
      "- !help",
      "- !ask <instruction>",
      "  - Sending a normal message without `!` works the same way.",
      "- !queue",
      "  - Show the current execution queue status.",
      "- !queue stopall",
      "  - Emergency-stop all queues (cancel pending, force-stop running tasks).",
      "- !queue fix",
      "  - Repair orphaned running entries waiting on missing Codex processes.",
      "- !sync",
      "  - Show sync status for updates made by other clients.",
      "- !sync on|off",
      "  - Enable or disable external client sync.",
      "- !sync reset",
      "  - Mark all current Codex messages as already synced. Only future updates will be synced.",
      "",
      "## Session Management",
      "- !session new [name]",
      "  - Disconnect from the current session and start a new one (with a new Codex thread).",
      "- !session current",
      "  - Show the current session's codex_thread_id / working_directory / status / queue.",
      "- !codex [query]",
      "  - Search ~/.codex/sessions and list candidates (latest first if omitted).",
      "- !codex pick <no>",
      "  - Change the Codex thread_id linked to the current session.",
      "  - Select by number from the last !codex result.",
      "- !codex session <codex_thread_id>",
      "  - Recommended: specify the Codex thread UUID directly.",
      "  - Change the Codex thread_id linked to the current session.",
      "  - Directly bind to the specified thread_id.",
    ].join("\n");
  }

  return [
    `${appName} Command Reference`,
    `build: ${build}`,
    "",
    "## 基本コマンド",
    "- !help",
    "- !ask <instruction>",
    "  - 「!」コマンドをつけず、普通のメッセージ送信でも同様に実行されます。",
    "- !queue",
    "  - 実行キューの状況を表示します。",
    "- !queue stopall",
    "  - 全キューを緊急停止します（待機中は取消、実行中は強制停止）。",
    "- !queue fix",
    "  - running孤児（存在しないCodexプロセスを待機中のスレッド）を修復します。",
    "- !sync",
    "  - 他のクライアント更新の同期状態を表示します。",
    "- !sync on|off",
    "  - 他のクライアント更新の同期を有効/無効にします。",
    "- !sync reset",
    "  - 現時点でのCodexのメッセージを全て同期済みとして扱います。未来の更新のみ同期します。",
    "",
    "## セッション管理",
    "- !session new [name]",
    "  - 現在のセッションとの接続を切り、新しいセッションを始めます（Codexのスレッドも新しくなります）。",
    "- !session current",
    "  - 現在のセッションの codex_thread_id / working_directory / status / queue などを表示します。",
    "- !codex [query]",
    "  - ~/.codex/sessions を検索して候補表示します（省略時は最新候補）。",
    "- !codex pick <no>",
    "  - 現在のセッションに紐づく Codex の thread_id を変更します。",
    "  - 直前の !codex 結果から番号選択します。",
    "- !codex session <codex_thread_id>",
    "  - 【推奨】CodexのスレッドID（UUID）でスレッドを指定します。",
    "  - 現在のセッションに紐づく Codex の thread_id を変更します。",
    "  - 直接 thread_id を指定します。",
  ].join("\n");
}

export function dmDisabledVerbose(locale: AppLocale): string {
  return locale === "en"
    ? "ERR_DM_DISABLED: This bot cannot be used in DMs."
    : "ERR_DM_DISABLED: このBotはDMでは使用できません。";
}

export function syntaxUnknownCommand(locale: AppLocale, helpText: string): string {
  return locale === "en"
    ? `Syntax Error: Unknown command.\n\n${helpText}`
    : `Syntax Error: 不明なコマンドです。\n\n${helpText}`;
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
): string | null {
  if (usedPercent == null) return null;
  const leftPercent = Math.max(0, Math.min(100, Math.round(100 - usedPercent)));
  if (windowMinutes === 300) {
    return locale === "en" ? `\`5h=${leftPercent}%\`` : `\`5時間=${leftPercent}%\``;
  }
  if (windowMinutes === 10080) {
    return locale === "en" ? `\`weekly=${leftPercent}%\`` : `\`週間=${leftPercent}%\``;
  }
  return `\`window${windowMinutes ?? "?"}m=${leftPercent}%\``;
}

export function codexUsageStatusLine(
  locale: AppLocale,
  status: UsageLimitStatus,
): string {
  const primary = formatLimitLeft(locale, status.primaryUsedPercent, status.primaryWindowMinutes);
  const secondary = formatLimitLeft(locale, status.secondaryUsedPercent, status.secondaryWindowMinutes);
  const parts = [primary, secondary].filter((v): v is string => Boolean(v));
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
  return `${prefix} ${parts.join(" ")}`;
}

export function completeHeader(
  _locale: AppLocale,
  label: string,
  switchBlock: string,
  usageBlock: string,
  historyBlock: string,
): string {
  void _locale;
  return `codex_session: ${label}\n${switchBlock}${historyBlock}complete: body is sent in next message(s)\n${usageBlock}`.trimEnd();
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
    ? "usage: !session <new|current> ..."
    : "使い方: !session <new|current> ...";
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
