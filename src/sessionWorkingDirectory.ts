import type { SessionRow } from "./types.js";

export type SessionWorkingDirectoryState = {
  baseWorkingDirectory: string | null;
  effectiveWorkingDirectory: string | null;
  overrideWorkingDirectory: string | null;
};

export function resolveSessionWorkingDirectoryState(
  session: Pick<SessionRow, "codex_thread_id" | "preferred_working_directory" | "working_directory_override">,
  resolvedCodexCwd: string | null,
): SessionWorkingDirectoryState {
  const baseWorkingDirectory = session.codex_thread_id
    ? (resolvedCodexCwd ?? session.preferred_working_directory)
    : session.preferred_working_directory;
  return {
    baseWorkingDirectory,
    effectiveWorkingDirectory: session.working_directory_override ?? baseWorkingDirectory,
    overrideWorkingDirectory: session.working_directory_override,
  };
}
