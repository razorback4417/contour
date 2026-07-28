# Contour

Contour is an evidence-backed topology explorer with two modes:

- **Physical topology** collects Linux CPU, NUMA, PCIe, GPU, NIC, RDMA, and
  storage evidence.
- **Runtime topology** normalizes supported NVIDIA DOCA Argus activity records
  and reconstructs process, container, file, TCP connection, endpoint, and
  interface relationships over time.

Runtime mode can replay JSONL captures or read bounded event windows from
ClickHouse. Contour does not log in to or install anything on the monitored
host. The bundled Argus workflow is synthetic; compatibility with production
Argus output still requires validation against an authorized hardware capture.

![Contour I/O topology showing a selected NIC, its PCIe path, related RDMA device and interface, provenance, and verification command](.github/assets/contour-overview.png)

*A sanitized accelerator fixture with one PCIe branch open. Contour reveals the relevant graph progressively, then connects a selected device to exact evidence and verification commands.*

![Contour Argus runtime topology showing a Python process connected to its container, model file, TCP flow, local interface, and peer endpoint](.github/assets/contour-runtime-argus.png)

*The bundled synthetic Argus replay. Contour reconstructs one process-centered software path, distinguishes observed from inferred relationships, and keeps the active evidence sequence visible below the graph.*

## Why Contour

`lstopo` is an excellent source of hardware topology, but its static whole-system output becomes difficult to investigate on dense machines. Contour keeps that evidence and changes how an engineer works with it.

| Static whole-system diagram | Contour |
| --- | --- |
| Shows the complete hierarchy at once | Starts with I/O or CPU/NUMA questions and reveals one branch at a time |
| Requires visual scanning for a device | Searches models, interfaces, RDMA names, and PCI BDFs |
| Primarily presents containment | Correlates PCI devices, netdevs, RDMA ports, NUMA evidence, and known paths |
| Produces a picture | Produces an evidence-backed route dossier with exact verification commands |

For runtime investigation, Argus supplies individual activity records. Contour
normalizes those records, correlates them into stable executions and
relationships, and keeps each conclusion linked to its source evidence.

### Why it matters

- Reduces the time spent correlating `lstopo`, sysfs, `ip`, and `rdma` output during bring-up or incident investigation.
- Makes shared PCIe paths and NUMA placement visible without claiming that topology alone proves congestion.
- Gives engineers an inspectable snapshot they can hand to another person and reproduce offline.
- Turns missing data into an explicit collector result instead of silently treating “unknown” as “not present.”

### How it is built

- Replaceable Linux collectors gather raw observations from hwloc, sysfs, iproute2, and optional RDMA tooling.
- Normalization produces one versioned canonical topology schema; the UI never parses command-specific output.
- Stable physical identities, typed relationships, diagnostics, and per-fact provenance make every displayed claim traceable.
- Deterministic projection, hierarchy layout, and SVG rendering produce the same result from the same normalized snapshot.
- The runtime adapter and temporal reducer keep Argus parsing, entity identity,
  correlation, and UI presentation separate.

## Quick start on Linux

Requirements: Node.js 22 or newer and `lstopo` from hwloc. `ethtool`, `rdma`, `devlink`, `nvidia-smi`, and `mlxlink` are optional evidence sources; missing tools do not prevent collection.

```bash
sudo apt install hwloc
git clone https://github.com/razorback4417/contour.git
cd contour
npm install
npm link
contour
```

Contour binds to `http://127.0.0.1:4177` and opens a browser when one is available. Press `Ctrl+C` to stop it. Run `contour doctor` if collection does not start.

## Mac to a remote Linux machine

Live collection runs on Linux. If the target can access GitHub, SSH to it and use the Linux quick start above.

If you need to clone on your Mac and copy the source to the target:

```bash
# On the Mac
git clone https://github.com/razorback4417/contour.git
rsync -az --exclude .git --exclude node_modules --exclude dist --exclude dist-cli contour/ user@host:~/contour/

# On the Linux target
ssh user@host
cd ~/contour
npm install
npm link
contour
```

Contour prints the exact tunnel command. Keep Contour running, then use a second Mac terminal:

```bash
ssh -N -L 4177:127.0.0.1:4177 user@host
```

