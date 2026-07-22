# Contour

Contour is a deterministic Linux system-topology explorer. It loads an hwloc/lstopo XML snapshot, normalizes it into a versioned canonical graph, validates and lays out that graph, renders an interactive engineering view, and exports stable SVG.

The first slice is intentionally offline-first: SSH and live collection are validation workflows, not runtime requirements.

## Run locally

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run dev
```

Open the printed local URL. The accelerator fixture loads by default. Use the fixture buttons or **Load XML** to inspect another snapshot.

## Collect an input

Install hwloc using the package manager for the target Linux host, then run:

```bash
lstopo --whole-system --of xml > topology.xml
```

Inspect the XML before moving or committing it. Hostnames, interface names, PCI IDs, serials, GUIDs, MAC/IP addresses, model strings, and source paths may identify a machine or environment.

Contour never runs this command from the browser. Copy the file to the workstation running Contour and load it there.

## Validate, normalize, and export

```bash
npm test
npm run typecheck
npm run build
npm run --silent contour -- normalize fixtures/workstation.xml > /tmp/contour-snapshot.json
npm run --silent contour -- svg fixtures/workstation.xml > /tmp/contour-topology.svg
```

The CLI writes to stdout so callers choose where artifacts go. Repeating either command with the same bytes and source path produces stable canonical JSON or SVG.

## Current interaction

- pan and zoom the topology;
- search labels, types, BDFs, interfaces, and observed fact values;
- filter canonical device classes;
- highlight devices with explicit NUMA-locality relationships;
- double-click a node to collapse its descendants;
- select two nodes to highlight their known containment path;
- inspect exact values, raw source fields, collector identity, and derivation rules;
- export the filtered/highlighted view as deterministic SVG.

## Architecture

See [the architecture brief](docs/ARCHITECTURE.md), [canonical schema](docs/SCHEMA.md), [collector roadmap](docs/COLLECTORS.md), and [local/live validation record](docs/VALIDATION.md).

```text
raw lstopo XML -> hwloc adapter -> canonical normalization -> validation
                -> deterministic hierarchy layout -> interactive/static renderer
```

## Known limitations

- Only lstopo XML input is implemented; sysfs, lspci, RDMA, networking, NVML, NVMe, and Mellanox sources are researched but not yet adapters.
- The v1 parser covers the source types exercised by the two sanitized fixtures; unsupported hwloc objects are skipped while their supported descendants remain attached to the closest canonical ancestor.
- PCI domain/bus entities are not synthesized when hwloc provides only bridges/devices.
- NUMA locality is emitted only when the source hierarchy supplies NUMA ancestry. No proximity guess is made.
- Path tracing follows known canonical containment, not measured bandwidth or routing.
- Shared-bridge relationships are visible through the common ancestor but are not materialized as pairwise `shares_bridge_with` edges.
- The custom layout favors auditability and stable order over compact placement on very large core counts. Progressive aggregation is the next rendering increment.
- Timestamps default to the Unix epoch for offline normalization unless the caller supplies collection metadata. Stable IDs never depend on timestamps.
