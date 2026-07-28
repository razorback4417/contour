import type {
  RuntimeEdgeKind,
  RuntimeGraph,
  RuntimeGraphEdge,
  RuntimeGraphNode,
  RuntimeNodeKind,
  RuntimeObservation,
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

export interface RuntimeEvidenceHighlight {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

export interface RuntimeNodeInterpretation {
  label: string;
  title: string;
  summary: string;
}

export interface RuntimeTrafficSample {
  bytes: number;
  label: string;
  basis: "delta" | "counter";
}

const defaultFocusLimits: RuntimeFocusLimits = {
  files: 3,
  connections: 2,
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

  const contexts = runtimeRelationships(graph, processId)
    .filter((relationship) =>
      relationship.peer.kind === "container" || relationship.edge.kind === "parent_of")
    .map((relationship) => relationship.peer)
    .filter((node, index, nodes) => nodes.findIndex((candidate) => candidate.id === node.id) === index)
    .sort((left, right) =>
      left.kind.localeCompare(right.kind)
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id))
    .slice(0, 3);
  contexts.forEach((node) => visibleIds.add(node.id));
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

export function highlightRuntimeEvidence(
  projection: RuntimeFocusProjection,
  observationId: string | undefined,
): RuntimeEvidenceHighlight {
  if (!observationId) return { nodeIds: new Set(), edgeIds: new Set() };
  return {
    nodeIds: new Set(projection.nodes
      .filter((node) => node.evidence.includes(observationId))
      .map((node) => node.id)),
    edgeIds: new Set(projection.edges
      .filter((edge) => edge.evidence.includes(observationId))
      .map((edge) => edge.id)),
  };
}

export function runtimeTrafficSample(
  observations: RuntimeObservation[],
  activeIndex: number,
): RuntimeTrafficSample | undefined {
  const active = observations[activeIndex];
  const activeBytes = connectionBytes(active);
  if (!active?.connection || activeBytes === undefined) return undefined;
  const identity = connectionIdentity(active);

  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    const prior = observations[index];
    if (connectionIdentity(prior) !== identity) continue;
    const priorBytes = connectionBytes(prior);
    if (priorBytes === undefined) continue;
    if (activeBytes < priorBytes) break;
    const delta = activeBytes - priorBytes;
    return {
      bytes: delta,
      label: `+${formatBytes(delta)} since prior sample`,
      basis: "delta",
    };
  }

  return {
    bytes: activeBytes,
    label: `${formatBytes(activeBytes)} counter observed`,
    basis: "counter",
  };
}

export function runtimeNodeInterpretation(
  node: RuntimeGraphNode,
  relationships: RuntimeRelationship[],
): RuntimeNodeInterpretation | undefined {
  const path = typeof node.facts.path === "string" ? node.facts.path : "";
  if (node.kind === "file" && path.includes("anon_inode:[pidfd]")) {
    const processCount = new Set(relationships
      .filter(({ peer }) => peer.kind === "process_execution")
      .map(({ peer }) => peer.id)).size;
    return {
      label: "KERNEL OBJECT · NOT A DISK FILE",
      title: "Process lifecycle handle",
      summary: `A pidfd is a stable handle used to monitor or signal another process. ${processCount > 1 ? `${processCount} executions touched this handle; ` : ""}repeated opens and closes are consistent with process supervision, but do not prove intent.`,
    };
  }
  if (node.kind === "file" && path.startsWith("socket:[")) {
    return {
      label: "KERNEL OBJECT",
      title: "Socket descriptor",
      summary: "This is an in-kernel socket handle rather than a filesystem path. Follow a correlated TCP flow for its local and peer endpoints.",
    };
  }
  if (node.kind === "file") {
    const mode = String(node.facts.mode ?? "").toUpperCase();
    const writeCapable = mode.includes("WRITE") || mode.includes("APPEND");
    const processes = relationships
      .filter(({ peer }) => peer.kind === "process_execution")
      .map(({ peer }) => peer.label);
    return {
      label: "OBSERVED FILE ACCESS",
      title: writeCapable ? "Write-capable file access" : "File opened by this execution",
      summary: `${processes[0] ?? "The selected execution"} opened this ${String(node.facts.descriptorType ?? "file").toLowerCase()}${mode ? ` with ${mode} mode` : ""}. Argus observed the descriptor activity; content semantics are not inferred.`,
    };
  }
  if (node.kind === "tcp_connection") {
    return {
      label: "OBSERVED COMMUNICATION",
      title: "Process-owned TCP flow",
      summary: "Argus tied this socket to the selected execution. Endpoint and interface edges show the observed tuple and any address-based interface correlation.",
    };
  }
  if (node.kind === "process_execution") {
    const files = relationships.filter(({ peer }) => peer.kind === "file").length;
    const connections = relationships.filter(({ peer }) => peer.kind === "tcp_connection").length;
    return {
      label: "RECONSTRUCTED EXECUTION",
      title: `${files} touched resources · ${connections} TCP flows`,
      summary: "This view is a bounded evidence neighborhood for one process execution, not every event emitted by Argus.",
    };
  }
  return undefined;
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

export function runtimeProcessMatches(
  graph: RuntimeGraph,
  process: RuntimeGraphNode,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const values: unknown[] = [
    process.label,
    process.id,
    ...Object.values(process.facts),
  ];
  for (const relationship of runtimeRelationships(graph, process.id)) {
    values.push(
      relationship.peer.label,
      relationship.peer.id,
      ...Object.values(relationship.peer.facts),
    );
    if (relationship.peer.kind !== "tcp_connection") continue;
    for (const connectionRelationship of runtimeRelationships(graph, relationship.peer.id)) {
      values.push(
        connectionRelationship.peer.label,
        connectionRelationship.peer.id,
        ...Object.values(connectionRelationship.peer.facts),
      );
    }
  }
  return values.some((value) => String(value ?? "").toLowerCase().includes(needle));
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

function connectionIdentity(observation: RuntimeObservation | undefined): string | undefined {
  const connection = observation?.connection;
  if (!connection) return undefined;
  return connection.descriptorId
    ?? `${connection.source.address}:${connection.source.port}->${connection.destination.address}:${connection.destination.port}`;
}

function connectionBytes(observation: RuntimeObservation | undefined): number | undefined {
  const connection = observation?.connection;
  if (!connection || (connection.bytesIn === undefined && connection.bytesOut === undefined)) {
    return undefined;
  }
  return (connection.bytesIn ?? 0) + (connection.bytesOut ?? 0);
}

function formatBytes(value: number): string {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) return `${stripTrailingZero((value / 1_000).toFixed(1))} KB`;
  return `${stripTrailingZero((value / 1_000_000).toFixed(1))} MB`;
}

function stripTrailingZero(value: string): string {
  return value.replace(/\.0$/, "");
}
