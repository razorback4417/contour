import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stableStringify } from "../src/model/stable";
import { normalizeArgusJsonLines } from "../src/runtime/argus";
import { buildRuntimeGraph } from "../src/runtime/graph";
import type { RuntimeCapture, RuntimeObservation } from "../src/runtime/types";

const fixture = readFileSync(
  new URL("../fixtures/argus/process-network-sequence.jsonl", import.meta.url),
  "utf8",
);

describe("runtime graph reducer", () => {
  it("builds direct process, container, file, and TCP relationships", () => {
    const graph = buildRuntimeGraph(normalizeArgusJsonLines(fixture, { synthetic: true }));

    expect(graph.nodes.map((node) => node.kind)).toEqual(expect.arrayContaining([
      "host",
      "container",
      "process_execution",
      "file",
      "tcp_connection",
      "tcp_endpoint",
      "network_interface",
    ]));
    expect(graph.edges.map((edge) => edge.kind)).toEqual(expect.arrayContaining([
      "contains",
      "member_of",
      "opened",
      "owns_connection",
      "source_endpoint",
      "destination_endpoint",
      "uses_interface",
    ]));
    const process = graph.nodes.find((node) => node.kind === "process_execution");
    expect(process).toMatchObject({
      label: "python3",
      lifecycle: "terminated",
      firstSeenAt: "2026-07-27T18:00:01.000000000Z",
      lastSeenAt: "2026-07-27T18:00:04.000000000Z",
    });
    expect(process?.evidence).toHaveLength(4);
    expect(graph.diagnostics.map((item) => item.code)).toContain("runtime.parent_identity_unresolved");
  });

  it("is deterministic when source records arrive out of order", () => {
    const capture = normalizeArgusJsonLines(fixture, { synthetic: true });
    const reversed = { ...capture, observations: [...capture.observations].reverse() };

    expect(stableStringify(buildRuntimeGraph(reversed)))
      .toBe(stableStringify(buildRuntimeGraph(capture)));
  });

  it("does not collapse two executions that reuse a PID", () => {
    const first = processObservation("first", "2026-07-27T18:00:00Z", "2026-07-27T18:00:00Z");
    const second = processObservation("second", "2026-07-27T18:01:00Z", "2026-07-27T18:01:00Z");
    const capture = runtimeCapture([first, second]);

    const processes = buildRuntimeGraph(capture).nodes.filter((node) => node.kind === "process_execution");
    expect(processes).toHaveLength(2);
    expect(new Set(processes.map((node) => node.id)).size).toBe(2);
  });

  it("marks an identity as ambiguous rather than trusting a bare PID", () => {
    const observation = processObservation("missing-time", "2026-07-27T18:00:00Z", undefined);
    const graph = buildRuntimeGraph(runtimeCapture([observation]));

    expect(graph.nodes.some((node) => node.id.startsWith("runtime-process-ambiguous:"))).toBe(true);
    expect(graph.diagnostics.map((item) => item.code)).toContain("runtime.ambiguous_process_identity");
  });
});

function processObservation(id: string, observedAt: string, createdAt: string | undefined): RuntimeObservation {
  return {
    id,
    kind: "process_started",
    observedAt,
    basis: "observed",
    process: { processId: 42, selfExecId: 1, name: "worker", createdAt },
    source: {
      collector: "argus",
      product: "DOCA_ARGUS",
      activityName: "Process Created",
      synthetic: true,
      rawRecord: `{${id}}`,
    },
  };
}

function runtimeCapture(observations: RuntimeObservation[]): RuntimeCapture {
  return {
    schemaVersion: "contour.runtime/v1",
    captureId: "capture:test",
    host: { id: "host:test", bootId: "boot:test" },
    startedAt: observations[0].observedAt,
    endedAt: observations.at(-1)?.observedAt ?? observations[0].observedAt,
    observations,
    diagnostics: [],
  };
}
