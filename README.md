# Discord Codex Agent

日本語のREADMEはこちら: [README.ja.md](./README.ja.md)  
Japanese README: [README.ja.md](./README.ja.md)

A Discord bot that lets you operate a local Codex CLI running on your Windows PC.
This project is primarily a technical proof of concept and is not recommended as a general-purpose production tool.

This software is **for Windows**. It assumes both Node.js and Codex CLI are running **natively on Windows**. WSL is not the target environment.

You can keep Codex running on a home Windows PC and operate it remotely from Discord. Because Discord works in a browser, this setup can also be used from lightweight devices such as Chromebooks.

Different Discord channels or threads can be mapped to different Codex sessions. This makes it possible to keep multiple Codex workflows active at the same time, for example one thread per application or project.

Codex can also return files to Discord by emitting `!attach <absolute_path>`.

## What You Can Do

・Remote software development through Discord
・Use Codex as an Obsidian librarian for search, organization, and web clipping workflows
・Extend Codex with custom Skills
・Run secretary-style workflows for Google Calendar, Tasks, and Gmail through separate Skills
・Coordinate travel plans and write back to Google Docs through separate Skills
・Keep Discord open in the Edge sidebar and use Codex as an always-available assistant while browsing

## Requirements

・Node.js 20+ on Windows
・A Discord Bot application
・A local Codex CLI running natively on Windows

## Important Note About Language Support

Some runtime messages, including `!help`, are currently Japanese-only. This should not be a practical blocker for most users, but an English version of help and bot messages is planned for a future release. Sorry for the inconvenience.

## Setup

1. Create your own private Discord server and channel.
2. Create an Application / Bot in Discord Developer Portal.
3. In `Installation`, set `Install Link = None`.
4. In `Bot`, regenerate and save the token if needed, and set `Public Bot = OFF`.
5. Invite the bot with OAuth2 URL Generator using at least the following permissions:
   ・`bot` scope
   ・`View Channels`
   ・`Send Messages`
   ・`Send Messages in Threads`
   ・`Read Message History`
   ・`Attach Files`
6. Enable Discord Developer Mode and copy the target channel ID.

Then prepare the local environment:

```bash
copy .env.example .env
npm install
```

## Main `.env` Settings

・`DISCORD_TOKEN`: bot token
・`ALLOWED_CHANNEL_IDS`: allowed Discord channel IDs
・`ALLOWED_USER_IDS`: optional allowlist of user IDs
・`SQLITE_PATH`: SQLite database path
・`CODEX_MODE`: usually `cli`
・`CODEX_TIMEOUT_SEC`: Codex timeout in seconds
・`INCOMING_ATTACH_DIR`: temp storage directory for incoming attachments
・`INCOMING_ATTACH_TTL_HOURS`: retention period for incoming attachments
・`INCOMING_ATTACH_MAX_BYTES`: per-file attachment limit
・`INSTANCE_LOCK_PORT`: single-instance lock port
・`EXTERNAL_SYNC_ENABLED`: enable external Codex client sync on startup
・`EXTERNAL_SYNC_POLL_SEC`: polling interval in seconds
・`EXTERNAL_SYNC_MAX_BURST`: max externally synced messages per cycle
・`EXTERNAL_SYNC_USER_MAX_CHARS`: max length for externally synced `user_message`

## Commands

### Basic

・`!help`
・`!ask <instruction>`
・Sending a normal message without `!ask` works the same way.

### Session Management

・`!session new [name]`
・`!session current`
・`!codex [query]`
・`!codex pick <no>`
・`!codex session <codex_thread_id>`

### Maintenance

・`!queue`
・`!queue stopall`
・`!queue fix`
・`!sync`
・`!sync on` / `!sync off`
・`!sync reset`

## Attachments

・Codex can upload files to Discord by returning `!attach <absolute_path>`.
・User-posted attachments are stored temporarily and passed to Codex as absolute paths on the next execution.
・Attachment-only messages are also treated as executable input and forwarded to Codex.

## Security Notes

The biggest single-point risk in this project is the Discord Bot path itself.
Prioritize the following:

・Do not let third parties install or take over the bot
・Protect the Discord account that manages the bot
・Protect the bot token
・Run the bot on a dedicated Windows machine separated from daily-use devices

## Logs

・`logs/last_run.log`: overwritten on each startup
・`logs/history-YYYY-MM-DD.log`: daily history log

## External Sync

If the same `codex_thread_id` is updated from another client such as Codex CLI or a VSCode extension, DiscordAgent can mirror those updates back into Discord.
This works in future-only mode and does not replay older history.

## Restart Behavior

`run_DiscordAgent.cmd` is intended to keep restarting the app in a loop.
That design allows remote restart by killing only the child `node` process while leaving the parent batch process alive.
