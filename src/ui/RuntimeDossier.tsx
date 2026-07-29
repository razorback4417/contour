import { useEffect, useMemo, useState } from "react";
import type { RuntimeGraph, RuntimeGraphNode } from "../runtime/types";
import {
  runtimeNodeInterpretation,
  runtimeRelationshipLabel,
  runtimeRelationships,
} from "./runtime-projection";

export function RuntimeDossier({
  graph,
  node,
}: {
  graph: RuntimeGraph;
  node: RuntimeGraphNode;
}) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "manual">("idle");
  const relationships = useMemo(
    () => runtimeRelationships(graph, node.id),
    [graph, node.id],
  );
  const { primaryFacts, technicalFacts } = dossierFacts(node);
  const interpretation = runtimeNodeInterpretation(node, relationships);
  const executionJson = useMemo(() => JSON.stringify({
    node,
    relationships: relationships.map(({ direction, edge, peer }) => ({
      direction,
      edge,
      peer,
    })),
  }, null, 2), [node, relationships]);

  useEffect(() => {
    if (!jsonOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setJsonOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [jsonOpen]);

  async function copyExecutionJson(): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(executionJson);
      } else if (!copyTextFallback(executionJson)) {
        throw new Error("Clipboard access is unavailable.");
      }
      setCopyStatus("copied");
    } catch {
      setCopyStatus("manual");
    }
  }

  return <><aside className="runtime-dossier">
    <header>
      <label className="section-label">{dossierLabel(node)}</label>
      <span>{node.lifecycle}</span>
      <h2>{node.label}</h2>
      <code>{node.kind.replaceAll("_", " ")}</code>
      <button type="button" className="runtime-json-open" onClick={() => {
        setCopyStatus("idle");
        setJsonOpen(true);
      }}>View JSON</button>
    </header>
    {interpretation && <section className="runtime-interpretation">
      <label>{interpretation.label}</label>
      <h3>{interpretation.title}</h3>
      <p>{interpretation.summary}</p>
    </section>}
    <section>
      <h3>Key evidence</h3>
      <dl>
        {primaryFacts.map(([key, value]) => <div key={key}>
          <dt>{humanizeFact(key)}</dt>
          <dd>{String(value)}</dd>
        </div>)}
      </dl>
    </section>
    <section>
      <h3>Connected evidence</h3>
      <ul>
        {relationships.slice(0, 5).map(({ edge, direction, peer }) => <li key={`${edge.id}:${direction}`}>
          <span>{runtimeRelationshipLabel(edge.kind, direction)}</span>
          <b>{peer.label}</b>
          <small>{edge.basis} · {edge.evidence.length} {edge.evidence.length === 1 ? "record" : "records"}</small>
        </li>)}
      </ul>
    </section>
    {technicalFacts.length > 0 && <details className="runtime-technical-evidence">
      <summary>Technical identifiers ({technicalFacts.length})</summary>
      <dl>
        {technicalFacts.map(([key, value]) => <div key={key}>
          <dt>{humanizeFact(key)}</dt>
          <dd>{String(value)}</dd>
        </div>)}
      </dl>
    </details>}
    <footer>
      <span>{node.evidence.length} Argus {node.evidence.length === 1 ? "record" : "records"}</span>
      <span>{formatSeenRange(node)}</span>
    </footer>
  </aside>
  {jsonOpen && <div className="runtime-json-overlay" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) setJsonOpen(false);
  }}>
    <section
      className="runtime-json-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="runtime-json-title"
    >
      <header>
        <div>
          <label className="section-label">NORMALIZED RUNTIME EVIDENCE</label>
          <h2 id="runtime-json-title">{node.label}</h2>
          <p>Selected node and its connected evidence relationships.</p>
        </div>
        <button
          type="button"
          aria-label="Close evidence JSON"
          onClick={() => setJsonOpen(false)}
        >×</button>
      </header>
      <pre tabIndex={0}>{executionJson}</pre>
      <footer>
        <span role="status">
          {copyStatus === "copied"
            ? "Copied to clipboard."
            : copyStatus === "manual"
              ? "Clipboard unavailable. Select the JSON and copy it manually."
              : "JSON is selectable and preserves normalized identifiers."}
        </span>
        <button
          type="button"
          className="runtime-json-copy"
          onClick={copyExecutionJson}
        >{copyStatus === "copied" ? "Copied" : "Copy JSON"}</button>
      </footer>
    </section>
  </div>}
  </>;
}

function copyTextFallback(value: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand?.("copy") ?? false;
  textarea.remove();
  return copied;
}

function dossierLabel(node: RuntimeGraphNode): string {
  const labels: Record<RuntimeGraphNode["kind"], string> = {
    host: "OBSERVED HOST",
    container: "CONTAINER CONTEXT",
    process_execution: "EXECUTION SUMMARY",
    file: "TOUCHED FILE",
    tcp_connection: "TCP FLOW",
    tcp_endpoint: "NETWORK ENDPOINT",
    network_interface: "WORKLOAD INTERFACE",
  };
  return labels[node.kind];
}

function dossierFacts(node: RuntimeGraphNode): {
  primaryFacts: Array<[string, string | number | boolean]>;
  technicalFacts: Array<[string, string | number | boolean]>;
} {
  const facts = Object.entries(node.facts)
    .filter(([, value]) => value !== "") as Array<[string, string | number | boolean]>;
  const priorities: Record<RuntimeGraphNode["kind"], string[]> = {
    host: ["hostname", "osVersion"],
    container: ["containerId"],
    process_execution: [
      "currentWorkingDirectory",
      "executablePath",
      "commandLine",
      "processId",
      "userId",
    ],
    file: ["mode", "descriptorType"],
    tcp_connection: ["state", "bytesIn", "bytesOut", "firstObservedAt", "closedAt"],
    tcp_endpoint: ["address", "port"],
    network_interface: ["name", "addresses", "mac"],
  };
  const primaryKeys = new Set(priorities[node.kind]);
  const primaryFacts = priorities[node.kind]
    .map((key) => facts.find(([candidate]) => candidate === key))
    .filter((fact): fact is [string, string | number | boolean] => Boolean(fact))
    .slice(0, 5);
  return {
    primaryFacts,
    technicalFacts: facts.filter(([key]) =>
      !primaryKeys.has(key) && !(node.kind === "file" && key === "path")),
  };
}

function formatSeenRange(node: RuntimeGraphNode): string {
  const duration = Math.max(0, timestampMs(node.lastSeenAt) - timestampMs(node.firstSeenAt));
  return duration === 0
    ? "observed once"
    : `observed across ${formatWindow(node.firstSeenAt, node.lastSeenAt)}`;
}

function formatWindow(start: string, end: string): string {
  const duration = Math.max(0, timestampMs(end) - timestampMs(start));
  if (duration < 1_000) return `${Math.round(duration)}ms`;
  if (duration < 60_000) return `${stripTrailingZero((duration / 1_000).toFixed(1))}s`;
  return `${Math.floor(duration / 60_000)}m ${Math.round((duration % 60_000) / 1_000)}s`;
}

function timestampMs(value: string): number {
  return Date.parse(value.replace(/(\.\d{3})\d+(Z|[+-]\d{2}:\d{2})$/, "$1$2"));
}

function humanizeFact(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function stripTrailingZero(value: string): string {
  return value.replace(/\.0$/, "");
}
