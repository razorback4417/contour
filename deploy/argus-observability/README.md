# Argus observation pipeline

This deployment is the receiver side of:

```text
Argus -> Fluent Bit -> OTLP/HTTP Collector -> ClickHouse -> Contour
```

The collector owns OTLP ingress, batching, and retries. ClickHouse owns the
durable event window. Contour reads each stored `Body` through the Argus adapter
and reports observed product/schema versions and normalization diagnostics.

## Receiver setup

Requirements: Docker Engine with Compose v2.

```sh
cd deploy/argus-observability
cp .env.example .env
```

Set `OTLP_BIND_ADDRESS` in `.env` to the receiver's internal address and replace
the ClickHouse password:

```sh
chmod 600 .env
docker compose config --quiet
docker compose up -d
```

Do not commit `.env`.

The sender endpoint is:

```text
http://<OTLP_BIND_ADDRESS>:4318/v1/logs
```

## Fluent Bit handoff

The sender-side Argus-to-Fluent-Bit configuration owns the record mapping.
This is the minimal output:

```ini
[OUTPUT]
    Name          opentelemetry
    Match         argus.*
    Host          <OTLP_BIND_ADDRESS>
    Port          4318
    Logs_uri      /v1/logs
    Tls           Off
```

After the first real record arrives, inspect `Body`, `LogAttributes`, and
`ResourceAttributes` before setting `logs_body_key`. Contour needs the complete
Argus JSON record in `Body`; premature field selection could discard evidence.

## Verification

Health and storage are intentionally host-local:

```sh
curl --fail http://127.0.0.1:13133/
docker compose exec clickhouse sh -lc \
  'clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" \
  --query "SELECT Timestamp, ServiceName, Body FROM otel.otel_logs ORDER BY Timestamp DESC LIMIT 5"'
```

The exporter creates `otel.otel_logs` and applies a 72-hour TTL. Stop the
services without deleting captured data with `docker compose stop`.

## Live Contour service

The supplied user service keeps the UI loopback-only, reads a bounded
250-record window, caps the Node.js process at 512 MiB and half a CPU, and does
not restart or modify the collector or ClickHouse:

```bash
mkdir -p ~/.config/systemd/user
cp deploy/argus-observability/contour-runtime.service \
  ~/.config/systemd/user/contour-runtime.service
systemctl --user daemon-reload
systemctl --user enable --now contour-runtime.service
```

The deployed build is expected at `~/contour-live/current`, with the receiver
environment at `~/contour/deploy/argus-observability/.env`. Inspect the service
without exposing it to the network:

```bash
systemctl --user status contour-runtime.service
curl --fail http://127.0.0.1:4178/
```

From a workstation, tunnel the loopback listener and open
`http://127.0.0.1:4178`:

```bash
ssh -N -L 4178:127.0.0.1:4178 <user>@<receiver-host>
```

See [`../../docs/ARGUS-DEMO.md`](../../docs/ARGUS-DEMO.md) for the demo path and
claim boundaries.
