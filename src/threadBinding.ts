import type { AppLocale } from "./i18n.js";

export type ThreadBindingChange =
  | { kind: "none" }
  | { kind: "bound"; nextThreadId: string }
  | { kind: "switched"; previousThreadId: string; nextThreadId: string };

export function detectThreadBindingChange(
  storedThreadId: string | null | undefined,
  observedThreadId: string | null | undefined,
): ThreadBindingChange {
  const next = observedThreadId?.trim();
  const current = storedThreadId?.trim();
  if (!next) return { kind: "none" };
  if (!current) return { kind: "bound", nextThreadId: next };
  if (current === next) return { kind: "none" };
  return {
    kind: "switched",
    previousThreadId: current,
    nextThreadId: next,
  };
}

export function buildThreadSwitchNotice(
  previousThreadId: string,
  nextThreadId: string,
  locale: AppLocale = "ja",
): string {
  if (locale === "en") {
    return [
      "notice: Codex switched the linked thread_id.",
      `old: ${previousThreadId}`,
      `new: ${nextThreadId}`,
      "Future runs will use the new thread_id.",
    ].join("\n");
  }
  return [
    "notice: Codex側で thread_id が切り替わりました。",
    `old: ${previousThreadId}`,
    `new: ${nextThreadId}`,
    "今後は新しい thread_id を利用します。",
  ].join("\n");
}

export function isMissingCodexThreadError(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.toLowerCase().includes("thread/resume failed: no rollout found for thread id");
}

export function buildInvalidThreadNotice(codexThreadId: string, locale: AppLocale = "ja"): string {
  if (locale === "en") {
    return [
      "notice: The Codex thread_id linked to this session is invalid.",
      `stored thread_id: ${codexThreadId}`,
      "",
      "Codex cannot find this thread_id, so this session cannot continue processing.",
      "",
      "How to recover:",
      "・Start with a new Codex thread: `!session new [name]`",
      "・Rebind to an existing Codex thread: `!codex` or `!codex session <codex_thread_id>`",
      "",
      "See `!help` for details.",
    ].join("\n");
  }
  return [
    "notice: 現在このセッションに紐づいている Codex thread_id は無効です。",
    `stored thread_id: ${codexThreadId}`,
    "",
    "Codex 側でこの thread_id が見つからないため、このセッションでは処理を続行できません。",
    "",
    "対処方法:",
    "・新しい Codex スレッドで続ける: `!session new [name]`",
    "・既存の Codex スレッドに結びつけ直す: `!codex` または `!codex session <codex_thread_id>`",
    "",
    "詳しくは `!help` を参照してください。",
  ].join("\n");
}
