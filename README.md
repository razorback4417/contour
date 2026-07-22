# Contour

Contour is a deterministic Linux system-topology explorer. Run it on a machine to inspect CPU, NUMA, PCIe, GPU, NIC, RDMA, and storage relationships in a local browser.

## Clone, install, and run

Requirements:

- Linux for live collection;
- Node.js 22 or newer;
- `lstopo` from the hwloc package.

On Ubuntu or Debian, install the system prerequisite:

```bash
sudo apt install hwloc
```

Clone Contour directly on the Linux machine. There is normally no need to rsync the repository:

```bash
git clone https://github.com/razorback4417/contour.git
cd contour
npm install
npm link
contour
```

`npm install` builds the browser UI and CLI; `npm link` exposes the `contour` command from that checkout.

Contour inspects the machine, starts a loopback-only server at `http://127.0.0.1:4177`, and opens the default browser when one is available. Press `Ctrl+C` in the terminal to stop it. To update later, run `git pull` and `npm install` in the checkout.

## Commands

The normal interface is intentionally small:

```bash
contour                    # inspect this Linux machine
contour topology.json      # open a saved canonical snapshot
contour topology.xml       # open a saved lstopo XML capture
contour doctor             # check whether this machine is ready
contour --help             # show usage
```

Snapshots and deterministic SVGs are exported from the browser. `contour advanced` lists the scripting forms for collection, normalization, and static rendering.

## Run on a remote machine

SSH to the target, install Contour there, and run the same command:

```bash
contour
```

Contour detects the SSH session and prints the exact tunnel command. On your workstation it will look like:

```bash
ssh -N -L 4177:127.0.0.1:4177 user@host
```

Keep both terminals open, then visit `http://127.0.0.1:4177`. The topology UI remains bound to the remote loopback interface; it is not exposed to the network.

If the Linux machine cannot access GitHub, clone on the workstation and sync only the source tree:

```bash
# On the workstation
git clone https://github.com/razorback4417/contour.git
rsync -az --exclude .git --exclude node_modules --exclude dist --exclude dist-cli contour/ user@host:~/contour/

# On the Linux machine
cd ~/contour
npm install
npm link
contour
```

Build on the Linux machine; do not copy the workstation's `node_modules` or generated build directories. For later updates, rerun the same `rsync` command followed by `npm install` on the Linux machine.

If installing Contour on the target is undesirable, capture only lstopo XML and open it from a workstation installation:

```bash
ssh user@host 'lstopo --whole-system --of xml -' > topology.xml
contour topology.xml
```

Review captures before sharing them. Hardware model strings, hostnames, interface names, PCI identifiers, GUIDs, serials, and source paths may identify a machine or environment.

## What the view means

The diagram shows known topology facts, not measured traffic. Solid gray edges are containment; teal connects OS devices to PCI devices; dashed blue shows exposed ports; dotted cyan connects RDMA ports to netdevs; dashed gold shows explicit NUMA locality. Selecting two nodes highlights their known containment path.

The details panel preserves exact observed values and provenance. For a selected object, Contour offers one focused read-only terminal command when additional inspection would be useful.

## Develop and verify

```bash
npm install
npm test
npm run typecheck
npm run build
```

For UI development, run `npm run dev`. See [the architecture brief](docs/ARCHITECTURE.md), [canonical schema](docs/SCHEMA.md), [collector roadmap](docs/COLLECTORS.md), and [validation record](docs/VALIDATION.md).

## Current limits

Live collection currently combines lstopo XML, `ip -details -json link`, `/sys/class/net` PCI/NUMA evidence, and optional `rdma -j link show`. lspci enrichment, NVML, NVMe, and Mellanox-specific enrichment remain planned. NUMA locality and paths are shown only when supported by observed topology; Contour does not guess missing relationships or claim measured bandwidth or congestion.
