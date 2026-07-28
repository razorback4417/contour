# Live Argus demo

This walkthrough shows evidence already received by the bounded ClickHouse
window. It does not simulate packets or infer a physical network path.

## Connect

Keep the live UI loopback-only and open an SSH tunnel:

```bash
ssh -N -L 4178:127.0.0.1:4178 <user>@<receiver-host>
```

Then open `http://127.0.0.1:4178`.

## Five-minute path

1. Confirm the header says **Live · 2s refresh** and note the bounded
   observation window.
2. Open **Change** under **Focused execution**. Search by a process name,
   container ID, working directory, touched path, or endpoint.
3. Read the graph from left to right: container/parent context, selected
   execution, touched files or TCP flows, then interfaces and peer endpoints.
4. Select a node and use its dossier to show the exact Argus-backed facts and
   whether each relationship is observed or inferred.
5. Select **Replay window** to show when the active execution touched a file or
   changed a TCP connection.
6. Open **Evidence ledger** for the normalized activity sequence. Open
   **Compatibility** to show the observed Argus versions and grouped adapter
   diagnostics.

## Accurate claims

- Contour reconstructs a process-centered communication graph from Argus
  evidence in the selected window.
- A transport-timed activity is retained only when Argus has no usable
  activity timestamp and ClickHouse supplies its receipt time; the UI labels
  that fallback.
- The view can reveal a changed software-graph shape, but it does not yet learn
  a baseline or classify anomalies.
- IP endpoints remain IP endpoints unless another evidence source identifies
  the service or workload.
- Runtime evidence does not establish switch hops, routing intent, VLANs, or a
  physical cable path.

## Operator checks

```bash
systemctl --user status contour-runtime.service
journalctl --user -u contour-runtime.service -n 50 --no-pager
```

If the live reader fails, Contour keeps the last valid graph and marks the feed
stale rather than replacing it with synthetic data.
