# Discord Codex Agent

日本語のREADMEはこちら: [README.ja.md](./README.ja.md)  
Japanese README: [README.ja.md](./README.ja.md)

A Discord bot that lets you operate a local Codex CLI running on your Windows PC.
This project is primarily a technical proof of concept and is not recommended as a general-purpose production tool.

This software is **for Windows**. It assumes both Node.js and Codex CLI are running **natively on Windows**. WSL is not the target environment.

You can keep Codex running on a home Windows PC and operate it remotely from Discord. Because Discord also works in a browser, this setup can also be used from lightweight devices such as Chromebooks.

Different Discord channels or threads can be mapped to different Codex sessions. This makes it possible to keep multiple Codex workflows active at the same time, for example one thread per application or project.

Codex can also return files to Discord by emitting `!attach <absolute_path>`.

## What You Can Do

- Remote software development through Discord
- Use Codex as an Obsidian librarian for search, organization, and web clipping workflows
- Extend Codex with custom Skills
- Run secretary-style workflows for Google Calendar, Tasks, and Gmail through separate Skills
- Coordinate travel plans and write back to Google Docs through separate Skills
- Keep Discord open in the Edge sidebar and use Codex as an always-available assistant while browsing

## Requirements

- Node.js 20+ on Windows
- A Discord Bot application
- A local Codex CLI running natively on Windows

## Language

- `APP_LOCALE=ja|en` selects the bot language explicitly.
- If `APP_LOCALE` is omitted, the bot falls back to the Windows OS locale.
- Shared error codes such as `ERR_*` remain common across languages.

## Setup

1. Create your own private Discord server and channel.
2. Create an Application / Bot in Discord Developer Portal.
3. In `Installation`, set `Install Link = None`.
4. In `Bot`, regenerate and save the token if needed, and set `Public Bot = OFF`.
5. Invite the bot with OAuth2 URL Generator using at least the following permissions:
   - `bot` scope
   - `View Channels`
   - `Send Messages`
   - `Send Messages in Threads`
   - `Read Message History`
   - `Attach Files`
6. Enable Discord Developer Mode and copy the target channel ID.

Then prepare the local environment:

```bash
git clone https://github.com/minmin9911/DiscordAgent.git
cd DiscordAgent
copy .env.example .env
```

Edit `.env`, then install dependencies:

```bash
npm install
```

Then start the bot:

```bat
run_DiscordAgent.cmd
```

If DiscordAgent will not perform self-restart operations, you can also run it with:

```bash
npm start
```

## Main `.env` Settings

- `DISCORD_TOKEN`: bot token
- `ALLOWED_CHANNEL_IDS`: allowed Discord channel IDs
- `ALLOWED_USER_IDS`: optional allowlist of user IDs
- `APP_LOCALE`: bot language (`ja` or `en`)
- `SQLITE_PATH`: SQLite database path
- `DEFAULT_AGENT_WORKDIR_ROOT`: root directory for new session working directories (default: `./workspaces`)
- `CODEX_MODE`: usually `cli`
- `CODEX_TIMEOUT_SEC`: Codex timeout in seconds
- `INCOMING_ATTACH_DIR`: temp storage directory for incoming attachments
- `INCOMING_ATTACH_TTL_HOURS`: retention period for incoming attachments
- `INCOMING_ATTACH_MAX_BYTES`: per-file attachment limit
- `INSTANCE_LOCK_PORT`: single-instance lock port
- `EXTERNAL_SYNC_ENABLED`: enable external Codex client sync on startup
- `EXTERNAL_SYNC_POLL_SEC`: polling interval in seconds
- `EXTERNAL_SYNC_MAX_BURST`: max externally synced messages per cycle
- `EXTERNAL_SYNC_USER_MAX_CHARS`: max length for externally synced `user_message`
- `SHOW_FINAL_STREAM_LOG`: show `stream_log` in the completion header (default: `true`)

Each completion header includes the current sandbox and approval status for that execution.
When `FORCE_LEGACY_FULL_ACCESS=true`, this status line is hidden.

Newly created app sessions now use `DEFAULT_AGENT_WORKDIR_ROOT/<session_id>` as the default working directory.

