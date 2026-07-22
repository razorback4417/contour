import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHwlocXml } from "../src/adapters/hwloc";
import type { EvidenceObservation } from "../src/adapters/evidence";
import { collectPhysicalEvidence } from "../src/collectors/evidence";
import { normalizeHwloc } from "../src/normalize/hwloc";

const xml = readFileSync(new URL("../fixtures/workstation.xml", import.meta.url), "utf8");

describe("optional physical evidence collectors", () => {
  it("runs independent sources and records unavailable tools honestly", async () => {
    const snapshot = normalizeHwloc(parseHwlocXml(xml));
    const inspectPci = async (bdf: string): Promise<EvidenceObservation[]> => [{
      target: { pciBdf: bdf }, placement: "node", collector: "linux.pci_sysfs", source: `/sys/bus/pci/devices/${bdf}`,
      facts: [{ key: "pci.vendor_id", value: bdf === "0000:02:00.0" ? "0x15b3" : "0x10de", sourceField: "vendor" }]
    }];
    const calls: string[] = [];
    const runner = async (command: string, args: string[]) => {
      calls.push(`${command} ${args.join(" ")}`);
      if (command === "ethtool" && args[0] === "-i") return { stdout: "driver: mlx5_core\nfirmware-version: 28.40.1000\nbus-info: 0000:02:00.0\n", stderr: "" };
      if (command === "ethtool") return { stdout: "Speed: 400000Mb/s\nDuplex: Full\nLink detected: yes\n", stderr: "" };
      if (command === "rdma") return { stdout: JSON.stringify([{ ifname: "mlx5_0", port: 1, counters: { rx_write_requests: 7 } }]), stderr: "" };
      if (command === "devlink") throw Object.assign(new Error("not installed"), { code: "ENOENT" });
      if (command === "nvidia-smi") return { stdout: "<nvidia_smi_log></nvidia_smi_log>", stderr: "" };
      if (command === "mlxlink") return { stdout: JSON.stringify({ result: { "Link Speed Active": "16G-Gen4" } }), stderr: "" };
      throw new Error(`unexpected ${command} ${args.join(" ")}`);
    };

    const evidence = await collectPhysicalEvidence(snapshot, { inspectPci, runner, now: () => new Date("2026-07-22T00:00:00Z") });
    expect(evidence.collectors.find((item) => item.collector === "linux.pci_sysfs")?.status).toBe("success");
    expect(evidence.collectors.find((item) => item.collector === "linux.devlink_info")?.status).toBe("unavailable");
    expect(evidence.collectors.find((item) => item.collector === "linux.ethtool")?.status).toBe("success");
    expect(evidence.observations.some((item) => item.collector === "nvidia.mlxlink")).toBe(true);
    expect(calls.some((call) => call.startsWith("ethtool -S "))).toBe(true);
  });
});
