export interface CliInvocation { command: string; args: string[]; }

const explicitCommands = new Set(["collect", "serve", "explore", "normalize", "svg", "doctor", "help", "advanced", "version"]);

export function resolveInvocation(argv: string[]): CliInvocation {
  const first = argv[0];
  if (!first) return { command: "explore", args: [] };
  if (["--help", "-h"].includes(first)) return { command: "help", args: argv.slice(1) };
  if (["--version", "-v"].includes(first)) return { command: "version", args: argv.slice(1) };
  if (explicitCommands.has(first)) return { command: first, args: argv.slice(1) };
  return { command: "explore", args: argv };
}
