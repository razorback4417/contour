import { describe, expect, it } from "vitest";
import { resolveInvocation } from "../src/cli/invocation";

describe("clean CLI invocation", () => {
  it("uses one normal command for local and offline exploration", () => {
    expect(resolveInvocation([])).toEqual({ command: "explore", args: [] });
    expect(resolveInvocation(["topology.json"])).toEqual({ command: "explore", args: ["topology.json"] });
    expect(resolveInvocation(["--no-open"])).toEqual({ command: "explore", args: ["--no-open"] });
  });

  it("keeps advanced automation commands explicit", () => {
    expect(resolveInvocation(["collect", "-o", "host.json"])).toEqual({ command: "collect", args: ["-o", "host.json"] });
    expect(resolveInvocation(["--help"])).toEqual({ command: "help", args: [] });
    expect(resolveInvocation(["doctor"])).toEqual({ command: "doctor", args: [] });
  });
});
