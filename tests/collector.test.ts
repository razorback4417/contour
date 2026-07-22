import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectLstopo } from "../src/collectors/lstopo";

const xml = readFileSync(new URL("../fixtures/workstation.xml", import.meta.url), "utf8");

describe("local lstopo collector", () => {
  it("owns command invocation and returns a canonical snapshot", async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const times = [new Date("2026-07-21T10:00:00Z"), new Date("2026-07-21T10:00:01Z")];
    const snapshot = await collectLstopo({
      runner: async (file, args) => { calls.push({ file, args }); return { stdout: xml, stderr: "" }; },
      now: () => times.shift()!
    });
    expect(calls).toEqual([{ file: "lstopo", args: ["--whole-system", "--of", "xml", "-"] }]);
    expect(snapshot.collectors[0]).toMatchObject({ status: "success", startedAt: "2026-07-21T10:00:00.000Z", completedAt: "2026-07-21T10:00:01.000Z" });
    expect(snapshot.nodes.some((node) => node.kind === "nic")).toBe(true);
  });

  it("reports an unavailable tool instead of an empty topology", async () => {
    const error = Object.assign(new Error("spawn lstopo ENOENT"), { code: "ENOENT" });
    await expect(collectLstopo({ runner: async () => { throw error; } })).rejects.toEqual(expect.objectContaining({ causeCode: "ENOENT" }));
  });
});
