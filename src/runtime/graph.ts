import { stableId } from "../model/stable";
import type {
  RuntimeCapture,
  RuntimeDiagnostic,
  RuntimeEdgeKind,
  RuntimeEvidenceBasis,
  RuntimeGraph,
  RuntimeGraphEdge,
  RuntimeGraphNode,
  RuntimeNodeKind,
  RuntimeObservation,
  RuntimeProcess,
  RuntimeTcpConnection,
} from "./types";

export function buildRuntimeGraph(capture: RuntimeCapture): RuntimeGraph {
  const nodes = new Map<string, RuntimeGraphNode>();
  const edges = new Map<string, RuntimeGraphEdge>();
  const diagnostics = [...capture.diagnostics];
  const activeProcessByPid = new Map<string, string>();
  const connectionByDescriptor = new Map<string, string>();
  const hostId = stableId("runtime-host", `${capture.host.id}\0${capture.host.bootId ?? "unknown-boot"}`);

  upsertNode(nodes, {
    id: hostId,
    kind: "host",
    label: capture.host.hostname ?? capture.host.id,
    lifecycle: "active",
    observedAt: capture.startedAt,
    facts: compactFacts({
      sourceId: capture.host.id,
      bootId: capture.host.bootId,
      osVersion: capture.host.osVersion,
    }),
  });

  const observations = [...capture.observations]
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id));

  for (const observation of observations) {
    const containerId = observation.container?.containerId ?? observation.process?.containerId;
    const containerNodeId = containerId
      ? stableId("runtime-container", `${hostId}\0${containerId}`)
      : undefined;
    if (containerNodeId && containerId) {
      upsertNode(nodes, {
        id: containerNodeId,
        kind: "container",
        label: shortContainerId(containerId),
        lifecycle: observation.kind === "container_stopped" ? "terminated" : "active",
        observedAt: observation.observedAt,
        observationId: observation.id,
        facts: { containerId },
      });
      upsertEdge(edges, "contains", hostId, containerNodeId, "observed", observation);
    }

    const processNodeId = observation.process
      ? processIdentity(capture, observation.process, observation, activeProcessByPid, diagnostics)
      : undefined;
    if (processNodeId && observation.process) {
      const process = observation.process;
      const lifecycle = observation.kind === "process_stopped" ? "terminated" : "active";
      upsertNode(nodes, {
        id: processNodeId,
        kind: "process_execution",
        label: process.name,
        lifecycle,
        observedAt: observation.observedAt,
        observationId: observation.id,
        facts: compactFacts({
          processId: process.processId,
          selfExecId: process.selfExecId,
          parentProcessId: process.parentProcessId,
          executablePath: process.executablePath,
          commandLine: process.commandLine,
          createdAt: process.createdAt,
          userId: process.userId,
          groupId: process.groupId,
          pidNamespace: process.pidNamespace,
          mountNamespace: process.mountNamespace,
          networkNamespace: process.networkNamespace,
        }),
      });
      const pidKey = processIndexKey(process);
      if (lifecycle === "terminated") {
        if (activeProcessByPid.get(pidKey) === processNodeId) activeProcessByPid.delete(pidKey);
      } else {
        activeProcessByPid.set(pidKey, processNodeId);
      }
      upsertEdge(edges, "contains", hostId, processNodeId, "observed", observation);
      if (containerNodeId) {
        upsertEdge(edges, "member_of", processNodeId, containerNodeId, "observed", observation);
      }
      addParentEdge(process, processNodeId, observation, activeProcessByPid, edges, diagnostics);
    }

    if (observation.fileDescriptor && processNodeId) {
      const file = observation.fileDescriptor;
      const fileIdentity = file.device && file.inode
        ? `${file.device}\0${file.inode}`
        : file.path ?? `${processNodeId}\0fd:${file.descriptorId}`;
      const fileNodeId = stableId("runtime-file", `${hostId}\0${fileIdentity}`);
      upsertNode(nodes, {
        id: fileNodeId,
        kind: "file",
        label: file.path ?? `fd ${file.descriptorId}`,
        lifecycle: "observed",
        observedAt: observation.observedAt,
        observationId: observation.id,
        facts: compactFacts({
          path: file.path,
          descriptorType: file.descriptorType,
          mode: file.mode,
          inode: file.inode,
          device: file.device,
        }),
      });
      upsertEdge(edges, "opened", processNodeId, fileNodeId, "observed", observation);
    }

    if (observation.connection && processNodeId) {
      addConnection(
        capture,
        observation,
        observation.connection,
        processNodeId,
        nodes,
        edges,
        connectionByDescriptor,
      );
    }
  }

  return {
    captureId: capture.captureId,
    hostId,
    nodes: [...nodes.values()].sort(compareById),
    edges: [...edges.values()].sort(compareById),
    diagnostics: diagnostics.sort(compareById),
  };
}

