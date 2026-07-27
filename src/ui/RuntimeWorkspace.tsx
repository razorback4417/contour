import { useState } from "react";
import type {
  RuntimeCapture,
  RuntimeGraph,
  RuntimeGraphEdge,
  RuntimeGraphNode,
  RuntimeObservation,
} from "../runtime/types";
import {
  defaultRuntimeFocus,
  projectRuntimeFocus,
  runtimeRelationshipLabel,
  runtimeRelationships,
  summarizeRuntimeGraph,
  type RuntimeFocusProjection,
} from "./runtime-projection";

const nodeWidth = 196;
const nodeHeight = 52;
const laneX = {
  context: 28,
  process: 274,
  resource: 540,
  endpoint: 806,
} as const;

interface PositionedNode {
  node: RuntimeGraphNode;
  x: number;
  y: number;
}

export function RuntimeWorkspace({
  capture,
  graph,
}: {
  capture: RuntimeCapture;
  graph: RuntimeGraph;
}) {
  const summary = summarizeRuntimeGraph(graph);
  const processes = graph.nodes
    .filter((node) => node.kind === "process_execution")
    .sort((left, right) =>
      right.lastSeenAt.localeCompare(left.lastSeenAt)
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id));
  const fallbackFocus = defaultRuntimeFocus(graph);
  const [requestedFocusId, setRequestedFocusId] = useState(fallbackFocus?.id);
  const focusId = processes.some((node) => node.id === requestedFocusId)
    ? requestedFocusId
    : fallbackFocus?.id;
  const projection = focusId ? projectRuntimeFocus(graph, focusId) : undefined;
  const [requestedSelectionId, setRequestedSelectionId] = useState(focusId);
  const selectedNode = projection?.nodes.find((node) => node.id === requestedSelectionId)
    ?? projection?.focus;
  const synthetic = capture.observations.length > 0
    && capture.observations.every((observation) => observation.source.synthetic);
  const focusedActivity = projection
    ? activityForProcess(capture, projection.focus)
    : [];

  function chooseProcess(id: string) {
    setRequestedFocusId(id);
    setRequestedSelectionId(id);
  }

  return <div className="runtime-workspace">
    <header className="runtime-heading">
      <div>
        <label className="section-label">ARGUS SOFTWARE FLOW</label>
        <h1>What did this execution touch?</h1>
        <p>
          {capture.host.hostname ?? capture.host.id}
          {" · "}{formatWindow(capture.startedAt, capture.endedAt)}
          {" · "}{capture.observations.length} normalized observations
        </p>
      </div>
      <span className={synthetic ? "synthetic" : "capture"}>
        {synthetic ? "SYNTHETIC REPLAY" : "LIVE CAPTURE"}
      </span>
    </header>

    <section className="runtime-focus-strip" aria-label="Choose an execution">
      <div className="runtime-focus-label">
        <span>EXECUTION FOCUS</span>
        <small>{processes.length} reconstructed</small>
      </div>
      <div className="runtime-processes">
        {processes.map((process) => <button
          type="button"
          className={process.id === focusId ? "active" : ""}
          key={process.id}
          onClick={() => chooseProcess(process.id)}
        >
          <b>{process.label}</b>
          <small>PID {String(process.facts.processId ?? "unknown")} · {process.evidence.length} records</small>
        </button>)}
      </div>
    </section>

    {projection && selectedNode ? <div className="runtime-stage">
      <section className="runtime-map" aria-label="Focused software topology">
        <TopologyMap
          projection={projection}
          selectedNodeId={selectedNode.id}
          onSelect={setRequestedSelectionId}
        />
        <div className="runtime-map-key">
          <span><i className="observed"/>observed</span>
          <span><i className="inferred"/>inferred</span>
          {(projection.hiddenFiles > 0 || projection.hiddenConnections > 0) && <b>
            focused view · {projection.hiddenFiles + projection.hiddenConnections} lower-priority resources hidden
          </b>}
        </div>
      </section>
      <RuntimeDossier graph={graph} node={selectedNode}/>
    </div> : <p className="runtime-empty">
      Argus records arrived, but no process execution could be reconstructed from this window.
    </p>}

    {projection && <section className="runtime-sequence">
      <header>
        <div>
          <label className="section-label">FOCUSED SEQUENCE</label>
          <h2>{projection.focus.label}</h2>
        </div>
        <p>Relative to capture start · only evidence attached to this execution</p>
      </header>
      <ol>
        {focusedActivity.slice(0, 12).map((observation) => <li key={observation.id}>
          <time>{formatOffset(capture.startedAt, observation.observedAt)}</time>
          <i/>
          <b>{observation.kind.replaceAll("_", " ")}</b>
          <span>{activityTarget(observation)}</span>
        </li>)}
      </ol>
    </section>}

    <footer className="runtime-evidence">
      <span>{graph.nodes.length} entities · {graph.edges.length} evidence-backed relationships</span>
      <span>
        {summary.inferredEdges > 0 ? `${summary.inferredEdges} inferred edges` : "direct edges only"}
        {" · "}{graph.diagnostics.length} records preserved as diagnostics
      </span>
    </footer>
  </div>;
}