## Commands

### Purpose of `!help agent`

Use `!help agent` to **teach DiscordAgent-specific commands (`!trigger` / `!attach`) to the agent**.  
The agent may use this command proactively when needed. The user may also run it explicitly to teach the agent.

- Main targets:
  - `!trigger ...` (user-and-agent shared command)
  - `!attach <absolute_path>` (agent-only command)
- Main uses:
  - before asking the agent to use DiscordAgent commands in a new conversation context
  - when the agent keeps preferring Skills instead of DiscordAgent commands
  - when the agent wants to check command usage by itself

Notes:
- Consecutive `!help agent` calls are blocked by loop protection.

### Basic

- `!help`
- `!ask <instruction>`
- Sending a normal message without `!ask` works the same way.

### Session Management

- `!session new [name]`
- `!session current`
- `!model`
  - Show available models for the current session.
- `!model <no>`
  - Switch the model for the current session.
  - `0` uses the model specified in Codex `config.toml` (default model).
  - The list source is `data/models.yaml`.
  - Codex `exec` does not currently provide a model-list API, so this list must be maintained manually unless that feature is added.
- `!codex [query]`
- `!codex pick <no>`
- `!codex session <codex_thread_id>`

### Triggers

These commands are primarily intended for agent use, but users can run them directly as well.  
Trigger firing is implemented through Windows Task Scheduler.

- `!trigger add daily HH:mm <prompt>`
  - Add a trigger that runs every day at the specified time.

- `!trigger add weekly Mon,Wed HH:mm <prompt>`
  - Add a trigger that runs every week on the specified day(s) and time.

- `!trigger add monthly <day(1-31)> HH:mm <prompt>`
  - Add a trigger that runs every month on the specified day and time.

- `!trigger add monthly <1-4|last> <Mon|Tue|...> HH:mm <prompt>`
  - Add a trigger that runs every month on the specified nth weekday or last weekday.

- `!trigger add at YYYY-MM-DD HH:mm <prompt>`
  - Add a trigger that runs only once at the specified date and time.

- `!trigger list`
  - Show the list of registered triggers.
  - Disabled triggers are shown in the `[OFF]` section, and enabled triggers are shown in the `[ON]` section.

- `!trigger show <id>`
  - Show details for the specified trigger.
  - The full stored `prompt` is also displayed.

- `!trigger edit <id> <prompt>`
  - Update the `prompt` of the specified trigger.

- `!trigger stop <id>`
  - Stop the specified trigger.

- `!trigger delete <id>`
  - Delete the specified trigger.

- `!trigger env show <id>`
  - Show the execution environment for the specified trigger.
  - Without overrides, this shows `working_directory` / `sandbox_mode`; with overrides, it shows `working_directory(override)` / `sandbox_mode(override)`.

- `!trigger env set workdir <id> <absolute_path>`
  - Set the working directory used only when that trigger runs.

- `!trigger env set sandbox <id> <on|off>`
  - Set the sandbox mode used only when that trigger runs.
  - `on` means `workspace-write`; `off` means `danger-full-access`.

- `!trigger env clear <id>`
  - Clear all execution-environment overrides for the specified trigger.

- `!trigger env clear workdir <id>`
  - Clear only the working-directory override for the specified trigger.

- `!trigger env clear sandbox <id>`
  - Clear only the sandbox override for the specified trigger.

### Maintenance

- `!queue`
- `!queue stopall`
  - `!stopall` and `!allstop` are also available as shorthand aliases.
- `!queue fix`
- `!sandbox on`
  - Run this session with `workspace-write`. This is the default setting for work inside the current workspace.
- `!sandbox off`
  - Run this session with persistent `danger-full-access`.
- `!sandbox dir add <absolute_path>`
  - Allow access to a folder outside the sandbox without additional approval by explicitly registering that folder.
  - Add an extra allowed directory for this session's Codex thread.
- `!sandbox dir remove <absolute_path>`
  - Remove an extra allowed directory.
- `!sandbox dir list`
  - Show the currently configured extra allowed directories.
