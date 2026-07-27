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

export interface RuntimeFocusProjection {
  focus: RuntimeGraphNode;
  nodes: RuntimeGraphNode[];
  edges: RuntimeGraphEdge[];
  hiddenFiles: number;
  hiddenConnections: number;
}

export interface RuntimeFocusLimits {
  files: number;
  connections: number;
}

const defaultFocusLimits: RuntimeFocusLimits = {
  files: 5,
  connections: 4,
};

export function summarizeRuntimeGraph(graph: RuntimeGraph): RuntimeGraphSummary {
  return {
    processes: countNodes(graph, "process_execution"),
    containers: countNodes(graph, "container"),
    files: countNodes(graph, "file"),
    connections: countNodes(graph, "tcp_connection"),
    inferredEdges: graph.edges.filter((edge) => edge.basis === "inferred").length,
  };
}

export function defaultRuntimeFocus(graph: RuntimeGraph): RuntimeGraphNode | undefined {
  const processScores = graph.nodes
    .filter((node) => node.kind === "process_execution")
    .map((node) => ({
      node,
      score: graph.edges.reduce((total, edge) => {
        if (edge.source !== node.id) return total;
        if (edge.kind === "owns_connection") return total + 1_000 + edge.evidence.length;
        if (edge.kind === "opened") return total + 10 + edge.evidence.length;
        return total;
      }, node.evidence.length),
    }));
  return processScores.sort((left, right) =>
    right.score - left.score
    || left.node.label.localeCompare(right.node.label)
    || left.node.id.localeCompare(right.node.id))[0]?.node;
}

export function projectRuntimeFocus(
  graph: RuntimeGraph,
  processId: string,
  limits: RuntimeFocusLimits = defaultFocusLimits,
): RuntimeFocusProjection | undefined {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const focus = nodeById.get(processId);
  if (!focus || focus.kind !== "process_execution") return undefined;

  const directEdges = graph.edges.filter((edge) =>
    edge.source === processId || edge.target === processId);
  const files = peersForEdges(directEdges, processId, nodeById, "opened", "file");
  const connections = peersForEdges(
    directEdges,
    processId,
    nodeById,
    "owns_connection",
    "tcp_connection",
  );
  const visibleFiles = files.slice(0, limits.files);
  const visibleConnections = connections.slice(0, limits.connections);
  const visibleIds = new Set<string>([
    processId,
    ...visibleFiles.map((node) => node.id),
    ...visibleConnections.map((node) => node.id),
  ]);

  for (const relationship of runtimeRelationships(graph, processId)) {
    if (
      relationship.peer.kind === "container"
      || relationship.edge.kind === "parent_of"
    ) {
      visibleIds.add(relationship.peer.id);
    }
  }
  for (const connection of visibleConnections) {
    for (const relationship of runtimeRelationships(graph, connection.id)) {
      if (
        relationship.peer.kind === "tcp_endpoint"
        || relationship.peer.kind === "network_interface"
      ) {
        visibleIds.add(relationship.peer.id);
      }
    }
  }

  return {
    focus,
    nodes: graph.nodes.filter((node) => visibleIds.has(node.id)),
    edges: graph.edges.filter((edge) =>
      visibleIds.has(edge.source) && visibleIds.has(edge.target)),
    hiddenFiles: Math.max(0, files.length - visibleFiles.length),
    hiddenConnections: Math.max(0, connections.length - visibleConnections.length),
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

function peersForEdges(
  edges: RuntimeGraphEdge[],
  processId: string,
  nodeById: ReadonlyMap<string, RuntimeGraphNode>,
  edgeKind: RuntimeEdgeKind,
  nodeKind: RuntimeNodeKind,
): RuntimeGraphNode[] {
  return edges
    .filter((edge) => edge.kind === edgeKind)
    .map((edge) => nodeById.get(edge.source === processId ? edge.target : edge.source))
    .filter((node): node is RuntimeGraphNode => node?.kind === nodeKind)
    .sort((left, right) =>
      right.lastSeenAt.localeCompare(left.lastSeenAt)
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id));
}
