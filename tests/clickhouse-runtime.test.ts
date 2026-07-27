import { describe, expect, it, vi } from "vitest";
import { ClickHouseReadError, readArgusJsonLinesFromClickHouse } from "../src/runtime/clickhouse";

describe("ClickHouse Argus reader", () => {
  it("preserves raw Body records and requests a bounded chronological window", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response([
      '{"Body":"{\\"message_id\\":\\"older\\",\\"future_field\\":\\"preserved\\"}"}',
      '{"Body":"{\\"message_id\\":\\"newer\\"}"}',
      "",
    ].join("\n")));

    const jsonl = await readArgusJsonLinesFromClickHouse({
      endpoint: "http://127.0.0.1:8123",
      database: "otel",
      username: "contour",
      password: "secret",
      limit: 250,
    }, request);

    expect(jsonl).toBe([
      '{"message_id":"older","future_field":"preserved"}',
      '{"message_id":"newer"}',
    ].join("\n"));
    const [url, init] = request.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8123/");
    expect(init?.body).toContain("FROM otel.otel_logs");
    expect(init?.body).toContain("ORDER BY Timestamp DESC");
    expect(init?.body).toContain("LIMIT 250");
    expect(init?.body).toContain("ORDER BY Timestamp ASC");
    expect(init?.headers).toMatchObject({
      authorization: `Basic ${Buffer.from("contour:secret").toString("base64")}`,
    });
  });

  it("reports backend failures without interpreting their payload", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      "database unavailable",
      { status: 503, statusText: "Service Unavailable" },
    ));

    await expect(readArgusJsonLinesFromClickHouse({
      endpoint: "http://127.0.0.1:8123",
      database: "otel",
      limit: 100,
    }, request)).rejects.toThrow(new ClickHouseReadError(
      "ClickHouse query failed (503): database unavailable",
    ));
  });

  it("rejects unsafe database identifiers at the storage boundary", async () => {
    await expect(readArgusJsonLinesFromClickHouse({
      endpoint: "http://127.0.0.1:8123",
      database: "otel; DROP DATABASE otel",
      limit: 100,
    })).rejects.toThrow("Invalid ClickHouse database");
  });
});
