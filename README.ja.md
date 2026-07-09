# Discord Codex Agent

English README: [README.md](./README.md)

Discord からPC上の Codex CLI を操作する Bot です。技術実証用であり常用することはお勧めしません。

本ソフトは **Windows 用** です（Windows 上で動作する Node.js と OpenAI Codex を対象としています）。
本ソフトが呼び出す Node.js と Codex CLI は **Windows ネイティブで動作している環境** を前提にしています（WSLは使用しません）。そのため、**低性能の古いWindows PCを母艦として利用することができます** 。

本ソフト（DiscordのBot）を自宅PCでを稼働させ、Discordから、自宅PCのCodexを遠隔操作します。リビングや外出先から簡単にCodexを操作できます。Discordはブラウザ上でも動作するので、ChromeBookなど幅広いOSから、母艦のCodexを操作することも可能です。

Discordのチャンネルやスレッドごとに別のCodexのセッションを割り当てることができるので、複数のCodexセッションをDiscordに登録することができます。例えば、作成中のアプリケーションごとにスレッドを作成し、それぞれにCodexのセッションを割り当てて、操作することが可能です。

また、「生成したファイルをここに添付して」といった指示をすることで、CodexからDiscordにファイルの添付をさせることが可能です。

その他にも、Obsidianの司書として、秘書として、ObsidianのVaultをワーキングディレクトリとするCodexをスレッド等に登録することで、「これを調べて。調べた結果をObsidianに記録しておいて。」「これに関するObsidianのページは何がある？それをDiscordに添付して」、さらに、Skillの呼び出しを活用することで「このURLをObsidianのClipフォルダにマークダウンで保存して」といった指示を与えることも可能です。

このほか、CodexのSkill機能を拡張していくことで、さまざまな機能を追加することができます。

## できること

母艦PCから離れた状態で、Discordを通じて以下のことができます。

* プログラムの開発（本ソフトもこれで開発しています）

* Obsidianの司書として、文書整理、検索、指定URLのスクラップ（Webをmarkdown化するskillを別途作成して利用）

* CodexのSkillを作成することで、機能を拡張可能です。そのSkillも、Codex Agentを通じて作成可能です。

* Googleカレンダー、タスク、GMAILを参照するAI秘書（Google APIを利用して、それぞれを読み書きするSkillを別途作成して利用）

* 旅行の企画を行い、Google Docsに反映して共有し、参加者とディスカッション（Google Docsを更新・共有等するSkillを別途作成して利用）

* Edgeブラウザのサイドバーでdiscord.comを開くことで、ブラウズしながら、いつでもCodexを秘書として活用できます。

## 前提

* Node.js 20+（Windowsネイティブ）

* Discord Bot（本ソフト）

* ローカルで動作する Codex CLI（Windowsネイティブ）

## 事前準備

まず、Discord側の設定を行います。第三者にこのDiscordのBotをインストールされた場合、母艦PCの全て及びCodex Skillからアクセスできる全ての情報について致命的なリスクが発生しますのでご注意ください。

1. Discord で、自分専用のサーバーとチャンネルを作成します（既にある場合は省略可）
2. Discord Developer Portal で Application / Bot を作成
3. `Installation` タブで `Install Link = None` に設定（公開インストール導線を無効にするため）
4. `Bot` タブでトークンを控え（発行済みの場合は再発行する）、また、`Public Bot` を OFF
5. OAuth2 URL Generator で Bot を対象サーバーへ招待（下記の権限を参考に設定してください）

   * `SCOPES`: `bot`

   * `BOT PERMISSIONS`（最低限）:

     * `View Channels`

     * `Send Messages`

     * `Send Messages in Threads`

     * `Read Message History`

     * `Attach Files`
6. Discordクライアントの設定で「開発者モード」に変更し、利用するチャンネルを右クリックして、チャンネルIDをコピーし、メモに控えてください。

## スクリプト本体の準備

