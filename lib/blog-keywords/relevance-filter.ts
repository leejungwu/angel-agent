export const RELEVANCE_TARGETS = ["unevaluated", "stale", "pending"] as const;
export type RelevanceTarget = typeof RELEVANCE_TARGETS[number];
export function isRelevanceTarget(value: unknown): value is RelevanceTarget {
  return RELEVANCE_TARGETS.some(target => target === value);
}
export function staleRelevanceFilter(version: number) {
  return `product_relevance_criteria_version.is.null,product_relevance_criteria_version.neq.${version}`;
}
// NULL versions are historical scores, not scores evaluated under the current criteria.
export function pendingRelevanceFilter(version: number) {
  return `product_relevance_score.is.null,product_relevance_criteria_version.is.null,product_relevance_criteria_version.neq.${version}`;
}
export function isStaleRelevance(score: number | null, version: number | null, currentVersion: number) {
  return score !== null && version !== currentVersion;
}
