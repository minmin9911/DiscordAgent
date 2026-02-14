export type SessionStatus = "active" | "archived" | "busy" | "error";

export type ExecutionStatus =
  | "queued"
  | "running"
  | "success"
  | "error"
  | "timeout"
  | "cancelled";

export interface SessionRow {
  id: string;
  name: string;
  codex_thread_id: string | null;
  preferred_working_directory: string | null;
  status: SessionStatus;
  created_by: string;
  created_at: string;
  last_used_at: string;
  summary: string | null;
  archived_at: string | null;
}

export interface ExecutionRow {
  id: string;
  session_id: string;
  discord_message_id: string;
  discord_channel_id: string;
  requested_by: string;
  command_text_masked: string;
  result_status: ExecutionStatus;
  error_code: string | null;
  retry_count: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface RuntimeSessionState {
  queueLength: number;
  runningSince: string | null;
}
