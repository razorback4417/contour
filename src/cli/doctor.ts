import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

export type DoctorState = "ok" | "optional" | "missing";
export interface DoctorCheck { label: string; state: DoctorState; detail: string; fix?: string; }
export interface DoctorReport { checks: DoctorCheck[]; offlineReady: boolean; liveReady: boolean; }

const execFileAsync = promisify(execFile);

export async function inspectEnvironment(staticRoot: string): Promise<DoctorReport> {
  const major = Number(process.versions.node.split(".")[0]);
  const checks: DoctorCheck[] = [
    { label: "Node.js", state: major >= 22 ? "ok" : "missing", detail: `v${process.versions.node}`, ...(major >= 22 ? {} : { fix: "Install Node.js 22 or newer." }) },
  ];

  try {
    await access(`${staticRoot}/index.html`);
    checks.push({ label: "Contour UI", state: "ok", detail: "built assets found" });
  } catch {
    checks.push({ label: "Contour UI", state: "missing", detail: "built assets not found", fix: "From the repository, run: npm run build" });
  }

  if (process.platform !== "linux") {
    checks.push({ label: "Live collection", state: "optional", detail: `${process.platform} can open saved snapshots; live collection targets Linux` });
  } else {
    checks.push(await commandCheck("hwloc/lstopo", "lstopo", ["--version"], true, "Install hwloc: sudo apt install hwloc (Ubuntu/Debian) or sudo dnf install hwloc (Fedora/RHEL)."));
    checks.push(await commandCheck("iproute2", "ip", ["-Version"], false, "Install iproute2 for interface and PCI correlation."));
    checks.push(await commandCheck("RDMA tooling", "rdma", ["-V"], false, "Install iproute2's RDMA tooling to correlate RDMA ports and netdevs."));
  }

  const nodeReady = checks.find((check) => check.label === "Node.js")?.state === "ok";
  const uiReady = checks.find((check) => check.label === "Contour UI")?.state === "ok";
  const lstopoReady = checks.find((check) => check.label === "hwloc/lstopo")?.state === "ok";
  return { checks, offlineReady: nodeReady && uiReady, liveReady: Boolean(nodeReady && uiReady && process.platform === "linux" && lstopoReady) };
}

export function formatDoctorReport(report: DoctorReport): string {
  const mark = { ok: "OK", optional: "OPTIONAL", missing: "MISSING" } as const;
  const lines = ["Contour doctor", ...report.checks.map((check) => `  ${mark[check.state].padEnd(8)} ${check.label} — ${check.detail}`)];
  for (const check of report.checks) if (check.fix && check.state !== "ok") lines.push(`           ${check.fix}`);
  lines.push("", `Offline snapshots: ${report.offlineReady ? "ready" : "not ready"}`, `Live Linux collection: ${report.liveReady ? "ready" : "not ready"}`);
  return lines.join("\n");
}

async function commandCheck(label: string, command: string, args: string[], required: boolean, fix: string): Promise<DoctorCheck> {
  try {
    const result = await execFileAsync(command, args, { encoding: "utf8", timeout: 5000 });
    const version = firstLine(result.stdout) || firstLine(result.stderr) || "available";
    return { label, state: "ok", detail: version };
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String((error as NodeJS.ErrnoException).code) : "failed";
    return { label, state: required ? "missing" : "optional", detail: code === "ENOENT" ? "not installed" : `check failed (${code})`, fix };
  }
}

function firstLine(value: string): string { return value.trim().split(/\r?\n/, 1)[0] ?? ""; }
