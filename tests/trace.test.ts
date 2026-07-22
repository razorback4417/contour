import { describe, expect, it } from "vitest";
import { pathContainsEdge, traceTopologyPath } from "../src/ui/trace";
import type { TopologyNode } from "../src/model/types";

describe("known topology path", () => {
  const nodes = new Map<string, TopologyNode>([
    node("host"), node("bridge-a", "host"), node("gpu", "bridge-a"), node("bridge-b", "host"), node("nic", "bridge-b")
  ].map((item) => [item.id, item]));

  it("walks through the lowest common containment ancestor", () => {
    const path = traceTopologyPath("gpu", "nic", nodes);
    expect(path).toEqual(["gpu", "bridge-a", "host", "bridge-b", "nic"]);
    expect(pathContainsEdge(path, "host", "bridge-b")).toBe(true);
    expect(pathContainsEdge(path, "gpu", "nic")).toBe(false);
  });
});

function node(id: string, parentId?: string): TopologyNode {
  return { id, kind: id === "host" ? "host" : "pci_endpoint", label: id, ...(parentId ? { parentId } : {}), facts: {} };
}