次に母艦PC側での作業となります。
リポジトリを取得し、`.env` を作成します。

```bash
git clone https://github.com/minmin9911/DiscordAgent.git
cd DiscordAgent
copy .env.example .env
```

その後、`.env` に Discord のトークンなどを設定し、依存関係をインストールします。

```bash
npm install
```

設定は.envファイルにて行います。設定テンプレート（.env.example）を.envとしてコピーし、そこに次項を参考に設定してください。

Bot の起動は次です。

```bat
run_DiscordAgent.cmd
```

DiscordAgent が自らを再起動させる操作を行わない場合は、次でも起動できます。

```bash
npm start
```

## `.env` 主な設定

* `APP_LOCALE`: Botの表示言語（`ja` または `en`、省略時はWindowsのOSロケールから決定）

* `DISCORD_TOKEN`: Bot トークン

* `ALLOWED_CHANNEL_IDS`: DiscordのチャンネルID（カンマ区切りで複数指定可能）　←上記で控えたもの

* `ALLOWED_USER_IDS`: 第三者によるBotの不正利用対策として、実行可能ユーザーをIDで制限できます（カンマ区切り）

  * 例: `ALLOWED_USER_IDS=123456789012345678,234567890123456789`

* `ALLOWED_USER_IDS` が空の場合は全ユーザー許可

* 許可外ユーザーには `ERR_USER_NOT_ALLOWED` を返します

### その他の設定項目（原則変更不要）

* `SQLITE_PATH`: DB パス

* `DEFAULT_AGENT_WORKDIR_ROOT`: 新規セッションの既定 working_directory ルート（既定 `./workspaces`）

* `CODEX_MODE`: `cli`（推奨）または `template`（非推奨・実験用）

* `CODEX_TIMEOUT_SEC`: Codex 実行タイムアウト秒

* `INCOMING_ATTACH_DIR`: Discord受信添付の保存先ディレクトリ

* `INCOMING_ATTACH_TTL_HOURS`: 受信添付の保持時間（時間）

* `INCOMING_ATTACH_MAX_BYTES`: 受信添付1ファイルあたりの最大サイズ（bytes）

* `INSTANCE_LOCK_PORT`: 単一起動用ロックポート（二重起動防止の排他制御に使用しているポート）

* `SHOW_FINAL_STREAM_LOG`: 完了ヘッダに `stream_log` を表示するか（既定 `true`）

実行ごとの完了ヘッダには、その実行時点の sandbox / 承諾状態が表示されます。

`FORCE_LEGACY_FULL_ACCESS=true` の場合、この承諾状態行は表示しません。

新規作成されたアプリセッションは、既定で `DEFAULT_AGENT_WORKDIR_ROOT/<session_id>` を working_directory として使用します。

### `CODEX_MODE=template` について

実験用の非推奨機能です。 `template` はテンプレート文字列をシェル実行するため、入力の扱い次第で **コマンドインジェクション** のリスクがあります。通常は `cli` を使ってください。ただし、 `Cli` でも、プロンプトに不正な指示を与えれば同様に危険な実行が可能ですので、注意してください。

## コマンド

### `!help agent` の用途

`!help agent` は、**Agent に DiscordAgent 専用コマンド（`!trigger` / `!attach`）を理解させるためのコマンド**です。  
Agent は必要に応じてこのコマンドを自発的に利用できます。また、ユーザが明示的に実行して Agent に教え込むこともできます。

- 主な対象:
  - `!trigger ...`（ユーザ・Agent兼用コマンド）
  - `!attach <absolute_path>`（Agent専用コマンド）
- 主な用途:
  - 新しい会話文脈で DiscordAgent コマンドを使わせる前
  - Agent が Skill を優先してしまい、DiscordAgent コマンドを使わないとき
  - Agent 自身がコマンドの使い方を確認したいときに参照する

注意:
- `!help agent` を連続で実行するとループ防止のため中断されます。

### 基本

* `!help`