function TopologyMap({
  projection,
  selectedNodeId,
  onSelect,
}: {
  projection: RuntimeFocusProjection;
  selectedNodeId: string;
  onSelect: (id: string) => void;
}) {
  const positioned = positionNodes(projection);
  const positionById = new Map(positioned.map((item) => [item.node.id, item]));
  const height = Math.max(390, ...positioned.map((item) => item.y + nodeHeight + 34));

  return <svg viewBox={`0 0 1030 ${height}`} role="img" aria-label={`Software topology centered on ${projection.focus.label}`}>
    <defs>
      <marker id="runtime-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
        <path d="M0,0 L6,3 L0,6 Z"/>
      </marker>
    </defs>
    <g className="runtime-lanes">
      <Lane x={laneX.context} width={nodeWidth} label="CONTEXT"/>
      <Lane x={laneX.process} width={nodeWidth} label="EXECUTION"/>
      <Lane x={laneX.resource} width={nodeWidth} label="TOUCHED RESOURCE"/>
      <Lane x={laneX.endpoint} width={nodeWidth} label="INTERFACE / PEER"/>
    </g>
    <g className="runtime-map-edges">
      {projection.edges.map((edge) => {
        const source = positionById.get(edge.source);
        const target = positionById.get(edge.target);
        if (!source || !target) return null;
        return <path
          className={edge.basis}
          d={edgePath(source, target)}
          key={edge.id}
          markerEnd="url(#runtime-arrow)"
        />;
      })}
    </g>
    <g className="runtime-map-nodes">
      {positioned.map(({ node, x, y }) => <g
        className={`${node.kind} ${node.lifecycle} ${node.id === selectedNodeId ? "selected" : ""}`}
        key={node.id}
        transform={`translate(${x} ${y})`}
        role="button"
        tabIndex={0}
        aria-label={`Inspect ${node.label}`}
        aria-pressed={node.id === selectedNodeId}
        onClick={() => onSelect(node.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(node.id);
          }
        }}
      >
        <rect width={nodeWidth} height={nodeHeight} rx="3"/>
        <rect className="kind-bar" width="3" height={nodeHeight}/>
        <text className="kind" x="14" y="17">{nodeKindLabel(node, projection.edges)}</text>
        <text x="14" y="36">{truncate(node.label, 27)}</text>
        <title>{node.label}</title>
      </g>)}
    </g>
  </svg>;
}

function Lane({ x, width, label }: { x: number; width: number; label: string }) {
  return <g>
    <line x1={x - 12} y1="34" x2={x + width + 12} y2="34"/>
    <text x={x} y="23">{label}</text>
  </g>;
}

function RuntimeDossier({ graph, node }: { graph: RuntimeGraph; node: RuntimeGraphNode }) {
  const relationships = runtimeRelationships(graph, node.id);
  const facts = Object.entries(node.facts).filter(([, value]) => value !== "");
  return <aside className="runtime-dossier">
    <header>
      <label className="section-label">EVIDENCE DOSSIER</label>
      <span>{node.lifecycle}</span>
      <h2>{node.label}</h2>
      <code>{node.kind.replaceAll("_", " ")}</code>
    </header>
    <section>
      <h3>Observed facts</h3>
      <dl>
        {facts.slice(0, 8).map(([key, value]) => <div key={key}>
          <dt>{humanizeFact(key)}</dt>
          <dd>{String(value)}</dd>
        </div>)}
      </dl>
    </section>
    <section>
      <h3>Relationships</h3>
      <ul>
        {relationships.slice(0, 10).map(({ edge, direction, peer }) => <li key={`${edge.id}:${direction}`}>
          <span>{runtimeRelationshipLabel(edge.kind, direction)}</span>
          <b>{peer.label}</b>
          <small>{edge.basis} · {edge.evidence.length} {edge.evidence.length === 1 ? "record" : "records"}</small>
        </li>)}
      </ul>
    </section>
    <footer>
      <span>{node.evidence.length} source {node.evidence.length === 1 ? "record" : "records"}</span>
      <span>{formatSeenRange(node)}</span>
    </footer>
  </aside>;
}

