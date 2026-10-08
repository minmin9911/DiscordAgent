import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";

export interface CodexDisplayDefaults {
  model: string | null;
  reasoningEffort: string | null;
  errorCode?: "ERR_CODEX_CONFIG_READ" | "ERR_CODEX_CONFIG_PARSE";
}

export function codexDisplayConfigPath(
  codexHome = process.env.CODEX_HOME,
  userHome = homedir(),
): string {
  return join(codexHome?.trim() || join(userHome, ".codex"), "config.toml");
}

function displayString(value: unknown): string | null {
  // Only display scalar settings, never configuration objects or multiline text.
  return typeof value === "string" && /^[^\s`<>|]+$/u.test(value) ? value : null;
}

export function parseCodexDisplayDefaults(text: string): CodexDisplayDefaults {
  try {
    const config = parse(text.replace(/^\uFEFF/u, ""), { integersAsBigInt: "asNeeded" });
    return {
      model: displayString(config.model),
      reasoningEffort: displayString(config.model_reasoning_effort),
    };
  } catch {
    return { model: null, reasoningEffort: null, errorCode: "ERR_CODEX_CONFIG_PARSE" };
  }
}

// Display metadata only: Codex remains responsible for resolving execution settings.
export function readCodexDisplayDefaults(
  configPath = codexDisplayConfigPath(),
): CodexDisplayDefaults {
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch {
    return { model: null, reasoningEffort: null, errorCode: "ERR_CODEX_CONFIG_READ" };
  }
  return parseCodexDisplayDefaults(text);
}