function processIdentity(
  capture: RuntimeCapture,
  process: RuntimeProcess,
  observation: RuntimeObservation,
  activeProcessByPid: ReadonlyMap<string, string>,
  diagnostics: RuntimeDiagnostic[],
): string {
  if (process.createdAt) {
    return stableId("runtime-process", [
      capture.host.bootId ?? capture.captureId,
      process.processId,
      process.createdAt,
      process.selfExecId ?? "unknown-exec",
    ].join("\0"));
  }
  const active = activeProcessByPid.get(processIndexKey(process));
  if (active) return active;
  diagnostics.push(graphDiagnostic(
    "runtime.ambiguous_process_identity",
    `PID ${process.processId} has no creation time or active execution to correlate.`,
    observation.id,
  ));
  return stableId("runtime-process-ambiguous", [
    capture.host.bootId ?? capture.captureId,
    process.processId,
    process.selfExecId ?? "unknown-exec",
    observation.observedAt,
  ].join("\0"));
}

function addParentEdge(
  process: RuntimeProcess,
  processNodeId: string,
  observation: RuntimeObservation,
  activeProcessByPid: ReadonlyMap<string, string>,
  edges: Map<string, RuntimeGraphEdge>,
  diagnostics: RuntimeDiagnostic[],
): void {
  if (process.parentProcessId === undefined) return;
  const candidates = [...activeProcessByPid.entries()]
    .filter(([key]) => key.startsWith(`${process.parentProcessId}\0`))
    .map(([, id]) => id);
  if (candidates.length === 1 && candidates[0] !== processNodeId) {
    upsertEdge(edges, "parent_of", candidates[0], processNodeId, "inferred", observation);
  } else if (candidates.length !== 1) {
    diagnostics.push(graphDiagnostic(
      "runtime.parent_identity_unresolved",
      `Could not resolve one active execution for parent PID ${process.parentProcessId}.`,
      observation.id,
    ));
  }
}

function addConnection(
  capture: RuntimeCapture,
  observation: RuntimeObservation,
  connection: RuntimeTcpConnection,
  processNodeId: string,
  nodes: Map<string, RuntimeGraphNode>,
  edges: Map<string, RuntimeGraphEdge>,
  connectionByDescriptor: Map<string, string>,
): void {
  const descriptorKey = connection.descriptorId
    ? `${processNodeId}\0${connection.descriptorId}`
    : undefined;
  const existing = descriptorKey ? connectionByDescriptor.get(descriptorKey) : undefined;
  const connectionNodeId = existing ?? stableId("runtime-tcp", [
    processNodeId,
    connection.descriptorId ?? "unknown-fd",
    endpointKey(connection.source),
    endpointKey(connection.destination),
    connection.firstObservedAt ?? observation.observedAt,
  ].join("\0"));
  if (descriptorKey) connectionByDescriptor.set(descriptorKey, connectionNodeId);
  const closed = observation.kind === "tcp_connection_closed" || Boolean(connection.closedAt);
  upsertNode(nodes, {
    id: connectionNodeId,
    kind: "tcp_connection",
    label: `${connection.source.address}:${connection.source.port} → ${connection.destination.address}:${connection.destination.port}`,
    lifecycle: closed ? "terminated" : "active",
    observedAt: observation.observedAt,
    observationId: observation.id,
    facts: compactFacts({
      descriptorId: connection.descriptorId,
      state: connection.state,
      bytesIn: connection.bytesIn,
      bytesOut: connection.bytesOut,
      firstObservedAt: connection.firstObservedAt,
      closedAt: connection.closedAt,
    }),
  });
  upsertEdge(edges, "owns_connection", processNodeId, connectionNodeId, "observed", observation);

  const sourceId = addEndpoint(capture, connection.source, observation, nodes);
  const destinationId = addEndpoint(capture, connection.destination, observation, nodes);
  upsertEdge(edges, "source_endpoint", connectionNodeId, sourceId, "observed", observation);
  upsertEdge(edges, "destination_endpoint", connectionNodeId, destinationId, "observed", observation);

  if (connection.interfaceName) {
    const interfaceId = stableId("runtime-interface", `${capture.host.id}\0${connection.interfaceName}`);
    upsertNode(nodes, {
      id: interfaceId,
      kind: "network_interface",
      label: connection.interfaceName,
      lifecycle: "observed",
      observedAt: observation.observedAt,
      observationId: observation.id,
      facts: compactFacts({ name: connection.interfaceName, mac: connection.interfaceMac }),
    });
    upsertEdge(edges, "uses_interface", connectionNodeId, interfaceId, "observed", observation);
  }
}

