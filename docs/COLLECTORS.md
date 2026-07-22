# Collector research and roadmap

This is the source-prioritized collector plan as of 2026-07-22. Each command must live behind its own collector/adapter and record status, version, stderr, and collection time. Correlation must use explicit keys such as PCI BDF, sysfs path, interface index/name, or RDMA device relationship.

## Implemented sources

- `lstopo --of xml`: the base CPU, cache, NUMA, PCI, and OS-device containment tree. hwloc explicitly supports exporting XML on one system and loading it on another. Bare `contour` invokes it locally; XML files remain loadable offline.
- `ip -details -json link show`: interface identity, state, MTU, queue counts, type, and physical port name.
- `/sys/class/net/<ifname>/device`: explicit interface-to-device path, PCI BDF when the path ends in one, and kernel NUMA affinity when non-negative.
- `rdma -j link show`: optional RDMA device/port state and explicit RDMA-port-to-netdev correlation. An unavailable command becomes an unavailable collector result rather than an empty RDMA topology.
- `/sys/bus/pci/devices/<BDF>`: PCI identity, driver, IOMMU group, NUMA placement, negotiated/capable link speed and width, and available AER counters.
- `ethtool`, `ethtool -i`, and `ethtool --show-fec`: negotiated Ethernet speed, lanes, duplex, carrier, driver/firmware, and FEC evidence.
- `rdma -j statistic show`: optional per-port RDMA hardware counters.
- `devlink -j dev info` and `devlink -j health show`: optional firmware identity and driver health-reporter state. Serial-number fields are intentionally not retained.
- `nvidia-smi -q -x`: optional isolated XML adapter for GPU PCIe capability/state, replay counters, C2C mode, and NVLink availability.
- `mlxlink -d <BDF> --json`: optional NVIDIA Networking evidence for link speed/width, errors, BER, cable, and physical-grade fields. Permission failures remain explicit collector failures.

## Next enrichment

- Broader `/sys/devices`, `/sys/bus/pci`, and `/sys/class/*` coverage: stable Linux relationships and attributes with no human-output parser. This should become the baseline for hosts where hwloc is unavailable.
- `lspci -D -mm -nn -k` plus selected `-vv` fields: fallback PCI identity and bridge detail where sysfs is incomplete. Prefer sysfs for topology and link evidence.
- `ip -json address`: optional address inventory, with a privacy policy before snapshots retain addresses.
- `rdma -j dev show`: device-level RDMA enrichment beyond the implemented link, port, and statistic relationships.
- Direct ethtool netlink: replace isolated text adapters where deployed ethtool versions expose consistent structured replies.
- `nvme list -o json` and `nvme list-subsys -o json`: controller, namespace, and subsystem relationships.

## Accelerator and NVIDIA networking follow-on

- Direct NVML remains the preferred future programmatic GPU adapter. The implemented `nvidia-smi -q -x` collector is isolated because NVIDIA does not promise backward-compatible NVSMI output.
- `nvidia-smi topo -m` / newer focused `topo` commands answer GPU-to-GPU, GPU-to-NIC, CPU/memory affinity, and NVMe path questions. Their matrix output is an adapter input, never the canonical model.
- `ibdev2netdev`, `/sys/class/infiniband`, and `rdma` correlate mlx5 RDMA ports to netdevs and PCI devices. GUIDs must be sanitized in committed fixtures.
- Deeper `mlxlink` cable and eye diagnostics remain opt-in. Contour only performs a read-only JSON query and never changes port state.

## Explicitly deferred

`dmidecode` (privilege and identifying serial data), fabric-wide tools such as `ibnetdiscover`, continuous telemetry sampling, active cable diagnostics, and any command that changes link, firmware, or device state. These require a concrete use case and a separate privilege/sensitivity review.

Official references:

- [hwloc command-line tools](https://hwloc.readthedocs.io/en/master/doxygen/html/tools.html)
- [ethtool manual](https://man7.org/linux/man-pages/man8/ethtool.8.html)
- [NVIDIA System Management Interface](https://docs.nvidia.com/deploy/nvidia-smi/index.html)
- [NVIDIA NVML API](https://docs.nvidia.com/deploy/nvml-api/nvml-api-reference.html)
- [NVIDIA mlxlink utility](https://docs.nvidia.com/networking/display/mftv4330/mlxlink%2Butility)
