export interface ClickHouseArgusOptions {
  endpoint: string;
  database: string;
  username?: string;
  password?: string;
  limit: number;
  timeoutMs?: number;
}

export interface ClickHouseArgusBatch {
  records: ClickHouseArgusRecord[];
  earlierCursor?: string;
  hasEarlier: boolean;
}

export interface ClickHouseArgusRecord {
  body: string;
  receivedAt: string;
}

export interface ClickHouseArgusPosition {
  cursor?: string;
  before?: string;
}

export class ClickHouseReadError extends Error {}

export async function readArgusJsonLinesFromClickHouse(
  options: ClickHouseArgusOptions,
  request: typeof fetch = fetch,
): Promise<string> {
  return (await readArgusBatchFromClickHouse(options, undefined, request))
    .records.map((record) => record.body).join("\n");
}

export async function readArgusBatchFromClickHouse(
  options: ClickHouseArgusOptions,
  position?: ClickHouseArgusPosition,
  request: typeof fetch = fetch,
): Promise<ClickHouseArgusBatch> {
  const endpoint = parseEndpoint(options.endpoint);
  const database = identifier(options.database, "database");
  const limit = positiveInteger(options.limit, "limit");
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (position?.cursor && position.before) {
    throw new ClickHouseReadError("Choose either a history cursor or a timestamp, not both.");
  }
  const boundary = position?.cursor ? decodeCursor(position.cursor) : undefined;
  const before = position?.before ? timestamp(position.before) : undefined;
  if (boundary) {
    endpoint.searchParams.set("param_cursor_timestamp", boundary.timestamp);
  }
  if (before) endpoint.searchParams.set("param_before", before);
  const query = [
    "SELECT CursorTimestamp, ReceivedAt, Body",
    "FROM (",
    "  SELECT",
    "    Timestamp,",
    "    toString(Timestamp) AS CursorTimestamp,",
    "    formatDateTime(Timestamp, '%Y-%m-%dT%H:%i:%s.%fZ', 'UTC') AS ReceivedAt,",
    "    Body",
    `  FROM ${database}.otel_logs`,
    ...(boundary ? [
      "  WHERE Timestamp < parseDateTime64BestEffort({cursor_timestamp:String})",
    ] : before ? [
      "  WHERE Timestamp < parseDateTime64BestEffort({before:String})",
    ] : []),
    "  ORDER BY Timestamp DESC",
    `  LIMIT ${limit + 1}`,
    ")",
    "ORDER BY Timestamp ASC",
    "FORMAT JSONEachRow",
  ].join("\n");
  const headers: Record<string, string> = { "content-type": "text/plain; charset=utf-8" };
  if (options.username) {
    headers.authorization = `Basic ${Buffer.from(`${options.username}:${options.password ?? ""}`).toString("base64")}`;
  }

  let response: Response;
  try {
    response = await request(endpoint, {
      method: "POST",
      headers,
      body: query,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ClickHouseReadError(
      `Could not reach ClickHouse at ${endpoint.origin}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const body = await response.text();
  if (!response.ok) {
    throw new ClickHouseReadError(
      `ClickHouse query failed (${response.status}): ${body.trim().slice(0, 500) || response.statusText}`,
    );
  }

  const rows = body.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      throw new ClickHouseReadError(`ClickHouse returned invalid JSON on row ${index + 1}.`);
    }
    if (!isRecord(row)
      || typeof row.Body !== "string"
      || typeof row.CursorTimestamp !== "string"
      || typeof row.ReceivedAt !== "string") {
      throw new ClickHouseReadError(
        `ClickHouse row ${index + 1} has no string Body, receipt time, or timestamp cursor.`,
      );
    }
    return {
      body: row.Body,
      timestamp: row.CursorTimestamp,
      receivedAt: row.ReceivedAt,
    };
  });
  const hasEarlier = rows.length > limit;
  const visibleRows = hasEarlier ? rows.slice(rows.length - limit) : rows;
  const oldest = visibleRows[0];
  return {
    records: visibleRows.map((row) => ({
      body: row.body,
      receivedAt: row.receivedAt,
    })),
    earlierCursor: oldest ? encodeCursor(oldest.timestamp) : undefined,
    hasEarlier,
  };
}

function parseEndpoint(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new ClickHouseReadError(`Invalid ClickHouse URL: ${value}`);
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new ClickHouseReadError("ClickHouse URL must use http or https.");
  }
  return endpoint;
}

function identifier(value: string, name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new ClickHouseReadError(`Invalid ClickHouse ${name}: ${value}`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 100_000) {
    throw new ClickHouseReadError(`ClickHouse ${name} must be an integer from 1 to 100000.`);
  }
  return value;
}

function timestamp(value: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new ClickHouseReadError("Invalid ClickHouse history timestamp.");
  }
  return new Date(milliseconds).toISOString();
}

function encodeCursor(timestamp: string): string {
  return Buffer.from(JSON.stringify({ timestamp }), "utf8").toString("base64url");
}

function decodeCursor(value: string): { timestamp: string } {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!isRecord(decoded)
      || typeof decoded.timestamp !== "string") {
      throw new Error();
    }
    return { timestamp: decoded.timestamp };
  } catch {
    throw new ClickHouseReadError("Invalid ClickHouse history cursor.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
