# CHANGELOG

上が最新ビルド、下へ行くほど古いビルド。

## v0.1.0 build.45 (2026-03-15)
- 添付ファイルだけの投稿も実行対象として扱い、画像やファイルのみのメッセージでもCodexへ渡せるよう修正。

## v0.1.0 build.44 (2026-03-14)
- `!queue stopall` / `!queue fix` の復旧性を改善し、停止後に同一セッションのキューが詰まり続ける問題を修正。

## v0.1.0 build.43 (2026-03-08)
- 他のクライアント（Codex CLI / Windows App）で同一 codex_thread_id が更新された場合に、Discordへ同期する !sync 機能を追加。
- 同期モードは future-only 固定。初回起動時と !sync reset は現在位置へアンカーし、過去履歴は送信しない。
- !sync / !sync on / !sync off / !sync reset を追加。
- .env に EXTERNAL_SYNC_ENABLED と EXTERNAL_SYNC_POLL_SEC を追加。

## v0.1.0 build.36 (2026-03-06)
- Codex CLI (`--json`) の stdout JSONL を逐次読み取りできるようにし、ストリーミング表示に対応した。
- `!queue` の status 出力に `working_directory` を追加。
- `working_directory` は、`codex_thread_id` から解決できる場合はそれを優先し、解決できない場合は `preferred_working_directory` を表示。

## v0.1.0 build.32 (2026-03-05)
- Discord添付ファイルを受信して保存し、Codexプロンプトへ絶対パスで連携する機能を追加。
- `INCOMING_ATTACH_DIR` / `INCOMING_ATTACH_TTL_HOURS` / `INCOMING_ATTACH_MAX_BYTES` を追加。
- 期限超過添付のクリーンアップ処理を追加。
- 添付ファイル参照のプロンプト文言を改善し、`latest_attachment_path` を導入。
- 「このファイル / これ / そのファイル」を `latest_attachment_path` に解決するルールを追加。

## v0.1.0 build.30 (2026-03-03)
- `ALLOWED_USER_IDS` を実装し、許可ユーザーのみBot操作を許可。
- `!queue` / `!queue status` / `!queue stopall` / `!queue fix` を追加。
- Codexプロセスの緊急停止とキュー復旧手段を整備。

## v0.1.0 build.29 (2026-02-28)
- Codex の WebSocket→HTTPS フォールバック時に、`agent_message` が取得できていれば成功扱いにする改善を実施。
- `Falling back from WebSockets to HTTPS transport` / `stream disconnected before completion` を警告扱いへ統一。

## v0.1.0 build.28 (2026-02-27)
- `!help` と README の基本コマンド説明を整理。
- `!ask <instruction>` と通常発話の関係を明確化。

## v0.1.0 build.26 (2026-02-24)
- 履歴ログ `history-YYYY-MM-DD.log` を日次運用前提で整備。
- 実行キューのロックキーを `codex:<codex_thread_id>` / `session:<session_id>` で明確化。
- `!session current` に `queue_lock_key` 表示を追加。

## v0.1.0 build.25 (2026-02-24)
- `!codex session <codex_thread_id>` / `!codex pick <no>` を追加。
- `SessionService.rebindCurrentSessionCodexThread()` を実装し、既存セッションへの thread 再紐付けを可能化。
- セッション切替導線を整理し、運用時の誤操作を低減。

## v0.1.0 build.19 (2026-02-14)
- `!codex search/pick` と `!session new` の `working_directory` 引き継ぎを改善し、セッション運用を安定化。
- AI出力の `!attach <absolute_path>` 指示（8MB制限）を整備し、ユーザー側 `!attach` は無効化。
- `!help` と README を更新し、ビルド番号を `build.19` に更新。
