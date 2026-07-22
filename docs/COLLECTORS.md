# Collector research and roadmap

This is the source-prioritized collector plan as of 2026-07-21. Each command must live behind its own collector/adapter and record status, version, stderr, and collection time. Correlation must use explicit keys such as PCI BDF, sysfs path, interface index/name, or RDMA device relationship.

## Implemented sources

- `lstopo --of xml`: the base CPU, cache, NUMA, PCI, and OS-device containment tree. hwloc explicitly supports exporting XML on one system and loading it on another. Bare `contour` invokes it locally; XML files remain loadable offline.
- `ip -details -json link show`: interface identity, state, MTU, queue counts, type, and physical port name.
- `/sys/class/net/<ifname>/device`: explicit interface-to-device path, PCI BDF when the path ends in one, and kernel NUMA affinity when non-negative.
- `rdma -j link show`: optional RDMA device/port state and explicit RDMA-port-to-netdev correlation. An unavailable command becomes an unavailable collector result rather than an empty RDMA topology.

## Priority 1: smallest useful enrichment

- Broader `/sys/devices`, `/sys/bus/pci`, and `/sys/class/*` coverage: stable Linux relationships and attributes with no human-output parser. This should become the baseline for hosts where hwloc is unavailable.
- `lspci -D -mm -nn -k` plus selected `-vv` fields: PCI identity, class/vendor/device IDs, driver, link capability/status, and bridge detail. Prefer sysfs for topology and use lspci as enrichment.
- `ip -json address`: optional address inventory, with a privacy policy before snapshots retain addresses.
- `rdma -j dev show`: device-level RDMA enrichment beyond the implemented link/port relationship.
- `ethtool --json` for supported queries, especially link modes and driver information. JSON coverage is partial, so every subcommand needs a capability result.
- `nvme list -o json` and `nvme list-subsys -o json`: controller, namespace, and subsystem relationships.

## Priority 2: accelerator and NVIDIA networking overlays

- NVIDIA NVML is the preferred programmatic GPU adapter: it is the supported library beneath `nvidia-smi` and exposes PCI identity, NUMA/topology levels, and NVLink state. Preserve the distinction between unavailable and unsupported values.
- `nvidia-smi -q -x` is a useful CLI fixture source because it has XML plus a DTD, but NVIDIA documents that NVSMI output is not backward-compatible. Keep versioned parsing isolated.
- `nvidia-smi topo -m` / newer focused `topo` commands answer GPU-to-GPU, GPU-to-NIC, CPU/memory affinity, and NVMe path questions. Their matrix output is an adapter input, never the canonical model.
- `ibdev2netdev`, `/sys/class/infiniband`, and `rdma` correlate mlx5 RDMA ports to netdevs and PCI devices. GUIDs must be sanitized in committed fixtures.
- `mlxlink` can enrich physical/link status for NVIDIA adapters. It is a later, optional collector: some operations or device access may require elevated privileges, and firmware-management tools such as `mstflint` must not be treated as discovery dependencies.

## Explicitly deferred

`dmidecode` (privilege and identifying serial data), fabric-wide tools such as `ibnetdiscover`, telemetry counters, cable diagnostics, and any command that changes link, firmware, or device state. These require a concrete use case and a separate privilege/sensitivity review.

Official references:

- [hwloc command-line tools](https://hwloc.readthedocs.io/en/master/doxygen/html/tools.html)
- [ethtool manual](https://man7.org/linux/man-pages/man8/ethtool.8.html)
- [NVIDIA System Management Interface](https://docs.nvidia.com/deploy/nvidia-smi/index.html)
- [NVIDIA NVML API](https://docs.nvidia.com/deploy/nvml-api/nvml-api-reference.html)
- [NVIDIA mlxlink utility](https://docs.nvidia.com/networking/display/mftv4330/mlxlink%2Butility)
