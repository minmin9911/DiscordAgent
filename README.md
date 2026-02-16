# Discord Codex Agent

Discord からローカルの Codex CLI を操作する Bot です。

## 前提

- Node.js 20+
- Discord Bot
- ローカルで動作する Codex CLI

## 事前準備

1. Discord でサーバー/チャンネルを（必要なら、チャンネルのしたにスレッドも）作成
2. Discord Developer Portal で Application / Bot を作成
3. `Installation` タブで `Install Link = None` に設定
4. `Bot` タブで `Public Bot` を OFF
5. OAuth2 URL Generator で Bot を対象サーバーへ招待
6. クライアントを設定から開発者モードに変更し、利用するチャンネルを右クリックしてチャンネルIDを控える

## スクリプト本体の準備

```bash
copy .env.example .env
npm install
npm run dev
```

## `.env` 主な設定

- `DISCORD_TOKEN`: Bot トークン
- `ALLOWED_CHANNEL_IDS`: 許可チャンネルID（カンマ区切り）
- `SQLITE_PATH`: DB パス
- `CODEX_MODE`: `cli`（推奨）または `template`（非推奨）
- `CODEX_TIMEOUT_SEC`: Codex 実行タイムアウト秒
- `INSTANCE_LOCK_PORT`: 単一起動用ロックポート

### `CODEX_MODE=template` について

`template` はテンプレート文字列をシェル実行するため、入力の扱い次第で **コマンドインジェクション** のリスクがあります。通常は `cli` を使ってください。

## コマンド

### 基本

- `!help`
- `!ask <instruction>`
  - `!ask` を付けずに、通常メッセージでも同様です。

### セッション管理（公開）

- `!codex [query]`
  - `~/.codex/sessions` を検索して候補表示（省略時は最新候補）
- `!codex pick <no>`
  - 直前の `!codex` 結果から番号選択し、現在セッションの `codex_thread_id` を差し替え
- `!codex session <codex_thread_id>`
  - 現在セッションの `codex_thread_id` を直接指定して差し替え
- `!session new [name]`
  - 現在セッションとの接続を切り、新しいセッションを開始（Codexスレッドも新規）
- `!session current`
  - `codex_thread_id` / `working_directory` / `status` / `queue` などを表示

## ログ

- `logs/last_run.log`: 起動ごとに上書き
- `logs/history-YYYY-MM-DD.log`: 日次履歴

## 添付ファイル

- Codex側専用の `!attach <absolute_path>` コマンドを使うことで、Discordに添付ファイルをつけることが可能（「XXXXを添付して」などの指示による）
- ユーザ側からの `!attach` コマンドは無効
- 上限: 8MB