* `!ask <instruction>`

  * 「!」コマンドをつけず、普通のメッセージ送信でも同様に実行されます。

  * 当該Discordスレッドに割り当てられているCodexセッションに対して、指示（Prompt）を送信します。Codexセッションが未指定の場合は、新規のセッションが割り当てられます。

### セッション管理

* `!codex session <codex_thread_id>` （推奨）

  * 現在のDiscordスレッドに割り当てられているCodexセッションを、指定されたUUID（`codex_thread_id`）のCodexセッションに変更します。codex resume <UUID>`<UUID>` と同様の役割です。

* `!codex [query]`

  * Codexのセッションリストを検索します。`~/.codex/sessions` を検索して候補表示します。queryを指定しなかった場合は、最新セッションのリストが表示されます。

* `!codex pick <no>`

  * 直前の `!codex [query]` 検索結果から番号選択し、現在のDiscordスレッドに割り当てられているCodexセッションを、 `no` に対応するCodexセッションに変更します。

* `!session new [name]`

* <br />

  * 現在のCodexセッションとの接続を切り、新規のCodexセッションを割り当てます。`[name]` はDiscord Agent内での管理用のセッション名称です（未使用）。

* `!session current`

  * 現在のDiscordスレッドに設定されているCodexの各種情報、`codex_thread_id` / `working_directory` / `status` / `queue` などを表示

* `!model`

  * このセッションで利用できるモデル一覧を表示します。

* `!model <no>`

  * このセッションで使うモデルを切り替えます。

  * `0` は Codex の config.toml で指定されているモデル（デフォルトモデル）を使用します。

  * data\models.yamlが一覧のソースです。残念ながら、Codexのexec機能にはモデル名一覧を取得する機能がないため、機能が提供されない限り、一覧表の更新は手動で行う必要があります。

### トリガー

このコマンドは Agent が実行することを想定していますが、ユーザによる実行も可能です。  
トリガーの発火には Windows タスクスケジューラを利用します。

* `!trigger add daily HH:mm <prompt>`

  * 毎日指定時刻に実行するトリガーを追加します。

* `!trigger add weekly Mon,Wed HH:mm <prompt>`

  * 毎週指定曜日・指定時刻に実行するトリガーを追加します。

* `!trigger add monthly <day(1-31)> HH:mm <prompt>`

  * 毎月指定日・指定時刻に実行するトリガーを追加します。

* `!trigger add monthly <1-4|last> <Mon|Tue|...> HH:mm <prompt>`

  * 毎月「第N曜日」または「最終曜日」の指定時刻に実行するトリガーを追加します。

* `!trigger add at YYYY-MM-DD HH:mm <prompt>`

  * 指定日時に1回だけ実行するトリガーを追加します。

* `!trigger list`

  * 登録済みトリガーの一覧を表示します。

  * 無効なトリガーは `[OFF]`、有効なトリガーは `[ON]` セクションに分けて表示されます。

* `!trigger show <id>`

  * 指定したトリガーの詳細を表示します。

  * 実行される `prompt` 全文も確認できます。

* `!trigger edit <id> <prompt>`

  * 指定したトリガーの `prompt` を更新します。

* `!trigger stop <id>`

  * 指定したトリガーを停止します。

* `!trigger delete <id>`

  * 指定したトリガーを削除します。

* `!trigger env show <id>`

  * 指定したトリガーの実行環境を表示します。
  * override 未設定時は `working_directory` / `sandbox_mode`、override 設定時は `working_directory(override)` / `sandbox_mode(override)` が表示されます。

* `!trigger env set workdir <id> <absolute_path>`

  * 指定したトリガー実行時だけ使う working directory を設定します。

* `!trigger env set sandbox <id> <on|off>`

  * 指定したトリガー実行時だけ使う sandbox モードを設定します。
  * `on` は `workspace-write`、`off` は `danger-full-access` を意味します。

* `!trigger env clear <id>`

  * 指定したトリガーの実行環境 override をまとめて解除します。

