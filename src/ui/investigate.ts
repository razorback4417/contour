import type { TopologyNode } from "../model/types";

export interface InvestigationCommand {
  label: string;
  command: string;
  reason: string;
}

export function investigationCommands(node: TopologyNode): InvestigationCommand[] {
  const bdf = stringFact(node, "pci_bdf");
  const interfaceName = stringFact(node, "linux.ifname") ?? stringFact(node, "hwloc.name");

  if (node.kind === "network_interface" && interfaceName) return [recommendation(
    "Verify driver and PCI correlation",
    `ethtool -i ${shellQuote(interfaceName)}`,
    "Confirms the kernel driver, firmware version, and bus-info for this netdev."
  )];
  if (node.kind === "rdma_device" || node.kind === "network_port") return [recommendation(
    "Verify RDMA port mapping",
    "rdma -d -j link show",
    "Shows RDMA device, port, state, and netdev correlation with driver details."
  )];
  if (node.kind === "gpu") return [recommendation(
    "Verify accelerator locality",
    "nvidia-smi topo -m",
    "Checks NVIDIA's GPU, CPU, memory, NIC, and NVLink locality view when available."
  )];
  if (node.kind === "storage_device") return [recommendation(
    "Verify NVMe hierarchy",
    "nvme list-subsys -o json",
    "Shows NVMe subsystem, controller, namespace, and transport relationships."
  )];
  if (bdf) return [recommendation(
    "Verify PCIe path and link",
    `lspci -D -s ${shellQuote(bdf)} -vv`,
    "Checks the driver plus capable and negotiated PCIe link width and speed."
  )];
  if (node.kind === "numa_node") return [recommendation(
    "Verify NUMA distances",
    "numactl --hardware",
    "Shows CPU membership, local memory, and the kernel NUMA distance matrix."
  )];
  if (["host", "cpu_package", "cpu_core", "cache"].includes(node.kind)) return [recommendation(
    "Verify CPU and NUMA topology",
    "lscpu --json",
    "Shows architecture, sockets, cores, caches, and NUMA summary as structured data."
  )];
  return [];
}

function recommendation(label: string, command: string, reason: string): InvestigationCommand { return { label, command, reason }; }
function stringFact(node: TopologyNode, key: string): string | undefined { const value = node.facts[key]?.value; return typeof value === "string" && value ? value : undefined; }
function shellQuote(value: string): string { return `'${value.replaceAll("'", `'"'"'`)}'`; }
