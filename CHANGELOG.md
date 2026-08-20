# CHANGELOG

Japanese changelog: [CHANGELOG.ja.md](./CHANGELOG.ja.md)

Newest builds are listed first.

## v0.1.0 build.89 (2026-08-21)
- Fix an issue where the same running message could appear multiple times when Discord communication was unstable.
- Optimize External Sync history reads so unchanged Codex session history is not repeatedly parsed, reducing background CPU and memory usage and improving response latency.

## v0.1.0 build.87 (2026-08-11)
- `!sandbox dir` now accepts the yen sign (`¥`) used as a path separator on Japanese Windows systems. It also prevents Markdown from corrupting displayed paths.
- `!sandbox dir` add and remove now follow Windows path rules by treating path casing as identical.

## v0.1.0 build.85 (2026-08-09)
- Reworked External Sync around Codex turns, substantially reducing cases where messages executed through DiscordAgent were mirrored again as `[External ...]`. Updates from external clients are synchronized only after the Codex turn completes, using the user input and final response.
- Prevented internal JSON from being shown as the body when Codex returns an empty `agent_message`.
- Updated the `!model` catalog with current GPT-5.6 Terra / Luna pricing guidance and removed `gpt-5.4-mini`, which is no longer a supported choice.

## v0.1.0 build.82 (2026-07-11)
- Change Codex session working-directory resolution to prefer `workspace_roots`. Some existing sessions may therefore use a different working directory than before; check with `!session current` if needed.

## v0.1.0 build.80 (2026-07-10)
- Added support for changing a session's working directory to any directory. Supports `!session workdir set <absolute_path>` / `!session workdir clear`, and `!session current` now shows the current setting.
- Add `!stopall` and `!allstop` as shorthand aliases for `!queue stopall`.
- Extend `!ok` to accept prompt-attached forms: `!ok <minutes> <prompt>` and `!ok <prompt>`.
- Improve suppression for cases where External Sync could incorrectly treat non-external messages as external. This is improved but not yet fully eliminated.

## v0.1.0 build.76 (2026-06-19)
- Implement `!trigger` features for scheduled and one-shot execution, including list, show, stop, delete, and edit operations. (Available to both agents and users.)
- Add `!sandbox dir` so each session can configure extra allowed directories for workspace-write runs.
- Add `!help agent` so an agent can learn DiscordAgent-specific commands when needed.
- Simplify the system prompt sent from DiscordAgent to Codex by moving detailed operational guidance into `!help agent`.

## v0.1.0 build.70 (2026-05-26)
- Add `!trigger` commands (add/list/stop/delete) with daily/weekly scheduling support.
- Add Windows Task Scheduler integration so fired events are ingested and executed through DA.
- Add trigger result posting to Discord contexts bound to the target codex_thread_id.

## v0.1.0 build.69 (2026-05-11)
- Improved `!ok` behavior by widening the range of permission-related errors that can be detected.

## v0.1.0 build.68 (2026-05-11)
- Add sandbox settings so each session can switch between `workspace-write` and `danger-full-access`.
- Make sandbox-enabled execution the default behavior for this application (previously only sandbox-disabled behavior was used). You can restore previous behavior by setting `FORCE_LEGACY_FULL_ACCESS=true`.
- Add `!ok` / `!ok <minutes>` / `!ng` handling for retrying, temporarily allowing, or discarding runs that may fail due to insufficient permissions.
- Add per-execution sandbox/approval status line to the completion header.
- Change the default working directory for app-created sessions to `DEFAULT_AGENT_WORKDIR_ROOT/<session_id>` (previously the app root directory was used, which allowed access to the application itself; this is now isolated).

## v0.1.0 build.63 (2026-05-04)
- Emphasize usage status in the completion header when remaining quota enters a danger zone (red at 5% or below, yellow at 10% or below).
- Add the `!model` command so the model can be switched per session.

## v0.1.0 build.60 (2026-05-03)
- Display 5-hour LIMIT and weekly LIMIT usage status in the completion header.
- Add `SHOW_FINAL_STREAM_LOG`, allowing the `stream_log` section to be cleared after streaming completes so only the full body remains visible. The default keeps the stream log.
- Fix a bug where `EXTERNAL_SYNC_ENABLED=false` was not applied correctly.

## v0.1.0 build.45 (2026-03-15)
- Treat attachment-only messages as executable requests, allowing images and files to be passed to Codex without accompanying text.

## v0.1.0 build.44 (2026-03-14)
- Improve recovery behavior for `!queue stopall` / `!queue fix`, fixing cases where a session queue could remain stuck after stopping.

## v0.1.0 build.43 (2026-03-08)
- Add the `!sync` feature to sync updates made to the same `codex_thread_id` from other clients such as Codex CLI or the Windows App back to Discord.
- External sync is future-only. Startup and `!sync reset` anchor at the current position and do not send past history.
- Add `!sync`, `!sync on`, `!sync off`, and `!sync reset`.
- Add `EXTERNAL_SYNC_ENABLED` and `EXTERNAL_SYNC_POLL_SEC` to `.env`.

## v0.1.0 build.36 (2026-03-06)
- Read Codex CLI (`--json`) stdout JSONL incrementally and support streaming display.
- Add `working_directory` to `!queue` status output.
- Prefer resolving `working_directory` from `codex_thread_id`; fall back to `preferred_working_directory` if it cannot be resolved.

## v0.1.0 build.32 (2026-03-05)
- Save incoming Discord attachments and pass their absolute paths into the Codex prompt.
- Add `INCOMING_ATTACH_DIR`, `INCOMING_ATTACH_TTL_HOURS`, and `INCOMING_ATTACH_MAX_BYTES`.
- Add cleanup for expired incoming attachments.
- Improve attachment-reference prompt text and introduce `latest_attachment_path`.
- Resolve phrases such as "this file", "this", and "that file" to `latest_attachment_path`.

## v0.1.0 build.30 (2026-03-03)
- Implement `ALLOWED_USER_IDS` so only allowed users can operate the bot.
- Add `!queue`, `!queue status`, `!queue stopall`, and `!queue fix`.
- Add emergency Codex process stop and queue recovery mechanisms.

## v0.1.0 build.29 (2026-02-28)
- Treat WebSocket-to-HTTPS fallback as successful when an `agent_message` is still obtained.
- Normalize `Falling back from WebSockets to HTTPS transport` / `stream disconnected before completion` as warnings.

## v0.1.0 build.28 (2026-02-27)
- Reorganize the basic command descriptions in `!help` and README.
- Clarify the relationship between `!ask <instruction>` and normal messages.

## v0.1.0 build.26 (2026-02-24)
- Introduce daily history logs based on `history-YYYY-MM-DD.log`.
- Clarify execution queue lock keys as `codex:<codex_thread_id>` / `session:<session_id>`.
- Add `queue_lock_key` to `!session current`.

## v0.1.0 build.25 (2026-02-24)
- Add `!codex session <codex_thread_id>` and `!codex pick <no>`.
- Implement `SessionService.rebindCurrentSessionCodexThread()` to rebind an existing session to a thread.
- Reorganize the session switching flow to reduce operational mistakes.

## v0.1.0 build.19 (2026-02-14)
- Improve `working_directory` inheritance for `!codex search/pick` and `!session new` to stabilize session operation.
- Add the AI output instruction for `!attach <absolute_path>` with an 8MB limit, while disabling user-side `!attach`.
- Update `!help` and README, and bump the build number to `build.19`.
