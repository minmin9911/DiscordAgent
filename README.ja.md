# Discord Codex Agent

English README: [README.md](./README.md)

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

・プログラムの開発（本ソフトもこれで開発しています）
・Obsidianの司書として、文書整理、検索、指定URLのスクラップ（Webをmarkdown化するskillを別途作成して利用）
・CodexのSkillを作成することで、機能を拡張可能です。そのSkillも、Codex Agentを通じて作成可能です。
・Googleカレンダー、タスク、GMAILを参照するAI秘書（Google APIを利用して、それぞれを読み書きするSkillを別途作成して利用）
・旅行の企画を行い、Google Docsに反映して共有し、参加者とディスカッション（Google Docsを更新・共有等するSkillを別途作成して利用）
・Edgeブラウザのサイドバーでdiscord.comを開くことで、ブラウズしながら、いつでもCodexを秘書として活用できます。

## 前提

・Node.js 20+（Windowsネイティブ）
・Discord Bot（本ソフト）
・ローカルで動作する Codex CLI（Windowsネイティブ）

## 事前準備

まず、Discord側の設定を行います。第三者にこのDiscordのBotをインストールされた場合、母艦PCの全て及びCodex Skillからアクセスできる全ての情報について致命的なリスクが発生しますのでご注意ください。

1. Discord で、自分専用のサーバーとチャンネルを作成します（既にある場合は省略可）
2. Discord Developer Portal で Application / Bot を作成
3. `Installation` タブで `Install Link = None` に設定（Public Botにするために必要）
4. `Bot` タブでトークンを控え（発行済みの場合は再発行する）、また、`Public Bot` を OFF
5. OAuth2 URL Generator で Bot を対象サーバーへ招待（下記の権限を参考に設定してください）

   ・`SCOPES`: `bot`
   ・`BOT PERMISSIONS`（最低限）:
   ・`View Channels`
   ・`Send Messages`
   ・`Send Messages in Threads`
   ・`Read Message History`
   ・`Attach Files`

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

・`DISCORD_TOKEN`: Bot トークン
・`ALLOWED_CHANNEL_IDS`: DiscordのチャンネルID（カンマ区切りで複数指定可能）
・`ALLOWED_USER_IDS`: 実行可能ユーザーをIDで制限できます（カンマ区切り）
・`ALLOWED_USER_IDS` が空の場合は全ユーザー許可
・許可外ユーザーには `ERR_USER_NOT_ALLOWED` を返します

### その他の設定項目（原則変更不要）

・`SQLITE_PATH`: DB パス
・`CODEX_MODE`: `cli`（推奨）または `template`（非推奨・実験用）
・`CODEX_TIMEOUT_SEC`: Codex 実行タイムアウト秒
・`INCOMING_ATTACH_DIR`: Discord受信添付の保存先ディレクトリ
・`INCOMING_ATTACH_TTL_HOURS`: 受信添付の保持時間（時間）
・`INCOMING_ATTACH_MAX_BYTES`: 受信添付1ファイルあたりの最大サイズ（bytes）
・`INSTANCE_LOCK_PORT`: 単一起動用ロックポート（二重起動防止の排他制御に使用しているポート）
・`EXTERNAL_SYNC_ENABLED`: 起動時の外部同期有効フラグ（`true`/`false`）
・`EXTERNAL_SYNC_POLL_SEC`: 同期間隔（秒、既定15）
・`EXTERNAL_SYNC_MAX_BURST`: 1回の同期で送信する最大件数（既定30）
・`EXTERNAL_SYNC_USER_MAX_CHARS`: 外部同期の user_message を送信前に切り詰める最大文字数（既定300）

## コマンド

### 基本

・`!help`
・`!ask <instruction>`
  ・「!」コマンドをつけず、普通のメッセージ送信でも同様に実行されます。

### セッション管理

・`!session new [name]`
・`!session current`
・`!codex [query]`
・`!codex pick <no>`
・`!codex session <codex_thread_id>`

### メンテナンスコマンド

・`!queue`
・`!queue stopall`
・`!queue fix`
・`!sync`
・`!sync on` / `!sync off`
・`!sync reset`

## 添付ファイル

・Codex側から `!attach <absolute_path>` を返すことで、Discordにファイルを添付できます。
・ユーザが投稿した添付ファイル（画像等）は `INCOMING_ATTACH_DIR` に一時保存され、次回のCodex実行時に絶対パスが自動でプロンプトへ付与されます。
・添付ファイルだけの投稿も実行対象として扱われます。

## ログ

・`logs/last_run.log`: 起動ごとに上書き
・`logs/history-YYYY-MM-DD.log`: 日次履歴

## セキュリティ運用

本アプリの最大の単一脆弱点は Discord Bot の経路です。以下を最優先で実施してください。

・Bot を奪わせない
・Discord 運用者アカウントを奪わせない
・Bot トークンを奪わせない
・実行環境を分離する

## その他

`run_DiscordAgent.cmd` では、本ソフトが繰り返し起動するようになっています。
このバッチファイルから起動し、Codex に `npm` プロセスを狙い撃ちで kill させることで、外出先から再起動させることが可能です。

## 外部同期

Codex CLI や VSCode 拡張などから同一 `codex_thread_id` が更新された場合、その履歴を Discord 側へフィードバックできます。
過去履歴は送信せず、未来の更新のみ同期します。同期量が多い場合は最新メッセージを優先します。
