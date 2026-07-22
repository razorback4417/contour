# Canonical topology schema v2

`TopologySnapshot` is the durable renderer contract. Required top-level fields are `schemaVersion`, `snapshotId`, `hostId`, `collectedAt`, `nodes`, `edges`, `collectors`, and `diagnostics`.

## Nodes

Every node has a stable `id`, a generic `kind`, a technical `label`, optional `parentId`, and a sorted fact map. Supported kinds are:

`host`, `numa_node`, `cpu_package`, `cpu_core`, `cache`, `memory_region`, `pci_domain`, `pci_bus`, `pci_bridge`, `pci_endpoint`, `gpu`, `nic`, `rdma_device`, `network_port`, `network_interface`, and `storage_device`.

Each fact is `{ value, state, provenance }`. `state` is one of:

- `observed`: directly present in source data;
- `derived`: produced by a named deterministic rule;
- `unknown`: relevant but the source cannot supply it.

Absence means the fact is not applicable or not modeled. It is distinct from an explicit `unknown` fact.

Vendor or source-specific data uses namespaced keys such as `hwloc.pci_type`; it does not create vendor-specific generic entity types.

## Edges

Edges have stable IDs, `source`, `target`, a typed `kind`, a fact map, and provenance. Kinds are `contains`, `attached_to`, `local_to`, `exposes`, `backed_by`, `connected_to`, `shares_bridge_with`, and `derived_from`. Containment follows source hierarchy. `backed_by` relates OS devices to their PCI device. `local_to` is emitted only from explicit NUMA ancestry or nodeset evidence; it is never guessed from visual proximity.

Edge facts represent properties of a connection rather than either endpoint. PCIe negotiated/capable speed and width, AER evidence, and vendor link counters therefore live on the device's upstream containment edge. A v1 snapshot is migrated on load by adding empty edge fact maps; new exports always use `contour.topology/v2`.

## Identity

Identity material is type plus a host-relative physical key:

- host: source root identity, preferring an observed hostname when supplied (sanitized fixtures use synthetic names);
- NUMA/package/core/cache: type, logical index, and stable ancestor path;
- PCI: normalized domain:BDF and entity type;
- OS devices: type, stable source name, and backing PCI identity;
- edges: relationship kind plus sorted endpoint IDs (direction retained for directed relationships).

The ID encoding is a deterministic FNV-1a hash plus kind prefix. Labels, sibling positions, timestamps, and discovery order are excluded.

## Provenance and collectors

A provenance record contains `collector`, `source`, `sourceField`, `rawValue`, `normalizedValue`, `method`, and optional `derivationRule`. Important displayed facts carry their own provenance; relationships carry the evidence that created them.

Collector results distinguish `success`, `partial`, `unavailable`, and `failed`, with optional diagnostics. A missing collector result is not equivalent to an unavailable source.

## Diagnostics

Diagnostics have a stable code, severity (`info`, `warning`, `error`), message, optional entity/source reference, and deterministic ID. Errors describe invalid contract or unusable input. Warnings describe partial or unsupported observations. Diagnostics are data and render with the snapshot; partial collection does not prevent rendering unless no topology root can be recovered.

## Troubleshooting analysis

Path dossiers and findings are deterministic views computed from the canonical snapshot; they do not mutate or extend the durable schema. A dossier contains the known containment route, endpoint locality status, scoped findings, exact supporting facts, uncertainty language, and a verification command. Rules may identify reported link downgrades, nonzero error evidence, RDMA/netdev state disagreement, unhealthy driver reporters, unknown NUMA locality, shared immediate bridges, and incomplete collection. These findings describe evidence to investigate and never claim measured congestion or root cause.
