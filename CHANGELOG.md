# CHANGELOG

## v0.1.0 build.19 (2026-02-14)
- `!codex search/pick` と `session new` の `working_directory` 継承を追加し、セッション運用を強化。
- AI出力の `!attach <absolute_path>` 自動添付（8MB上限）を実装し、ユーザー直接 `!attach` は無効化。
- `!help` と README を整理し、ビルド番号を `build.19` に更新。

## v0.1.0 build.25 (2026-02-24)
- 新しいDiscordスレッド作成直後に `!codex session <codex_thread_id>` / `!codex pick <no>` を実行した際、DiscordAgent側のセッションが未作成でも自動作成してから紐づけるように修正
- `SessionService.rebindCurrentSessionCodexThread()` を拡張し、未バインド文脈での rebind をサービス層で吸収
- 単体テストを追加し、未セッション状態からの自動作成＋rebind を検証
## v0.1.0 build.26 (2026-02-24)
- `history-YYYY-MM-DD.log` を起動時固定ではなく、OSローカル時間帯ベースで日付切替する日次ローテーションに変更（日時跨ぎ後も正しいファイルへ出力）
- 実行キューの排他単位を `DiscordAgent session` ベースから `lockKey` ベースへ拡張し、リンク済みは `codex:<codex_thread_id>`、未リンクは `session:<session_id>` を使用
- `!session current` に `queue_lock_key` を表示し、キュー詰まりの切り分けをしやすく改善
- `ExecutionManager` の単体テストを追加（同一 lockKey 直列 / 異なる lockKey 並列）

## v0.1.0 build.28 (2026-02-27)
- `!help` の基本コマンド表示を修正し、「`!` コマンドをつけず通常メッセージでも実行可」の説明を `!ask <instruction>` の直下へ移動
- `README` の基本コマンド説明を `!help` / `!ask <instruction>` の構成に合わせて修正

## v0.1.0 build.29 (2026-02-28)
- Codex実行でWebSocket切断後にHTTPSへフォールバックした際、`agent_message` が取得できていれば成功扱いに変更
- `Falling back from WebSockets to HTTPS transport` / `stream disconnected before completion` を警告扱いへ分類し、誤って `ERR_CODEX_AGENT_ERROR` で失敗確定しないよう修正

## v0.1.0 build.30 (2026-03-03)
- `ALLOWED_USER_IDS`（カンマ区切り）を追加し、許可ユーザーのみBot実行を受け付けるアクセス制御を実装
  - 非許可ユーザーからのメッセージは `ERR_USER_NOT_ALLOWED` で拒否
- `!queue` / `!queue status` / `!queue stopall` / `!queue fix` を追加し、キュー可視化・緊急停止・孤児running修復に対応
- Codexプロセス追跡と緊急停止を追加
