# Runtime observation contract

Argus produces a changing record of workload behavior. That record is not part
of the physical `contour.topology/v2` snapshot. Contour normalizes runtime
records into a separate `contour.runtime/v1` capture. The two workspaces remain
separate; any future correlation must use explicit host or interface evidence.

## Ownership

- An input adapter owns knowledge of its external wire format and version.
- The ClickHouse reader owns storage ordering, opaque history cursors, and
  transport of raw `Body` strings and storage receipt timestamps; it does not
  interpret or rewrite Argus fields.
- The runtime normalizer owns the `contour.runtime/v1` observation contract.
- The temporal reducer owns entity identity, lifecycle state, and graph edges.
- The UI consumes normalized captures and never parses Argus fields.

Adapters preserve each raw record and identify synthetic input explicitly.
Unknown external fields may pass through the raw record without changing this
contract. Unsupported records become diagnostics rather than partially
invented observations.

## Capture

A runtime capture contains one host identity, a bounded time interval,
normalized observations, and diagnostics. It is an event history, not a claim
that every activity on the machine was observed.

Process identity uses the host boot, PID, process creation time, and Argus
self-exec identifier when available. PID alone is never a stable process
execution identity.

Every observation declares an evidence basis:

- `observed`: directly represented by a source record;
- `inferred`: produced by a named deterministic correlation rule.

Observation time has separate provenance. `argus` means the time came from the
Argus record. `transport_received` means Argus supplied no usable activity time
and the live ClickHouse boundary supplied its UTC receipt time. Offline JSONL
has no transport fallback.

Committed fixtures and the built-in example are synthetic. Imported and live
captures are labeled at the input boundary. Compatibility is specific to the
observed product/schema versions and normalization diagnostics; it is not a
blanket claim about every Argus deployment.

## Argus adapter status

`src/runtime/argus.ts` accepts one JSON object per line and maps the documented
process, container, file-descriptor, and TCP attribute names. Process evidence
includes the current working directory and PID, mount, and network namespaces
when supplied. It preserves unknown fields only inside the raw record and emits
diagnostics for malformed or unsupported activities.

`details_gathering_failed` is retained as an explicit Argus diagnostic rather
than invented graph activity. When a live record uses Argus's Unix-epoch
timestamp sentinel, the adapter may retain it with the ClickHouse receipt time,
an `argus.transport_timestamp_fallback` diagnostic, and explicit
`transport_received` time provenance.

The adapter does not claim that JSONL is Argus's transport framing. The caller,
rather than an input field, assigns the `synthetic` trust label. The
compatibility panel makes observed product/schema versions and unsupported
records visible without changing the runtime contract.

## Temporal graph

`src/runtime/graph.ts` reduces normalized observations into deterministic host,
container, process-execution, file, TCP-connection, endpoint, and interface
nodes. Direct source relationships remain `observed`; correlations such as
parent-process resolution are marked `inferred`.

Process execution identity includes the boot identity, PID, creation time, and
self-exec identifier. When creation time is absent and no active execution can
be correlated, the reducer emits an ambiguous identity and diagnostic instead
of merging observations by PID.

## Network topology boundary

Argus is sufficient for an evidence-backed **communication topology**, not a
physical fabric map. Contour can show:

- which process owned a TCP connection;
- the observed local and peer IP/port tuple and TCP state;
- the workload interface named by the connection event; and
- an inferred interface attachment when the local socket address matches the
  workload interface inventory carried in the Argus message header.

The inferred attachment is explicitly labeled as inferred. Argus alone does not
prove switch ports, intermediate hops, VLAN membership, routing intent, DNS or
Kubernetes service identity, or the physical cable path. Those require separate
evidence adapters such as LLDP/NVUE, Kubernetes EndpointSlices, DNS, or an
inventory source. They can enrich the same graph without changing ownership of
Argus normalization.

## Replay

```bash
npm run build
node dist-cli/cli.js runtime fixtures/argus/process-network-sequence.jsonl --no-open
```

The browser can also open `.jsonl` Argus records or canonical
`contour.runtime/v1` JSON. The built-in Runtime example is always labeled
synthetic. A user-supplied capture is labeled as a replay; the UI does not claim
that it was collected from validated hardware. **Import runtime evidence** first
shows the accepted formats and keeps live ClickHouse setup separate from
offline file import.

The ClickHouse mode refreshes its bounded window every two seconds. The UI
groups repeated executions behind a searchable process picker, follows the
latest evidence by default, and can replay the focused execution. Execution
search includes connected container, file, connection, interface, and endpoint
facts. Choosing replay or an event freezes that evidence window; replay can be
restarted deterministically. **Earlier window** pages
through retained ClickHouse history, **Newer** returns through windows already
visited in the browser, and a UTC timestamp can jump to the bounded page ending
before that time. **Live** explicitly resumes ingestion. The browser treats
storage cursors as opaque. If the pinned execution leaves the bounded live
window, Contour pauses instead of silently switching to a different process.
The **Evidence ledger** lists the normalized observations in the current bounded
window, not the entire retained ClickHouse table. It initially renders 100 rows,
supports process, PID, container, namespace, path, address, and activity search
plus kind filtering, and loads additional rows on demand. Selecting a row
returns to the associated execution when that process identity was
reconstructable. The compatibility panel inventories observed Argus
product/schema versions and groups normalization diagnostics by code.
Animated pulses travel only across nodes and edges whose evidence contains the
active normalized observation. For repeated TCP observations, pulse size reflects
the increase from the prior byte-counter sample for that connection. The first
sample is labeled as a cumulative counter. This is observed state progression,
not a packet animation or instantaneous throughput measurement. If refresh fails,
Contour keeps the last valid graph and marks the feed stale.

The receiver deployment can be read directly:

```bash
set -a && . deploy/argus-observability/.env && set +a
contour runtime --clickhouse
```

The ClickHouse reader selects a bounded newest window, restores chronological
order, and transports each `Body` unchanged alongside its UTC storage receipt
time into the Argus adapter. Earlier pages use a timestamp cursor encoded at
the storage boundary, so the UI never learns ClickHouse ordering semantics or
adds a secondary sort over event bodies.
It defaults to
`http://127.0.0.1:8123`, database `otel`, and 500 records. Override the endpoint
with `CLICKHOUSE_URL` or the window with `--limit`. Reads time out after five
seconds so a slow backend cannot leave the live UI waiting indefinitely.

Raw Argus records remain available at the ingestion boundary for provenance,
but are omitted from the live browser payload. The UI receives normalized
observations and evidence IDs only; this keeps the two-second refresh bounded
without changing graph construction.
