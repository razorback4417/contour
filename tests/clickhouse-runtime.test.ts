import { describe, expect, it, vi } from "vitest";
import {
  ClickHouseReadError,
  readArgusBatchFromClickHouse,
  readArgusJsonLinesFromClickHouse,
} from "../src/runtime/clickhouse";

describe("ClickHouse Argus reader", () => {
  it("preserves raw Body records and requests a bounded chronological window", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response([
      '{"CursorTimestamp":"2026-07-27 18:00:00.000000000","ReceivedAt":"2026-07-27T18:00:00.000000000Z","Body":"{\\"message_id\\":\\"older\\",\\"future_field\\":\\"preserved\\"}"}',
      '{"CursorTimestamp":"2026-07-27 18:00:01.000000000","ReceivedAt":"2026-07-27T18:00:01.000000000Z","Body":"{\\"message_id\\":\\"newer\\"}"}',
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
    expect(init?.body).toContain("LIMIT 251");
    expect(init?.body).toContain("ORDER BY Timestamp ASC");
    expect(init?.body).toContain("ReceivedAt");
    expect(init?.headers).toMatchObject({
      authorization: `Basic ${Buffer.from("contour:secret").toString("base64")}`,
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("pages earlier with an opaque cursor and keeps storage ordering out of callers", async () => {
    const latestRequest = vi.fn<typeof fetch>().mockResolvedValue(new Response([
      '{"CursorTimestamp":"2026-07-27 18:00:00.000000000","ReceivedAt":"2026-07-27T18:00:00.000000000Z","Body":"older"}',
      '{"CursorTimestamp":"2026-07-27 18:00:01.000000000","ReceivedAt":"2026-07-27T18:00:01.000000000Z","Body":"newer"}',
    ].join("\n")));
    const latest = await readArgusBatchFromClickHouse({
      endpoint: "http://127.0.0.1:8123",
      database: "otel",
      limit: 1,
    }, undefined, latestRequest);

    expect(latest.records).toEqual([{
      body: "newer",
      receivedAt: "2026-07-27T18:00:01.000000000Z",
    }]);
    expect(latest.hasEarlier).toBe(true);
    expect(latest.earlierCursor).toBeTruthy();

    const historyRequest = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      '{"CursorTimestamp":"2026-07-27 17:59:59.000000000","ReceivedAt":"2026-07-27T17:59:59.000000000Z","Body":"earlier"}',
    ));
    await readArgusBatchFromClickHouse({
      endpoint: "http://127.0.0.1:8123",
      database: "otel",
      limit: 1,
    }, { cursor: latest.earlierCursor }, historyRequest);

    const [url, init] = historyRequest.mock.calls[0];
    expect(new URL(String(url)).searchParams.get("param_cursor_timestamp"))
      .toBe("2026-07-27 18:00:01.000000000");
    expect(init?.body).toContain("{cursor_timestamp:String}");
    expect(init?.body).not.toContain("sipHash64");
  });

  it("accepts a validated timestamp boundary without exposing SQL interpolation", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(""));
    await readArgusBatchFromClickHouse({
      endpoint: "http://127.0.0.1:8123",
      database: "otel",
      limit: 100,
    }, { before: "2026-07-27T18:00:00Z" }, request);

    const [url, init] = request.mock.calls[0];
    expect(new URL(String(url)).searchParams.get("param_before"))
      .toBe("2026-07-27T18:00:00.000Z");
    expect(init?.body).toContain("{before:String}");
    expect(init?.body).not.toContain("2026-07-27T18:00:00");
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
