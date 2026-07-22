import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHwlocXml } from "../src/adapters/hwloc";
import { parseDevlinkHealthJson, parseDevlinkInfoJson, parseEttoolText, parseMlxlinkJson, parseNvidiaSmiXml, parseRdmaStatisticJson, type EvidenceObservation } from "../src/adapters/evidence";
import { normalizeHwloc } from "../src/normalize/hwloc";
import { enrichPhysicalEvidence } from "../src/normalize/evidence";
import { assessLinkEvidence, findLinkEvidence } from "../src/ui/evidence";

const xml = readFileSync(new URL("../fixtures/workstation.xml", import.meta.url), "utf8");

describe("physical evidence boundary", () => {
  it("places PCIe facts on the upstream edge and preserves arbitrary future fields", () => {
    const base = normalizeHwloc(parseHwlocXml(xml));
    const observation: EvidenceObservation = {
      target: { pciBdf: "0000:01:00.0" },
      placement: "upstream_edge",
      collector: "linux.pci_sysfs",
      source: "/sys/bus/pci/devices/0000:01:00.0",
      facts: [
        { key: "pcie.current_width", value: 16, rawValue: "16", sourceField: "current_link_width" },
        { key: "pcie.future_field", value: "preserved", sourceField: "future_field" }
      ]
    };
    const snapshot = enrichPhysicalEvidence(base, { observations: [observation], collectors: [collector("linux.pci_sysfs")] });
    const gpu = snapshot.nodes.find((node) => node.facts.pci_bdf?.value === "0000:01:00.0")!;
    const upstream = snapshot.edges.find((edge) => edge.kind === "contains" && edge.target === gpu.id)!;
    expect(upstream.facts["pcie.current_width"].value).toBe(16);
    expect(upstream.facts["pcie.current_width"].provenance[0]).toMatchObject({ collector: "linux.pci_sysfs", rawValue: "16", sourceField: "current_link_width" });
    expect(upstream.facts["pcie.future_field"].value).toBe("preserved");
    expect(gpu.facts["pcie.current_width"]).toBeUndefined();
    upstream.facts["pcie.max_width"] = structuredClone(upstream.facts["pcie.current_width"]);
    upstream.facts["pcie.current_width"] = structuredClone(upstream.facts["pcie.current_width"]);
    upstream.facts["pcie.max_width"].value = 16;
    upstream.facts["pcie.current_width"].value = 8;
    expect(findLinkEvidence(snapshot, gpu.id)).toHaveLength(1);
    expect(assessLinkEvidence(upstream).state).toBe("below_capability");
  });

  it("parses generic link, RDMA, devlink, NVIDIA, and mlxlink evidence", () => {
    expect(keys(parseEttoolText("Speed: 400000Mb/s\nDuplex: Full\nAuto-negotiation: on\nLink detected: yes", "eth0"))).toEqual(expect.arrayContaining(["ethernet.speed_mbps", "ethernet.link_detected"]));
    expect(keys(parseRdmaStatisticJson(JSON.stringify([{ ifname: "mlx5_0", port: 1, counters: { rx_write_requests: 7 } }]))[0])).toContain("rdma.counter.rx_write_requests");
    expect(keys(parseRdmaStatisticJson(JSON.stringify([{ ifname: "mlx5_0", port: 1, rx_write_requests: 7, out_of_buffer: 0 }]))[0])).toEqual(expect.arrayContaining(["rdma.counter.rx_write_requests", "rdma.counter.out_of_buffer"]));
    expect(keys(parseDevlinkInfoJson(JSON.stringify({ info: { "pci/0000:02:00.0": { driver: "mlx5_core", versions: { running: { "fw.version": "28.40.1000" } } } } }))[0])).toEqual(expect.arrayContaining(["devlink.driver", "devlink.version.running.fw_version"]));
    expect(keys(parseDevlinkHealthJson(JSON.stringify({ health: { "pci/0000:02:00.0": [{ reporter: "tx", state: "healthy", error: 0, recover: 0 }] } }))[0])).toEqual(expect.arrayContaining(["devlink.health.tx.state", "devlink.health.tx.error"]));
    expect(keys(parseNvidiaSmiXml("<nvidia_smi_log><gpu><pci><pci_bus_id>00000000:01:00.0</pci_bus_id><pci_gpu_link_info><pcie_gen><current_link_gen>4</current_link_gen><max_link_gen>5</max_link_gen></pcie_gen><link_widths><current_link_width>16x</current_link_width><max_link_width>16x</max_link_width></link_widths></pci_gpu_link_info></pci></gpu></nvidia_smi_log>")[0])).toContain("nvidia.pcie.current_generation");
    expect(keys(parseMlxlinkJson(JSON.stringify({ result: { "Link Speed Active": "16G-Gen4", "Link Width Active": "16X", "CRC Error TLP": 2 } }), "0000:02:00.0")[0])).toEqual(expect.arrayContaining(["mlxlink.link_speed_active", "mlxlink.link_width_active", "mlxlink.crc_error_tlp"]));
  });
});

function keys(observation: EvidenceObservation): string[] { return observation.facts.map((fact) => fact.key); }
function collector(name: string) { return { collector: name, status: "success" as const, startedAt: "2026-07-22T00:00:00Z", completedAt: "2026-07-22T00:00:00Z", source: name }; }