function addEndpoint(
  capture: RuntimeCapture,
  endpoint: RuntimeTcpConnection["source"],
  observation: RuntimeObservation,
  nodes: Map<string, RuntimeGraphNode>,
): string {
  const id = stableId("runtime-endpoint", `${capture.host.id}\0${endpointKey(endpoint)}`);
  upsertNode(nodes, {
    id,
    kind: "tcp_endpoint",
    label: `${endpoint.address}:${endpoint.port}`,
    lifecycle: "observed",
    observedAt: observation.observedAt,
    observationId: observation.id,
    facts: { address: endpoint.address, port: endpoint.port },
  });
  return id;
}

function upsertNode(
  nodes: Map<string, RuntimeGraphNode>,
  input: {
    id: string;
    kind: RuntimeNodeKind;
    label: string;
    lifecycle: RuntimeGraphNode["lifecycle"];
    observedAt: string;
    observationId?: string;
    facts: RuntimeGraphNode["facts"];
  },
): void {
  const existing = nodes.get(input.id);
  if (!existing) {
    nodes.set(input.id, {
      id: input.id,
      kind: input.kind,
      label: input.label,
      lifecycle: input.lifecycle,
      firstSeenAt: input.observedAt,
      lastSeenAt: input.observedAt,
      facts: input.facts,
      evidence: input.observationId ? [input.observationId] : [],
    });
    return;
  }
  existing.lastSeenAt = maxTime(existing.lastSeenAt, input.observedAt);
  existing.firstSeenAt = minTime(existing.firstSeenAt, input.observedAt);
  existing.lifecycle = input.lifecycle === "terminated" ? "terminated" : existing.lifecycle;
  existing.facts = { ...existing.facts, ...input.facts };
  if (input.observationId && !existing.evidence.includes(input.observationId)) {
    existing.evidence.push(input.observationId);
    existing.evidence.sort();
  }
}

function upsertEdge(
  edges: Map<string, RuntimeGraphEdge>,
  kind: RuntimeEdgeKind,
  source: string,
  target: string,
  basis: RuntimeEvidenceBasis,
  observation: RuntimeObservation,
): void {
  const id = stableId("runtime-edge", `${kind}\0${source}\0${target}`);
  const existing = edges.get(id);
  if (!existing) {
    edges.set(id, {
      id,
      kind,
      source,
      target,
      basis,
      firstSeenAt: observation.observedAt,
      lastSeenAt: observation.observedAt,
      evidence: [observation.id],
    });
    return;
  }
  existing.firstSeenAt = minTime(existing.firstSeenAt, observation.observedAt);
  existing.lastSeenAt = maxTime(existing.lastSeenAt, observation.observedAt);
  if (!existing.evidence.includes(observation.id)) {
    existing.evidence.push(observation.id);
    existing.evidence.sort();
  }
}

function graphDiagnostic(code: string, message: string, observationId: string): RuntimeDiagnostic {
  return {
    id: stableId("runtime-diagnostic", `${code}\0${observationId}`),
    code,
    severity: "warning",
    message,
    sourceMessageId: observationId,
  };
}

function processIndexKey(process: RuntimeProcess): string {
  return `${process.processId}\0${process.selfExecId ?? "unknown-exec"}`;
}

function endpointKey(endpoint: RuntimeTcpConnection["source"]): string {
  return `${endpoint.address}\0${endpoint.port}`;
}

function shortContainerId(value: string): string {
  return value.length > 16 ? value.slice(0, 12) : value;
}

function compactFacts(
  values: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string | number | boolean] =>
    entry[1] !== undefined));
}

function minTime(left: string, right: string): string {
  return left.localeCompare(right) <= 0 ? left : right;
}

function maxTime(left: string, right: string): string {
  return left.localeCompare(right) >= 0 ? left : right;
}

function compareById<T extends { id: string }>(left: T, right: T): number {
  return left.id.localeCompare(right.id);
}