* `!trigger env clear workdir <id>`

  * 指定したトリガーの working directory override だけを解除します。

* `!trigger env clear sandbox <id>`

  * 指定したトリガーの sandbox override だけを解除します。

### メンテナンスコマンド

* `!queue`

  * 実行中・待機中のキュー状態を表示します（`!queue status` と同じ）。

* `!queue stopall`

  * 全キューを緊急停止します（待機中は取消、実行中は強制停止）。
  * 短縮コマンドとして `!stopall` / `!allstop` も使用できます。

* `!queue fix`

  * `running` となっているが、対応するプロセスの存在しない、「孤児実行」を修復します。

* `!sandbox on`

  * このセッションを `workspace-write` で実行します。ワーキングディレクトリ内の操作を基本とする既定設定です。

* `!sandbox off`

  * このセッションを常時 `danger-full-access` で実行します。

* `!sandbox dir add <absolute_path>`

  * sandbox 外のフォルダを指定することで、承認なくそのフォルダにアクセスできるようにするコマンドです。

  * このセッションの Codex スレッドに、追加許可ディレクトリを設定します。

* `!sandbox dir remove <absolute_path>`

  * 追加許可ディレクトリを削除します。

* `!sandbox dir list`

  * 現在設定されている追加許可ディレクトリを表示します。

* `!sandbox dir clear`

  * 追加許可ディレクトリをすべて削除します。

* `!ok`

  * 直近の権限不足リクエストを1回だけ `danger-full-access` で再実行します。
  * `!ok <prompt>` とすると、その prompt を 1回だけ full access で実行します。sudo のイメージです。

* `!ok <minutes>`

  * 指定分数だけ、このセッションを一時的に `danger-full-access` で実行します。上限は60分です。
  * `!ok <minutes> <prompt>` とすると、その prompt を full access で実行します。その後、指定した分数だけ full access 状態が持続します。sudo の時間限定版のイメージです。

* `!ng`

  * 直近の権限不足リクエストを破棄します。

## ログ

* `logs/last_run.log`: 起動ごとに上書き

* `logs/history-YYYY-MM-DD.log`: 日次履歴

## 添付ファイル

* Codex側から `!attach <absolute_path>` コマンドを送信することで、Discordに添付ファイルをつけることが可能です（ユーザからは、Discordを通じて「XXXXを添付して」などの指示を行って添付させます）。

* ユーザ側からの `!attach` コマンドは無効です。

* 上限: 8MB

* ユーザが投稿した添付ファイル（画像等）は `INCOMING_ATTACH_DIR` に一時保存され、次回のCodex実行時に絶対パスが自動でプロンプトへ付与されます。

* 一時保存ファイルは `INCOMING_ATTACH_TTL_HOURS` を過ぎると定期クリーンアップで削除されます。

## セキュリティ運用

本アプリの最大の単一脆弱点は Discord Bot の経路です。以下を最優先で実施してください。

* Bot を奪わせない

  * Discord Developer Portal の `Installation` で `Install Link = None` を維持

  * `Public Bot` を `OFF` に維持

  * 招待URLを発行する場合は必要時のみ・最小権限で運用

* Discord 運用者アカウントを奪わせない

  * 2FA を必須化（可能ならパスキー）

  * 開発者 / 管理者ロールを最小化

* Bot トークンを奪わせない

  * `.env` / ログ / 画面共有での漏えい防止

  * 漏えい疑い時は即時 `Regenerate Token` と再配布

* 実行環境を分離する

  * Bot は専用の Windows PC 上で稼働させ、日常利用端末と分離

# その他

run\_DiscordAgent.cmd では、本ソフトが繰り返し起動するようになっています。
（直接npmせず）このバッチファイルから起動し、Codexに「npmプロセスを狙い撃ちでKill」させることで、外出先から本ソフトを再起動させることが可能です。
但し、意図せぬ挙動をした場合に、外出先から一切の操作ができなくなり、破壊的な影響が生じる可能性もありますので、リスクを理解して利用してください。

