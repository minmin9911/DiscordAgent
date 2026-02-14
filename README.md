# Discord Codex Agent

Discordの指定チャンネルで受信したメッセージを、ローカルCodexへ渡して実行するBotです。  
セッションを保持し、`!session` コマンドで切り替えて運用できます。

なお、このプログラムは、コンセプト実証用です。安全性の面から、常用することはお勧めしません。

## 前提
- Node.js 20+
- Discord Bot Token
- ローカルで実行可能な Codex コマンド

## できること

- Discordのチャンネルやその下のスレッドごとに、ローカルPCで稼働しているCodex CLIのセッションを割り当てることで、Discordを通じてローカルのCodexを操作できます。
- Codexに対して、ローカルのファイルをDiscordに添付するよう指示することができます。
- 一定程度のキューイングを行っていますので、処理中にコマンドを投げても順番に処理されます。
- Botサーバが起動していないときに送信したメッセージは、その後Botサーバが起動したときに処理されます（誤動作を想定して、３メッセージまでに制限しています）。
- チャンネルやスレッドごとにセッション管理をしています。あるスレッドで、新しいセッションに切り替えた場合でも、ワーキングディレクトリだけは引き継いで新しいセッションを作成します。同一対象物に対して、別の話題に切り替えるような場面を想定しています。

## 制限事項

- このプログラムはコンセプト実証用です。常用はお勧めしません。
- Codex呼び出しの際に--dangerously-bypass-approvals-and-sandboxをつけているため、外部の悪意に対して、本Botをインストールした端末は極めて脆弱になります。
- また、Botの設定を誤ったり、トークンが流出した場合、不正なプロンプトが入力され、端末内のファイルがDiscordに添付されて流出する恐れがあります。
- とにかく、このBotに第三者がアクセスできた時点で、あなたのPCはまな板の鯉となります。

## Private運用: 初期セットアップ（Step by Step）
0. Discord側の事前準備
- Discordサーバー（ギルド）を作成する
  - 本アプリは、公開しての利用を前提としていないので、自分以外が在籍していない専用のDiscordサーバとして作成する。
- テキストチャンネルを作成する
- 必要に応じて、そのチャンネル配下にスレッドを作成する

1. Discord Developer Portalでアプリを作成
- `https://discord.com/developers/applications` を開く
- `New Application` で新規作成

1. Botを作成してトークンを取得
- 左メニュー `Bot` を開く
- `Reset Token` または `Copy` で Bot Token を取得
- Tokenは `.env` の `DISCORD_TOKEN` に設定する

1. Public BotはOFFにする（Private運用）
- `Installation` タブで `Install Link` を `None` にしておく
- `Bot` 画面の `Public Bot` をOFF
- `Save Changes` を押す
- もし保存できない場合:
  - `Installation` タブで `Install Link = None` になっているか確認

1. Botを自分のサーバーへ招待
- `OAuth2 > URL Generator` を開く
- `SCOPES` は `bot` を選択
- `BOT PERMISSIONS` は最小限（例: View Channels / Send Messages / Read Message History）
- 生成されたURLで、運用対象サーバーに招待

1. 反応させるチャンネルIDを取得
- Discordクライアントの開発者モードをON
- 対象テキストチャンネルを右クリックして `IDをコピー`
- スレッド運用する場合も、.envに登録するのは親チャンネルID（配下スレッドは自動で対象となる）

1. `.env` を作成
```bash
copy .env.example .env
```
- 最低限以下を設定:
  - `DISCORD_TOKEN=<2.で取得したBot Token>`
  - `ALLOWED_CHANNEL_IDS=<5.で取得したチャンネルID>`（複数はカンマ区切り）
  - `CODEX_MODE=cli`

1. 依存をインストール
```bash
npm install
```

1. 起動
```bash
npm run dev
```
- または `run_DiscordAgent.cmd` でも起動可能

1. 起動確認
- コンソールに `build: vX.Y.Z build.N` が出る
- ログに `bot ready` が出る
- `logs/last_run.log` に起動ログが出る

1.  Discord側の動作確認
- 許可チャンネルで `!help` を送信
- `!session current` でセッション情報表示を確認
- 通常メッセージ送信でCodex実行が開始されることを確認

1.  Private運用の安全チェック（推奨）
- `ALLOWED_CHANNEL_IDS` は必要最小限のみ
- Bot TokenをGitに含めない（`.env` をコミットしない）
- 不要サーバーにBotを入れない
- 定期的にTokenをローテーションする

