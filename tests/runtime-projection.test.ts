import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeArgusJsonLines } from "../src/runtime/argus";
import { buildRuntimeGraph } from "../src/runtime/graph";
import {
  defaultRuntimeFocus,
  highlightRuntimeEvidence,
  projectRuntimeFocus,
  runtimeNodeInterpretation,
  runtimeProcessMatches,
  runtimeRelationshipLabel,
  runtimeRelationships,
  runtimeTrafficSample,
  summarizeRuntimeGraph,
} from "../src/ui/runtime-projection";
import {
  activityGroupLabel,
  groupRuntimeActivity,
} from "../src/ui/runtime-activity";

const fixture = readFileSync(
  new URL("../fixtures/argus/process-network-sequence.jsonl", import.meta.url),
  "utf8",
);
const graph = buildRuntimeGraph(normalizeArgusJsonLines(fixture, { synthetic: true }));

describe("runtime UI projection", () => {
  it("summarizes normalized graph kinds without reading Argus records", () => {
    expect(summarizeRuntimeGraph(graph)).toEqual({
      processes: 1,
      containers: 1,
      files: 2,
      connections: 1,
      inferredEdges: 0,
    });
  });

  it("projects both directions of a relationship with evidence basis", () => {
    const process = graph.nodes.find((node) => node.kind === "process_execution")!;
    const relationships = runtimeRelationships(graph, process.id);

    expect(relationships.some(({ edge, peer }) =>
      edge.kind === "opened" && edge.basis === "observed" && peer.kind === "file")).toBe(true);
    expect(runtimeRelationshipLabel("opened", "outgoing")).toBe("opened");
    expect(runtimeRelationshipLabel("opened", "incoming")).toBe("opened by");
  });

  it("builds a bounded process-centered topology with network endpoints", () => {
    const focus = defaultRuntimeFocus(graph)!;
    const projection = projectRuntimeFocus(graph, focus.id)!;

    expect(focus.label).toBe("python3");
    expect(projection.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining([
      "container",
      "process_execution",
      "file",
      "tcp_connection",
      "tcp_endpoint",
      "network_interface",
    ]));
    expect(projection.edges.every((edge) =>
      projection.nodes.some((node) => node.id === edge.source)
      && projection.nodes.some((node) => node.id === edge.target))).toBe(true);
    expect(projection.hiddenFiles).toBe(0);
    expect(projection.hiddenConnections).toBe(0);
  });

  it("finds executions through process facts and connected evidence", () => {
    const process = defaultRuntimeFocus(graph)!;

    expect(runtimeProcessMatches(graph, process, "python3")).toBe(true);
    expect(runtimeProcessMatches(graph, process, "synthetic-container-a")).toBe(true);
    expect(runtimeProcessMatches(graph, process, "/models/model.safetensors")).toBe(true);
    expect(runtimeProcessMatches(graph, process, "198.51.100.20")).toBe(true);
    expect(runtimeProcessMatches(graph, process, "not-present")).toBe(false);
  });

  it("highlights only topology entities backed by the active observation", () => {
    const focus = defaultRuntimeFocus(graph)!;
    const projection = projectRuntimeFocus(graph, focus.id)!;
    const highlight = highlightRuntimeEvidence(projection, "synthetic-network-created");

    expect(highlight.nodeIds.has(focus.id)).toBe(true);
    expect([...highlight.edgeIds].length).toBeGreaterThan(0);
    expect(projection.edges
      .filter((edge) => highlight.edgeIds.has(edge.id))
      .every((edge) => edge.evidence.includes("synthetic-network-created"))).toBe(true);
    expect(projection.nodes
      .filter((node) => highlight.nodeIds.has(node.id))
      .every((node) => node.evidence.includes("synthetic-network-created"))).toBe(true);
  });

  it("explains pidfds as process handles without claiming proven intent", () => {
    const node = {
      id: "pidfd",
      kind: "file" as const,
      label: "anon_inode:[pidfd]",
      lifecycle: "observed" as const,
      firstSeenAt: "2026-07-27T18:00:00Z",
      lastSeenAt: "2026-07-27T18:00:01Z",
      facts: { path: "anon_inode:[pidfd]" },
      evidence: ["one"],
    };
    const interpretation = runtimeNodeInterpretation(node, []);

    expect(interpretation?.title).toBe("Process lifecycle handle");
    expect(interpretation?.summary).toContain("do not prove intent");
  });

  it("derives network activity from the counter increase for the same connection", () => {
    const observations = normalizeArgusJsonLines(fixture, { synthetic: true }).observations
      .filter((observation) => observation.connection);
    const first = observations[0]!;
    const second = {
      ...first,
      id: "later-counter",
      observedAt: "2026-07-27T18:00:05Z",
      connection: {
        ...first.connection!,
        bytesIn: (first.connection?.bytesIn ?? 0) + 1_500,
        bytesOut: (first.connection?.bytesOut ?? 0) + 500,
      },
    };
    const sample = runtimeTrafficSample([first, second], 1);

    expect(sample).toEqual({
      bytes: 2_000,
      label: "+2 KB since prior sample",
      basis: "delta",
    });
  });

  it("collapses a same-time filesystem burst without dropping its observations", () => {
    const base = normalizeArgusJsonLines(fixture, { synthetic: true }).observations
      .find((observation) => observation.fileDescriptor)!;
    const observations = [
      base,
      {
        ...base,
        id: "file-close",
        kind: "file_descriptor_closed" as const,
        observedAt: "2026-07-27T18:00:02.050Z",
        fileDescriptor: { ...base.fileDescriptor!, path: "/models/config.json" },
      },
    ];
    const groups = groupRuntimeActivity(observations);

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
    expect(groups[0].targets).toBe(2);
    expect(activityGroupLabel(groups[0])).toBe("filesystem activity");
  });
});
