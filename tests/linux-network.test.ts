import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDevlinkPortJson, parseIpLinkJson, parseRdmaDeviceJson, parseRdmaLinkJson } from "../src/adapters/iproute";
import { parseHwlocXml } from "../src/adapters/hwloc";
import { normalizeHwloc } from "../src/normalize/hwloc";
import { enrichLinuxNetwork } from "../src/normalize/linux-network";

describe("generic Linux network enrichment", () => {
  it("correlates netdev, PCI, NUMA, RDMA device, and port using explicit keys", () => {
    const xml = readFileSync(new URL("../fixtures/workstation.xml", import.meta.url), "utf8");
    const base = normalizeHwloc(parseHwlocXml(xml));
    const snapshot = enrichLinuxNetwork(base, {
      interfaces: parseIpLinkJson(JSON.stringify([{ ifindex: 2, ifname: "eth0", link_type: "ether", operstate: "UP", mtu: 9000, num_rx_queues: 8, num_tx_queues: 8 }])),
      sysfs: [{ ifname: "eth0", pciBdf: "0000:02:00.0", numaNode: 0, devicePath: "/sys/devices/pci0000:00/0000:02:00.0" }],
      rdmaLinks: parseRdmaLinkJson(JSON.stringify([{ ifindex: 3, ifname: "mlx5_0", port: 1, netdev: "eth0", state: "ACTIVE", physical_state: "LINK_UP" }])),
      rdmaDevices: parseRdmaDeviceJson(JSON.stringify([{ ifindex: 3, ifname: "mlx5_0", fw: "28.40.1000", node_type: "ca", node_guid: "not-retained" }])),
      infiniband: [{ device: "mlx5_0", pciBdf: "0000:02:00.0", devicePath: "/sys/devices/pci0000:00/0000:02:00.0" }],
      devlinkPorts: parseDevlinkPortJson(JSON.stringify({ port: { "pci/0000:02:00.0/1": { flavour: "physical", port: 1, type: "eth", netdev: "eth0", splittable: false } } })),
      collectors: [collector("linux.ip_link"), collector("linux.sysfs_net"), collector("linux.rdma_link"), collector("linux.rdma_device"), collector("linux.infiniband_sysfs"), collector("linux.devlink_port")]
    });
    const netdev = snapshot.nodes.find((node) => node.kind === "network_interface" && node.facts["linux.ifname"]?.value === "eth0")!;
    const rdma = snapshot.nodes.find((node) => node.kind === "rdma_device")!;
    const port = snapshot.nodes.find((node) => node.kind === "network_port")!;
    expect(snapshot.nodes.filter((node) => node.kind === "network_interface")).toHaveLength(1);
    expect(snapshot.edges.some((edge) => edge.kind === "backed_by" && edge.source === netdev.id)).toBe(true);
    expect(snapshot.edges.some((edge) => edge.kind === "local_to" && edge.source === netdev.id)).toBe(true);
    expect(snapshot.edges).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "exposes", source: rdma.id, target: port.id }), expect.objectContaining({ kind: "connected_to", source: port.id, target: netdev.id })]));
    expect(rdma.parentId).toBe(snapshot.nodes.find((node) => node.facts.pci_bdf?.value === "0000:02:00.0")?.id);
    expect(rdma.facts["rdma.firmware"].value).toBe("28.40.1000");
    expect(rdma.facts["rdma.node_guid"]).toBeUndefined();
    expect(netdev.facts["devlink.port.flavour"].value).toBe("physical");
  });
});

function collector(name: string) { return { collector: name, status: "success" as const, startedAt: "2026-07-21T00:00:00Z", completedAt: "2026-07-21T00:00:00Z", source: name }; }
