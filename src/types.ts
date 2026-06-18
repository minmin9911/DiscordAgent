export type SessionStatus = "active" | "archived" | "busy" | "error";
export type SandboxMode = "workspace-write" | "danger-full-access";
export type TriggerStatus = "enabled" | "disabled";
export type TriggerType = "daily" | "weekly" | "at" | "monthly";

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
  model_override: string | null;
  sandbox_mode: SandboxMode | null;
  danger_full_access_until: string | null;
  preferred_working_directory: string | null;
  attach_instruction_sent_at: string | null;
  status: SessionStatus;
  created_by: string;
  created_at: string;
  last_used_at: string;
  summary: string | null;
  archived_at: string | null;
}

export interface TriggerRow {
  id: string;
  codex_thread_id: string;
  name: string;
  trigger_type: TriggerType;
  time_hhmm: string;
  days_csv: string | null;
  prompt: string;
  task_name: string;
  status: TriggerStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TriggerFireRow {
  id: string;
  trigger_id: string;
  fired_at: string;
  status: "pending" | "done" | "error";
  processed_at: string | null;
  error_message: string | null;
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
