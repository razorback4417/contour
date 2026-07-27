# Runtime observation contract

Argus produces a changing record of workload behavior. That record is not part
of the physical `contour.topology/v2` snapshot. Contour normalizes runtime
records into a separate `contour.runtime/v1` capture and links the two views
only when they share explicit host or interface evidence.

## Ownership

- An input adapter owns knowledge of its external wire format and version.
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

The first Argus adapter and its fixtures remain synthetic until compared with
an authorized hardware capture. Hardware validation may change the adapter,
but it must not require changing the runtime contract or physical topology
schema.
