import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HwlocParseError, parseHwlocXml, type RawHwlocObject } from "../src/adapters/hwloc";
import { normalizeHwloc } from "../src/normalize/hwloc";
import { stableStringify } from "../src/model/stable";
import { layoutTopology } from "../src/layout/hierarchy";
import { renderTopologySvg } from "../src/render/svg";

const workstationXml = readFileSync(new URL("../fixtures/workstation.xml", import.meta.url), "utf8");
const acceleratorXml = readFileSync(new URL("../fixtures/accelerator-server.xml", import.meta.url), "utf8");

describe("hwloc normalization contract", () => {
  it("is byte-stable across repeated normalization", () => {
    const first = normalizeHwloc(parseHwlocXml(acceleratorXml, "accelerator.xml"));
    const second = normalizeHwloc(parseHwlocXml(acceleratorXml, "accelerator.xml"));
    expect(stableStringify(first)).toBe(stableStringify(second));
  });

  it("ignores raw sibling discovery order", () => {
    const raw = parseHwlocXml(acceleratorXml, "accelerator.xml");
    const reordered = structuredClone(raw);
    reverseChildren(reordered.root);
    expect(stableStringify(normalizeHwloc(reordered))).toBe(stableStringify(normalizeHwloc(raw)));
  });

  it("uses stable physical facts for unique IDs", () => {
    const snapshot = normalizeHwloc(parseHwlocXml(workstationXml));
    const ids = snapshot.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    const gpu = snapshot.nodes.find((node) => node.kind === "gpu");
    expect(gpu?.facts.pci_bdf.value).toBe("0000:01:00.0");
    expect(gpu?.id.startsWith("gpu:")).toBe(true);
    expect(snapshot.nodes.filter((node) => node.kind === "gpu")).toHaveLength(1);
    expect(snapshot.nodes.filter((node) => node.kind === "storage_device")).toHaveLength(1);
  });

  it("retains observed provenance and explicit NUMA locality", () => {
    const snapshot = normalizeHwloc(parseHwlocXml(acceleratorXml, "fixture.xml"));
    const nic = snapshot.nodes.find((node) => node.kind === "nic" && node.facts.pci_bdf.value === "0000:03:00.0")!;
    expect(nic.facts.pci_bdf.provenance[0]).toMatchObject({ collector: "hwloc.lstopo_xml", source: "fixture.xml", sourceField: "pci_busid", rawValue: "0000:03:00.0" });
    const locality = snapshot.edges.find((edge) => edge.kind === "local_to" && edge.source === nic.id);
    expect(snapshot.nodes.find((node) => node.id === locality?.target)?.label).toBe("NUMA 0");
    expect(locality?.provenance[0].method).toBe("derived");
  });

  it("keeps unknown distinct from absent and renders partial input", () => {
    const xml = `<topology><object type="Machine"><object type="Package" os_index="0"><object type="Core" os_index="0"/></object></object></topology>`;
    const snapshot = normalizeHwloc(parseHwlocXml(xml, "partial.xml"), { collectorStatus: "partial" });
    const host = snapshot.nodes.find((node) => node.kind === "host")!;
    expect(host.facts.numa_topology.state).toBe("unknown");
    expect(host.facts.serial_number).toBeUndefined();
    expect(snapshot.diagnostics.some((item) => item.code === "NUMA_UNAVAILABLE")).toBe(true);
    expect(renderTopologySvg(snapshot, layoutTopology(snapshot))).toContain("<svg");
  });

  it("reports malformed source data at the adapter boundary", () => {
    expect(() => parseHwlocXml("<topology><object></topology>")).toThrow(HwlocParseError);
  });
});

describe("deterministic layout and export", () => {
  it("produces stable positions", () => {
    const snapshot = normalizeHwloc(parseHwlocXml(acceleratorXml));
    const layout = layoutTopology(snapshot);
    expect(layout).toEqual(layoutTopology(snapshot));
    const numa = snapshot.nodes.filter((node) => node.kind === "numa_node").sort((a, b) => Number(a.facts.logical_index.value) - Number(b.facts.logical_index.value));
    const positions = new Map(layout.nodes.map((node) => [node.id, node]));
    expect(positions.get(numa[0].id)!.y).toBeLessThan(positions.get(numa[1].id)!.y);
  });

  it("produces byte-stable SVG", () => {
    const snapshot = normalizeHwloc(parseHwlocXml(workstationXml));
    const layout = layoutTopology(snapshot);
    expect(renderTopologySvg(snapshot, layout)).toBe(renderTopologySvg(snapshot, layout));
  });
});

function reverseChildren(object: RawHwlocObject): void {
  object.children.reverse();
  object.children.forEach(reverseChildren);
}
