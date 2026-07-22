import type { TopologySnapshot } from "../model/types";

export interface StartupContext {
  host: string;
  port: number;
  openRequested: boolean;
  browserOpened: boolean;
  sshSession: boolean;
  sshTarget?: string;
}

const statusMark = { success: "OK", partial: "PARTIAL", unavailable: "OPTIONAL", failed: "FAILED" } as const;

export function formatSnapshotSummary(snapshot: TopologySnapshot): string {
  const host = snapshot.nodes.find((node) => node.id === snapshot.hostId)?.label ?? "this host";
  const collectors = snapshot.collectors.map((collector) => {
    const message = collector.message ? ` — ${singleLine(collector.message)}` : "";
    return `  ${statusMark[collector.status].padEnd(8)} ${collector.collector}${message}`;
  });
  return [
    `Topology ready for ${host}`,
    `  ${snapshot.nodes.length} nodes · ${snapshot.edges.length} relationships · ${snapshot.diagnostics.length} diagnostics`,
    ...(collectors.length ? ["Collectors", ...collectors] : []),
  ].join("\n");
}

export function formatServerReady(url: string, context: StartupContext): string {
  const lines = ["", "Contour is ready", `  ${url}`];
  if (context.sshSession && isLoopback(context.host)) {
    const target = context.sshTarget ?? "user@host";
    lines.push(
      "",
      "Remote session detected. On your workstation, run:",
      `  ssh -N -L ${context.port}:127.0.0.1:${context.port} ${target}`,
      `Then open ${url}`,
    );
  } else if (context.openRequested && context.browserOpened) {
    lines.push("  Opened in your default browser.");
  } else {
    lines.push("  Open this URL in a browser.");
  }
  if (!isLoopback(context.host)) lines.push("", "Warning: this server is reachable beyond localhost. Prefer the loopback default with an SSH tunnel.");
  lines.push("", "Press Ctrl+C to stop Contour.");
  return lines.join("\n");
}

export function detectSshSession(environment: NodeJS.ProcessEnv): boolean {
  return Boolean(environment.SSH_CONNECTION || environment.SSH_CLIENT || environment.SSH_TTY);
}

export function sshTarget(environment: NodeJS.ProcessEnv, hostname: string): string {
  const serverAddress = environment.SSH_CONNECTION?.trim().split(/\s+/)[2];
  const targetHost = serverAddress?.includes(":") ? `[${serverAddress}]` : serverAddress || hostname;
  return `${environment.USER || environment.LOGNAME || "user"}@${targetHost}`;
}

function isLoopback(host: string): boolean { return host === "127.0.0.1" || host === "localhost" || host === "::1"; }
function singleLine(value: string): string { return value.replace(/\s+/g, " ").trim(); }
