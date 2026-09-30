import type { ModelCatalogLoadResult } from "./modelCatalog.js";
import type { ReasoningEffort } from "./types.js";

const CONSERVATIVE_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"];

export function supportedReasoningEfforts(
  modelId: string | null,
  catalog: ModelCatalogLoadResult,
): ReasoningEffort[] {
  if (modelId) {
    const item = catalog.items.find((candidate) => candidate.id === modelId);
    if (item?.reasoningEfforts.length) return item.reasoningEfforts;
  }

  const concreteModels = catalog.items.filter((item) => item.id !== "default" && !item.disabled);
  if (concreteModels.length === 0 || concreteModels.some((item) => item.reasoningEfforts.length === 0)) {
    return CONSERVATIVE_EFFORTS;
  }

  return CONSERVATIVE_EFFORTS.filter((effort) => (
    concreteModels.every((item) => item.reasoningEfforts.includes(effort))
  ));
}

export function isReasoningEffortSupported(
  modelId: string | null,
  effort: ReasoningEffort,
  catalog: ModelCatalogLoadResult,
): boolean {
  return supportedReasoningEfforts(modelId, catalog).includes(effort);
}

export function reasoningEffortCodexConfigArgs(
  effort: ReasoningEffort | null | undefined,
): string[] {
  return effort ? ["-c", `model_reasoning_effort=${effort}`] : [];
}