## 外部同期

Codex CLIやVSCodeの拡張などからCodexに指示を与えた履歴をDiscord側にフィードバックします。
但し、久しぶりに起動したときなどに同期量が爆発しないように、上限を超えた同期は切り捨てられます（最新メッセージを優先）。

* `!sync` : 外部クライアント同期の状態表示

* `!sync on` / `!sync off` : 外部同期の有効/無効

* `!sync reset` : 現在位置を送信済みとして再アンカー（過去分は送信しない）

関連する `.env` の項目は以下の通りです。

* `EXTERNAL_SYNC_ENABLED`: 起動時の外部同期有効フラグ（`true`/`false`）

* `EXTERNAL_SYNC_POLL_SEC`: 同期間隔（秒、既定15）

* `EXTERNAL_SYNC_MAX_BURST`: 1回の同期で送信する最大件数（既定30、超過分は古い順に送信スキップ）

* `EXTERNAL_SYNC_USER_MAX_CHARS`: 外部同期の `user_message` を送信前に切り詰める最大文字数（既定300）

## Skill による拡張例

DiscordAgent に限った話ではありませんが、Codexは、Skill を追加することで用途を大きく広げられます。\
Skill は Codex に指示して、ユーザ自らで作成できるため、自分専用の秘書、音声窓口、ブラウザ自動化ツールとして育てていけます。以下は、私が実際に Codex に作成させて、DiscordAgent から呼び出している Skill の例となります。

・名前: `local-voice-command-intake`\
・機能: 音声ファイル（`*.ogg`）をローカルで文字起こしし、依頼文に整える\
・用途: Discord に音声を送るだけで、話し言葉の依頼を Codex へ渡せる\
・技術: `faster-whisper`

・名前: `web2markdown-clip`\
・機能: 指定した URL を Markdown 化して Obsidian の Vault に保存する\
・用途: 気になった記事や資料を Discord からそのまま知識ベースへ蓄積できる\
・技術: `PowerShell`, `Readability`, `Turndown`, `Playwright`

・名前: `google-calendar-rw`\
・機能: Google Calendar の参照、作成、更新、削除を自然言語で行う\
・用途: 予定確認や日程調整を Discord 上の会話から進められる\
・技術: `Google Calendar API`

・名前: `google-gmail-rw`\
・機能: Gmail の参照、送信、状態更新、ゴミ箱移動を自然言語で行う\
・用途: メール確認や返信下書きを Discord から依頼できる\
・技術: `Gmail API`

・名前: `google-tasks-rw`\
・機能: Google Tasks の参照、作成、更新、削除を自然言語で行う\
・用途: やること整理やタスク追加を Discord の会話から進められる\
・技術: `Google Tasks API`

・名前: `edge-browser-operator`\
・機能: Windows ネイティブの Microsoft Edge を Playwright で操作する\
・用途: ブラウザ操作を伴う調査や定型作業を Discord から自動化できる\
・技術: `Playwright`, `Microsoft Edge`

・名前: `restart-discordagent-windows`\
・機能: `run_DiscordAgent.cmd` から呼び出されている `node.exe` を狙い撃ちで終了し、DiscordAgent を再起動させる\
・用途: 外出先からでも DiscordAgent を自殺的に再起動し、復旧につなげられる\
・技術: `PowerShell`, `Windows process control`

「何をしたいか」「どう運用したいか」を Codex に伝えれば、Codexは自分に合った Skill を開発してくれます。

たとえば、Gmail で届いた会社からのメールに記載された予定をカレンダーに登録し、そのメールに記載された「会議」について準備するというタスクをGoogleタスクに追加するといった複合的な依頼も可能です。\
また、「予定変更の連絡がメールで来ているので、新しい時間に合わせてカレンダーに登録済みの『移動』予定の時間帯を変更してください」のように、メール確認と既存予定の更新を組み合わせた処理も行えます。
