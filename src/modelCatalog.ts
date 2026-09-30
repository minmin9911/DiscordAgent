import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReasoningEffort } from "./types.js";

export interface ModelCatalogItem {
  id: string;
  description: string;
  descriptionJa?: string;
  descriptionEn?: string;
  creditsPerMillion?: [number, number, number];
  disabled: boolean;
  reasoningEfforts: ReasoningEffort[];
}

export interface ModelCatalogLoadResult {
  path: string;
  items: ModelCatalogItem[];
}

const MODEL_CATALOG_PATH = resolve("data/models.yaml");
const FALLBACK_ITEMS: ModelCatalogItem[] = [
  {
    id: "default",
    description: "Uses Codex default model.",
    descriptionJa: "Codexの設定で指定されたモデルを使用します。",
    descriptionEn: "Uses the model specified in Codex config.",
    disabled: false,
    reasoningEfforts: [],
  },
];

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1";
}

export function parseModelCatalogYaml(text: string): ModelCatalogItem[] {
  const lines = text.split(/\r?\n/);
  const items: ModelCatalogItem[] = [];
  let current: ModelCatalogItem | null = null;

  const flushCurrent = (): void => {
    if (!current) return;
    if (!current.id.trim()) {
      current = null;
      return;
    }
    items.push({
      id: current.id.trim(),
      description: current.description.trim(),
      descriptionJa: current.descriptionJa?.trim(),
      descriptionEn: current.descriptionEn?.trim(),
      creditsPerMillion: current.creditsPerMillion,
      disabled: current.disabled,
      reasoningEfforts: current.reasoningEfforts,
    });
    current = null;
  };

  for (const rawLine of lines) {
    const noComment = rawLine.replace(/\s+#.*$/, "");
    const line = noComment.trim();
    if (!line) continue;
    if (line === "models:") continue;
    const idMatch = line.match(/^-+\s*id:\s*(.+)$/);
    if (idMatch) {
      flushCurrent();
      current = {
        id: unquote(idMatch[1] ?? ""),
        description: "",
        disabled: false,
        reasoningEfforts: [],
      };
      continue;
    }
    if (!current) continue;
    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) {
      current.description = unquote(descMatch[1] ?? "");
      continue;
    }
    const descriptionJaMatch = line.match(/^description_ja:\s*(.+)$/);
    if (descriptionJaMatch) {
      current.descriptionJa = unquote(descriptionJaMatch[1] ?? "");
      continue;
    }
    const descriptionEnMatch = line.match(/^description_en:\s*(.+)$/);
    if (descriptionEnMatch) {
      current.descriptionEn = unquote(descriptionEnMatch[1] ?? "");
      continue;
    }
    const creditsMatch = line.match(/^credits_per_million:\s*\[(.*)\]$/);
    if (creditsMatch) {
      const credits = (creditsMatch[1] ?? "").split(",").map((value) => Number(value.trim()));
      if (credits.length === 3 && credits.every((value) => Number.isFinite(value) && value >= 0)) {
        current.creditsPerMillion = credits as [number, number, number];
      }
      continue;
    }
    const disabledMatch = line.match(/^disabled:\s*(.+)$/);
    if (disabledMatch) {
      current.disabled = parseBoolean(unquote(disabledMatch[1] ?? ""));
      continue;
    }
    const effortsMatch = line.match(/^reasoning_efforts:\s*\[(.*)\]$/);
    if (effortsMatch) {
      const values = (effortsMatch[1] ?? "")
        .split(",")
        .map((value) => unquote(value))
        .filter((value): value is ReasoningEffort => (
          value === "none"
          || value === "low"
          || value === "medium"
          || value === "high"
          || value === "xhigh"
          || value === "max"
        ));
      current.reasoningEfforts = [...new Set(values)];
      continue;
    }
  }
  flushCurrent();
  return items;
}

export function loadModelCatalog(): ModelCatalogLoadResult {
  if (!existsSync(MODEL_CATALOG_PATH)) {
    return { path: MODEL_CATALOG_PATH, items: [...FALLBACK_ITEMS] };
  }
  try {
    const text = readFileSync(MODEL_CATALOG_PATH, "utf8");
    const items = parseModelCatalogYaml(text).filter((item) => item.id.length > 0);
    if (items.length === 0) {
      return { path: MODEL_CATALOG_PATH, items: [...FALLBACK_ITEMS] };
    }
    return { path: MODEL_CATALOG_PATH, items };
  } catch {
    return { path: MODEL_CATALOG_PATH, items: [...FALLBACK_ITEMS] };
  }
}
