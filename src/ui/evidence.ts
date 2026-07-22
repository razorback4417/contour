import type { TopologyEdge, TopologySnapshot } from "../model/types";

export interface LinkAssessment {
  state: "within_capability" | "below_capability" | "observed";
  label: string;
  note: string;
}

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

export function assessLinkEvidence(edge: TopologyEdge): LinkAssessment {
  const currentWidth = numeric(edge, ".current_width");
  const maxWidth = numeric(edge, ".max_width");
  const currentSpeed = numeric(edge, ".current_speed_gt_s", ".current_generation");
  const maxSpeed = numeric(edge, ".max_speed_gt_s", ".max_generation");
  const below = (currentWidth !== undefined && maxWidth !== undefined && currentWidth < maxWidth)
    || (currentSpeed !== undefined && maxSpeed !== undefined && currentSpeed < maxSpeed);
  if (below) return { state: "below_capability", label: "Below reported capability", note: "Current PCIe speed can reduce while a device is idle; confirm under load before treating this as degradation." };
  if ((currentWidth !== undefined && maxWidth !== undefined) || (currentSpeed !== undefined && maxSpeed !== undefined)) return { state: "within_capability", label: "At reported capability", note: "Capability and negotiated values are observations from the available collectors." };
  return { state: "observed", label: "Physical evidence collected", note: "The source did not expose a complete current-versus-capable pair." };
}

function numeric(edge: TopologyEdge, ...suffixes: string[]): number | undefined {
  for (const [key, fact] of Object.entries(edge.facts)) if (suffixes.some((suffix) => key.endsWith(suffix)) && typeof fact.value === "number") return fact.value;
  return undefined;
}
