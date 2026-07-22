import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseHwlocXml } from "../adapters/hwloc";
import { normalizeHwloc } from "../normalize/hwloc";
import type { TopologySnapshot } from "../model/types";

export interface ProcessResult { stdout: string; stderr: string; }
export type ProcessRunner = (file: string, args: string[]) => Promise<ProcessResult>;

export interface LstopoCollectorOptions {
  runner?: ProcessRunner;
  now?: () => Date;
}

export class CollectorUnavailableError extends Error {
  readonly collector = "hwloc.lstopo_xml";
  constructor(message: string, readonly causeCode?: string) {
    super(message);
    this.name = "CollectorUnavailableError";
  }
}

const execFileAsync = promisify(execFile);

const defaultRunner: ProcessRunner = async (file, args) => {
  const result = await execFileAsync(file, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { stdout: result.stdout, stderr: result.stderr };
};

export async function collectLstopo(options: LstopoCollectorOptions = {}): Promise<TopologySnapshot> {
  const runner = options.runner ?? defaultRunner;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let result: ProcessResult;
  try {
    result = await runner("lstopo", ["--whole-system", "--of", "xml", "-"]);
  } catch (error) {
    const code = isNodeError(error) ? error.code : undefined;
    const detail = code === "ENOENT"
      ? "lstopo is not installed. Install the hwloc package and retry."
      : `lstopo failed${code ? ` (${code})` : ""}: ${error instanceof Error ? error.message : String(error)}`;
    throw new CollectorUnavailableError(detail, code);
  }
  if (!result.stdout.trim()) throw new CollectorUnavailableError(`lstopo returned no XML${result.stderr ? `: ${result.stderr.trim()}` : "."}`);
  const completedAt = now().toISOString();
  const snapshot = normalizeHwloc(parseHwlocXml(result.stdout, "command:lstopo --whole-system --of xml -"), { collectedAt: completedAt });
  snapshot.collectors[0].startedAt = startedAt;
  snapshot.collectors[0].completedAt = completedAt;
  if (result.stderr.trim()) {
    snapshot.collectors[0].status = "partial";
    snapshot.collectors[0].message = result.stderr.trim();
  }
  return snapshot;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
