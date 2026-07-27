export interface ClickHouseArgusOptions {
  endpoint: string;
  database: string;
  username?: string;
  password?: string;
  limit: number;
}

export class ClickHouseReadError extends Error {}

export async function readArgusJsonLinesFromClickHouse(
  options: ClickHouseArgusOptions,
  request: typeof fetch = fetch,
): Promise<string> {
  const endpoint = parseEndpoint(options.endpoint);
  const database = identifier(options.database, "database");
  const limit = positiveInteger(options.limit, "limit");
  const query = [
    "SELECT Body",
    "FROM (",
    `  SELECT Timestamp, Body FROM ${database}.otel_logs`,
    "  ORDER BY Timestamp DESC",
    `  LIMIT ${limit}`,
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
    response = await request(endpoint, { method: "POST", headers, body: query });
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

  const records = body.split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      throw new ClickHouseReadError(`ClickHouse returned invalid JSON on row ${index + 1}.`);
    }
    if (!isRecord(row) || typeof row.Body !== "string") {
      throw new ClickHouseReadError(`ClickHouse row ${index + 1} has no string Body.`);
    }
    return row.Body;
  });
  return records.join("\n");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