Open `http://127.0.0.1:4177` on the Mac. The UI remains bound to the Linux machine's loopback interface and is not exposed to the network.

For later source updates, rerun the same `rsync` command and `npm install` on Linux. Build on Linux; do not copy `node_modules`, `dist`, or `dist-cli` from the Mac.

## Commands

```bash
contour                      # inspect this Linux machine
contour topology.json        # open a saved Contour snapshot
contour topology.xml         # open a saved lstopo XML capture
contour runtime argus.jsonl  # replay an Argus activity capture
contour runtime --clickhouse # read the latest Argus events from ClickHouse
contour doctor               # check prerequisites
contour --help               # show normal usage
contour advanced             # show scripting commands
```

Mac and Windows can open saved XML or JSON snapshots, but live collection is Linux-only. One way to capture XML without installing Contour remotely is:

```bash
ssh user@host 'lstopo --whole-system --of xml -' > topology.xml
contour topology.xml
```

## Using the UI

- Start with **I/O paths** or **CPU & NUMA** instead of rendering the complete graph.
- Select a node to inspect exact facts, provenance, relationships, and a focused verification command.
- Open a summarized I/O branch from the selected node's right panel.
- Search by model, device class, interface, RDMA name, or PCI BDF.
- Choose endpoint A and endpoint B to highlight their known containment path.
- Inspect the path dossier for hop-by-hop identity, explicit NUMA evidence, scoped findings, uncertainty, and verification commands.
- Use the mode-aware import guide to distinguish saved topology or runtime evidence from live collection.
- Export the canonical snapshot or current deterministic SVG from the browser.

The **Runtime** view turns separate Argus events into a process-centered
software flow. It shows container context, touched files, TCP connections,
local interfaces, peer endpoints, and the evidence sequence behind the graph.
Relationships are labeled as observed or inferred. If process identity is
ambiguous, Contour reports that ambiguity instead of merging records by PID.

An endpoint remains an IP and port unless an evidence source explicitly
identifies it. Contour does not guess application or service names from an
address.

Runtime captures can be replayed from JSONL or read live from bounded
ClickHouse windows. The UI supports process search, replay, earlier and newer
windows, UTC jumps, and a searchable evidence ledger. See
[`docs/RUNTIME.md`](docs/RUNTIME.md) for the experimental contract, network
topology boundary, and current adapter ownership.

For the receiver deployment, run Contour where ClickHouse is reachable directly
or through a tunnel to the storage environment. This does not require SSH
access to the monitored workload:

```bash
cd deploy/argus-observability
set -a && . ./.env && set +a
contour runtime --clickhouse
```

`CLICKHOUSE_URL` defaults to `http://127.0.0.1:8123`; the database defaults to
`otel`. The live reader refreshes the latest 500 stored bodies every two
seconds, restores chronological order, and passes the raw JSON records to the
same Argus normalizer as JSONL replay. The focused flow animates only
relationships backed by the active observation; it does not simulate packets.

Edges represent observed or inferred topology facts. When sources provide it, the inspector shows PCIe negotiated/capable width and speed, Ethernet link/FEC state, RDMA counters, driver health, and optional NVIDIA evidence. Counters and topology do not by themselves prove congestion; unknown information remains distinct from absent information.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

Use `npm run dev` for UI development. The durable topology contract and collector boundaries live in [`docs/SCHEMA.md`](docs/SCHEMA.md) and [`docs/COLLECTORS.md`](docs/COLLECTORS.md).

## Current limits

Physical collection combines hwloc XML, Linux PCI/network/InfiniBand sysfs,
iproute2, ethtool, RDMA, devlink, and optional NVIDIA evidence. Findings are
checks over one snapshot, not proof of congestion or failure. Direct NVML,
NVMe subsystem enrichment, physical link counter deltas, and fabric-wide
topology remain planned.

Runtime topology is limited to the events Argus exports in the selected window.
It can reconstruct software communication paths, but not switch hops, VLANs,
routing intent, DNS names, or Kubernetes service identity. Those require
separate remote evidence sources. Replay animation shows evidence progression,
not captured packets.

Snapshots may contain identifying hardware or environment data such as hostnames, interfaces, PCI identifiers, GUIDs, serials, and source paths. Review them before sharing.

Licensed under the [Apache License 2.0](LICENSE).
