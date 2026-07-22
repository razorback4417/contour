import type { TopologyEdge, TopologySnapshot } from "../model/types";
export { assessLinkEvidence } from "../analysis/troubleshooting";

export function findLinkEvidence(snapshot: TopologySnapshot, nodeId: string): TopologyEdge[] {
  const related = new Set([nodeId]);
  for (let depth = 0; depth < 3; depth += 1) {
    for (const edge of snapshot.edges) {
      if (!["backed_by", "connected_to", "exposes"].includes(edge.kind)) continue;
      if (related.has(edge.source)) related.add(edge.target);
      if (related.has(edge.target)) related.add(edge.source);
    }
    for (const node of snapshot.nodes) if (related.has(node.id) && node.parentId) related.add(node.parentId);
  }
  return snapshot.edges.filter((edge) => edge.kind === "contains" && related.has(edge.target) && Object.keys(edge.facts).length > 0).sort((a, b) => a.id.localeCompare(b.id));
}
