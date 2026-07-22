import { describe, expect, it } from "vitest";
import { collectLinuxNetwork } from "../src/collectors/linux-network";

describe("focused Linux network collectors", () => {
  it("collects structured RDMA device and devlink port correlations without retaining GUIDs", async () => {
    const calls: string[] = [];
    const result = await collectLinuxNetwork({
      runner: async (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        if (command === "ip") return { stdout: JSON.stringify([{ ifindex: 2, ifname: "eth0", link_type: "ether", operstate: "UP" }]), stderr: "" };
        if (command === "rdma" && args.includes("link")) return { stdout: JSON.stringify([{ ifname: "mlx5_0", port: 1, netdev: "eth0", state: "ACTIVE" }]), stderr: "" };
        if (command === "rdma") return { stdout: JSON.stringify([{ ifname: "mlx5_0", ifindex: 3, fw: "28.40.1000", node_type: "ca", node_guid: "not-retained" }]), stderr: "" };
        if (command === "devlink") return { stdout: JSON.stringify({ port: { "pci/0000:02:00.0/1": { flavour: "physical", port: 1, type: "eth", netdev: "eth0" } } }), stderr: "" };
        throw new Error(`unexpected command: ${command}`);
      },
      inspectSysfs: async (ifname) => ({ ifname, pciBdf: "0000:02:00.0", devicePath: "/sys/devices/0000:02:00.0" }),
      inspectInfiniband: async () => [{ device: "mlx5_0", pciBdf: "0000:02:00.0", devicePath: "/sys/devices/0000:02:00.0" }],
      now: () => new Date("2026-07-22T00:00:00Z")
    });

    expect(calls).toEqual(expect.arrayContaining(["rdma -j link show", "rdma -j dev show", "devlink -j port show"]));
    expect(result.rdmaDevices[0]).toEqual({ device: "mlx5_0", ifindex: 3, firmware: "28.40.1000", nodeType: "ca" });
    expect(result.devlinkPorts[0].netdev).toBe("eth0");
    expect(result.collectors.every((collector) => collector.status === "success")).toBe(true);
  });
});
