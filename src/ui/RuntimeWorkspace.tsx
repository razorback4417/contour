import { useEffect, useMemo, useRef, useState } from "react";
import type {
  RuntimeCapture,
  RuntimeGraph,
  RuntimeGraphEdge,
  RuntimeGraphNode,
  RuntimeObservation,
} from "../runtime/types";
import {
  defaultRuntimeFocus,
  highlightRuntimeEvidence,
  projectRuntimeFocus,
  runtimeProcessMatches,
  runtimeTrafficSample,
  summarizeRuntimeGraph,
  type RuntimeFocusProjection,
} from "./runtime-projection";
import { RuntimeDossier } from "./RuntimeDossier";
import {
  activityGroupLabel,
  formatRuntimeClock,
  groupRuntimeActivity,
  runtimeActivityTarget,
  type RuntimeActivityGroup,
} from "./runtime-activity";
import {
  RuntimeCompatibilityPanel,
  RuntimeEvidenceLedger,
} from "./RuntimeEvidence";

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

interface RuntimeProcessGroup {
  label: string;
  executions: RuntimeGraphNode[];
  records: number;
}

export function RuntimeWorkspace({
  capture,
  graph,
  live = false,
  following = false,
  stale = false,
  hasEarlier = false,
  hasNewer = false,
  historyAction,
  historyError,
  onLoadEarlier,
  onLoadNewer,
  onJumpToTime,
  onJumpLive,
  onFollowingChange,
  onFocusChange,
}: {
  capture: RuntimeCapture;
  graph: RuntimeGraph;
  live?: boolean;
  following?: boolean;
  stale?: boolean;
  hasEarlier?: boolean;
  hasNewer?: boolean;
  historyAction?: "earlier" | "jump" | "live";
  historyError?: string;
  onLoadEarlier?: () => Promise<boolean>;
  onLoadNewer?: () => void;
  onJumpToTime?: (before: string) => Promise<boolean>;
  onJumpLive?: () => Promise<boolean>;
  onFollowingChange?: (following: boolean) => void;
  onFocusChange?: (focusId: string | undefined) => void;
}) {
  const summary = useMemo(() => summarizeRuntimeGraph(graph), [graph]);
  const processes = useMemo(() => graph.nodes
    .filter((node) => node.kind === "process_execution")
    .sort((left, right) =>
      right.lastSeenAt.localeCompare(left.lastSeenAt)
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id)), [graph]);
  const fallbackFocus = useMemo(() => defaultRuntimeFocus(graph), [graph]);
  const [requestedFocusId, setRequestedFocusId] = useState(fallbackFocus?.id);
  const focusId = processes.some((node) => node.id === requestedFocusId)
    ? requestedFocusId
    : fallbackFocus?.id;
  const processGroups = useMemo(() => groupProcesses(processes), [processes]);
  const [processQuery, setProcessQuery] = useState("");
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const filteredProcessGroups = useMemo(() => {
    return processGroups.filter((group) =>
      group.executions.some((node) => runtimeProcessMatches(graph, node, processQuery)));
  }, [graph, processGroups, processQuery]);
  const processPicker = useRef<HTMLDetailsElement>(null);
  const windowPicker = useRef<HTMLDetailsElement>(null);
  const [jumpTime, setJumpTime] = useState(() => formatDateTimeInput(capture.endedAt));
  const projection = useMemo(
    () => focusId ? projectRuntimeFocus(graph, focusId) : undefined,
    [focusId, graph],
  );
  const [requestedSelectionId, setRequestedSelectionId] = useState(focusId);
  const selectedNode = projection?.nodes.find((node) => node.id === requestedSelectionId)
    ?? projection?.focus;
  const synthetic = capture.observations.length > 0
    && capture.observations.every((observation) => observation.source.synthetic);
  const focusedActivity = useMemo(
    () => projection ? activityForProcess(capture, projection.focus) : [],
    [capture, projection],
  );
  const activityGroups = useMemo(() => groupRuntimeActivity(focusedActivity), [focusedActivity]);
  const [playback, setPlayback] = useState<"live" | "replay" | "paused">(
    live && following ? "live" : "replay",
  );
  const [playhead, setPlayhead] = useState(0);
  const activeIndex = Math.min(playhead, Math.max(0, activityGroups.length - 1));
  const activeGroup = activityGroups[activeIndex];
  const activeObservation = activeGroup?.observation;
  const activeTraffic = runtimeTrafficSample(focusedActivity, activeGroup?.endIndex ?? 0);
  const visibleActivity = useMemo(
    () => activityWindow(activityGroups, activeIndex, 8),
    [activeIndex, activityGroups],
  );

  useEffect(() => {
    if (live && following) setPlayback("live");
    else if (!live) setPlayback("replay");
  }, [following, live]);

  useEffect(() => {
    onFocusChange?.(focusId);
  }, [focusId, onFocusChange]);

  useEffect(() => {
    setPlayhead(playback === "live" ? Math.max(0, activityGroups.length - 1) : 0);
  }, [focusId]);

  useEffect(() => {
    setJumpTime(formatDateTimeInput(capture.endedAt));
  }, [capture.captureId, capture.endedAt]);

  useEffect(() => {
    if (playback !== "live") return;
    setPlayhead(Math.max(0, activityGroups.length - 1));
  }, [activityGroups.length, capture.captureId, playback]);

  useEffect(() => {
    if (playback !== "replay" || activityGroups.length < 2) return;
    const timer = window.setInterval(() => {
      setPlayhead((current) => (current + 1) % activityGroups.length);
    }, 980);
    return () => window.clearInterval(timer);
  }, [activityGroups.length, playback]);

  useEffect(() => {
    const dismissOpenPicker = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      for (const picker of [processPicker.current, windowPicker.current]) {
        if (picker?.open && !picker.contains(event.target)) picker.removeAttribute("open");
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      processPicker.current?.removeAttribute("open");
      windowPicker.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", dismissOpenPicker);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOpenPicker);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, []);

  function chooseProcess(id: string) {
    setRequestedFocusId(id);
    setRequestedSelectionId(id);
    setProcessQuery("");
    processPicker.current?.removeAttribute("open");
    onFocusChange?.(id);
  }

  function choosePlayback(next: "live" | "replay" | "paused") {
    setPlayback(next);
    if (live) onFollowingChange?.(next === "live");
  }

  return <div className="runtime-workspace">
    <header className="runtime-heading">
      <div>
        <label className="section-label">ARGUS RUNTIME TOPOLOGY</label>
        <h1>Observed software paths</h1>
        <p>
          {capture.host.hostname ?? capture.host.id}
          {" · "}{formatWindow(capture.startedAt, capture.endedAt)}
          {" · "}{processes.length} executions
          {" · "}{capture.observations.length} observations
        </p>
      </div>
      <span className={synthetic ? "synthetic" : stale ? "stale" : "capture"}>
        {synthetic
          ? "SYNTHETIC REPLAY"
          : stale
            ? "FEED STALE · LAST GOOD WINDOW"
            : live && !following
              ? "LIVE FEED · VIEW PAUSED"
              : live
                ? "LIVE · 2S REFRESH"
                : "CAPTURE REPLAY"}
      </span>
    </header>

    <section className="runtime-investigation-bar" aria-label="Runtime investigation controls">
      <div>
        <details className="runtime-process-picker" ref={processPicker}>
          <summary>
            <span>
              <label>FOCUSED EXECUTION</label>
              <b>{projection?.focus.label ?? "No execution selected"}</b>
              <small>
                PID {String(projection?.focus.facts.processId ?? "unknown")}
                {" · "}{projection?.focus.evidence.length ?? 0} evidence records
              </small>
            </span>
            <i>Change</i>
          </summary>
          <div className="runtime-process-menu">
            <input
              aria-label="Filter executions"
              placeholder="Filter process, container, path, or endpoint"
              value={processQuery}
              onChange={(event) => setProcessQuery(event.target.value)}
            />
            <header>
              <span>{filteredProcessGroups.length} process names</span>
              <small>{processes.length} executions in window</small>
            </header>
            <div>
              {filteredProcessGroups.slice(0, 40).map((group) => {
                const process = group.executions.find((execution) =>
                  runtimeProcessMatches(graph, execution, processQuery)) ?? group.executions[0];
                return <button
                  type="button"
                  className={group.executions.some((node) => node.id === focusId) ? "active" : ""}
                  key={group.label}
                  onClick={() => chooseProcess(process.id)}
                >
                  <span>
                    <b>{group.label}</b>
                    <small>
                      {group.executions.length} {group.executions.length === 1 ? "execution" : "executions"}
                      {" · "}{group.records} records
                    </small>
                  </span>
                  <code>
                    {processQuery.trim() ? "matching" : "latest"} PID{" "}
                    {String(process.facts.processId ?? "unknown")}
                  </code>
                </button>;
              })}
            </div>
            {filteredProcessGroups.length > 40 && <footer>
              Refine the filter to inspect {filteredProcessGroups.length - 40} more process names.
            </footer>}
          </div>
        </details>
      </div>
      <details className="runtime-window-summary" ref={windowPicker}>
        <summary>
          <span>
            <label>OBSERVATION WINDOW</label>
            <b>{formatRuntimeClock(capture.startedAt)}–{formatRuntimeClock(capture.endedAt)}</b>
            <small>
              {formatWindow(capture.startedAt, capture.endedAt)}
              {" · "}{activityGroups.length} activity episodes
            </small>
          </span>
          {live && <i>Change</i>}
        </summary>
        {live && <div className="runtime-window-menu">
          <header>
            <b>Navigate retained evidence</b>
            <small>UTC · bounded by the server record limit</small>
          </header>
          <nav>
            <button
              type="button"
              disabled={!hasEarlier || Boolean(historyAction)}
              onClick={async () => {
                if (await onLoadEarlier?.()) windowPicker.current?.removeAttribute("open");
              }}
            >{historyAction === "earlier" ? "Loading…" : "← Earlier"}</button>
            <button
              type="button"
              disabled={!hasNewer || Boolean(historyAction)}
              onClick={onLoadNewer}
            >Newer →</button>
            <button
              type="button"
              disabled={following || Boolean(historyAction)}
              onClick={async () => {
                if (await onJumpLive?.()) {
                  choosePlayback("live");
                  windowPicker.current?.removeAttribute("open");
                }
              }}
            >{historyAction === "live" ? "Loading…" : "Live"}</button>
          </nav>
          <label htmlFor="runtime-jump-time">Jump to events before</label>
          <div>
            <input
              id="runtime-jump-time"
              type="datetime-local"
              step="1"
              value={jumpTime}
              onChange={(event) => setJumpTime(event.target.value)}
            />
            <button type="button" disabled={!jumpTime || Boolean(historyAction)} onClick={async () => {
              if (await onJumpToTime?.(new Date(`${jumpTime}Z`).toISOString())) {
                windowPicker.current?.removeAttribute("open");
              }
            }}>{historyAction === "jump" ? "Loading…" : "Go"}</button>
          </div>
          {historyError && <p className="runtime-window-error" role="status">{historyError}</p>}
        </div>}
      </details>
    </section>

    {projection && selectedNode ? <div className="runtime-stage">
      <section className="runtime-map" aria-label="Focused software topology">
        <TopologyMap
          projection={projection}
          selectedNodeId={selectedNode.id}
          activeObservation={activeObservation}
          activeBytes={activeTraffic?.bytes}
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
      <RuntimeDossier
        graph={graph}
        node={selectedNode}
      />
    </div> : <p className="runtime-empty">
      Argus records arrived, but no process execution could be reconstructed from this window.
    </p>}

    {projection && <section className="runtime-sequence">
      <header>
        <div>
          <label className="section-label">EXECUTION ACTIVITY</label>
          <h2>{projection.focus.label}</h2>
        </div>
        {activeObservation && <div className="runtime-active-event" key={activeObservation.id}>
          <span>{playback === "live" ? "LATEST" : playback === "paused" ? "PAUSED" : "REPLAYING"}</span>
          <b>
            {activityGroupLabel(activeGroup)}
            {activeGroup.count > 1 ? ` ×${activeGroup.count}` : ""}
          </b>
          <small>
            {formatOffset(capture.startedAt, activeObservation.observedAt)}
            {activeTraffic ? ` · ${activeTraffic.label}` : ""}
          </small>
        </div>}
        <div className="runtime-playback" aria-label="Flow playback controls">
          {playback === "live" ? <span>FOLLOWING LIVE</span> : <button
            type="button"
            onClick={() => choosePlayback(playback === "replay" ? "paused" : "replay")}
          >{playback === "replay" ? "Pause replay" : "Resume replay"}</button>}
          {playback === "live" && <button
            type="button"
            onClick={() => {
              choosePlayback("replay");
              setPlayhead(0);
            }}
          >Replay window</button>}
          {playback !== "live" && <button
            type="button"
            onClick={() => {
              setPlayhead(0);
              choosePlayback("replay");
            }}
          >Restart replay</button>}
        </div>
      </header>
      <ol>
        {visibleActivity.map(({ group, index }) => {
          const traffic = runtimeTrafficSample(focusedActivity, group.endIndex);
          const observation = group.observation;
          return <li
            className={index === activeIndex ? "active" : ""}
            key={`${observation.id}:${group.count}`}
          >
            <button type="button" onClick={() => {
              setPlayhead(index);
              choosePlayback("paused");
            }}>
              <time>{formatOffset(capture.startedAt, observation.observedAt)}</time>
              <b>
                {activityGroupLabel(group)}
                {group.count > 1 ? ` ×${group.count}` : ""}
              </b>
              <span>
                {group.count > 1
                  ? `${group.targets} ${group.targets === 1 ? "target" : "targets"} in this burst`
                  : runtimeActivityTarget(observation)}
              </span>
              {traffic && <small>{traffic.label}</small>}
            </button>
          </li>;
        })}
      </ol>
    </section>}

    {ledgerOpen && <RuntimeEvidenceLedger
      capture={capture}
      onClose={() => setLedgerOpen(false)}
      onInspect={(observation) => {
        const process = processes.find((node) => node.evidence.includes(observation.id));
        if (process) chooseProcess(process.id);
        setLedgerOpen(false);
      }}
    />}

    <footer className="runtime-evidence">
      <span>{graph.nodes.length} entities · {graph.edges.length} evidence-backed relationships</span>
      <button type="button" onClick={() => setLedgerOpen(true)}>
        Evidence ledger · {capture.observations.length}
      </button>
      <span>
        {summary.inferredEdges > 0 ? `${summary.inferredEdges} inferred edges` : "direct edges only"}
        {" · "}{graph.diagnostics.length} total diagnostics
      </span>
      <RuntimeCompatibilityPanel capture={capture}/>
    </footer>
  </div>;
}

function TopologyMap({
  projection,
  selectedNodeId,
  activeObservation,
  activeBytes,
  onSelect,
}: {
  projection: RuntimeFocusProjection;
  selectedNodeId: string;
  activeObservation?: RuntimeObservation;
  activeBytes?: number;
  onSelect: (id: string) => void;
}) {
  const positioned = useMemo(() => positionNodes(projection), [projection]);
  const positionById = useMemo(
    () => new Map(positioned.map((item) => [item.node.id, item])),
    [positioned],
  );
  const height = Math.max(390, ...positioned.map((item) => item.y + nodeHeight + 34));
  const highlight = highlightRuntimeEvidence(projection, activeObservation?.id);
  const activeEdges = projection.edges.filter((edge) => highlight.edgeIds.has(edge.id));
  const primaryPulse = activeEdges.find((edge) => edge.kind === "owns_connection")
    ?? activeEdges.find((edge) => edge.kind === "opened");
  const destinationPulse = activeEdges.find((edge) => edge.kind === "destination_endpoint");
  const pulseEdgeIds = new Set(
    [primaryPulse?.id, destinationPulse?.id].filter((id): id is string => Boolean(id)),
  );

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
        const path = edgePath(source, target);
        const active = highlight.edgeIds.has(edge.id);
        return <g key={edge.id}>
          <path
            className={`${edge.basis} ${active ? "active" : ""}`}
            d={path}
            markerEnd="url(#runtime-arrow)"
          />
          {active && pulseEdgeIds.has(edge.id) && <circle
            className="runtime-data-pulse"
            key={`${activeObservation?.id}:${edge.id}`}
            r={pulseRadius(activeBytes)}
            opacity="0"
          >
            <animateMotion
              path={path}
              begin={pulseDelay(edge)}
              dur="760ms"
            />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              begin={pulseDelay(edge)}
              dur="760ms"
              fill="freeze"
            />
          </circle>}
        </g>;
      })}
    </g>
    <g className="runtime-map-nodes">
      {positioned.map(({ node, x, y }) => <g
        className={`${node.kind} ${node.lifecycle} ${node.id === selectedNodeId ? "selected" : ""} ${highlight.nodeIds.has(node.id) ? "active" : ""}`}
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
      const stableNodes = [...nodes].sort((left, right) =>
        left.kind.localeCompare(right.kind)
        || left.label.localeCompare(right.label)
        || left.id.localeCompare(right.id));
      const columnHeight = stableNodes.length * 64 - 12;
      const startY = 58 + Math.max(0, (canvasHeight - columnHeight) / 2);
      return stableNodes.map((node, index) => ({
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

function groupProcesses(processes: RuntimeGraphNode[]): RuntimeProcessGroup[] {
  const groups = new Map<string, RuntimeProcessGroup>();
  for (const process of processes) {
    const key = process.label || "unknown process";
    const current = groups.get(key);
    if (current) {
      current.executions.push(process);
      current.records += process.evidence.length;
    } else {
      groups.set(key, {
        label: key,
        executions: [process],
        records: process.evidence.length,
      });
    }
  }
  return [...groups.values()].sort((left, right) =>
    right.records - left.records
    || right.executions[0].lastSeenAt.localeCompare(left.executions[0].lastSeenAt)
    || left.label.localeCompare(right.label));
}

function activityWindow(
  groups: RuntimeActivityGroup[],
  activeIndex: number,
  limit: number,
): Array<{ group: RuntimeActivityGroup; index: number }> {
  const start = Math.min(
    Math.max(0, activeIndex - limit + 2),
    Math.max(0, groups.length - limit),
  );
  return groups.slice(start, start + limit)
    .map((group, offset) => ({ group, index: start + offset }));
}

function pulseRadius(bytes: number | undefined): number {
  return Math.min(5, 2.75 + Math.log10(Math.max(1, bytes ?? 0)) * 0.4);
}

function pulseDelay(edge: RuntimeGraphEdge): string {
  return edge.kind === "destination_endpoint" ? "0.18s" : "0s";
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

function formatDateTimeInput(value: string): string {
  return new Date(timestampMs(value)).toISOString().slice(0, 19);
}

function timestampMs(value: string): number {
  return Date.parse(value.replace(/(\.\d{3})\d+(Z|[+-]\d{2}:\d{2})$/, "$1$2"));
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function stripTrailingZero(value: string): string {
  return value.replace(/\.0$/, "");
}