## セットアップ
```bash
copy .env.example .env
npm install
```

`.env` の主な設定:
- `DISCORD_TOKEN`: Discord Bot のトークン
- `ALLOWED_CHANNEL_IDS`: 反応対象チャンネルID（カンマ区切り）
- `SQLITE_PATH`: SQLiteファイルの保存先
- `CODEX_MODE`: `cli`（推奨）または `template`（非推奨）
  - `template` はユーザー入力をシェル実行コマンドへ埋め込む構成のため、コマンドインジェクションのリスクがあります。
- `INSTANCE_LOCK_PORT`: 単一起動判定に使うローカルポート
- `CODEX_EXEC_TEMPLATE`: Codex実行テンプレート(CODEX_MODE: templateで使用)
  - `{input}` と `{sessionId}` を置換して実行
  - 例: `codex --session {sessionId} {input}`

`CODEX_MODE=cli` の場合:
- 内部で `codex exec --dangerously-bypass-approvals-and-sandbox --json` を実行
- 初回レスポンスの `thread_id` を保存
- 2回目以降は `codex exec resume <thread_id>` で継続
- `thread_id` に対応する元の working directory (`~/.codex/sessions` の `session_meta.cwd`) が見つかる場合、`codex` プロセスをその `cwd` で起動して resume

## 起動
```bash
npm run dev
```

起動時に標準出力へ `build: vX.Y.Z build.N` を表示します。

単一起動ガード:
- 同じPCで2つ目を起動すると、`another instance is already running` を出して終了します。
- ロックはローカルポートで保持し、プロセス終了時にOSが自動解放します。
- 再起動時に `queued/running` の実行レコードは `cancelled (ERR_BOT_RESTARTED)` に確定します。
- 実行中が異常に残留した場合、ウォッチドッグで `timeout (ERR_EXEC_WATCHDOG_TIMEOUT)` または `timeout (ERR_STALE_RUNNING_TIMEOUT)` に確定します。

実行ログ（常時出力）:
- `logs/last_run.log`: 起動ごとに上書きされるデバッグ用ログ
- `logs/history-YYYY-MM-DD.log`: 日別の履歴ログ（追跡用）

ビルドして起動する場合:
```bash
npm run build
npm start
```

## コマンド
- 用語定義:
  - `session_id`: このアプリ（DiscordAgent）内で管理するセッションID
  - `codex_thread_id`: Codex 側のセッションID（thread_id）
  - `working_directory`: Codex 実行時の作業ディレクトリ
- `!help`
- `!codex <query>`（`~/.codex/sessions` から候補を検索して表示）
- `!codex pick <no>`（直前の `!codex` 検索結果から番号で選択して接続）
- `!session new [name]`（新規セッションを作成。直前セッションが存在する場合は `working_directory` を引き継ぐ）
- `!session connect <codex_thread_id>`（既知のCodexセッションに接続）
- `!session <codex_thread_id>`（`connect` の短縮形）
- `!session list [query]`（Bot DBにある既知のCodexセッションをリスト表示）
- `!session switch <id|name|no>`（Bot DBにある既知のCodexセッションへ切替）
- `!session current`（現在紐づいている`session_id` / `codex_thread_id` / `working_directory` を表示）
- `!session help`（`!help` と同等のヘルプを表示）
- `!ask <指示>`（Codexに渡されます。!askは省略可能であり、通常発話でも同様に実行）

通常メッセージ（行頭が `!` の行以外）は、現在セッションへの実行指示として、Codexに渡されます。
行頭が `!` で既知コマンドと一致しない場合は、構文エラーを返し、その下にヘルプを表示します。
Codex専用のコマンドとして、`!attach` が存在しています。ユーザからは使用できません。「XXを添付して」のように指示をして、Codex側に使用させてください。Bot がこの行を検出して自動添付します（1ファイル上限 8MB）。
ホワイトリストに指定したチャンネルIDの配下スレッドも自動で反応対象になります。
セッションの紐づけはチャンネル/スレッド単位で保持されるため、スレッドごとに別セッションへ接続できます。
Discordのシステムメッセージは無視します。

## 詳細メモ
- 同一セッションは直列キュー、別セッションは並列実行
- キュー上限: 20
- タイムアウト: 30分（上限60分）
- 進捗通知: 30秒間隔
- 応答は要約を付けず、本文をそのまま分割投稿
- 返信分割: 1800文字
- 監査ログ保持: 90日（日次クリーンアップ）