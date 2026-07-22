import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHwlocXml } from "../src/adapters/hwloc";
import { normalizeHwloc } from "../src/normalize/hwloc";
import { layoutTopology } from "../src/layout/hierarchy";
import { renderTopologySvg } from "../src/render/svg";
import { ioRoots, projectTopologyView, searchTopologyNodes, topologyOverview } from "../src/ui/projection";

const xml = readFileSync(new URL("../fixtures/accelerator-server.xml", import.meta.url), "utf8");
const snapshot = normalizeHwloc(parseHwlocXml(xml, "fixture.xml"));

describe("progressive topology projection", () => {
  it("summarizes the durable snapshot without changing it", () => {
    const before = structuredClone(snapshot);
    const overview = topologyOverview(snapshot);
    expect(overview.totalNodes).toBe(snapshot.nodes.length);
    expect(overview.cpuCores).toBeGreaterThan(0);
    expect(overview.ioDevices).toBeGreaterThan(0);
    expect(snapshot).toEqual(before);
  });

  it("shows aggregate CPU and NUMA structure without individual cores or caches", () => {
    const projection = projectTopologyView(snapshot, { mode: "compute" });
    const kinds = new Set(snapshot.nodes.filter((node) => projection.visibleNodeIds.has(node.id)).map((node) => node.kind));
    expect(kinds).toEqual(new Set(["host", "cpu_package", "numa_node", "memory_region"]));
  });

  it("starts I/O at upstream groups and expands one branch deterministically", () => {
    const overview = projectTopologyView(snapshot, { mode: "io" });
    const bridge = ioRoots(snapshot)[0];
    const endpoint = snapshot.nodes.find((node) => node.parentId === bridge.id)!;
    expect(overview.visibleNodeIds.has(bridge.id)).toBe(true);
    expect(overview.visibleNodeIds.has(endpoint.id)).toBe(false);

    const focused = projectTopologyView(snapshot, { mode: "io", focusRootId: bridge.id });
    expect(focused.visibleNodeIds.has(endpoint.id)).toBe(true);
    expect(focused.hiddenDescendantCounts.get(bridge.id)).toBeUndefined();
    expect(projectTopologyView(snapshot, { mode: "io", focusRootId: bridge.id })).toEqual(focused);
  });

  it("exports the projected view without reintroducing hidden CPU detail", () => {
    const projection = projectTopologyView(snapshot, { mode: "compute" });
    const layout = layoutTopology(snapshot, projection.visibleNodeIds);
    const svg = renderTopologySvg(snapshot, layout, { visibleNodeIds: projection.visibleNodeIds });
    expect(svg).toContain("CPU package");
    expect(svg).not.toContain("Core 0");
    expect(svg).toBe(renderTopologySvg(snapshot, layout, { visibleNodeIds: projection.visibleNodeIds }));
  });

  it("ranks hardware suggestions deterministically and includes stable identifiers", () => {
    const gpuMatches = searchTopologyNodes(snapshot, "gpu", 8);
    expect(gpuMatches.length).toBeGreaterThan(0);
    expect(gpuMatches[0].kind).toBe("gpu");
    expect(searchTopologyNodes(snapshot, "gpu", 8)).toEqual(gpuMatches);

    const node = snapshot.nodes.find((candidate) => candidate.facts.pci_bdf?.value)!;
    const identifierMatches = searchTopologyNodes(snapshot, String(node.facts.pci_bdf.value), 8);
    expect(identifierMatches.map((candidate) => candidate.id)).toContain(node.id);
    expect(searchTopologyNodes(snapshot, "", 8)).toEqual([]);
  });
});
