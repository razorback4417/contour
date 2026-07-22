import type { Diagnostic, TopologySnapshot } from "../model/types";
import { stableId } from "../model/stable";

export function validateSnapshot(snapshot: TopologySnapshot): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const ids = new Set<string>();
  for (const node of snapshot.nodes) {
    if (ids.has(node.id)) diagnostics.push(make("DUPLICATE_NODE_ID", "error", `Duplicate node ID: ${node.id}`, node.id));
    ids.add(node.id);
  }
  if (!ids.has(snapshot.hostId)) diagnostics.push(make("HOST_NOT_FOUND", "error", "The snapshot hostId does not reference a node."));
  for (const node of snapshot.nodes) {
    if (node.parentId && !ids.has(node.parentId)) diagnostics.push(make("MISSING_PARENT", "error", `${node.id} references missing parent ${node.parentId}.`, node.id));
  }
  for (const edge of snapshot.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) diagnostics.push(make("DANGLING_EDGE", "error", `${edge.id} has a missing endpoint.`));
    if (!edge.facts || typeof edge.facts !== "object" || Array.isArray(edge.facts)) diagnostics.push(make("EDGE_FACTS_MISSING", "error", `${edge.id} is missing its facts map.`));
  }
  return diagnostics;
}

function make(code: string, severity: Diagnostic["severity"], message: string, nodeId?: string): Diagnostic {
  return { id: stableId("diagnostic", `${code}:${nodeId ?? ""}:${message}`), code, severity, message, ...(nodeId ? { nodeId } : {}) };
}
