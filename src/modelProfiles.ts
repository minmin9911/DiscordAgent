import type { CodexDisplayDefaults } from "./codexDisplayDefaults.js";
import type { ModelCatalogLoadResult } from "./modelCatalog.js";
import { isReasoningEffortSupported } from "./reasoningEffort.js";
import type { ModelProfileName, ReasoningEffort, SessionRow } from "./types.js";

const EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];
export interface ModelProfile { model: string; effort: ReasoningEffort | null }
export interface ResolvedModelSettings {
  source: "config" | "explicit" | ModelProfileName;
  modelOverride: string | null;
  reasoningEffortOverride: ReasoningEffort | null;
  model: string | null;
  effort: string | null;
  warnModel: boolean;
  warnEffort: boolean;
}

export const modelProfileKey = (name: ModelProfileName): string => `model_profile:${name}`;

export function readModelProfile(read: (key: string) => string | null, name: ModelProfileName): ModelProfile | null {
  const raw = read(modelProfileKey(name));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ModelProfile;
    if (!value || typeof value.model !== "string" || !value.model.trim()
      || value.model === "default" || (value.effort !== null && !EFFORTS.includes(value.effort))) {
      throw new Error();
    }
    return value;
  } catch {
    throw new Error(`ERR_MODEL_PROFILE_INVALID: ${name}`);
  }
}

export function validateModelProfile(profile: ModelProfile, catalog: ModelCatalogLoadResult): void {
  const item = catalog.items.find(item => item.id === profile.model);
  if (!item || item.disabled || item.id === "default") throw new Error("ERR_MODEL_PROFILE_MODEL_UNAVAILABLE");
  if (profile.effort && !isReasoningEffortSupported(profile.model, profile.effort, catalog)) {
    throw new Error("ERR_MODEL_PROFILE_EFFORT_UNSUPPORTED");
  }
}

export function resolveModelSettings(
  session: Pick<SessionRow, "model_override" | "model_profile" | "reasoning_effort_override">,
  read: (key: string) => string | null,
  defaults: CodexDisplayDefaults,
  catalog: ModelCatalogLoadResult,
): ResolvedModelSettings {
  const source = session.model_override ? "explicit" : session.model_profile ?? "config";
  const profile = source === "coding" || source === "office" ? readModelProfile(read, source) : null;
  if ((source === "coding" || source === "office") && !profile) {
    throw new Error(`ERR_MODEL_PROFILE_UNDEFINED: !model ${source} <no> [effort]`);
  }
  if (profile) validateModelProfile(profile, catalog);
  const modelOverride = session.model_override ?? profile?.model ?? null;
  const model = modelOverride ?? defaults.model;
  const reasoningEffortOverride = session.reasoning_effort_override ?? profile?.effort ?? null;
  if (reasoningEffortOverride && !isReasoningEffortSupported(model, reasoningEffortOverride, catalog)) {
    throw new Error(`ERR_REASONING_EFFORT_UNSUPPORTED: ${model ?? "config"} / ${reasoningEffortOverride}`);
  }
  return { source, modelOverride, reasoningEffortOverride, model,
    effort: reasoningEffortOverride ?? defaults.reasoningEffort,
    warnModel: source === "explicit", warnEffort: Boolean(session.reasoning_effort_override) };
}

export function parseModelProfileCommand(arg: string): {
  name: ModelProfileName; index?: number; effort?: ReasoningEffort;
} | null {
  const parts = arg.trim().split(/\s+/);
  const name = /^(c|coding)$/i.test(parts[0] ?? "") ? "coding"
    : /^(o|office)$/i.test(parts[0] ?? "") ? "office" : null;
  if (!name) return null;
  if (parts.length > 3 || (parts[1] != null && !/^[1-9]\d*$/.test(parts[1]))
    || (parts[2] != null && !EFFORTS.includes(parts[2] as ReasoningEffort))) {
    throw new Error("ERR_MODEL_PROFILE_USAGE");
  }
  return { name, index: parts[1] ? Number(parts[1]) : undefined, effort: parts[2] as ReasoningEffort | undefined };
}
