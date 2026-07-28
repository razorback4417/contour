import { useMemo, useState } from "react";
import { summarizeRuntimeCompatibility } from "../runtime/compatibility";
import type { RuntimeCapture, RuntimeObservation } from "../runtime/types";
import { formatRuntimeClock, runtimeActivityTarget } from "./runtime-activity";

export function RuntimeCompatibilityPanel({ capture }: { capture: RuntimeCapture }) {
  const summary = useMemo(() => summarizeRuntimeCompatibility(capture), [capture]);
  const diagnosticCount = summary.diagnostics.reduce((total, item) => total + item.count, 0);
  return <details className="runtime-compatibility">
    <summary>
      <span>Compatibility</span>
      <b>{summary.normalizedObservations} normalized · {diagnosticCount} diagnostics</b>
    </summary>
    <div>
      <section>
        <label>OBSERVED SOURCE CONTRACTS</label>
        {summary.contracts.length > 0 ? <ul>
          {summary.contracts.map((contract) => <li
            key={`${contract.product}:${contract.productVersion ?? ""}:${contract.schemaVersion ?? ""}`}
          >
            <b>{contract.product}</b>
            <span>
              product {contract.productVersion ?? "version unknown"}
              {" · "}schema {contract.schemaVersion ?? "unknown"}
              {" · "}{contract.observations} observations
            </span>
          </li>)}
        </ul> : <p>No supported observations in this window.</p>}
      </section>
      <section>
        <label>NORMALIZATION DIAGNOSTICS</label>
        {summary.diagnostics.length > 0 ? <ul>
          {summary.diagnostics.map((diagnostic) => <li key={diagnostic.code}>
            <b>{diagnostic.code}</b>
            <span>{diagnostic.count} {diagnostic.count === 1 ? "record" : "records"}</span>
          </li>)}
        </ul> : <p>No compatibility diagnostics.</p>}
      </section>
    </div>
  </details>;
}

export function RuntimeEvidenceLedger({
  capture,
  onClose,
  onInspect,
}: {
  capture: RuntimeCapture;
  onClose: () => void;
  onInspect: (observation: RuntimeObservation) => void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [limit, setLimit] = useState(100);
  const kinds = useMemo(
    () => [...new Set(capture.observations.map((observation) => observation.kind))].sort(),
    [capture],
  );
  const observations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return capture.observations.filter((observation) => {
      if (kind !== "all" && observation.kind !== kind) return false;
      if (!needle) return true;
      return [
        observation.kind,
        observation.process?.name,
        observation.process?.processId,
        observation.process?.containerId,
        observation.process?.currentWorkingDirectory,
        observation.process?.mountNamespace,
        observation.process?.executablePath,
        observation.process?.commandLine,
        observation.fileDescriptor?.path,
        observation.fileDescriptor?.descriptorId,
        observation.connection?.source.address,
        observation.connection?.source.port,
        observation.connection?.destination.address,
        observation.connection?.destination.port,
      ].some((value) => String(value ?? "").toLowerCase().includes(needle));
    });
  }, [capture, kind, query]);

  return <div className="runtime-ledger-overlay" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="runtime-ledger" role="dialog" aria-modal="true" aria-labelledby="runtime-ledger-title">
      <header>
        <div>
          <label className="section-label">CURRENT OBSERVATION WINDOW</label>
          <h2 id="runtime-ledger-title">Evidence ledger</h2>
          <p>
            {formatRuntimeClock(capture.startedAt)}–{formatRuntimeClock(capture.endedAt)}
            {" · "}{capture.observations.length} normalized observations
          </p>
        </div>
        <button type="button" aria-label="Close evidence ledger" onClick={onClose}>×</button>
      </header>
      <div className="runtime-ledger-filters">
        <input
          aria-label="Search runtime evidence"
          placeholder="Search process, container, namespace, path, address, or activity"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(100);
          }}
        />
        <select value={kind} onChange={(event) => {
          setKind(event.target.value);
          setLimit(100);
        }}>
          <option value="all">All activity kinds</option>
          {kinds.map((value) => <option key={value} value={value}>
            {value.replaceAll("_", " ")}
          </option>)}
        </select>
      </div>
      <div className="runtime-ledger-list">
        <header>
          <span>TIME</span><span>ACTIVITY</span><span>EXECUTION</span><span>TARGET</span>
        </header>
        {observations.slice(0, limit).map((observation) => <button
          type="button"
          key={observation.id}
          onClick={() => onInspect(observation)}
        >
          <time title={observation.observedAt}>{formatRuntimeClock(observation.observedAt)}</time>
          <span>
            <b>{observation.kind.replaceAll("_", " ")}</b>
            <small>
              {observation.basis}
              {observation.observedAtSource === "transport_received"
                ? " · transport receipt time"
                : ""}
            </small>
          </span>
          <span>
            <b>{observation.process?.name ?? "no process context"}</b>
            <small>PID {observation.process?.processId ?? "—"}</small>
          </span>
          <code title={runtimeActivityTarget(observation)}>
            {runtimeActivityTarget(observation)}
          </code>
        </button>)}
      </div>
      <footer>
        <span>Showing {Math.min(limit, observations.length)} of {observations.length} matching observations</span>
        {limit < observations.length && <button type="button" onClick={() => setLimit((value) => value + 100)}>
          Load 100 more
        </button>}
      </footer>
    </section>
  </div>;
}
