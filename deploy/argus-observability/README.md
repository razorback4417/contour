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

Patrick owns the Argus-to-Fluent-Bit record mapping. This is the minimal output:

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
