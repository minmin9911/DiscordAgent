# Discord Codex Agent

Discord からローカルの Codex CLI を操作する Bot です。技術実証用であり、常用することはお勧めしません。

Discordから、自宅のPCで稼働するCodexを遠隔操作します。リビングでタブレットから書斎のPCで動くCodexに指示を与えたり、外出先からCodexを操作したりすることができます。

Discordのチャンネルやスレッドごとに別のCodexのセッションを割り当てることができるので、複数のCodexセッションをDiscordに登録することができます。例えば、作成中のアプリケーションごとにスレッドを作成し、それぞれにCodexのセッションを割り当てて、操作することが可能です。

また、「生成したファイルをここに添付して」といった指示をすることで、CodexからDiscordにファイルの添付をすることが可能です。

その他にも、Obsidianの司書として、秘書として、ObsidianのVaultをワーキングディレクトリとするCodexをスレッド等に登録することで、「これを調べて。調べた結果をObsidianに記録しておいて。」「これに関するObsidianのページは何がある？それをDiscordに添付して」、さらに、Skillの呼び出しを活用することで「このURLをObsidianのClipフォルダにマークダウンで保存して」といった指示を与えることも可能です。

このほか、Skill機能を拡張していくことで、さまざまな機能を追加することができます。

## 前提

- Node.js 20+
- Discord Bot
- ローカルで動作する Codex CLI

## 事前準備

1. Discord で、自分専用のサーバーとチャンネルを作成します（既にある場合は省略可）
2. Discord Developer Portal で Application / Bot を作成
3. `Installation` タブで `Install Link = None` に設定（Public Botにするために必要）
4. `Bot` タブでトークンを控え（発行済みの場合は再発行する）、また、`Public Bot` を OFF
5. OAuth2 URL Generator で Bot を対象サーバーへ招待（下記の権限を参考に設定してください）
   - `SCOPES`: `bot`
   - `BOT PERMISSIONS`（最低限）:
     - `View Channels`
     - `Send Messages`
     - `Send Messages in Threads`
     - `Read Message History`
     - `Attach Files`
6. Discordクライアントの設定で「開発者モード」に変更し、利用するチャンネルを右クリックして、チャンネルIDをコピーし、メモに控えてください。

## スクリプト本体の準備

```bash
copy .env.example .env
npm install
```

　設定は.envファイルにて行います。設定テンプレート（.env.example）を.envとしてコピーし、そこに次項を参考に設定してください。

## `.env` 主な設定

- `DISCORD_TOKEN`: Bot トークン
- `ALLOWED_CHANNEL_IDS`: DiscordのチャンネルID（カンマ区切りで複数指定可能）　←上記で控えたもの

### 以下は特に設定しなくてよい

- `SQLITE_PATH`: DB パス
- `CODEX_MODE`: `cli`（推奨）または `template`（非推奨・実験用）
- `CODEX_TIMEOUT_SEC`: Codex 実行タイムアウト秒
- `INSTANCE_LOCK_PORT`: 単一起動用ロックポート

### `CODEX_MODE=template` について

実験用の非推奨機能です。 `template` はテンプレート文字列をシェル実行するため、入力の扱い次第で **コマンドインジェクション** のリスクがあります。通常は `cli` を使ってください。ただし、 `Cli` でも、プロンプトに不正な指示を与えれば同様に危険な実行が可能ですので、注意してください。

## コマンド

### 基本

- `!help`
- 通常のメッセージ送信 又は `!ask <instruction>`
  - 当該Discordスレッドに割り当てられているCodexセッションに対して、指示（Prompt）を送信します。Codexセッションが未指定の場合は、新規のセッションが割り当てられます。

### セッション管理


- `!codex session <codex_thread_id>` （推奨）

  - 現在のDiscordスレッドに割り当てられているCodexセッションを、指定されたUUID（`codex_thread_id`）のCodexセッションに変更します。codex resume <UUID>`<UUID>` と同様の役割です。
- `!codex [query]`

  - Codexのセッションリストを検索します。`~/.codex/sessions` を検索して候補表示します。queryを指定しなかった場合は、最新セッションのリストが表示されます。
- `!codex pick <no>`

  - 直前の `!codex` 検索結果から番号選択し、現在のDiscordスレッドに割り当てられているCodexセッションを、 `no` に対応するCodexセッションに変更します。
- `!session new [name]`
- - 現在のCodexセッションとの接続を切り、新たなCodexセッションを割り当てます。`[name]` はDiscord Agent内での管理用のセッション名称です（未使用）。
- `!session current`

  - 現在のDiscordスレッドに設定されているCodexの各種情報、`codex_thread_id` / `working_directory` / `status` / `queue` などを表示

## ログ

- `logs/last_run.log`: 起動ごとに上書き
- `logs/history-YYYY-MM-DD.log`: 日次履歴

## 添付ファイル

- Codex側専用の `!attach <absolute_path>` コマンドで、Discordに添付ファイルをつけることが可能（ユーザからは、Discordを通じて「XXXXを添付して」などの指示を行って添付させます）
- ユーザ側からの `!attach` コマンドは無効にしています。
- 上限: 8MB
