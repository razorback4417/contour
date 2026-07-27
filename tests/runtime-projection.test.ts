import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeArgusJsonLines } from "../src/runtime/argus";
import { buildRuntimeGraph } from "../src/runtime/graph";
import {
  runtimeRelationshipLabel,
  runtimeRelationships,
  summarizeRuntimeGraph,
} from "../src/ui/runtime-projection";

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
});