- `!sandbox dir clear`
  - Remove all extra allowed directories.
- `!ok`
  - Retry the latest permission-limited request once with `danger-full-access`.
  - `!ok <prompt>` runs that prompt once with full access, similar to a one-shot sudo.
- `!ok <minutes>`
  - Temporarily run this session with `danger-full-access` for the specified number of minutes. The maximum is 60 minutes.
  - `!ok <minutes> <prompt>` runs that prompt with full access, then keeps full access enabled for the specified duration, similar to a time-limited sudo.
- `!ng`
  - Discard the latest permission-limited request.
- `!sync`
- `!sync on` / `!sync off`
- `!sync reset`

## Attachments

- Codex can upload files to Discord by returning `!attach <absolute_path>`.
- User-posted attachments are stored temporarily and passed to Codex as absolute paths on the next execution.
- Attachment-only messages are also treated as executable input and forwarded to Codex.

## Security Notes

The biggest single-point risk in this project is the Discord Bot path itself.
Prioritize the following:

- Do not let third parties install or take over the bot
- Protect the Discord account that manages the bot
- Protect the bot token
- Run the bot on a dedicated Windows machine separated from daily-use devices

## Logs

- `logs/last_run.log`: overwritten on each startup
- `logs/history-YYYY-MM-DD.log`: daily history log

## External Sync

If the same `codex_thread_id` is updated from another client such as Codex CLI or a VSCode extension, DiscordAgent can mirror those updates back into Discord.
This works in future-only mode and does not replay older history.

## Restart Behavior

`run_DiscordAgent.cmd` is intended to keep restarting the app in a loop.
That design allows remote restart by killing only the child `node` process while leaving the parent batch process alive.

## Skill Extension Examples

This is not limited to DiscordAgent, but Codex becomes much more useful when extended with Skills.  
Because users can ask Codex to create Skills themselves, you can grow Codex into your own secretary, voice intake endpoint, or browser automation tool. Below are examples of Skills that I actually had Codex create and that I call through DiscordAgent.

・Name: `local-voice-command-intake`  
・Function: Transcribes voice files (`*.ogg`) locally and converts them into an executable request  
・Use: You can send a voice message to Discord and have spoken requests passed to Codex  
・Technology: `faster-whisper`

・Name: `web2markdown-clip`  
・Function: Converts a given URL into Markdown and saves it into an Obsidian Vault  
・Use: You can send articles or reference pages from Discord directly into your knowledge base  
・Technology: `PowerShell`, `Readability`, `Turndown`, `Playwright`

・Name: `google-calendar-rw`  
・Function: Reads, creates, updates, and deletes Google Calendar entries in natural language  
・Use: You can check schedules and adjust plans directly from a Discord conversation  
・Technology: `Google Calendar API`

・Name: `google-gmail-rw`  
・Function: Reads, sends, updates, and trashes Gmail messages in natural language  
・Use: You can review email and draft replies from Discord  
・Technology: `Gmail API`

・Name: `google-tasks-rw`  
・Function: Reads, creates, updates, and deletes Google Tasks in natural language  
・Use: You can organize todos and add tasks from Discord conversations  
・Technology: `Google Tasks API`

・Name: `edge-browser-operator`  
・Function: Operates native Microsoft Edge on Windows through Playwright  
・Use: You can automate browser-based research and routine web tasks from Discord  
・Technology: `Playwright`, `Microsoft Edge`

・Name: `restart-discordagent-windows`  
・Function: Targets and terminates the `node.exe` launched from `run_DiscordAgent.cmd` to restart DiscordAgent  
・Use: You can force a remote, self-destructive restart of DiscordAgent and recover service while away from the machine  
・Technology: `PowerShell`, `Windows process control`

If you tell Codex what you want to do and how you want to operate, Codex can develop Skills tailored to your workflow.

For example, you can ask it to read a company email from Gmail, register the schedule described there in Google Calendar, and add a Google Tasks item to prepare for the meeting described in that email.  
You can also combine email review and calendar updates, such as: “A rescheduling email has arrived, so update the time block of the existing ‘travel’ event in my calendar to match the new time.”
