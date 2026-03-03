# Discord Codex Agent

Discord からPC上の Codex CLI を操作する Bot です。技術実証用であり常用することはお勧めしません。

本ソフトは **Windows 用** です（Windows 上で動作する Node.js と OpenAI Codex を対象としています）。
本ソフトが呼び出す Node.js と Codex CLI は **Windows ネイティブで動作している環境** を前提にしています（WSLは使用しません）。そのため、**低性能の古いWindows PCを母艦として利用することができます** 。

本ソフト（DiscordのBot）を自宅PCでを稼働させ、Discordから、自宅PCのCodexを遠隔操作します。リビングや外出先から簡単にCodexを操作できます。Discordはブラウザ上で動作するので、ChromeBookなど幅広いOSから、母艦のCodexを操作することも可能です。

Discordのチャンネルやスレッドごとに別のCodexのセッションを割り当てることができるので、複数のCodexセッションをDiscordに登録することができます。例えば、作成中のアプリケーションごとにスレッドを作成し、それぞれにCodexのセッションを割り当てて、操作することが可能です。

また、「生成したファイルをここに添付して」といった指示をすることで、CodexからDiscordにファイルの添付をさせることが可能です。

その他にも、Obsidianの司書として、秘書として、ObsidianのVaultをワーキングディレクトリとするCodexをスレッド等に登録することで、「これを調べて。調べた結果をObsidianに記録しておいて。」「これに関するObsidianのページは何がある？それをDiscordに添付して」、さらに、Skillの呼び出しを活用することで「このURLをObsidianのClipフォルダにマークダウンで保存して」といった指示を与えることも可能です。

このほか、CodexのSkill機能を拡張していくことで、さまざまな機能を追加することができます。

## できること

母艦PCから離れた状態で、Discordを通じて以下のことができます。

- プログラムの開発（本ソフトもこれで開発しています）
- Obsidianの司書として、文書整理、検索、指定URLのスクラップ（Webをmarkdown化するskillを別途作成して利用）
- Googleカレンダー、タスク、GMAILを参照するAI秘書（Google APIを利用して、それぞれを読み書きするSkillを別途作成して利用）
- 旅行の企画を行い、Google Docsに反映して共有し、参加者とディスカッション（Google Docsを更新・共有等するSkillを別途作成して利用）

## 前提

- Node.js 20+（Windowsネイティブ）
- Discord Bot（本ソフト）
- ローカルで動作する Codex CLI（Windowsネイティブ）

## 事前準備

まず、Discord側の設定を行います。第三者にこのDiscordのBotをインストールされた場合、母艦PCの全て及びCodex Skillからアクセスできる全ての情報について致命的なリスクが発生しますのでご注意ください。

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

次に母艦PC側での作業となります。
git cloneし終わったら、Discordのトークンなどを.envファイルに設定します。

```bash
copy .env.example .env
npm install
```

設定は.envファイルにて行います。設定テンプレート（.env.example）を.envとしてコピーし、そこに次項を参考に設定してください。

## `.env` 主な設定

- `DISCORD_TOKEN`: Bot トークン
- `ALLOWED_CHANNEL_IDS`: DiscordのチャンネルID（カンマ区切りで複数指定可能）　←上記で控えたもの
- `ALLOWED_USER_IDS`: 第三者によるBotの不正利用対策として、実行可能ユーザーをIDで制限できます（カンマ区切り）
  - 例: `ALLOWED_USER_IDS=123456789012345678,234567890123456789`
- `ALLOWED_USER_IDS` が空の場合は全ユーザー許可
- 許可外ユーザーには `ERR_USER_NOT_ALLOWED` を返します
  
### その他の設定項目（原則変更不要）

- `SQLITE_PATH`: DB パス
- `CODEX_MODE`: `cli`（推奨）または `template`（非推奨・実験用）
- `CODEX_TIMEOUT_SEC`: Codex 実行タイムアウト秒
- `INSTANCE_LOCK_PORT`: 単一起動用ロックポート（二重起動防止の排他制御に使用しているポート）

### `CODEX_MODE=template` について

実験用の非推奨機能です。 `template` はテンプレート文字列をシェル実行するため、入力の扱い次第で **コマンドインジェクション** のリスクがあります。通常は `cli` を使ってください。ただし、 `Cli` でも、プロンプトに不正な指示を与えれば同様に危険な実行が可能ですので、注意してください。

## コマンド

### 基本

- `!help`
- `!ask <instruction>`
  - 「!」コマンドをつけず、普通のメッセージ送信でも同様に実行されます。
  - 当該Discordスレッドに割り当てられているCodexセッションに対して、指示（Prompt）を送信します。Codexセッションが未指定の場合は、新規のセッションが割り当てられます。

### セッション管理


- `!codex session <codex_thread_id>` （推奨）
  - 現在のDiscordスレッドに割り当てられているCodexセッションを、指定されたUUID（`codex_thread_id`）のCodexセッションに変更します。codex resume <UUID>`<UUID>` と同様の役割です。
- `!codex [query]`
  - Codexのセッションリストを検索します。`~/.codex/sessions` を検索して候補表示します。queryを指定しなかった場合は、最新セッションのリストが表示されます。
- `!codex pick <no>`
  - 直前の `!codex [query]` 検索結果から番号選択し、現在のDiscordスレッドに割り当てられているCodexセッションを、 `no` に対応するCodexセッションに変更します。
- `!session new [name]`
- - 現在のCodexセッションとの接続を切り、新規のCodexセッションを割り当てます。`[name]` はDiscord Agent内での管理用のセッション名称です（未使用）。
- `!session current`

  - 現在のDiscordスレッドに設定されているCodexの各種情報、`codex_thread_id` / `working_directory` / `status` / `queue` などを表示

### メンテナンスコマンド

- `!queue`
  - 実行中・待機中のキュー状態を表示します（`!queue status` と同じ）。
- `!queue stopall`
  - 全キューを緊急停止します（待機中は取消、実行中は強制停止）。
- `!queue fix`
  - `running` となっているが、対応するプロセスの存在しない、「孤児実行」を修復します。

## ログ

- `logs/last_run.log`: 起動ごとに上書き
- `logs/history-YYYY-MM-DD.log`: 日次履歴

## 添付ファイル

- Codex側から `!attach <absolute_path>` コマンドを送信することで、Discordに添付ファイルをつけることが可能です（ユーザからは、Discordを通じて「XXXXを添付して」などの指示を行って添付させます）。
- ユーザ側からの `!attach` コマンドは無効です。
- 上限: 8MB

## セキュリティ運用

本アプリの最大の単一脆弱点は Discord Bot の経路です。以下を最優先で実施してください。

- Bot を奪わせない
  - Discord Developer Portal の `Installation` で `Install Link = None` を維持
  - `Public Bot` を `OFF` に維持
  - 招待URLを発行する場合は必要時のみ・最小権限で運用
- Discord 運用者アカウントを奪わせない
  - 2FA を必須化（可能ならパスキー）
  - 開発者 / 管理者ロールを最小化
- Bot トークンを奪わせない
  - `.env` / ログ / 画面共有での漏えい防止
  - 漏えい疑い時は即時 `Regenerate Token` と再配布
- 実行環境を分離する
  - Bot は専用の Windows PC 上で稼働させ、日常利用端末と分離
