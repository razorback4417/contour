import type { RuntimeCapture, RuntimeGraph, RuntimeGraphNode } from "../runtime/types";
import {
  runtimeRelationshipLabel,
  runtimeRelationships,
  summarizeRuntimeGraph,
} from "./runtime-projection";

export function RuntimeWorkspace({
  capture,
  graph,
}: {
  capture: RuntimeCapture;
  graph: RuntimeGraph;
}) {
  const summary = summarizeRuntimeGraph(graph);
  const processes = graph.nodes.filter((node) => node.kind === "process_execution");
  const resources = graph.nodes.filter((node) =>
    ["file", "tcp_connection", "tcp_endpoint", "network_interface"].includes(node.kind));
  const synthetic = capture.observations.length > 0
    && capture.observations.every((observation) => observation.source.synthetic);

  return <div className="runtime-workspace">
    <header className="runtime-heading">
      <div>
        <label className="section-label">SOFTWARE TOPOLOGY · REPLAY</label>
        <h1>{capture.host.hostname ?? capture.host.id}</h1>
        <p>{formatTime(capture.startedAt)} → {formatTime(capture.endedAt)}</p>
      </div>
      <span className={synthetic ? "synthetic" : "capture"}>
        {synthetic ? "SYNTHETIC FIXTURE" : "CAPTURE REPLAY"}
      </span>
    </header>

    <section className="runtime-summary" aria-label="Runtime graph summary">
      <Metric value={summary.processes} label="process executions"/>
      <Metric value={summary.containers} label="containers"/>
      <Metric value={summary.connections} label="TCP connections"/>
      <Metric value={summary.files} label="files"/>
      <Metric value={graph.diagnostics.length} label="diagnostics"/>
    </section>

    <div className="runtime-columns">
      <section>
        <label className="section-label">EXECUTIONS</label>
        <div className="runtime-card-list">
          {processes.map((node) => <RuntimeNodeCard key={node.id} graph={graph} node={node}/>)}
          {processes.length === 0 && <p className="runtime-empty">No process execution was reconstructed.</p>}
        </div>
      </section>
      <section>
        <label className="section-label">OBSERVED RESOURCES</label>
        <div className="runtime-card-list">
          {resources.map((node) => <RuntimeNodeCard key={node.id} graph={graph} node={node}/>)}
          {resources.length === 0 && <p className="runtime-empty">No file or network resource was reconstructed.</p>}
        </div>
      </section>
      <section>
        <label className="section-label">ACTIVITY TIMELINE</label>
        <ol className="runtime-timeline">
          {[...capture.observations]
            .sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id))
            .map((observation) => <li key={observation.id}>
              <time>{formatTime(observation.observedAt)}</time>
              <b>{observation.kind.replaceAll("_", " ")}</b>
              <span>{observation.process?.name ?? observation.connection?.destination.address ?? observation.container?.containerId ?? "activity"}</span>
              <small>{observation.source.activityName}</small>
            </li>)}
        </ol>
      </section>
    </div>

    <footer className="runtime-evidence">
      {capture.observations.length} observations · {graph.nodes.length} nodes · {graph.edges.length} relationships
      {summary.inferredEdges > 0 ? ` · ${summary.inferredEdges} inferred` : " · direct evidence only"}
      {" · "}schema {capture.schemaVersion.split("/")[1]}
    </footer>
  </div>;
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function RuntimeNodeCard({ graph, node }: { graph: RuntimeGraph; node: RuntimeGraphNode }) {
  const relationships = runtimeRelationships(graph, node.id);
  return <article className={`runtime-node ${node.lifecycle}`}>
    <div className="runtime-node-heading">
      <span>{node.kind.replaceAll("_", " ")}</span>
      <i>{node.lifecycle}</i>
    </div>
    <h2>{node.label}</h2>
    <code>{primaryFact(node)}</code>
    {relationships.length > 0 && <ul>
      {relationships.map(({ edge, direction, peer }) => <li key={`${edge.id}:${direction}`}>
        <span>{runtimeRelationshipLabel(edge.kind, direction)}</span>
        <b>{peer.label}</b>
        <i>{edge.basis}</i>
      </li>)}
    </ul>}
    <small>{node.evidence.length} evidence {node.evidence.length === 1 ? "record" : "records"}</small>
  </article>;
}

function primaryFact(node: RuntimeGraphNode): string {
  const preferred = [
    node.facts.executablePath,
    node.facts.path,
    node.facts.state,
    node.facts.address,
    node.facts.name,
  ].find((value) => value !== undefined);
  return preferred === undefined ? node.id : String(preferred);
}

function formatTime(value: string): string {
  return value.replace("T", " ").replace(/(\.\d{3})\d+Z$/, "$1Z");
}
