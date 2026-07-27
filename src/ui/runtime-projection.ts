import type {
  RuntimeEdgeKind,
  RuntimeGraph,
  RuntimeGraphEdge,
  RuntimeGraphNode,
  RuntimeNodeKind,
} from "../runtime/types";

export interface RuntimeGraphSummary {
  processes: number;
  containers: number;
  files: number;
  connections: number;
  inferredEdges: number;
}

export interface RuntimeRelationship {
  edge: RuntimeGraphEdge;
  direction: "incoming" | "outgoing";
  peer: RuntimeGraphNode;
}

export function summarizeRuntimeGraph(graph: RuntimeGraph): RuntimeGraphSummary {
  return {
    processes: countNodes(graph, "process_execution"),
    containers: countNodes(graph, "container"),
    files: countNodes(graph, "file"),
    connections: countNodes(graph, "tcp_connection"),
    inferredEdges: graph.edges.filter((edge) => edge.basis === "inferred").length,
  };
}

export function runtimeRelationships(
  graph: RuntimeGraph,
  nodeId: string,
): RuntimeRelationship[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const relationships: RuntimeRelationship[] = [];
  for (const edge of graph.edges) {
    if (edge.source === nodeId) {
      const peer = nodes.get(edge.target);
      if (peer) relationships.push({ edge, direction: "outgoing", peer });
    }
    if (edge.target === nodeId) {
      const peer = nodes.get(edge.source);
      if (peer) relationships.push({ edge, direction: "incoming", peer });
    }
  }
  return relationships.sort((left, right) =>
    left.edge.kind.localeCompare(right.edge.kind) || left.peer.id.localeCompare(right.peer.id));
}

export function runtimeRelationshipLabel(
  kind: RuntimeEdgeKind,
  direction: RuntimeRelationship["direction"],
): string {
  const labels: Record<RuntimeEdgeKind, [string, string]> = {
    contains: ["contains", "contained by"],
    parent_of: ["parent of", "child of"],
    member_of: ["member of", "has member"],
    opened: ["opened", "opened by"],
    owns_connection: ["owns connection", "owned by"],
    source_endpoint: ["source endpoint", "source for"],
    destination_endpoint: ["destination endpoint", "destination for"],
    uses_interface: ["uses interface", "used by"],
  };
  return labels[kind][direction === "outgoing" ? 0 : 1];
}

function countNodes(graph: RuntimeGraph, kind: RuntimeNodeKind): number {
  return graph.nodes.filter((node) => node.kind === kind).length;
}