function positionNodes(projection: RuntimeFocusProjection): PositionedNode[] {
  const groups = {
    context: projection.nodes.filter((node) =>
      node.kind === "container" || (node.kind === "process_execution" && node.id !== projection.focus.id)),
    process: [projection.focus],
    resource: projection.nodes.filter((node) =>
      node.kind === "file" || node.kind === "tcp_connection"),
    endpoint: projection.nodes.filter((node) =>
      node.kind === "tcp_endpoint" || node.kind === "network_interface"),
  };
  const maxRows = Math.max(...Object.values(groups).map((nodes) => nodes.length), 1);
  const canvasHeight = Math.max(310, maxRows * 64);
  return (Object.entries(groups) as Array<[keyof typeof groups, RuntimeGraphNode[]]>)
    .flatMap(([lane, nodes]) => {
      const columnHeight = nodes.length * 64 - 12;
      const startY = 58 + Math.max(0, (canvasHeight - columnHeight) / 2);
      return nodes.map((node, index) => ({
        node,
        x: laneX[lane],
        y: startY + index * 64,
      }));
    });
}

function edgePath(source: PositionedNode, target: PositionedNode): string {
  const forward = target.x >= source.x;
  const startX = source.x + (forward ? nodeWidth : 0);
  const endX = target.x + (forward ? 0 : nodeWidth);
  const startY = source.y + nodeHeight / 2;
  const endY = target.y + nodeHeight / 2;
  const bend = Math.max(34, Math.abs(endX - startX) * 0.42);
  return `M${startX},${startY} C${startX + (forward ? bend : -bend)},${startY} ${endX - (forward ? bend : -bend)},${endY} ${endX},${endY}`;
}

function nodeKindLabel(node: RuntimeGraphNode, edges: RuntimeGraphEdge[]): string {
  if (node.kind === "tcp_endpoint") {
    return edges.some((edge) => edge.kind === "source_endpoint" && edge.target === node.id)
      ? "local endpoint"
      : "peer endpoint";
  }
  const labels: Record<RuntimeGraphNode["kind"], string> = {
    host: "host",
    container: "container context",
    process_execution: "process execution",
    file: "file",
    tcp_connection: "TCP flow",
    tcp_endpoint: "IP endpoint",
    network_interface: "network interface",
  };
  return labels[node.kind];
}

function activityForProcess(
  capture: RuntimeCapture,
  process: RuntimeGraphNode,
): RuntimeObservation[] {
  const evidence = new Set(process.evidence);
  return capture.observations
    .filter((observation) => evidence.has(observation.id))
    .sort((left, right) =>
      left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id));
}

function activityTarget(observation: RuntimeObservation): string {
  if (observation.fileDescriptor?.path) return observation.fileDescriptor.path;
  if (observation.connection) {
    return `${observation.connection.destination.address}:${observation.connection.destination.port}`;
  }
  if (observation.container?.containerId) return truncate(observation.container.containerId, 24);
  return observation.process?.name ?? "execution";
}

function formatWindow(start: string, end: string): string {
  const duration = Math.max(0, timestampMs(end) - timestampMs(start));
  if (duration < 1_000) return `${Math.round(duration)}ms window`;
  if (duration < 60_000) return `${stripTrailingZero((duration / 1_000).toFixed(1))}s window`;
  return `${Math.floor(duration / 60_000)}m ${Math.round((duration % 60_000) / 1_000)}s window`;
}

function formatOffset(start: string, value: string): string {
  const elapsed = Math.max(0, timestampMs(value) - timestampMs(start));
  if (elapsed < 1_000) return `+${Math.round(elapsed)}ms`;
  return `+${stripTrailingZero((elapsed / 1_000).toFixed(2))}s`;
}

function formatSeenRange(node: RuntimeGraphNode): string {
  const duration = Math.max(0, timestampMs(node.lastSeenAt) - timestampMs(node.firstSeenAt));
  return duration === 0 ? "observed once" : `observed across ${formatWindow(node.firstSeenAt, node.lastSeenAt).replace(" window", "")}`;
}

function timestampMs(value: string): number {
  return Date.parse(value.replace(/(\.\d{3})\d+(Z|[+-]\d{2}:\d{2})$/, "$1$2"));
}

function humanizeFact(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function stripTrailingZero(value: string): string {
  return value.replace(/\.0$/, "");
}
